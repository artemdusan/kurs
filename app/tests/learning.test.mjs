import 'fake-indexeddb/auto';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, setMeta, getMeta, getSettings } from '../src/db.js';
import { migrateLearningState, getDailyStats, addActivity } from '../src/activity.js';
import { newProgress, recordAnswer, lessonFloorReached, buildMistakesPool, bestStreak } from '../src/engine/session.js';
import { localDay, shiftDay, currentStreak, mergeCounter, aggregateDays } from '../../shared/learning.js';

const realNow = Date.now;
let clock;
const at = (s) => { clock = new Date(s).getTime(); Date.now = () => clock; };
const entry = (id = 'L1-n0', level = 1) => ({ word: { id }, progress: { ...newProgress(id), level }, sessionStreak: 0 });
beforeEach(async () => {
  Date.now = realNow;
  await db.delete(); await db.open();
  at('2026-11-05T12:00:00+01:00');
  await migrateLearningState();
});
after(async () => { Date.now = realNow; await db.delete(); });

test('migration preserves IDs, totals, unlocked lessons and settings; caps 11+ without generating events', async () => {
  await setMeta('learningRulesVersion', 0);
  await setMeta('settings', { floorLevel: 2, sessionMinutes: 20 });
  await setMeta('unlockedLesson', 10);
  await setMeta('dailyStats', { '2026-11-04': { correct: 12, wrong: 2, seconds: 123, sessions: 3 } });
  await db.progress.put({ ...newProgress('L1-n0'), level: 14, correctTotal: 48 });
  await migrateLearningState(); await migrateLearningState();
  assert.equal((await getSettings()).floorLevel, 3);
  assert.equal((await getSettings()).sessionMinutes, 20);
  assert.equal(await getMeta('unlockedLesson'), 10);
  assert.equal((await db.progress.get('L1-n0')).level, 10);
  assert.equal((await db.progress.get('L1-n0')).correctTotal, 48);
  assert.equal((await getDailyStats())['2026-11-04'].seconds, 123);
  assert.equal((await getDailyStats())['2026-11-04'].drops, 0);
});

test('one promotion per local day, midnight resets without waiting 24 hours', async () => {
  at('2026-11-05T23:59:00+01:00');
  let e = await recordAnswer(entry(), true);
  assert.equal(e.progress.level, 2);
  e = await recordAnswer(e, true);
  assert.equal(e.progress.level, 2);
  at('2026-11-06T00:01:00+01:00');
  e = await recordAnswer(e, true);
  assert.equal(e.progress.level, 3);
  const days = await getDailyStats();
  assert.equal(days['2026-11-05'].advances, 1);
  assert.equal(days['2026-11-06'].advances, 1);
});

test('mistake at level 1 blocks promotion only for that day', async () => {
  let e = await recordAnswer(entry(), false);
  e = await recordAnswer(e, true);
  assert.equal(e.progress.level, 1);
  assert.equal((await getDailyStats())['2026-11-05'].drops, 0);
  at('2026-11-06T00:00:01+01:00');
  e = await recordAnswer(e, true);
  assert.equal(e.progress.level, 2);
});

test('levels 2–5 fall by one, 6–10 to 5; no second change that day', async () => {
  for (let level = 2; level <= 10; level++) {
    let e = await recordAnswer(entry(`L1-n${level}`, level), false);
    assert.equal(e.progress.level, level >= 6 ? 5 : level - 1);
    e = await recordAnswer(e, true);
    assert.equal(e.progress.level, level >= 6 ? 5 : level - 1);
  }
  assert.equal((await getDailyStats())['2026-11-05'].drops, 9);
});

test('level 10 stays capped, a correct answer uses today, next-day mistake drops to 5', async () => {
  let e = await recordAnswer(entry('cap', 11), true);
  assert.equal(e.progress.level, 10);
  e = await recordAnswer(e, false);
  assert.equal(e.progress.level, 10);
  at('2026-11-06T12:00:00+01:00');
  e = await recordAnswer(e, false);
  assert.equal(e.progress.level, 5);
});

test('legacy cooldown timestamp is interpreted as a local calendar day', async () => {
  const e = entry(); e.progress.lastLevelChangeAt = new Date('2026-11-05T23:50:00+01:00').getTime();
  at('2026-11-06T00:10:00+01:00');
  assert.equal((await recordAnswer(e, true)).progress.level, 2);
});

test('floor checks all earlier cards and excludes deleted ones', async () => {
  await db.words.bulkPut([{ id: 'a', lesson: 1 }, { id: 'b', lesson: 2 }, { id: 'deleted', lesson: 1, deleted: 1 }]);
  await db.progress.bulkPut([{ ...newProgress('a'), level: 2 }, { ...newProgress('b'), level: 3 }]);
  assert.equal(await lessonFloorReached(2, 3), false);
  await db.progress.update('a', { level: 3 });
  assert.equal(await lessonFloorReached(2, 3), true);
  await db.progress.update('a', { level: 1 });
  assert.equal(await lessonFloorReached(2, 3), false);
});

test('local date and streak survive DST and expire after a missed day', () => {
  assert.equal(localDay(new Date('2026-11-06T00:30:00+01:00')), '2026-11-06');
  assert.equal(shiftDay('2026-03-30', -1), '2026-03-29');
  assert.equal(shiftDay('2026-10-26', -1), '2026-10-25');
  const daily = { '2026-03-28': { correct: 1 }, '2026-03-29': { correct: 1 } };
  assert.equal(currentStreak(daily, '2026-03-30').count, 2);
  // jeden opuszczony dzień ratuje „zamrożenie”, dwa z rzędu kończą serię
  assert.deepEqual(currentStreak(daily, '2026-03-31'), { count: 2, lastDay: '2026-03-29', frozen: ['2026-03-30'], freezeAvailable: false });
  assert.equal(currentStreak(daily, '2026-04-01').count, 0);
  assert.equal(bestStreak(daily), 2);
});

test('DST fallback does not grant a second promotion during the repeated hour', async () => {
  at('2026-10-25T02:30:00+02:00');
  let e = await recordAnswer(entry(), true);
  at('2026-10-25T02:30:00+01:00');
  e = await recordAnswer(e, true);
  assert.equal(e.progress.level, 2);
});

test('concurrent answers use stored progress and add counters atomically', async () => {
  await Promise.all([recordAnswer(entry(), true), recordAnswer(entry(), true), addActivity({ seconds: 1 })]);
  const p = await db.progress.get('L1-n0');
  assert.equal(p.level, 2);
  assert.equal(p.correctTotal, 2);
  assert.equal((await getDailyStats())['2026-11-05'].advances, 1);
  assert.equal((await getDailyStats())['2026-11-05'].seconds, 1);
});

test('persisted seconds survive closing and reopening the database without session finish', async () => {
  await addActivity({ seconds: 37 });
  db.close(); await db.open();
  assert.equal((await getDailyStats())['2026-11-05'].seconds, 37);
});

test('two device counters sum, merging/retries never double-count', () => {
  const a = { day: '2026-11-05', deviceId: 'a', correct: 10, seconds: 100 };
  const b = { day: a.day, deviceId: 'b', correct: 5, seconds: 60 };
  assert.equal(aggregateDays([mergeCounter(a, a), b])[a.day].correct, 15);
  assert.equal(mergeCounter(a, { ...a, correct: 8 }).correct, 10);
});

test('streak freeze: one missed day per seven days of study; a second gap inside that window ends the streak', () => {
  const on = (...days) => Object.fromEntries(days.map((d) => ['2026-11-' + String(d).padStart(2, '0'), { correct: 1 }]));
  // 1–3, [4 opuszczony], 5–12: jedna luka → seria 11
  const one = on(1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12);
  const s = currentStreak(one, '2026-11-12');
  assert.equal(s.count, 11);
  assert.deepEqual(s.frozen, ['2026-11-04']);
  assert.equal(s.freezeAvailable, true); // ratunek sprzed ponad tygodnia już się odnowił
  // luki 8. i 11.: między nimi tylko 2 dni nauki → seria liczy się od 9.
  const two = on(1, 2, 3, 4, 5, 6, 7, 9, 10, 12);
  assert.equal(currentStreak(two, '2026-11-12').count, 3);
  // luki 4. i 12. dzieli 7 dni nauki → obie uratowane
  const far = on(1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 13);
  assert.equal(currentStreak(far, '2026-11-13').count, 11);
  assert.equal(currentStreak(far, '2026-11-13').freezeAvailable, false);
});
