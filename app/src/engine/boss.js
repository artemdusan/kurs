import { buildMcqOptions } from './mcq.js';
import { sprintDeck } from './insights.js';

// Walka z bossem: zwieńczenie lekcji. Boss szykuje atak (pasek czasu), a gracz
// odpowiada na szybkie pytania z właśnie ukończonej lekcji. Dobra odpowiedź to
// trafienie, szybka — cios krytyczny. Ostatni punkt życia zabiera dopiero „cios
// kończący”: wpisanie słowa z lekcji z klawiatury.

export const BOSS_HEARTS = 3;
export const CRIT_SHARE = 0.35; // odpowiedź w pierwszych 35% czasu = cios krytyczny

/** Rodzaje bossów — każdy zmienia jedną zasadę walki. */
export const BOSS_TYPES = [
  { key: 'guardian', name: 'Strażnik', hp: 6, time: 9, trait: 'Bez sztuczek. Odpowiadaj, zanim zaatakuje.' },
  { key: 'rayo', name: 'Błyskawica', hp: 5, time: 5, trait: 'Atakuje szybko: masz o połowę mniej czasu.' },
  { key: 'escudo', name: 'Tarczownik', hp: 4, time: 9, shield: true, trait: 'Tarcza pęka po dobrej odpowiedzi, ale wraca po każdym błędzie.' },
  { key: 'vampiro', name: 'Wampir', hp: 6, time: 9, heals: true, trait: 'Każdy twój błąd leczy go o 1 punkt.' },
  { key: 'camaleon', name: 'Kameleon', hp: 6, time: 8, reverse: true, trait: 'Odwraca pytania: hiszpańskie słowo, polska odpowiedź.' },
];

/** Boss strzegący lekcji `lesson` (pierwszy boss stoi przed lekcją 2). */
export function bossFor(lesson) {
  return BOSS_TYPES[(((lesson - 2) % BOSS_TYPES.length) + BOSS_TYPES.length) % BOSS_TYPES.length];
}

/** Stan po dobrej odpowiedzi. `fast` = cios krytyczny. */
export function applyHit(state, boss, fast) {
  if (boss.shield && state.shield) return { ...state, shield: false, damage: 0, broke: true };
  const damage = Math.min(state.hp, fast ? 2 : 1);
  return { ...state, hp: state.hp - damage, damage, crit: fast && damage === 2 };
}

/** Stan po błędzie albo po upływie czasu. */
export function applyMiss(state, boss) {
  return {
    ...state,
    hearts: state.hearts - 1,
    hp: boss.heals ? Math.min(boss.hp, state.hp + 1) : state.hp,
    shield: Boolean(boss.shield),
    healed: Boolean(boss.heals) && state.hp < boss.hp,
  };
}

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const KINDS = ['vocab', 'form', 'article', 'vocab', 'form', 'vocab'];

/**
 * Pytania do walki: głównie z ukończonej lekcji (`lesson`), reszta z wcześniejszych.
 * Każde: { kind, prompt, hint, options, answer, es }.
 */
export async function buildBossQuestions(deck, lesson, boss, count = 16, rng = Math.random) {
  const words = deck.map((d) => d.word);
  const own = (list) => { const mine = list.filter((w) => w.lesson === lesson); return mine.length >= 3 ? mine : list; };
  const entries = words.filter((w) => w.type !== 'verb_form');
  const forms = words.filter((w) => w.type === 'verb_form');
  const nouns = sprintDeck(deck.filter((d) => d.word.type === 'noun'), rng);
  const lessonOf = new Map(words.map((w) => [w.id, w.lesson]));
  const ownNouns = (() => { const mine = nouns.filter((n) => lessonOf.get(n.id) === lesson); return mine.length >= 3 ? mine : nouns; })();
  const queues = { vocab: shuffle(own(entries), rng), form: shuffle(own(forms), rng), article: shuffle(ownNouns, rng) };
  const take = (kind) => { const q = queues[kind]; if (!q.length) return null; const item = q.shift(); q.push(item); return item; };

  const questions = [];
  for (let i = 0; questions.length < count && i < count * 3; i++) {
    const kind = KINDS[i % KINDS.length];
    if (kind === 'form') {
      const w = take('form');
      const options = w && (await buildMcqOptions(w, rng));
      if (options) { questions.push({ kind, prompt: w.pl, hint: 'Która forma?', options, answer: w.es, es: w.es }); continue; }
    }
    if (kind === 'article') {
      const n = take('article');
      if (n) { questions.push({ kind, prompt: n.noun, sub: n.pl, hint: 'Jaki rodzajnik?', options: n.plural ? ['los', 'las'] : ['el', 'la'], answer: n.article, es: n.article + ' ' + n.noun }); continue; }
    }
    const w = take('vocab');
    if (!w) continue;
    const side = boss.reverse ? 'pl' : 'es';
    const other = boss.reverse ? 'es' : 'pl';
    const seen = new Set([w[side].toLowerCase()]);
    const distractors = [];
    for (const c of shuffle(entries.filter((e) => e.type === w.type), rng).concat(shuffle(entries, rng))) {
      if (distractors.length >= 3) break;
      if (c.id === w.id || c[other].toLowerCase() === w[other].toLowerCase() || seen.has(c[side].toLowerCase())) continue;
      seen.add(c[side].toLowerCase());
      distractors.push(c[side]);
    }
    if (distractors.length < 2) continue;
    questions.push({ kind: 'vocab', prompt: w[other], hint: boss.reverse ? 'Co to znaczy?' : 'Jak to po hiszpańsku?', options: shuffle([w[side], ...distractors], rng), answer: w[side], es: w.es });
  }
  return questions;
}

/** Słowa na cios kończący: najpierw czasownik lekcji, potem przymiotniki i rzeczowniki. */
export function finisherWords(deck, lesson, rng = Math.random) {
  const mine = deck.map((d) => d.word).filter((w) => w.lesson === lesson && w.type !== 'verb_form');
  const rank = { verb: 0, adjective: 1, noun: 2 };
  return shuffle(mine, rng).sort((a, b) => (rank[a.type] ?? 3) - (rank[b.type] ?? 3));
}
