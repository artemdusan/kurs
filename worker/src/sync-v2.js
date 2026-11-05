import { COUNTERS, normalizeProgress } from '../../shared/learning.js';

const validDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const number = (n) => Number.isSafeInteger(n) && n >= 0;

function counterStatement(db, userId, row) {
  return db.prepare(`INSERT INTO daily_counters
    (user_id, day, device_id, correct, wrong, seconds, sessions, advances, drops, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, day, device_id) DO UPDATE SET
    ${COUNTERS.map((k) => `${k} = MAX(daily_counters.${k}, excluded.${k})`).join(', ')},
    updated_at = MAX(daily_counters.updated_at, excluded.updated_at)`)
    .bind(userId, row.day, row.deviceId, ...COUNTERS.map((k) => row[k] || 0), row.updated_at || 0);
}

// Existing UTC daily totals are retained as a shared baseline, never duplicated
// for each device. Batch commits are idempotent if the request is interrupted.
async function migrateLegacyStats(db, userId) {
  const done = await db.prepare("SELECT data FROM meta WHERE user_id = ? AND key = 'statsV2Migrated'").bind(userId).first();
  if (done) return;
  const legacy = await db.prepare("SELECT data FROM meta WHERE user_id = ? AND key = 'dailyStats'").bind(userId).first();
  const statements = Object.entries(JSON.parse(legacy?.data || '{}')).filter(([day]) => validDay(day))
    .map(([day, row]) => counterStatement(db, userId, { ...row, day, deviceId: 'legacy' }));
  // Each batch is atomic. The marker is only written once every row is saved.
  for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
  await db.prepare("INSERT INTO meta (user_id, key, data, updated_at) VALUES (?, 'statsV2Migrated', 'true', ?) ON CONFLICT DO NOTHING")
    .bind(userId, Date.now()).run();
}

export async function syncV2(body, db, userId) {
  if (body.protocol !== 2) return { status: 409, body: { error: 'client_upgrade_required' } };
  const progress = body.progress || [];
  const counters = body.counters || [];
  if (!Array.isArray(progress) || !Array.isArray(counters) || progress.length + counters.length > 25)
    return { status: 400, body: { error: 'bad_batch' } };
  for (const p of progress) {
    if (typeof p.wordId !== 'string' || p.wordId.length > 100 || !number(p.updated_at) || !Number.isFinite(p.level))
      return { status: 400, body: { error: 'bad_progress' } };
  }
  for (const row of counters) {
    if (!validDay(row.day) || typeof row.deviceId !== 'string' || !/^[\w-]{1,64}$/.test(row.deviceId)
      || row.id !== `${row.day}/${row.deviceId}` || !number(row.updated_at)
      || COUNTERS.some((key) => !number(row[key] || 0)))
      return { status: 400, body: { error: 'bad_counter' } };
  }
  const statements = [];
  for (const incoming of progress) {
    const p = normalizeProgress(incoming);
    statements.push(db.prepare(`INSERT INTO progress (user_id, word_id, data, updated_at, deleted)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, word_id) DO UPDATE SET
      data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted
      WHERE COALESCE(json_extract(progress.data, '$.rulesVersion'), 1) < 2
         OR excluded.updated_at > progress.updated_at`)
      .bind(userId, p.wordId, JSON.stringify(p), p.updated_at, p.deleted ? 1 : 0));
  }
  for (const row of counters) statements.push(counterStatement(db, userId, row));
  const unlocked = body.unlockedLesson;
  if (unlocked && Number.isInteger(unlocked.value) && unlocked.value >= 1 && unlocked.value <= 100 && number(unlocked.updated_at)) {
    statements.push(db.prepare(`INSERT INTO meta (user_id, key, data, updated_at) VALUES (?, 'unlockedLesson', ?, ?)
      ON CONFLICT (user_id, key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
      WHERE excluded.updated_at > meta.updated_at`)
      .bind(userId, JSON.stringify(unlocked.value), unlocked.updated_at));
  }
  if (validDay(body.historySince)) statements.push(db.prepare(`INSERT INTO meta (user_id, key, data, updated_at)
    VALUES (?, 'levelHistorySince', ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET
    data = MIN(meta.data, excluded.data), updated_at = MAX(meta.updated_at, excluded.updated_at)`)
    .bind(userId, JSON.stringify(body.historySince), Date.now()));
  if (statements.length) await db.batch(statements);
  if (body.pull === false) return { status: 200, body: { protocol: 2 } };
  await migrateLegacyStats(db, userId);
  // Full snapshots avoid holes caused by client clock skew or late offline
  // uploads. New writes after this read are returned at the next sync.
  const [rows, stats, meta] = await db.batch([
    db.prepare('SELECT data FROM progress WHERE user_id = ?').bind(userId),
    db.prepare('SELECT * FROM daily_counters WHERE user_id = ?').bind(userId),
    db.prepare("SELECT key, data, updated_at FROM meta WHERE user_id = ? AND key IN ('unlockedLesson', 'levelHistorySince')").bind(userId),
  ]);
  const metadata = Object.fromEntries(meta.results.map((r) => [r.key, r]));
  const unlock = metadata.unlockedLesson;
  return { status: 200, body: {
    protocol: 2,
    progress: rows.results.map((r) => normalizeProgress(JSON.parse(r.data))),
    counters: stats.results.map((r) => ({ id: `${r.day}/${r.device_id}`, day: r.day, deviceId: r.device_id,
      ...Object.fromEntries(COUNTERS.map((k) => [k, r[k]])), updated_at: r.updated_at })),
    historySince: metadata.levelHistorySince ? JSON.parse(metadata.levelHistorySince.data) : null,
    unlockedLesson: unlock ? { value: JSON.parse(unlock.data), updated_at: unlock.updated_at } : null,
  } };
}
