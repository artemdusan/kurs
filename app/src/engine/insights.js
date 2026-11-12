import { db, getMeta, setMeta } from '../db.js';
import { getProgressMap } from './session.js';
import { FLOOR_LEVEL } from '../../../shared/learning.js';

// Liczby, które zamieniają „ucz się” w konkretny cel: ile kart brakuje do
// kolejnej lekcji i jak rozkłada się talia.

/** Karty z lekcji 1..maxLesson razem z poziomem (domyślnie 1). */
export async function loadDeck(maxLesson) {
  const words = await db.words.where('lesson').belowOrEqual(maxLesson).filter((w) => !w.deleted).toArray();
  const progressMap = await getProgressMap(words.map((w) => w.id));
  return words.map((word) => ({ word, progress: progressMap.get(word.id) || null, level: progressMap.get(word.id)?.level || 1 }));
}

/** missing — karty poniżej progu odblokowania (tyle dzieli od następnej lekcji). */
export function deckGoals(deck, floor = FLOOR_LEVEL) {
  let missing = 0;
  for (const { level } of deck) if (level < floor) missing++;
  return { total: deck.length, missing, ready: deck.length - missing };
}

/** Trzy grupy zamiast dziesięciu poziomów: nowe (1–2), utrwalane (3–5), złote (6–10). */
export function cardBuckets(deck) {
  const b = { fresh: 0, learning: 0, gold: 0 };
  for (const { level } of deck) b[level >= 6 ? 'gold' : level >= 3 ? 'learning' : 'fresh']++;
  return b;
}

// --- kamienie milowe -------------------------------------------------------
const STEPS = {
  gold: [10, 25, 50, 100, 250, 500, 1000, 2000, 3085],
  streak: [3, 7, 14, 30, 50, 100, 200, 365],
  lesson: [5, 10, 25, 50, 55, 75, 85, 100],
  answers: [100, 500, 1000, 5000, 10000, 25000],
};
const LABEL = {
  gold: (n) => `${n} złotych kart (poziom 6+)`,
  streak: (n) => `Seria ${n} dni z rzędu`,
  lesson: (n) => (n === 25 ? 'Poziom A0 otwarty w całości — 25 lekcji' : n === 55 ? 'Poziom A1 otwarty w całości — 55 lekcji' : n === 85 ? 'Poziom A2 otwarty w całości — 85 lekcji' : n === 100 ? 'Wszystkie 100 lekcji otwarte' : `Otwarte ${n} lekcji`),
  answers: (n) => `${n} poprawnych odpowiedzi`,
};

/** Progi osiągnięte przy podanych wartościach, np. ['gold:10', 'streak:3']. */
export function reachedMilestones(values) {
  const out = [];
  for (const [kind, steps] of Object.entries(STEPS)) {
    for (const n of steps) if ((values[kind] || 0) >= n) out.push(`${kind}:${n}`);
  }
  return out;
}

export function milestoneLabel(key) {
  const [kind, n] = key.split(':');
  return LABEL[kind]?.(Number(n)) || key;
}

/**
 * Zwraca etykiety nowo osiągniętych progów i zapisuje je jako widziane.
 * Przy pierwszym uruchomieniu (brak zapisu) niczego nie ogłasza — inaczej
 * aktualizacja zasypałaby wieloletniego użytkownika starymi osiągnięciami.
 */
export async function claimMilestones(values) {
  const reached = reachedMilestones(values);
  const seen = await getMeta('milestonesSeen', null);
  await setMeta('milestonesSeen', [...new Set([...(seen || []), ...reached])]);
  if (!seen) return [];
  const known = new Set(seen);
  // z jednej kategorii pokazujemy tylko najwyższy nowy próg
  const best = new Map();
  for (const key of reached) if (!known.has(key)) best.set(key.split(':')[0], key);
  return [...best.values()].map(milestoneLabel);
}

// --- gra „Pary na czas” ----------------------------------------------------
export const PAIRS_PER_BOARD = 5;

/**
 * Talia do gry: hasła (bez form odmiany), najpierw te już widziane i słabsze
 * (poziom ≤ 5), potem reszta — zabawa jest przy okazji powtórką.
 */
export function pairsDeck(deck, rng = Math.random) {
  const cards = deck
    .filter(({ word }) => word.type !== 'verb_form')
    .map(({ word, progress, level }) => ({
      id: word.id,
      es: word.es,
      pl: word.pl,
      rank: (progress?.lastSeenAt ? 0 : 2) + (level <= 5 ? 0 : 1) + rng(),
    }))
    .sort((a, b) => a.rank - b.rank);
  return cards;
}

/** Następna plansza: `size` kart bez powtórzonego hasła ani tłumaczenia (homonimy myliłyby pary). */
export function dealBoard(cards, used, size = PAIRS_PER_BOARD) {
  const board = [];
  const es = new Set();
  const pl = new Set();
  const take = (allowUsed) => {
    for (const c of cards) {
      if (board.length >= size) break;
      if (board.includes(c) || (!allowUsed && used.has(c.id))) continue;
      const e = c.es.toLowerCase();
      const p = c.pl.toLowerCase();
      if (es.has(e) || pl.has(p)) continue;
      es.add(e); pl.add(p); board.push(c);
    }
  };
  take(false);
  if (board.length < size) take(true); // mała talia — karty wracają
  for (const c of board) used.add(c.id);
  return board;
}

/** Punkty za parę: seria bezbłędnych par mnoży wynik, najwyżej ×5. */
export function pairPoints(combo) {
  return 10 * Math.min(5, Math.max(1, combo));
}
