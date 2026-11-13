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

// --- punkty doświadczenia i poziom gracza ----------------------------------
// XP wynika z liczników dni (które i tak się synchronizują), więc nie wymaga
// osobnego zapisu: poprawna odpowiedź 10, awans karty 20, ukończona sesja 50.
// Bonus za wyzwania dnia jest zapisany lokalnie (CHALLENGE_XP za każde).
export const CHALLENGE_XP = 100;

export function playerXp(daily, bonus = 0) {
  let xp = bonus;
  for (const d of Object.values(daily || {})) xp += (d.correct || 0) * 10 + (d.advances || 0) * 20 + (d.sessions || 0) * 50;
  return xp;
}

/** Poziom L wymaga łącznie 100·L·(L−1) XP, czyli każdy kolejny kosztuje o 200 więcej. */
export function playerLevel(xp) {
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + Math.max(0, xp) / 25)) / 2));
  const base = 100 * level * (level - 1);
  return { level, into: xp - base, need: 200 * level, xp };
}

// --- rangi i nagrody za poziom gracza --------------------------------------
// Ranga zmienia się co RANK_STEP poziomów; po ostatniej dochodzą gwiazdki, bez końca.
export const RANK_STEP = 5;
export const RANKS = ['Turista', 'Viajero', 'Estudiante', 'Vecino', 'Hablante', 'Nativo'];

export function rankFor(level) {
  const tier = Math.floor(Math.max(1, level) / RANK_STEP);
  const stars = Math.max(0, tier - (RANKS.length - 1));
  const name = RANKS[Math.min(tier, RANKS.length - 1)];
  const next = (tier + 1) * RANK_STEP;
  return { tier, name, stars, label: name + (stars ? ' ' + '★'.repeat(Math.min(stars, 5)) + (stars > 5 ? `×${stars}` : '') : ''), nextAt: next, toNext: next - level };
}

// Nagrody za poziom gracza:
// - każdy poziom: joker 50/50 na bossa (zapas najwyżej JOKER_MAX, raz na walkę),
// - każda nowa ranga (co RANK_STEP poziomów): dodatkowo serce na bossa (zapas
//   najwyżej HEART_STOCK_MAX) i nowy lakier auta w „Drodze” (wynika z rangi).
// Gdy zapas jest pełny, nagroda zamienia się w LEVEL_BONUS_XP. Serce i joker
// zużywają się dopiero wtedy, gdy zadziałają. Zapasy i bonus są zapisane lokalnie.
export const HEART_STOCK_MAX = 1;
export const JOKER_MAX = 2;
export const LEVEL_BONUS_XP = 100;

/** Co dają poziomy from+1..to przy zapasach { hearts, jokers } (czysta funkcja). */
export function levelRewards(from, to, stock = {}) {
  let hearts = stock.hearts || 0;
  let jokers = stock.jokers || 0;
  const out = { hearts: 0, jokers: 0, bonusXp: 0, ranks: 0 };
  for (let level = from + 1; level <= to; level++) {
    if (jokers < JOKER_MAX) { jokers++; out.jokers++; } else out.bonusXp += LEVEL_BONUS_XP;
    if (level % RANK_STEP === 0) {
      out.ranks++;
      if (hearts < HEART_STOCK_MAX) { hearts++; out.hearts++; } else out.bonusXp += LEVEL_BONUS_XP;
    }
  }
  return out;
}

const stockOf = async (key, max) => Math.max(0, Math.min(max, await getMeta(key, 0)));
export const heartStock = () => stockOf('bossHearts', HEART_STOCK_MAX);
export const jokerStock = () => stockOf('bossJokers', JOKER_MAX);

async function take(key, max) {
  const stock = await stockOf(key, max);
  if (stock <= 0) return false;
  await setMeta(key, stock - 1);
  return true;
}
/** Zużywa serce, które właśnie uratowało walkę. */
export const takeBossHeart = () => take('bossHearts', HEART_STOCK_MAX);
/** Zużywa jokera 50/50. */
export const takeJoker = () => take('bossJokers', JOKER_MAX);

const plural = (n, one, few, many) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

/**
 * Ogłasza zmianę poziomu (raz) i przyznaje nagrody. Zwraca teksty do pokazania.
 * Przy pierwszym uruchomieniu tej wersji gracz powyżej poziomu 1 dostaje jedno serce na start.
 */
export async function claimLevelUp(level) {
  const news = [];
  const hearts = await heartStock();
  const jokers = await jokerStock();
  // jokery doszły w nowszej wersji: gracz powyżej poziomu 1 dostaje jednego na start
  if (!(await getMeta('jokersOn', false))) {
    await setMeta('jokersOn', true);
    if (level > 1 && jokers < JOKER_MAX) { await setMeta('bossJokers', jokers + 1); news.push('Nowość: joker 50/50 na bossa (+1)'); }
    return news; // poziom ogłaszamy przy następnej okazji, ze świeżym zapasem
  }
  const seen = await getMeta('playerLevelSeen', null);
  if (seen === level) return news;
  await setMeta('playerLevelSeen', level);
  if (seen === null || !(await getMeta('levelRewardsOn', false))) {
    await setMeta('levelRewardsOn', true);
    if (rankFor(level).tier > 0 && hearts < HEART_STOCK_MAX) { await setMeta('bossHearts', hearts + 1); news.push(`Ranga ${rankFor(level).label}: na start +1 serce na bossa`); }
    return news;
  }
  if (level < seen) return news;
  const reward = levelRewards(seen, level, { hearts, jokers });
  if (reward.hearts) await setMeta('bossHearts', hearts + reward.hearts);
  if (reward.jokers) await setMeta('bossJokers', jokers + reward.jokers);
  if (reward.bonusXp) await setMeta('bonusXp', (await getMeta('bonusXp', 0)) + reward.bonusXp);
  const parts = [];
  if (reward.jokers) parts.push(`+${reward.jokers} ${plural(reward.jokers, 'joker', 'jokery', 'jokerów')} 50/50`);
  if (reward.hearts) parts.push('+1 serce na bossa');
  if (reward.bonusXp) parts.push(`+${reward.bonusXp} XP`);
  news.push(`Poziom gracza ${level}: ${parts.join(', ')}`);
  if (reward.ranks) news.push(`Nowa ranga: ${rankFor(level).label} i nowy lakier auta w „Drodze”`);
  return news;
}

// --- wyzwanie dnia ---------------------------------------------------------
const CHALLENGES = [
  { kind: 'advances', targets: [8, 10, 12], label: (n) => `${n} awansów kart` },
  { kind: 'correct', targets: [30, 40, 50], label: (n) => `${n} poprawnych odpowiedzi` },
  { kind: 'minutes', targets: [5, 8], label: (n) => `${n} min ponad dzienny cel` },
  { kind: 'pairs', targets: [200, 300], label: (n) => `${n} punktów w „Parach”` },
  { kind: 'road', targets: [150, 250], label: (n) => `${n} punktów w „Drodze”` },
];

/** Jedno wyzwanie na dzień, wybierane z daty — to samo po każdym otwarciu aplikacji. */
export function dailyChallenge(day, goalMinutes = 10) {
  let h = 0;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = CHALLENGES[h % CHALLENGES.length];
  const n = c.targets[(h >>> 8) % c.targets.length];
  const target = c.kind === 'minutes' ? goalMinutes + n : n;
  return { kind: c.kind, target, label: c.kind === 'minutes' ? `${target} minut nauki` : c.label(n) };
}

/** Postęp wyzwania: liczniki dnia + najlepsze dzisiejsze wyniki gier. */
export function challengeProgress(challenge, counters = {}, games = {}) {
  const value = {
    advances: counters.advances || 0,
    correct: counters.correct || 0,
    minutes: Math.floor((counters.seconds || 0) / 60),
    pairs: games.pairs || 0,
    road: games.road || 0,
  }[challenge.kind] || 0;
  return { value: Math.min(value, challenge.target), done: value >= challenge.target };
}

/** Najlepszy dzisiejszy wynik gry (do wyzwania dnia); zwraca rekord wszech czasów sprzed zapisu. */
export async function saveGameScore(game, score, today) {
  return db.transaction('rw', db.meta, async () => {
    const row = await getMeta('gameToday', null);
    const games = row && row.day === today ? row : { day: today };
    games[game] = Math.max(games[game] || 0, score);
    await setMeta('gameToday', games);
    const key = game + 'Best';
    const previous = await getMeta(key, 0);
    if (score > previous) await setMeta(key, score);
    return previous;
  });
}

// --- limit XP z gier ---------------------------------------------------------
// Gry („Droga”, „Pary”) są dodatkiem do nauki: do XP (i liczników dnia) liczy się
// najwyżej GAME_XP_HITS trafień dziennie, łącznie z obu gier. Ponad limit gra się
// o rekord i pocztówki; czas gry dalej liczy się do dziennego celu minut.
// Licznik jest lokalny (meta „gameToday”), więc synchronizacja się nie zmienia.
export const GAME_XP_HITS = 30;

/** Co z gry trafi do liczników dnia (czysta funkcja): trafienia do limitu, błędy proporcjonalnie.
 * `limited` = część trafień nie zmieściła się w limicie. */
export function gameCounters(hits, mistakes, counted) {
  const correct = Math.min(Math.max(0, hits), Math.max(0, GAME_XP_HITS - (counted || 0)));
  const wrong = correct >= hits ? mistakes : Math.round((mistakes * correct) / Math.max(1, hits));
  return { correct, wrong, limited: correct < hits };
}

/** Zalicza trafienia z gry do dzisiejszego limitu; zwraca { correct, wrong } do zapisania w liczniku dnia. */
export async function countGameHits(hits, mistakes, today) {
  return db.transaction('rw', db.meta, async () => {
    const row = await getMeta('gameToday', null);
    const games = row && row.day === today ? row : { day: today };
    const out = gameCounters(hits, mistakes, games.counted);
    games.counted = (games.counted || 0) + out.correct;
    await setMeta('gameToday', games);
    return out;
  });
}

export async function gamesToday(today) {
  const row = await getMeta('gameToday', null);
  return row && row.day === today ? row : {};
}

/** Zalicza wyzwanie dnia (raz). Zwraca true, gdy właśnie teraz zostało zaliczone. */
export async function claimChallenge(day) {
  const done = await getMeta('challengeDone', {});
  if (done[day]) return false;
  await setMeta('challengeDone', { ...done, [day]: 1 });
  return true;
}

export async function challengeBonus() {
  // razem z XP przyznanym za poziomy przy pełnym zapasie serc i jokerów
  return Object.keys(await getMeta('challengeDone', {})).length * CHALLENGE_XP + (await getMeta('bonusXp', 0));
}

// --- trudne słowa ----------------------------------------------------------
/** Karty, na których najczęściej pada błąd (co najmniej 2 pomyłki), najgorsze najpierw. */
export function hardWords(deck, limit = 25) {
  return deck
    .map(({ word, progress, level }) => {
      const wrong = progress?.wrongTotal || 0;
      const total = wrong + (progress?.correctTotal || 0);
      return { word, progress, level, wrong, rate: total ? wrong / total : 0 };
    })
    .filter((c) => c.wrong >= 2)
    .sort((a, b) => b.rate - a.rate || b.wrong - a.wrong)
    .slice(0, limit);
}

// --- rzeczowniki z rodzajnikiem (gra „Droga”, pytania bossa) ----------------------------------------------------
/** Rzeczowniki z rodzajnikiem do zgadywania: { id, article, noun, pl, plural }. */
export function sprintDeck(deck, rng = Math.random) {
  const cards = [];
  for (const { word } of deck) {
    if (word.type !== 'noun') continue;
    const m = word.es.trim().match(/^(el|la|los|las)\s+(.+)$/i);
    if (!m) continue;
    const article = m[1].toLowerCase();
    cards.push({ id: word.id, article, noun: m[2], pl: word.pl, plural: article === 'los' || article === 'las', rank: rng() });
  }
  return cards.sort((a, b) => a.rank - b.rank);
}
