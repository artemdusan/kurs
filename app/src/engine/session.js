import { db, getMeta, setMeta } from '../db.js';

// Silnik sesji: losowanie ważone poziomem, zaliczenie słowa po 2 poprawnych
// odpowiedziach z rzędu, zmiana poziomu (awans/spadek) max raz na 24 h.

export const LEVEL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const MAX_LEVEL = 6;
export const SESSION_DONE_STREAK = 2;

export async function getProgressMap(wordIds) {
  const rows = await db.progress.where('wordId').anyOf(wordIds).toArray();
  const map = new Map(rows.filter((r) => !r.deleted).map((r) => [r.wordId, r]));
  return map;
}

export function newProgress(wordId) {
  return {
    wordId,
    level: 1,
    lastLevelChangeAt: 0,
    correctTotal: 0,
    wrongTotal: 0,
    lastSeenAt: 0,
    updated_at: Date.now(),
    deleted: 0,
  };
}

/** Waga losowania: niższy poziom => znacznie większa szansa. */
export function drawWeight(level) {
  return 1 / (level * level);
}

/**
 * Losuje następne słowo z puli (elementy: {word, progress, sessionStreak}),
 * unikając powtórki poprzedniego. Słowa z poziomem 1 mają bezwzględne
 * pierwszeństwo — dopóki są nieukończone, losujemy tylko spośród nich.
 */
export function pickNext(pool, previousWordId = null, rng = Math.random) {
  const candidates = pool.filter(
    (e) => e.sessionStreak < SESSION_DONE_STREAK && e.word.id !== previousWordId
  );
  let list = candidates.length
    ? candidates
    : pool.filter((e) => e.sessionStreak < SESSION_DONE_STREAK);
  if (!list.length) return null;
  const level1 = list.filter((e) => e.progress.level === 1);
  if (level1.length) list = level1;
  const total = list.reduce((s, e) => s + drawWeight(e.progress.level), 0);
  let r = rng() * total;
  for (const e of list) {
    r -= drawWeight(e.progress.level);
    if (r <= 0) return e;
  }
  return list[list.length - 1];
}

/**
 * Rejestruje odpowiedź. Aktualizuje streak sesyjny i (z poszanowaniem cooldownu 24 h)
 * poziom słowa. Zwraca zaktualizowany wpis puli.
 */
export async function recordAnswer(entry, correct) {
  const now = Date.now();
  const p = { ...entry.progress };
  p.lastSeenAt = now;
  p.updated_at = now;

  let sessionStreak = entry.sessionStreak;
  if (correct) {
    p.correctTotal++;
    sessionStreak++;
    if (
      sessionStreak >= SESSION_DONE_STREAK &&
      p.level < MAX_LEVEL &&
      now - p.lastLevelChangeAt >= LEVEL_COOLDOWN_MS
    ) {
      p.level++;
      p.lastLevelChangeAt = now;
    }
  } else {
    p.wrongTotal++;
    p.lastWrongAt = now;
    sessionStreak = 0;
    if (p.level > 1 && now - p.lastLevelChangeAt >= LEVEL_COOLDOWN_MS) {
      p.level--;
      p.lastLevelChangeAt = now;
      p.lastLevelDropAt = now;
    }
  }

  await db.progress.put(p);
  return { ...entry, progress: p, sessionStreak };
}

/**
 * Buduje pulę sesji: wszystkie nieskasowane słowa z lekcji 1..maxLesson.
 * Sesja skupia się na słabych/nowych słowach dzięki wadze 1/level^2;
 * dodatkowo pula jest przycinana do `poolSize` słów o najniższym poziomie.
 */
export async function buildSessionPool(maxLesson, poolSize = 25, excludeIds = null) {
  const words = await db.words
    .where('lesson')
    .belowOrEqual(maxLesson)
    .filter((w) => !w.deleted && !(excludeIds && excludeIds.has(w.id)))
    .toArray();
  const progressMap = await getProgressMap(words.map((w) => w.id));
  const entries = words.map((word) => ({
    word,
    progress: progressMap.get(word.id) || newProgress(word.id),
    sessionStreak: 0,
  }));
  // najsłabsze i najdawniej widziane najpierw
  entries.sort(
    (a, b) =>
      a.progress.level - b.progress.level || a.progress.lastSeenAt - b.progress.lastSeenAt
  );
  return entries.slice(0, poolSize);
}

/**
 * Pula trybu „powtórka błędów”: słowa, którym DZISIAJ spadł poziom,
 * najświeższe spadki najpierw.
 */
export async function buildMistakesPool(maxLesson, poolSize = 25) {
  const words = await db.words
    .where('lesson')
    .belowOrEqual(maxLesson)
    .filter((w) => !w.deleted)
    .toArray();
  const progressMap = await getProgressMap(words.map((w) => w.id));
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const entries = words
    .map((word) => ({
      word,
      progress: progressMap.get(word.id) || newProgress(word.id),
      sessionStreak: 0,
    }))
    .filter((e) => (e.progress.lastLevelDropAt || 0) >= startOfToday);
  entries.sort((a, b) => b.progress.lastLevelDropAt - a.progress.lastLevelDropAt);
  return entries.slice(0, poolSize);
}

/** Liczba słów kwalifikujących się do powtórki (dzisiejsze spadki poziomu). */
export async function countRecentMistakes(maxLesson) {
  return (await buildMistakesPool(maxLesson, Infinity)).length;
}

/** Rozkład poziomów słów z lekcji 1..maxLesson (indeks 0 = poziom 1). */
export async function levelDistribution(maxLesson) {
  const words = await db.words
    .where('lesson')
    .belowOrEqual(maxLesson)
    .filter((w) => !w.deleted)
    .toArray();
  const progressMap = await getProgressMap(words.map((w) => w.id));
  const levels = Array.from({ length: MAX_LEVEL }, () => 0);
  for (const w of words) levels[(progressMap.get(w.id)?.level || 1) - 1]++;
  return levels;
}

/** Sprawdza „floor”: czy wszystkie słowa z lekcji 1..lesson mają poziom >= floorLevel. */
export async function lessonFloorReached(lesson, floorLevel) {
  const words = await db.words
    .where('lesson')
    .belowOrEqual(lesson)
    .filter((w) => !w.deleted)
    .toArray();
  if (!words.length) return false;
  const progressMap = await getProgressMap(words.map((w) => w.id));
  return words.every((w) => (progressMap.get(w.id)?.level || 1) >= floorLevel);
}

/** Statystyki dzienne (odpowiedzi, sekundy nauki, sesje) + streak dni nauki. */
export async function bumpDailyStats({ correct = 0, wrong = 0, seconds = 0, finishedSession = false }) {
  const today = new Date().toISOString().slice(0, 10);
  const stats = await getMeta('dailyStats', {});
  const day = stats[today] || { correct: 0, wrong: 0, sessions: 0, seconds: 0 };
  day.correct += correct;
  day.wrong += wrong;
  day.seconds = (day.seconds || 0) + seconds;
  if (finishedSession) day.sessions++;
  stats[today] = day;
  await setMeta('dailyStats', stats);

  const streakInfo = await getMeta('streak', { count: 0, lastDay: '' });
  if (streakInfo.lastDay !== today && (correct || wrong)) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    streakInfo.count = streakInfo.lastDay === yesterday ? streakInfo.count + 1 : 1;
    streakInfo.lastDay = today;
    await setMeta('streak', streakInfo);
  }
  return { stats, streak: streakInfo };
}
