import { getMeta, setMeta } from '../db.js';

// Salon gier: jedna lista gier, z której czyta ekran gier, skróty z ikony
// i Statystyki. Nowa gra = wpis tutaj + jej komponent w App.jsx.
// Wszystkie gry dzielą dzienny limit XP z gier (insights.js: GAME_XP_HITS),
// nie zmieniają poziomów kart, a rekord trzymają w meta `<id>Best`.

export const GAMES = [
  { id: 'pairs', name: 'Pary', icon: 'pairs', teaches: 'tłumaczenie', blurb: '60 s łączenia słów w pary', minLesson: 1 },
  { id: 'road', name: 'Droga', icon: 'road', teaches: 'el / la', blurb: 'wjedź w bramkę z rodzajnikiem', minLesson: 1 },
  { id: 'lluvia', name: 'Lluvia', icon: 'rain', teaches: 'odmiana', blurb: 'kto mówi? złap formę, zanim spadnie', minLesson: 2 },
  { id: 'luka', name: 'Luka', icon: 'gap', teaches: 'zdania', blurb: 'uzupełnij zdanie na czas', minLesson: 1 },
  { id: 'eco', name: 'Eco', icon: 'ear', teaches: 'ze słuchu', blurb: 'usłysz słowo, wybierz tłumaczenie', minLesson: 3, needsVoice: true },
];

export const GAME_IDS = GAMES.map((g) => g.id);
export const gameById = (id) => GAMES.find((g) => g.id === id) || null;
export const DEFAULT_LAST_GAME = 'road';

/** Czy gra jest dostępna: lekcja otwarta i (dla gier ze słuchu) jest lektor. */
export function gameLock(game, unlockedLesson, hasVoice = true) {
  if (unlockedLesson < game.minLesson) return `od lekcji ${game.minLesson}`;
  if (game.needsVoice && !hasVoice) return 'brak lektora';
  return '';
}

// --- gra dnia ----------------------------------------------------------------
export const FEATURED_XP = 50;

/** Jedna z dostępnych gier wybierana z daty — ta sama przez cały dzień. */
export function featuredGame(day, available) {
  if (!available.length) return null;
  let h = 7;
  for (const ch of day) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return available[h % available.length];
}

/** Bonus za pierwszą ukończoną rozgrywkę gry dnia (raz dziennie). Zwraca true, gdy przyznany teraz. */
export async function claimFeatured(day, gameId, playedToday) {
  if (!gameId || !(playedToday?.[gameId] > 0)) return false;
  const done = await getMeta('featuredDone', '');
  if (done === day) return false;
  await setMeta('featuredDone', day);
  await setMeta('bonusXp', (await getMeta('bonusXp', 0)) + FEATURED_XP);
  return true;
}

// --- wspólne -----------------------------------------------------------------
export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const norm = (s) => String(s || '').trim().toLowerCase();
// najpierw karty widziane i słabsze — gra jest przy okazji powtórką
const rankOf = ({ progress, level }, rng) => (progress?.lastSeenAt ? 0 : 2) + (level <= 5 ? 0 : 1) + rng();

/** `n` różnych opcji: poprawna + losowe z puli (bez duplikatów po normalizacji). */
export function pickOptions(correct, pool, n = 4, rng = Math.random) {
  const seen = new Set([norm(correct)]);
  const out = [correct];
  for (const c of shuffle(pool, rng)) {
    if (out.length >= n) break;
    const k = norm(c);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return shuffle(out, rng);
}

// --- „Lluvia”: odmiana czasowników ------------------------------------------
export const PERSONS = [
  { key: 'singular-1', label: 'yo' },
  { key: 'singular-2', label: 'tú' },
  { key: 'singular-3', label: 'él / ella' },
  { key: 'plural-1', label: 'nosotros' },
  { key: 'plural-2', label: 'vosotros' },
  { key: 'plural-3', label: 'ellos' },
];
const TENSE_PL = { present: 'teraźniejszy', preterite: 'przeszły', future: 'przyszły' };

/**
 * Formy czasowników do łapania: { id, es, verb, tense, persons }.
 * `persons` to wszystkie osoby, które mają tę samą formę w tym czasowniku
 * (gdyby forma się powtarzała, każda z nich jest dobrą odpowiedzią).
 */
export function conjugationDeck(deck, rng = Math.random) {
  const verbs = new Map();
  for (const { word } of deck) if (word.type === 'verb') verbs.set(word.id, word.es);
  const byForm = new Map();
  for (const c of deck) {
    const g = c.word.grammar;
    if (c.word.type !== 'verb_form' || !g) continue;
    const k = c.word.parentId + '|' + norm(c.word.es);
    if (!byForm.has(k)) byForm.set(k, new Set());
    byForm.get(k).add(`${g.number}-${g.person}`);
  }
  return deck
    .filter(({ word }) => word.type === 'verb_form' && word.grammar)
    .map((c) => ({
      id: c.word.id,
      es: c.word.es,
      verb: verbs.get(c.word.parentId) || '',
      tense: TENSE_PL[c.word.grammar.tense] || c.word.grammar.tense,
      person: `${c.word.grammar.number}-${c.word.grammar.person}`,
      persons: [...byForm.get(c.word.parentId + '|' + norm(c.word.es))],
      rank: rankOf(c, rng),
    }))
    .sort((a, b) => a.rank - b.rank);
}

/** Czas spadania jednej formy (ms): z każdym trafieniem szybciej, do granicy. */
export function fallMs(hits) {
  return Math.max(2200, 6500 - hits * 220);
}

// --- „Luka”: zdania z luką ----------------------------------------------------
// ten sam zapis luki co w Cloze.jsx (`[es::pl]`); tu bez JSX, żeby dało się testować w Node
const CLOZE = /\[([^\]:]+)::([^\]]+)\]/;
function parseExample(example) {
  const m = String(example?.es_form || '').match(CLOZE);
  if (!m) return { before: '', answer: '', after: '', pl: '' };
  const idx = example.es_form.indexOf(m[0]);
  return { before: example.es_form.slice(0, idx), answer: m[1], after: example.es_form.slice(idx + m[0].length), pl: example.pl_translation };
}

/** Zdania z przykładów: { id, key, before, answer, after, pl, group }. */
export function clozeDeck(deck, rng = Math.random) {
  const out = [];
  for (const c of deck) {
    const { word } = c;
    const group = word.type === 'verb_form' ? 'v:' + word.parentId : word.type;
    (word.examples || []).forEach((ex, i) => {
      const p = parseExample(ex);
      if (!p.answer) return;
      out.push({ id: word.id, key: `${word.id}#${i}`, ...p, group, rank: rankOf(c, rng) });
    });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/** Dopasowuje wielką literę na początku do poprawnej odpowiedzi (żeby nie zdradzać początku zdania). */
export function matchCase(text, like) {
  if (!text || !like) return text;
  const upper = like[0] !== like[0].toLowerCase();
  return (upper ? text[0].toUpperCase() : text[0].toLowerCase()) + text.slice(1);
}

/** Opcje do zdania: te same części mowy (formy — tego samego czasownika). */
export function clozeOptions(item, items, n = 4, rng = Math.random) {
  let pool = items.filter((x) => x.group === item.group && x.id !== item.id).map((x) => x.answer);
  // za mało form/słów w grupie (np. pierwsza lekcja) — dobierz z tego samego typu
  if (new Set(pool.map(norm)).size < n - 1 && item.group.startsWith('v:')) {
    pool = pool.concat(items.filter((x) => x.group.startsWith('v:') && x.id !== item.id).map((x) => x.answer));
  }
  if (new Set(pool.map(norm)).size < n - 1) pool = pool.concat(items.filter((x) => x.id !== item.id).map((x) => x.answer));
  return pickOptions(item.answer, pool.map((a) => matchCase(a, item.answer)), n, rng);
}

// --- „Eco”: ze słuchu ------------------------------------------------------------
/** Hasła do słuchania: { id, es, pl } (bez form odmiany — ich tłumaczenia są zbyt podobne). */
export function listenDeck(deck, rng = Math.random) {
  return deck
    .filter(({ word }) => word.type !== 'verb_form')
    .map((c) => ({ id: c.word.id, es: c.word.es, pl: c.word.pl, rank: rankOf(c, rng) }))
    .sort((a, b) => a.rank - b.rank);
}

/** Cztery polskie tłumaczenia do wyboru; inne hasło o tym samym brzmieniu nie trafia do opcji. */
export function listenOptions(item, items, n = 4, rng = Math.random) {
  const pool = items.filter((x) => x.id !== item.id && norm(x.es) !== norm(item.es)).map((x) => x.pl);
  return pickOptions(item.pl, pool, n, rng);
}

/** Następny element talii bez powtórki ostatnich `gap` (mała talia może się zapętlić). */
export function nextFrom(items, recent, gap = 8) {
  const avoid = new Set(recent.slice(-gap));
  const fresh = items.filter((x) => !avoid.has(x.key || x.id));
  const list = fresh.length ? fresh : items;
  // talia jest posortowana od najważniejszych; lekka losowość w czołówce
  const head = list.slice(0, Math.min(list.length, 6));
  return head[Math.floor(Math.random() * head.length)];
}
