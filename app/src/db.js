import Dexie from 'dexie';

// Offline-first: wszystko w IndexedDB. Tabele `words` i `progress` są lekkie
// i synchronizowane deltami (updated_at > lastSync), soft delete przez `deleted`.
export const db = new Dexie('kurs-hiszpanski');

db.version(1).stores({
  // id deterministyczny (lekcja+typ+pozycja w lekcji) — patrz course.js
  words: 'id, lesson, parentId, updated_at',
  progress: 'wordId, level, updated_at',
  meta: 'key',
});

export async function getMeta(key, fallback = null) {
  const row = await db.meta.get(key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  await db.meta.put({ key, value });
}

export const DEFAULT_SETTINGS = {
  sessionMinutes: 10,
  dailyGoalMinutes: 10, // dzienny cel minut nauki (zielona buźka)
  // accentTolerance — automatyczny: poziom ≤5 → tolerancja, >5 → perfekcyjnie
  accentTolerance: false, // nieużywane bezpośrednio; zachowane dla kompatybilności wstecznej
  tts: true,              // zawsze włączone; przycisk TTS w sesji pozostaje
  floorLevel: 2,          // minimalny poziom wszystkich słów wymagany do odblokowania kolejnej lekcji (ukryte w UI)
  mcqMaxLevel: 2,         // do tego poziomu odmiany czasowników są w trybie MCQ
  syncUrl: '',
  syncLogin: '',
  syncPassword: '',
};

export async function getSettings() {
  const saved = await getMeta('settings', {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveSettings(settings) {
  await setMeta('settings', settings);
}
