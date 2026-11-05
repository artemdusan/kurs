import { syncV2 } from './sync-v2.js';

// Cloudflare Worker: synchronizacja v2 + prosty dashboard administratora
// + przypomnienia web push (cron 19:00 czasu polskiego).
// Endpointy:
//   POST /sync       — Basic Auth (login:hasło); przyjmuje partie zmian i zwraca pełne postępy/liczniki
//   GET  /push/vapid — publiczny klucz VAPID (do subskrypcji w przeglądarce)
//   POST /push/subscribe   — Basic Auth; zapis subskrypcji push urządzenia
//   POST /push/unsubscribe — Basic Auth; usunięcie subskrypcji
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
    const credentials = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)));
    const separator = credentials.indexOf(':');
    if (separator < 1) return null;
    login = credentials.slice(0, separator);
    password = credentials.slice(separator + 1);
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

async function handleSync(request, env) {
  const userId = await authenticate(request, env);
  if (!userId) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'invalid_json' }, 400);
  const result = await syncV2(body, env.DB, userId);
  return json(result.body, result.status);
}

async function handlePushSubscribe(request, env) {
  const userId = await authenticate(request, env);
  if (!userId) return json({ error: 'unauthorized' }, 401);
  const sub = await request.json();
  if (!sub || !sub.endpoint) return json({ error: 'bad subscription' }, 400);
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, data, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, endpoint) DO UPDATE SET data = excluded.data`
  )
    .bind(userId, sub.endpoint, JSON.stringify(sub), Date.now())
    .run();
  return json({ ok: true });
}

async function handlePushUnsubscribe(request, env) {
  const userId = await authenticate(request, env);
  if (!userId) return json({ error: 'unauthorized' }, 401);
  const body = await request.json();
  if (!body?.endpoint) return json({ error: 'bad request' }, 400);
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .bind(userId, body.endpoint)
    .run();
  return json({ ok: true });
}

// --- Web push (VAPID, RFC 8292) ---
// Push wysyłamy BEZ payloadu (nie trzeba szyfrowania RFC 8291) — treść
// przypomnienia jest zaszyta w service workerze aplikacji (push-sw.js).
// Klucze: `npx web-push generate-vapid-keys`, sekrety VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY (base64url), VAPID_SUBJECT (mailto:...).

function b64urlToBytes(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function bytesToB64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function vapidJwt(audience, env) {
  // klucz publiczny web-push to surowy punkt P-256 (0x04 || x || y)
  const pub = b64urlToBytes(env.VAPID_PUBLIC_KEY);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: env.VAPID_PRIVATE_KEY,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = new TextEncoder();
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64url(
    enc.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: env.VAPID_SUBJECT || 'mailto:admin@example.com',
      })
    )
  );
  // WebCrypto zwraca podpis ECDSA w formacie raw r||s — dokładnie tym, którego wymaga JWT
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`))
  );
  return `${header}.${payload}.${bytesToB64url(sig)}`;
}

async function sendPush(endpoint, env) {
  const jwt = await vapidJwt(new URL(endpoint).origin, env);
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      TTL: '86400',
      Urgency: 'normal',
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
  });
}

// Cron (19:00 Europe/Warsaw): przypomnienie tylko dla użytkowników, którzy
// dziś nie mieli żadnej aktywności (dailyStats z synchronizacji). Jeśli była
// choć jedna odpowiedź — nic nie wysyłamy.
async function sendReminders(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  const warsawHour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: 'numeric', hour12: false }).format(new Date())
  );
  if (warsawHour !== 19) return; // cron odpala 17:00 i 18:00 UTC — trafia tylko jeden z nich

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const rows = await env.DB.prepare(
    `SELECT s.user_id, s.endpoint, m.data AS stats,
       (SELECT COALESCE(SUM(c.correct + c.wrong), 0) FROM daily_counters c WHERE c.user_id = s.user_id AND c.day = ?) AS answers
     FROM push_subscriptions s
     LEFT JOIN meta m ON m.user_id = s.user_id AND m.key = 'dailyStats'`
  ).bind(today).all();

  for (const r of rows.results) {
    let day = null;
    try {
      day = JSON.parse(r.stats || '{}')[today];
    } catch {}
    const active = r.answers > 0 || day && ((day.correct || 0) + (day.wrong || 0) > 0 || (day.seconds || 0) > 0);
    if (active) continue;
    const res = await sendPush(r.endpoint, env).catch(() => null);
    // 404/410 = subskrypcja wygasła (odinstalowana PWA itp.) — sprzątamy
    if (res && (res.status === 404 || res.status === 410)) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
        .bind(r.user_id, r.endpoint)
        .run();
    }
  }
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
      await env.DB.prepare('DELETE FROM daily_counters WHERE user_id = ?').bind(user.id).run();
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(user.id).run();
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
    }
    return json({ ok: true });
  }
  if (body.action === 'list') {
    const users = await env.DB.prepare(
      `SELECT u.login, u.created_at,
              m.data AS unlocked_lesson_data
       FROM users u
       LEFT JOIN meta m ON m.user_id = u.id AND m.key = 'unlockedLesson'`
    ).all();
    return json({
      users: users.results.map((u) => ({
        login: u.login,
        created_at: u.created_at,
        unlockedLesson: u.unlocked_lesson_data ? JSON.parse(u.unlocked_lesson_data) : null,
      })),
    });
  }
  if (body.action === 'setUnlockedLesson') {
    const lesson = Number(body.lesson);
    if (!Number.isInteger(lesson) || lesson < 1) return json({ error: 'bad lesson number' }, 400);
    const user = await env.DB.prepare('SELECT id FROM users WHERE login = ?').bind(body.login).first();
    if (!user) return json({ error: 'user not found' }, 404);
    // Świeży updated_at — wygrywa z tym, co urządzenie ma teraz, ale ustąpi
    // kolejnemu legalnemu odblokowaniu na urządzeniu (patrz handleSync).
    await env.DB.prepare(
      `INSERT INTO meta (user_id, key, data, updated_at) VALUES (?, 'unlockedLesson', ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    )
      .bind(user.id, JSON.stringify(lesson), Date.now())
      .run();
    return json({ ok: true });
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
<table><thead><tr><th>Login</th><th>Utworzono</th><th>Odblokowana lekcja</th><th></th></tr></thead><tbody id="users"></tbody></table>
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
function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
async function createUser() {
  await api('create', { login: login.value, password: password.value });
  alert('OK'); listUsers();
}
async function listUsers() {
  const data = await api('list');
  users.innerHTML = data.users.map(u =>
    '<tr><td>' + u.login + '</td><td>' + new Date(u.created_at).toLocaleDateString('pl') +
    '</td><td><input type="number" min="1" class="lesson-input" data-login="' + escAttr(u.login) +
    '" value="' + (u.unlockedLesson ?? '') + '" style="width:70px"></td>' +
    '<td><button onclick="setLesson(this)">Ustaw</button> ' +
    '<button class="danger" onclick="removeUser(\\'' + u.login + '\\')">Usuń</button></td></tr>').join('');
}
async function setLesson(btn) {
  const input = btn.closest('tr').querySelector('.lesson-input');
  const lesson = parseInt(input.value, 10);
  if (!lesson || lesson < 1) { alert('Podaj poprawny numer lekcji (≥ 1)'); return; }
  await api('setUnlockedLesson', { login: input.dataset.login, lesson });
  alert('Ustawiono lekcję ' + lesson + ' dla ' + input.dataset.login);
  listUsers();
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
    if (url.pathname === '/push/vapid' && request.method === 'GET') {
      return json({ key: env.VAPID_PUBLIC_KEY || '' });
    }
    if (url.pathname === '/push/subscribe' && request.method === 'POST') {
      return handlePushSubscribe(request, env);
    }
    if (url.pathname === '/push/unsubscribe' && request.method === 'POST') {
      return handlePushUnsubscribe(request, env);
    }
    if (url.pathname === '/admin/users' && request.method === 'POST') return handleAdminUsers(request, env);
    if (url.pathname === '/dashboard') {
      return new Response(DASHBOARD_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return json({ ok: true, service: 'kurs-sync' });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(env));
  },
};
