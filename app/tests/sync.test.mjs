import 'fake-indexeddb/auto';
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { db, setMeta, getMeta } from '../src/db.js';
import { addActivity, getDailyStats, migrateLearningState } from '../src/activity.js';
import { syncNow } from '../src/sync.js';
import { localDay, aggregateDays } from '../../shared/learning.js';

let mf, sql;
const realFetch = globalThis.fetch;
const day = localDay();
const row = (deviceId, correct, stamp = 10) => ({ id: `${day}/${deviceId}`, day, deviceId, correct, wrong: 0, seconds: correct * 10, sessions: 1, advances: correct, drops: 0, updated_at: stamp });
async function request(body) {
  const response = await mf.dispatchFetch('https://sync.test/sync', { method: 'POST', headers: { Authorization: 'Basic ' + btoa('test:pass:word'), 'Content-Type': 'application/json' }, body: JSON.stringify({ protocol: 2, ...body }) });
  return { status: response.status, data: await response.json() };
}
before(async () => {
  const bundled = await build({ entryPoints: ['../worker/src/index.js'], bundle: true, format: 'esm', write: false, platform: 'browser' });
  mf = new Miniflare({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2025-01-01', d1Databases: ['DB'] });
  sql = await mf.getD1Database('DB');
  const schema = (await readFile('../worker/schema.sql', 'utf8')).replace(/--[^\n]*/g, '');
  await sql.batch(schema.split(';').filter((s) => s.trim()).map((s) => sql.prepare(s)));
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('test:pass:word'))).toString('hex');
  await sql.prepare('INSERT INTO users (id, login, password_hash, created_at) VALUES (1, ?, ?, 0)').bind('test', hash).run();
});
beforeEach(async () => {
  globalThis.fetch = realFetch;
  await sql.batch(['progress', 'meta', 'daily_counters'].map((t) => sql.prepare(`DELETE FROM ${t}`)));
  await db.delete(); await db.open(); await migrateLearningState();
  await setMeta('settings', { syncUrl: 'https://sync.test', syncLogin: 'test', syncPassword: 'pass:word' });
});
after(async () => { globalThis.fetch = realFetch; await db.delete(); await mf?.dispose(); });

test('worker sums independent offline devices; retries and older payloads are idempotent', async () => {
  await Promise.all([request({ counters: [row('a', 10)] }), request({ counters: [row('b', 5)] })]);
  await request({ counters: [row('a', 10)] });
  const r = await request({ counters: [row('a', 8, 5)] });
  assert.equal(r.status, 200);
  assert.equal(aggregateDays(r.data.counters)[day].correct, 15);
  assert.equal(aggregateDays(r.data.counters)[day].advances, 15);
});

test('full snapshot returns a change uploaded late with an old device timestamp', async () => {
  await request({ progress: [{ wordId: 'first', level: 3, updated_at: 1000 }] });
  await request({});
  await request({ progress: [{ wordId: 'late', level: 4, updated_at: 100 }] });
  assert.equal((await request({})).data.progress.find((p) => p.wordId === 'late').level, 4);
});

test('server caps incoming high levels and rejects obsolete sync protocol', async () => {
  assert.equal((await request({ progress: [{ wordId: 'cap', level: 35, updated_at: 10 }] })).data.progress[0].level, 10);
  assert.equal((await request({ protocol: 1 })).status, 409);
});

test('legacy daily stats from server and client remain a single baseline', async () => {
  await sql.prepare("INSERT INTO meta VALUES (1, 'dailyStats', ?, 0)").bind(JSON.stringify({ [day]: { correct: 10, seconds: 100 } })).run();
  const r = await request({ counters: [row('legacy', 10), row('phone', 2)] });
  assert.equal(aggregateDays(r.data.counters)[day].correct, 12);
  assert.equal(aggregateDays((await request({})).data.counters)[day].correct, 12);
});

test('client preserves answers and unlocked lesson written while sync is in flight; next sync sends them', async () => {
  await addActivity({ correct: 1 });
  await db.progress.put({ wordId: 'card', level: 3, rulesVersion: 2, updated_at: 100 });
  await setMeta('unlockedLesson', 2); await setMeta('unlockedLessonUpdatedAt', 100);
  let injected = false;
  globalThis.fetch = async (url, options) => {
    const response = await mf.dispatchFetch(url, options);
    if (JSON.parse(options.body).pull && !injected) {
      injected = true;
      await addActivity({ correct: 1 });
      await db.progress.update('card', { level: 4, updated_at: 200 });
      await setMeta('unlockedLesson', 3); await setMeta('unlockedLessonUpdatedAt', 200);
    }
    return response;
  };
  await syncNow();
  assert.equal((await getDailyStats())[day].correct, 2);
  assert.equal((await db.progress.get('card')).level, 4);
  assert.equal(await getMeta('unlockedLesson'), 3);
  await syncNow();
  const r = await request({});
  assert.equal(aggregateDays(r.data.counters)[day].correct, 2);
  assert.equal(r.data.progress[0].level, 4);
  assert.equal(r.data.unlockedLesson.value, 3);
});

test('failed upload can be retried without doubling counters and without acknowledging unsent data', async () => {
  await addActivity({ correct: 4, seconds: 50 });
  let fail = true;
  globalThis.fetch = async (url, options) => {
    const response = await mf.dispatchFetch(url, options);
    if (fail) { fail = false; throw new Error('connection lost after server commit'); }
    return response;
  };
  await assert.rejects(syncNow(), /connection lost/);
  await syncNow();
  assert.equal(aggregateDays((await request({})).data.counters)[day].correct, 4);
});

test('client rejects old server response before changing local state', async () => {
  await addActivity({ correct: 4 });
  globalThis.fetch = async () => new Response(JSON.stringify({ dailyStats: {}, serverTime: Date.now() }));
  await assert.rejects(syncNow(), /Serwer wymaga aktualizacji/);
  assert.equal((await getDailyStats())[day].correct, 4);
});
