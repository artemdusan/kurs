import { db, getMeta, setMeta } from '../db.js';

// Silnik sesji: losowanie ważone poziomem, zaliczenie słowa po 1 poprawnej
// odpowiedzi, zmiana poziomu (awans/spadek) max raz na 24 h.
// Maksymalny poziom nieograniczony; karty poziomu 6+ po błędzie spadają na 5.

export const LEVEL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const SESSION_DONE_STREAK = 1;

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
 * Poziom i tak zmieni się max raz na 24 h (LEVEL_COOLDOWN_MS).
 */
export function requiredStreak(progress, now = Date.now()) {
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
    (e) => e.sessionStreak < requiredStreak(e.progress) && e.word.id !== previousWordId
  );
  const list = candidates.length
    ? candidates
    : pool.filter((e) => e.sessionStreak < requiredStreak(e.progress));
  if (!list.length) return null;
  const weak = list.filter((e) => e.progress.level === 1);
  const review = list.filter((e) => e.progress.level > 1);
  if (!weak.length) return weightedDraw(review, rng);
  if (!review.length) return weightedDraw(weak, rng);
  return rng() < REVIEW_SHARE ? weightedDraw(review, rng) : weightedDraw(weak, rng);
}

/**
 * Rejestruje odpowiedź. Aktualizuje streak sesyjny i (z poszanowaniem cooldownu 24 h)
 * poziom słowa.
 *
 * - 1 poprawna odpowiedź = awans (jeśli cooldown minął)
 * - Błędna odpowiedź = spadek (jeśli cooldown minął i poziom > 1)
 * - Karty poziomu 6+ po błędzie spadają na poziom 5
 * - Poziom 1 nie spada (jest to minimalny poziom)
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
      // karty poziomu 6+ spadają od razu na poziom 5
      if (p.level >= 6) {
        p.level = 5;
      } else {
        p.level--;
      }
      p.lastLevelChangeAt = now;
      p.lastLevelDropAt = now;
    }
  }

  await db.progress.put(p);
  return { ...entry, progress: p, sessionStreak };
}

/**
 * Buduje pulę sesji: ~70% miejsc dla słów nowych/słabych (poziom 1, najdawniej
 * widziane najpierw) + ~30% zarezerwowane dla powtórek (poziom 2+, losowanych
 * wagami 1/poziom² — "random repetition", bez sztywnych interwałów).
 * Niedobór w jednej grupie dopełnia druga.
 */
export async function buildSessionPool(maxLesson, poolSize = 25, excludeIds = null, rng = Math.random) {
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

/**
 * Usuwa słowo z puli powtórki błędów po udanym powtórzeniu w sesji „mistakes” —
 * inaczej wracałoby w kółko przez resztę dnia mimo poprawnej odpowiedzi.
 */
export async function clearMistake(wordId) {
  const p = await db.progress.get(wordId);
  if (!p || !p.lastLevelDropAt) return;
  p.lastLevelDropAt = 0;
  p.updated_at = Date.now();
  await db.progress.put(p);
}

/** Liczba słów kwalifikujących się do powtórki (dzisiejsze spadki poziomu). */
export async function countRecentMistakes(maxLesson) {
  return (await buildMistakesPool(maxLesson, Infinity)).length;
}

/** Rozkład poziomów słów z lekcji 1..maxLesson (indeks 0 = poziom 1). Dynamiczny — bez górnego limitu. */
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
 * Statystyki dzienne (odpowiedzi, sekundy nauki, sesje) + streak dni nauki.
 * Każdy dzień ma własny `updated_at` — przy synchronizacji dwóch urządzeń
 * scalanie odbywa się per dzień (nowszy zapis danego dnia wygrywa), więc
 * nauka na jednym urządzeniu nie nadpisuje dni zapisanych na drugim.
 *
 * Parametr `dayOverride` pozwala przypisać statystyki do konkretnego dnia
 * (np. gdy sesja zaczęła się przed północą, a skończyła po).
 */
export async function bumpDailyStats({ correct = 0, wrong = 0, seconds = 0, finishedSession = false, dayOverride = null }) {
  const today = dayOverride || new Date().toISOString().slice(0, 10);
  const stats = await getMeta('dailyStats', {});
  const day = stats[today] || { correct: 0, wrong: 0, sessions: 0, seconds: 0 };
  day.correct += correct;
  day.wrong += wrong;
  day.seconds = (day.seconds || 0) + seconds;
  if (finishedSession) day.sessions++;
  day.updated_at = Date.now();
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
