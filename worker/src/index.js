// Cloudflare Worker: synchronizacja delt + prosty dashboard administratora.
// Endpointy:
//   POST /sync       — Basic Auth (login:hasło); przyjmuje i zwraca delty
//   GET  /dashboard  — panel admina (zarządzanie użytkownikami), token w polu formularza
//   POST /admin/users — tworzenie/usuwanie użytkowników (nagłówek X-Admin-Token)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function authenticate(request, env) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return null;
  let login, password;
  try {
    [login, password] = atob(header.slice(6)).split(':');
  } catch {
    return null;
  }
  if (!login) return null;
  const hash = await sha256Hex(`${login}:${password || ''}`);
  const user = await env.DB.prepare('SELECT id FROM users WHERE login = ? AND password_hash = ?')
    .bind(login, hash)
    .first();
  return user ? user.id : null;
}

// Scala dailyStats z dwóch urządzeń dzień po dniu — dzień z nowszym
// `updated_at` wygrywa, więc równoległa nauka na obu urządzeniach w różne
// dni sumuje się zamiast nadpisywać całą historię.
function mergeDailyStats(existing, incoming) {
  const merged = { ...(existing || {}) };
  for (const [day, incDay] of Object.entries(incoming || {})) {
    const cur = merged[day];
    if (!cur || (incDay.updated_at || 0) > (cur.updated_at || 0)) merged[day] = incDay;
  }
  return merged;
}

// Streak to pojedynczy licznik (nie da się go sumować per dzień) — bierzemy
// wersję z późniejszym `lastDay`, a przy remisie wyższy `count`.
function mergeStreak(existing, incoming) {
  if (!existing) return incoming || null;
  if (!incoming) return existing;
  if (incoming.lastDay > existing.lastDay) return incoming;
  if (existing.lastDay > incoming.lastDay) return existing;
  return (incoming.count || 0) >= (existing.count || 0) ? incoming : existing;
}

async function handleSync(request, env) {
  const userId = await authenticate(request, env);
  if (!userId) return json({ error: 'unauthorized' }, 401);

  const body = await request.json();
  const since = Number(body.since) || 0;
  const now = Date.now();

  // Zapis przychodzących delt (LWW po updated_at)
  for (const w of body.words || []) {
    await env.DB.prepare(
      `INSERT INTO words (user_id, id, data, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, id) DO UPDATE SET
         data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted
       WHERE excluded.updated_at > words.updated_at`
    )
      .bind(userId, w.id, JSON.stringify(w), w.updated_at || now, w.deleted ? 1 : 0)
      .run();
  }
  for (const p of body.progress || []) {
    await env.DB.prepare(
      `INSERT INTO progress (user_id, word_id, data, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, word_id) DO UPDATE SET
         data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted
       WHERE excluded.updated_at > progress.updated_at`
    )
      .bind(userId, p.wordId, JSON.stringify(p), p.updated_at || now, p.deleted ? 1 : 0)
      .run();
  }

  // dailyStats/streak: scal przychodzące dane z tym, co serwer już ma,
  // i odeślij WYNIK scalania — oba urządzenia zbiegają do tej samej sumy
  const metaRows = await env.DB.prepare('SELECT key, data FROM meta WHERE user_id = ?')
    .bind(userId)
    .all();
  const metaMap = {};
  for (const r of metaRows.results) metaMap[r.key] = JSON.parse(r.data);

  const mergedDailyStats = mergeDailyStats(metaMap.dailyStats, body.dailyStats);
  const mergedStreak = mergeStreak(metaMap.streak, body.streak);

  await env.DB.prepare(
    `INSERT INTO meta (user_id, key, data, updated_at) VALUES (?, 'dailyStats', ?, ?)
     ON CONFLICT (user_id, key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  )
    .bind(userId, JSON.stringify(mergedDailyStats), now)
    .run();
  if (mergedStreak) {
    await env.DB.prepare(
      `INSERT INTO meta (user_id, key, data, updated_at) VALUES (?, 'streak', ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    )
      .bind(userId, JSON.stringify(mergedStreak), now)
      .run();
  }

  // Zwrot zmian serwera od `since`
  const words = await env.DB.prepare(
    'SELECT data FROM words WHERE user_id = ? AND updated_at > ?'
  )
    .bind(userId, since)
    .all();
  const progress = await env.DB.prepare(
    'SELECT data FROM progress WHERE user_id = ? AND updated_at > ?'
  )
    .bind(userId, since)
    .all();

  return json({
    serverTime: now,
    words: words.results.map((r) => JSON.parse(r.data)),
    progress: progress.results.map((r) => JSON.parse(r.data)),
    dailyStats: mergedDailyStats,
    streak: mergedStreak,
  });
}

async function handleAdminUsers(request, env) {
  const token = request.headers.get('X-Admin-Token');
  if (!token || token !== env.ADMIN_TOKEN) return json({ error: 'forbidden' }, 403);
  const body = await request.json();

  if (body.action === 'create') {
    const hash = await sha256Hex(`${body.login}:${body.password}`);
    await env.DB.prepare(
      'INSERT INTO users (login, password_hash, created_at) VALUES (?, ?, ?) ON CONFLICT (login) DO UPDATE SET password_hash = excluded.password_hash'
    )
      .bind(body.login, hash, Date.now())
      .run();
    return json({ ok: true });
  }
  if (body.action === 'delete') {
    const user = await env.DB.prepare('SELECT id FROM users WHERE login = ?').bind(body.login).first();
    if (user) {
      await env.DB.prepare('DELETE FROM words WHERE user_id = ?').bind(user.id).run();
      await env.DB.prepare('DELETE FROM progress WHERE user_id = ?').bind(user.id).run();
      await env.DB.prepare('DELETE FROM meta WHERE user_id = ?').bind(user.id).run();
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
    }
    return json({ ok: true });
  }
  if (body.action === 'list') {
    const users = await env.DB.prepare('SELECT login, created_at FROM users').all();
    return json({ users: users.results });
  }
  return json({ error: 'unknown action' }, 400);
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kurs — dashboard</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0f172a;color:#f1f5f9;max-width:560px;margin:0 auto;padding:16px}
  input,button{font-size:16px;padding:10px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#f1f5f9;margin:4px 0}
  button{background:#22c55e;color:#052e13;font-weight:700;cursor:pointer;border:none}
  table{width:100%;border-collapse:collapse;margin-top:16px}
  td,th{padding:8px;border-bottom:1px solid #334155;text-align:left}
  .danger{background:#ef4444;color:#fff}
</style></head><body>
<h1>Dashboard administratora</h1>
<p>Token administratora:</p>
<input id="token" type="password" placeholder="ADMIN_TOKEN" style="width:100%">
<h2>Nowy użytkownik</h2>
<input id="login" placeholder="login"> <input id="password" type="password" placeholder="hasło">
<button onclick="createUser()">Utwórz / zmień hasło</button>
<h2>Użytkownicy</h2>
<button onclick="listUsers()">Odśwież listę</button>
<table><tbody id="users"></tbody></table>
<script>
async function api(action, extra) {
  const res = await fetch('/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': document.getElementById('token').value },
    body: JSON.stringify({ action, ...extra }),
  });
  if (!res.ok) { alert('Błąd: ' + res.status); throw new Error(res.status); }
  return res.json();
}
async function createUser() {
  await api('create', { login: login.value, password: password.value });
  alert('OK'); listUsers();
}
async function listUsers() {
  const data = await api('list');
  users.innerHTML = data.users.map(u =>
    '<tr><td>' + u.login + '</td><td>' + new Date(u.created_at).toLocaleDateString('pl') +
    '</td><td><button class="danger" onclick="removeUser(\\'' + u.login + '\\')">Usuń</button></td></tr>').join('');
}
async function removeUser(l) {
  if (!confirm('Usunąć ' + l + ' wraz z danymi?')) return;
  await api('delete', { login: l }); listUsers();
}
</script></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/sync' && request.method === 'POST') return handleSync(request, env);
    if (url.pathname === '/admin/users' && request.method === 'POST') return handleAdminUsers(request, env);
    if (url.pathname === '/dashboard') {
      return new Response(DASHBOARD_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return json({ ok: true, service: 'kurs-sync' });
  },
};
