import Dexie from 'dexie';
import { FLOOR_LEVEL } from '../../shared/learning.js';

// Offline-first: materiały, postępy i liczniki są w IndexedDB.
// Synchronizacja v2 obejmuje postępy i liczniki, a materiały pochodzą z plików kursu.
export const db = new Dexie('kurs-hiszpanski');

db.version(1).stores({
  // id deterministyczny (lekcja+typ+pozycja w lekcji) — patrz course.js
  words: 'id, lesson, parentId, updated_at',
  progress: 'wordId, level, updated_at',
  meta: 'key',
});

db.version(2).stores({ dailyCounters: '&id, day, deviceId' });

export async function getMeta(key, fallback = null) {
  const row = await db.meta.get(key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  await db.meta.put({ key, value });
}

// unlockedLesson wymaga osobno śledzonego updated_at (obok samej wartości),
// żeby dało się go synchronizować z serwerem metodą "ostatni zapis wygrywa"
// (patrz sync.js) — inaczej admin zmieniający numer z dashboardu i urządzenie
// legalnie odblokowujące kolejną lekcję nie miałyby jak rozstrzygnąć konfliktu.
export async function setUnlockedLesson(value, updatedAt = Date.now()) {
  await db.transaction('rw', db.meta, async () => {
    await setMeta('unlockedLesson', value);
    await setMeta('unlockedLessonUpdatedAt', updatedAt);
  });
}

export const DEFAULT_SETTINGS = {
  sessionMinutes: 10,
  dailyGoalMinutes: 10, // dzienny cel minut nauki (zielona buźka)
  // accentTolerance — automatyczny: poziom ≤5 → tolerancja, >5 → perfekcyjnie
  accentTolerance: false, // nieużywane bezpośrednio; zachowane dla kompatybilności wstecznej
  tts: true,              // zawsze włączone; przycisk TTS w sesji pozostaje
  floorLevel: FLOOR_LEVEL,          // minimalny poziom wszystkich słów wymagany do odblokowania kolejnej lekcji (ukryte w UI)
  mcqMaxLevel: 2,         // do tego poziomu odmiany czasowników są w trybie MCQ
  sfx: true,              // efekty dźwiękowe 8-bit
  listening: true,        // zadania ze słuchu (dyktando) dla kart od poziomu 4
  remindMorning: false,   // przypomnienia push: 8:00 / 19:00 / 21:00 (patrz worker)
  remindEvening: true,
  remindStreak: true,
  syncUrl: '',
  syncLogin: '',
  syncPassword: '',
};

export async function getSettings() {
  const saved = await getMeta('settings', {});
  return { ...DEFAULT_SETTINGS, ...saved, floorLevel: FLOOR_LEVEL };
}

export async function saveSettings(settings) {
  await setMeta('settings', settings);
}
