import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { reminderKind } from '../../worker/src/reminders.js';

test('reminder slots: evening needs an idle day, streak also needs yesterday, morning is opt-in', () => {
  assert.equal(reminderKind(19, {}), 'evening');
  assert.equal(reminderKind(19, { answersToday: 3 }), null);
  assert.equal(reminderKind(19, { prefs: { evening: false } }), null);
  assert.equal(reminderKind(21, { answersYesterday: 5 }), 'streak');
  assert.equal(reminderKind(21, { answersYesterday: 0 }), null);
  assert.equal(reminderKind(21, { answersToday: 1, answersYesterday: 5 }), null);
  assert.equal(reminderKind(8, {}), null);
  assert.equal(reminderKind(8, { prefs: { morning: true } }), 'morning');
  assert.equal(reminderKind(12, { prefs: { morning: true } }), null);
});

let mf, sql;
const auth = { Authorization: 'Basic ' + btoa('test:pw'), 'Content-Type': 'application/json' };
const post = async (path, body, headers = auth) => {
  const r = await mf.dispatchFetch('https://sync.test' + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
};
before(async () => {
  const bundled = await build({ entryPoints: ['../worker/src/index.js'], bundle: true, format: 'esm', write: false, platform: 'browser' });
  mf = new Miniflare({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2025-01-01', d1Databases: ['DB'], bindings: { TEST_HOOKS: '1', VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'x' } });
  sql = await mf.getD1Database('DB');
  const schema = (await readFile('../worker/schema.sql', 'utf8')).replace(/--[^\n]*/g, '');
  await sql.batch(schema.split(';').filter((s) => s.trim()).map((s) => sql.prepare(s)));
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('test:pw'))).toString('hex');
  await sql.prepare('INSERT INTO users (id, login, password_hash, created_at) VALUES (1, ?, ?, 0)').bind('test', hash).run();
  await post('/push/subscribe', { endpoint: 'https://push.example/abc' });
});
after(async () => { await mf?.dispose(); });

// 2026-07-15 to czas letni (UTC+2), 2026-12-15 zimowy (UTC+1).
const fire = async (iso) => (await post('/__test/reminders', { now: iso })).data;
const answer = (day) => sql.prepare('INSERT OR REPLACE INTO daily_counters (user_id, day, device_id, correct) VALUES (1, ?, ?, 4)').bind(day, 'd').run();

test('worker sends each reminder at the Warsaw hour in summer and winter time, and respects preferences', async () => {
  assert.deepEqual(await fire('2026-07-15T17:00:00Z'), [{ user_id: 1, kind: 'evening' }]);
  assert.deepEqual(await fire('2026-07-15T18:00:00Z'), []);
  assert.deepEqual(await fire('2026-12-15T18:00:00Z'), [{ user_id: 1, kind: 'evening' }]);
  assert.deepEqual(await fire('2026-12-15T17:00:00Z'), []);

  // 21:00 — tylko gdy wczoraj była nauka, a dziś jeszcze nie
  assert.deepEqual(await fire('2026-07-15T19:00:00Z'), []);
  await answer('2026-07-14');
  assert.deepEqual(await fire('2026-07-15T19:00:00Z'), [{ user_id: 1, kind: 'streak' }]);
  await answer('2026-07-15');
  assert.deepEqual(await fire('2026-07-15T19:00:00Z'), []);
  assert.deepEqual(await fire('2026-07-15T17:00:00Z'), []);

  // poranne jest wyłączone, dopóki użytkownik go nie włączy
  assert.deepEqual(await fire('2026-07-16T06:00:00Z'), []);
  assert.equal((await post('/push/prefs', { morning: true, evening: false })).data.prefs.streak, true);
  assert.deepEqual(await fire('2026-07-16T06:00:00Z'), [{ user_id: 1, kind: 'morning' }]);
  assert.deepEqual(await fire('2026-07-16T17:00:00Z'), []);
  assert.equal((await post('/push/prefs', {}, { 'Content-Type': 'application/json' })).status, 401);
});
