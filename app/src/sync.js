import { db, getMeta, setMeta, getSettings } from './db.js';
import { migrateLearningState } from './activity.js';
import { mergeCounter, normalizeProgress, progressWins } from '../../shared/learning.js';

export const DEFAULT_SYNC_URL = import.meta.env?.VITE_SYNC_URL || '';
export function resolveSyncUrl(settings) {
  let url = (settings.syncUrl || DEFAULT_SYNC_URL).trim().replace(/\/$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
}

// One in-flight sync per tab, plus a cross-tab Web Lock where supported.
let inFlight = null;
export function syncNow() {
  if (!inFlight) {
    const run = () => performSync();
    const work = globalThis.navigator?.locks
      ? navigator.locks.request('kurs-sync', run)
      : run();
    inFlight = work.finally(() => { inFlight = null; });
  }
  return inFlight;
}

async function performSync() {
  await migrateLearningState();
  const settings = await getSettings();
  const syncUrl = resolveSyncUrl(settings);
  if (!syncUrl || !settings.syncLogin) throw new Error('Uzupełnij adres serwera i login w ustawieniach');
  const ackKey = `syncAckV2:${syncUrl}:${settings.syncLogin}`;
  const snapshot = await db.transaction('r', db.progress, db.dailyCounters, db.meta, async () => ({
    progress: await db.progress.toArray(),
    counters: await db.dailyCounters.toArray(),
    ack: await getMeta(ackKey, { progress: {}, counters: {} }),
    historySince: await getMeta('levelHistorySince'),
    unlockedLesson: {
      value: await getMeta('unlockedLesson', 1),
      updated_at: await getMeta('unlockedLessonUpdatedAt', 0),
    },
  }));
  const progress = snapshot.progress.filter((p) => snapshot.ack.progress[p.wordId] !== p.updated_at);
  const counters = snapshot.counters.filter((p) => snapshot.ack.counters[p.id] !== p.updated_at);
  // Bound query count per request, including the initial upload of all cards.
  const uploads = [
    ...progress.map((p) => ({ type: 'progress', value: p })),
    ...counters.map((p) => ({ type: 'counters', value: p })),
  ];
  const request = async (batch, pull) => {
    const credentials = new TextEncoder().encode(`${settings.syncLogin}:${settings.syncPassword}`);
    const res = await fetch(syncUrl + '/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + btoa(String.fromCharCode(...credentials)) },
      body: JSON.stringify({ protocol: 2, pull,
        progress: batch.filter((x) => x.type === 'progress').map((x) => x.value),
        counters: batch.filter((x) => x.type === 'counters').map((x) => x.value),
        historySince: snapshot.historySince, unlockedLesson: snapshot.unlockedLesson,
      }),
    });
    if (res.status === 401) throw new Error('Błędny login lub hasło');
    if (res.status === 409) throw new Error('Zaktualizuj aplikację i serwer synchronizacji');
    if (!res.ok) throw new Error(`Synchronizacja nieudana (${res.status})`);
    const data = await res.json();
    if (data.protocol !== 2) throw new Error('Serwer wymaga aktualizacji do nowej synchronizacji');
    return data;
  };
  for (let i = 0; i < uploads.length; i += 25) await request(uploads.slice(i, i + 25), false);
  // Full progress snapshot is small for this course and cannot skip changes
  // uploaded late from an offline device. No shared client/server clock cursor.
  const data = await request([], true);
  await db.transaction('rw', db.progress, db.dailyCounters, db.meta, async () => {
    for (const remote of data.progress || []) {
      const local = await db.progress.get(remote.wordId);
      if (progressWins(remote, local)) await db.progress.put(normalizeProgress(remote));
    }
    for (const remote of data.counters || []) {
      await db.dailyCounters.put(mergeCounter(await db.dailyCounters.get(remote.id), remote));
    }
    const localUnlockAt = await getMeta('unlockedLessonUpdatedAt', 0);
    if (data.unlockedLesson && data.unlockedLesson.updated_at > localUnlockAt) {
      await setMeta('unlockedLesson', data.unlockedLesson.value);
      await setMeta('unlockedLessonUpdatedAt', data.unlockedLesson.updated_at);
    }
    const localSince = await getMeta('levelHistorySince');
    if (data.historySince && (!localSince || data.historySince < localSince)) await setMeta('levelHistorySince', data.historySince);
    // Acknowledge only the exact snapshot sent. Writes made while the request
    // was in flight retain a different timestamp and go out in the next sync.
    const ack = snapshot.ack;
    for (const p of progress) ack.progress[p.wordId] = p.updated_at;
    for (const p of counters) ack.counters[p.id] = p.updated_at;
    await setMeta(ackKey, ack);
  });
  return { sent: uploads.length, received: (data.progress?.length || 0) + (data.counters?.length || 0) };
}
