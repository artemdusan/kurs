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
  let url = (settings.syncUrl || DEFAULT_SYNC_URL).trim().replace(/\/$/, '');
  // bez schematu przeglądarka potraktowałaby adres jako ścieżkę względną
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
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

  const now = Date.now();
  await db.transaction('rw', db.words, db.progress, async () => {
    for (const remote of data.words || []) {
      const local = await db.words.get(remote.id);
      if (local) {
        if (remote.updated_at > local.updated_at) await db.words.put(remote);
        continue;
      }
      // Id słów są teraz deterministyczne (course.js), więc ta gałąź to głównie
      // siatka bezpieczeństwa na czas przejściowy — urządzenie, które nie
      // zdążyło jeszcze zmigrować starych losowych UUID, mogło wysłać rekord
      // tej samej treści pod innym id. Kanoniczny jest mniejszy id
      // (deterministycznie — oba urządzenia zbiegną do tego samego), postęp
      // przegranego rekordu przenosimy na zwycięzcę.
      const clash = remote.naturalKey
        ? await db.words.where('naturalKey').equals(remote.naturalKey).first()
        : null;
      if (!clash) {
        await db.words.put(remote);
        continue;
      }
      if (remote.deleted || clash.id < remote.id) continue; // lokalny kanoniczny — pomiń duplikat
      const [pLoser, pWinner] = await Promise.all([
        db.progress.get(clash.id),
        db.progress.get(remote.id),
      ]);
      // tombstone przegranego (zmieniony klucz, żeby nie kolidował z zwycięzcą) —
      // soft delete rozejdzie się na serwer i pozostałe urządzenia
      await db.words.put({
        ...clash,
        naturalKey: `${clash.naturalKey}|dup:${clash.id}`,
        deleted: 1,
        updated_at: now,
      });
      await db.words.put(remote);
      if (pLoser && (!pWinner || pLoser.updated_at > pWinner.updated_at)) {
        await db.progress.put({ ...pLoser, wordId: remote.id, updated_at: now });
      }
      if (pLoser) {
        await db.progress.put({ ...pLoser, wordId: clash.id, deleted: 1, updated_at: now });
      }
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
