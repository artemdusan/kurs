import { db } from '../db.js';

// MCQ dla odmian czasowników: dystraktory to formy TEGO SAMEGO czasownika,
// ta sama osoba i liczba, inne czasy (present / preterite / future).

function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Zwraca listę 3 opcji (stringów) z poprawną odpowiedzią, albo null gdy brak dystraktorów. */
export async function buildMcqOptions(word, rng = Math.random) {
  if (word.type !== 'verb_form' || !word.grammar) return null;
  const siblings = await db.words
    .where('parentId')
    .equals(word.parentId)
    .filter(
      (w) =>
        !w.deleted &&
        w.id !== word.id &&
        w.grammar &&
        w.grammar.person === word.grammar.person &&
        w.grammar.number === word.grammar.number &&
        w.grammar.tense !== word.grammar.tense &&
        w.es !== word.es
    )
    .toArray();

  let distractors = shuffle(siblings, rng).slice(0, 2).map((w) => w.es);
  if (distractors.length < 2) {
    // awaryjnie: dowolne inne formy tego czasownika
    const any = await db.words
      .where('parentId')
      .equals(word.parentId)
      .filter((w) => !w.deleted && w.es !== word.es && !distractors.includes(w.es))
      .toArray();
    distractors = [...distractors, ...shuffle(any, rng).map((w) => w.es)].slice(0, 2);
  }
  if (distractors.length < 2) return null;
  return shuffle([word.es, ...distractors], rng);
}
