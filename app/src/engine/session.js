import { db } from '../db.js';
import { addActivity } from '../activity.js';
import { localDay, normalizeProgress, MAX_LEVEL } from '../../../shared/learning.js';

// Silnik sesji: losowanie ważone poziomem, zaliczenie słowa po 1 poprawnej
// odpowiedzi, zmiana poziomu raz na lokalny dzień. Maksimum 10, minimum 1.
// Karty poziomu 6+ po błędzie spadają na 5.

export const SESSION_DONE_STREAK = 1;
export const SESSION_POOL_SIZE = 25;

export async function getProgressMap(wordIds) {
  const rows = await db.progress.where('wordId').anyOf(wordIds).toArray();
  const map = new Map(rows.filter((r) => !r.deleted).map((r) => [r.wordId, normalizeProgress(r)]));
  return map;
}

export function newProgress(wordId) {
  return {
    wordId,
    level: 1,
    rulesVersion: 2,
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

/** Udział powtórek (słowa poziomu 2+) w puli sesji i w losowaniu zadań. */
export const REVIEW_SHARE = 0.5;

/** Losowanie ważone poziomem (drawWeight) z listy wpisów puli. */
function weightedDraw(list, rng = Math.random) {
  const total = list.reduce((s, e) => s + drawWeight(e.progress.level), 0);
  let r = rng() * total;
  for (const e of list) {
    r -= drawWeight(e.progress.level);
    if (r <= 0) return e;
  }
  return list[list.length - 1];
}

/**
 * Jedna poprawna odpowiedź wystarczy do zaliczenia słowa w sesji.
 * Poziom zmienia się najwyżej raz na lokalny dzień.
 */
export function requiredStreak() {
  return SESSION_DONE_STREAK;
}

/**
 * Losuje następne słowo z puli (elementy: {word, progress, sessionStreak}),
 * unikając powtórki poprzedniego. Dwustopniowo: z prawdopodobieństwem
 * 1-REVIEW_SHARE losujemy ze słów nowych/słabych (poziom 1), inaczej
 * z powtórek (poziom 2+, wewnątrz ważone 1/poziom² — niższe wracają częściej).
 */
export function pickNext(pool, previousWordId = null, rng = Math.random) {
  const candidates = pool.filter(
    (e) => e.sessionStreak < requiredStreak() && e.word.id !== previousWordId
  );
  const list = candidates.length
    ? candidates
    : pool.filter((e) => e.sessionStreak < requiredStreak());
  if (!list.length) return null;
  const weak = list.filter((e) => e.progress.level === 1);
  const review = list.filter((e) => e.progress.level > 1);
  if (!weak.length) return weightedDraw(review, rng);
  if (!review.length) return weightedDraw(weak, rng);
  return rng() < REVIEW_SHARE ? weightedDraw(review, rng) : weightedDraw(weak, rng);
}

/** Odpowiedź, poziom i statystyki zapisują się w jednej transakcji. */
export async function recordAnswer(entry, correct, { clearMistake = false } = {}) {
  const now = Date.now();
  const today = localDay(now);
  return db.transaction('rw', db.progress, db.dailyCounters, db.meta, async () => {
    const p = normalizeProgress(await db.progress.get(entry.word.id) || entry.progress);
    const previousLevel = p.level;
    const lastDay = p.lastLevelChangeDay || (p.lastLevelChangeAt ? localDay(p.lastLevelChangeAt) : '');
    const canChange = !lastDay || lastDay < today;
    const sessionStreak = correct ? entry.sessionStreak + 1 : 0;
    p.lastSeenAt = now;
    p.updated_at = Math.max(now, (p.updated_at || 0) + 1);
    if (correct) {
      p.correctTotal = (p.correctTotal || 0) + 1;
      if (canChange && p.level < MAX_LEVEL) p.level++;
    } else {
      p.wrongTotal = (p.wrongTotal || 0) + 1;
      if (canChange && p.level > 1) p.level = p.level >= 6 ? 5 : p.level - 1;
    }
    // At the ceiling, a correct answer also consumes today's change. At the
    // floor a mistake blocks promotion until midnight, as in the old rules.
    if (canChange || (!correct && p.level === 1)) {
      p.lastLevelChangeDay = today;
      p.lastLevelChangeAt = now;
    }
    const advances = Number(p.level > previousLevel);
    const drops = Number(p.level < previousLevel);
    if (drops) p.lastLevelDropAt = now;
    if (clearMistake && correct) p.lastLevelDropAt = 0;
    await db.progress.put(p);
    await addActivity({ correct: Number(correct), wrong: Number(!correct), advances, drops }, today, now);
    return { ...entry, progress: p, sessionStreak };
  });
}

/**
 * Buduje pulę sesji: ~50% miejsc dla słów nowych/słabych (poziom 1, najdawniej
 * widziane najpierw) + ~50% zarezerwowane dla powtórek (poziom 2+, losowanych
 * wagami 1/poziom² — "random repetition", bez sztywnych interwałów).
 * Niedobór w jednej grupie dopełnia druga.
 */
export async function buildSessionPool(maxLesson, poolSize = SESSION_POOL_SIZE, excludeIds = null, rng = Math.random) {
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

  const fresh = entries
    .filter((e) => e.progress.level === 1)
    .sort((a, b) => a.progress.lastSeenAt - b.progress.lastSeenAt);
  const review = entries.filter((e) => e.progress.level > 1);

  // powtórki: losowanie ważone bez zwracania
  const reviewSlots = Math.min(review.length, Math.round(poolSize * REVIEW_SHARE));
  const pickedReview = [];
  const reviewLeft = [...review];
  while (pickedReview.length < reviewSlots && reviewLeft.length) {
    const e = weightedDraw(reviewLeft, rng);
    pickedReview.push(e);
    reviewLeft.splice(reviewLeft.indexOf(e), 1);
  }

  const pool = [...fresh.slice(0, poolSize - pickedReview.length), ...pickedReview];
  // za mało świeżych — dopełnij kolejnymi powtórkami
  while (pool.length < poolSize && reviewLeft.length) {
    const e = weightedDraw(reviewLeft, rng);
    pool.push(e);
    reviewLeft.splice(reviewLeft.indexOf(e), 1);
  }
  return pool;
}

/**
 * Pula trybu „powtórka błędów”: słowa, którym DZISIAJ spadł poziom,
 * najświeższe spadki najpierw.
 */
export async function buildMistakesPool(maxLesson, poolSize = SESSION_POOL_SIZE) {
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

/**
 * Usuwa słowo z puli powtórki błędów po udanym powtórzeniu w sesji „mistakes” —
 * inaczej wracałoby w kółko przez resztę dnia mimo poprawnej odpowiedzi.
 */
export async function clearMistake(wordId) {
  await db.transaction('rw', db.progress, async () => {
    const p = await db.progress.get(wordId);
    if (!p || !p.lastLevelDropAt) return;
    p.lastLevelDropAt = 0;
    p.updated_at = Math.max(Date.now(), (p.updated_at || 0) + 1);
    await db.progress.put(p);
  });
}

/** Pula trybu „trudne słowa”: karty z największym odsetkiem błędów (min. 2 pomyłki). */
export async function buildHardPool(maxLesson, poolSize = SESSION_POOL_SIZE) {
  const words = await db.words.where('lesson').belowOrEqual(maxLesson).filter((w) => !w.deleted).toArray();
  const progressMap = await getProgressMap(words.map((w) => w.id));
  return words
    .map((word) => ({ word, progress: progressMap.get(word.id) || newProgress(word.id), sessionStreak: 0 }))
    .filter((e) => (e.progress.wrongTotal || 0) >= 2)
    .sort((a, b) => {
      const rate = (e) => e.progress.wrongTotal / (e.progress.wrongTotal + (e.progress.correctTotal || 0));
      return rate(b) - rate(a) || b.progress.wrongTotal - a.progress.wrongTotal;
    })
    .slice(0, poolSize);
}

/** Liczba słów kwalifikujących się do powtórki (dzisiejsze spadki poziomu). */
export async function countRecentMistakes(maxLesson) {
  return (await buildMistakesPool(maxLesson, Infinity)).length;
}

/** Rozkład poziomów słów z lekcji 1..maxLesson (indeks 0 = poziom 1). Maksimum 10. */
export async function levelDistribution(maxLesson) {
  const words = await db.words
    .where('lesson')
    .belowOrEqual(maxLesson)
    .filter((w) => !w.deleted)
    .toArray();
  const progressMap = await getProgressMap(words.map((w) => w.id));
  let maxLevel = 1;
  const levelMap = new Map();
  for (const w of words) {
    const lvl = progressMap.get(w.id)?.level || 1;
    levelMap.set(lvl, (levelMap.get(lvl) || 0) + 1);
    if (lvl > maxLevel) maxLevel = lvl;
  }
  const levels = [];
  for (let i = 1; i <= Math.max(maxLevel, 6); i++) {
    levels.push(levelMap.get(i) || 0);
  }
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

/**
 * Status dnia względem dziennego celu minut:
 * 'green' — cel minut osiągnięty, 'yellow' — była nauka, ale poniżej celu
 * (dzień i tak liczy się do streaka), 'red' — dziś jeszcze nic.
 * Dzień jest "aktywny" tylko gdy były odpowiedzi (correct/wrong) — same
 * sekundy (np. z sesji przeciągniętej po północy) nie aktywują dnia.
 */
export function dayStatus(day, goalMinutes = 10) {
  const active = (day?.correct || 0) + (day?.wrong || 0) > 0;
  if (!active) return 'red';
  return (day.seconds || 0) >= goalMinutes * 60 ? 'green' : 'yellow';
}

/** Najdłuższa seria kolejnych dni z nauką, policzona z historii dailyStats. */
export function bestStreak(daily) {
  const days = Object.keys(daily || {})
    .filter((d) => dayStatus(daily[d]) !== 'red')
    .sort();
  let best = 0;
  let cur = 0;
  let prev = null;
  for (const d of days) {
    cur = prev && new Date(d) - new Date(prev) === 86400000 ? cur + 1 : 1;
    if (cur > best) best = cur;
    prev = d;
  }
  return best;
}
