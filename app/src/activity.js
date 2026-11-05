import { db, getMeta, setMeta } from './db.js';
import { localDay, aggregateDays, COUNTERS, mergeCounter, RULES_VERSION, FLOOR_LEVEL, normalizeProgress } from '../../shared/learning.js';

// One persistent counter per device and local day. Max-merge per component makes
// retries idempotent and preserves concurrent work on different devices.
export async function addActivity(delta, day = localDay(), now = Date.now()) {
  return db.transaction('rw', db.dailyCounters, db.meta, async () => {
    let deviceId = await getMeta('deviceId');
    if (!deviceId) { deviceId = crypto.randomUUID(); await setMeta('deviceId', deviceId); }
    const id = `${day}/${deviceId}`;
    const old = await db.dailyCounters.get(id);
    const row = mergeCounter(old, { id, day, deviceId });
    for (const key of COUNTERS) row[key] += Math.max(0, delta[key] || 0);
    row.updated_at = Math.max(now, (old?.updated_at || 0) + 1);
    await db.dailyCounters.put(row);
  });
}

export async function getDailyStats() {
  return aggregateDays(await db.dailyCounters.toArray());
}

export async function migrateLearningState(now = Date.now()) {
  await db.transaction('rw', db.progress, db.meta, db.dailyCounters, async () => {
    if ((await getMeta('learningRulesVersion', 0)) >= RULES_VERSION) return;
    const saved = await getMeta('settings', {});
    await setMeta('settings', { ...saved, floorLevel: FLOOR_LEVEL });
    for (const p of await db.progress.toArray()) {
      await db.progress.put(normalizeProgress(p));
    }
    // Shared legacy ID avoids counting previously synced history twice. Dates
    // are preserved: UTC aggregates cannot reliably be split into local days.
    const legacy = await getMeta('dailyStats', {});
    for (const [day, values] of Object.entries(legacy)) {
      const row = mergeCounter(null, { ...values, id: `${day}/legacy`, day, deviceId: 'legacy' });
      await db.dailyCounters.put(mergeCounter(await db.dailyCounters.get(row.id), row));
    }
    if (!(await getMeta('levelHistorySince'))) await setMeta('levelHistorySince', localDay(now));
    await setMeta('learningRulesVersion', RULES_VERSION);
  });
}
