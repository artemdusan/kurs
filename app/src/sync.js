import { db, getMeta, setMeta, getSettings } from './db.js';

// Synchronizacja delt z Cloudflare Workerem:
// - wysyłamy tylko rekordy z updated_at > lastSync,
// - serwer zwraca swoje zmiany od lastSync,
// - konflikty: last-writer-wins po updated_at,
// - soft delete przez pole `deleted`.

// Domyślny adres Workera wstrzykiwany przy buildzie (Cloudflare Pages: zmienna VITE_SYNC_URL).
// Ręcznie wpisany adres w ustawieniach ma pierwszeństwo.
export const DEFAULT_SYNC_URL = import.meta.env.VITE_SYNC_URL || '';

export function resolveSyncUrl(settings) {
  return (settings.syncUrl || DEFAULT_SYNC_URL).trim().replace(/\/$/, '');
}

export async function syncNow() {
  const settings = await getSettings();
  const syncUrl = resolveSyncUrl(settings);
  if (!syncUrl || !settings.syncLogin) {
    throw new Error('Uzupełnij adres serwera i login w ustawieniach');
  }
  const lastSync = await getMeta('lastSync', 0);

  const changedWords = await db.words.where('updated_at').above(lastSync).toArray();
  const changedProgress = await db.progress.where('updated_at').above(lastSync).toArray();

  const res = await fetch(syncUrl + '/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + btoa(`${settings.syncLogin}:${settings.syncPassword}`),
    },
    body: JSON.stringify({
      since: lastSync,
      words: changedWords,
      progress: changedProgress,
    }),
  });
  if (res.status === 401) throw new Error('Błędny login lub hasło');
  if (!res.ok) throw new Error(`Synchronizacja nieudana (${res.status})`);
  const data = await res.json();

  await db.transaction('rw', db.words, db.progress, async () => {
    for (const remote of data.words || []) {
      const local = await db.words.get(remote.id);
      if (!local || remote.updated_at > local.updated_at) await db.words.put(remote);
    }
    for (const remote of data.progress || []) {
      const local = await db.progress.get(remote.wordId);
      if (!local || remote.updated_at > local.updated_at) await db.progress.put(remote);
    }
  });

  await setMeta('lastSync', data.serverTime || Date.now());
  return {
    sent: changedWords.length + changedProgress.length,
    received: (data.words?.length || 0) + (data.progress?.length || 0),
  };
}
