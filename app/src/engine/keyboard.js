import { splitArticle } from './answer.js';

// Mini klawiatura ekranowa: litery występujące w odpowiedzi + 1-2 dodatkowe
// znaki-dystraktory (samogłoska z akcentem i spółgłoska, w tym ñ/ü).

const ACCENT_VOWELS = ['á', 'é', 'í', 'ó', 'ú'];
const EXTRA_CONSONANTS = ['ñ', 'b', 'v', 'g', 'j', 'z', 'x', 'h', 'q'];
const SPECIALS = ['ñ', 'ü'];

function pick(arr, exclude, rng) {
  const pool = arr.filter((c) => !exclude.has(c));
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Buduje układ klawiatury dla docelowego tekstu (bez rodzajnika — ten ma osobne przyciski).
 * Zwraca { letters: [...], hasSpace: bool }.
 */
export function buildKeyboard(target, { isNoun = false, rng = Math.random } = {}) {
  const text = isNoun ? splitArticle(target).rest : target;
  const chars = new Set(
    text.toLowerCase().replace(/[^a-záéíóúüñ]/g, '').split('')
  );

  const extras = [];
  const accent = pick(ACCENT_VOWELS, chars, rng);
  if (accent) extras.push(accent);
  // spółgłoska lub znak specjalny, preferuj ñ/ü jeśli nieobecne
  const special = pick(SPECIALS, chars, rng);
  const consonant = special && rng() < 0.5 ? special : pick(EXTRA_CONSONANTS, chars, rng);
  if (consonant && !extras.includes(consonant)) extras.push(consonant);

  // kolejność jak na klawiaturze QWERTY (litery akcentowane obok bazowych) —
  // stałe, przewidywalne pozycje ułatwiają trafianie palcem
  const letters = [...chars, ...extras].sort((a, b) => qwertyRank(a) - qwertyRank(b));
  return {
    letters,
    hasSpace: /\s/.test(text.trim()),
  };
}

const QWERTY = 'qwertyuiopasdfghjklñzxcvbnm';
const BASE = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u' };

function qwertyRank(ch) {
  const base = BASE[ch] || ch;
  // akcentowana wersja tuż za bazową literą
  return QWERTY.indexOf(base) * 2 + (BASE[ch] ? 1 : 0);
}

/** Dzieli litery na rzędy po maks `perRow`, jak fizyczna klawiatura. */
export function keyboardRows(letters, perRow = 7) {
  const rows = [];
  for (let i = 0; i < letters.length; i += perRow) rows.push(letters.slice(i, i + perRow));
  return rows;
}

/** Przyciski rodzajników dopasowane do odpowiedzi: mnogie tylko dla rzeczowników mnogich. */
export function articleButtons(expectedArticle) {
  return expectedArticle === 'los' || expectedArticle === 'las' || expectedArticle === 'unos' || expectedArticle === 'unas'
    ? ['los', 'las']
    : ['el', 'la'];
}
