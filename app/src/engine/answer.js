// Normalizacja i porównywanie odpowiedzi.
// Rodzajniki określone i nieokreślone są równoważne: el/un, la/una, los/unos, las/unas.

const ARTICLE_CANON = {
  el: 'el', un: 'el',
  la: 'la', una: 'la',
  los: 'los', unos: 'los',
  las: 'las', unas: 'las',
};

export function splitArticle(text) {
  const m = text.trim().match(/^(el|la|los|las|un|una|unos|unas)\s+(.+)$/i);
  if (!m) return { article: '', rest: text.trim() };
  return { article: m[1].toLowerCase(), rest: m[2] };
}

export function stripAccents(s) {
  // usuwa akcenty (a z akcentem -> a itd.), ale enie (\u00f1) pozostaje osobna litera
  return s
    .replace(/\u00f1/g, '\u0001')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0001/g, '\u00f1');
}

function normalize(s, accentTolerance) {
  let out = s.toLowerCase().trim().replace(/\s+/g, ' ');
  if (accentTolerance) out = stripAccents(out);
  return out;
}

/** Porównuje odpowiedź użytkownika z oczekiwaną. Dla rzeczowników rodzajniki el/un itd. są równoważne. */
export function checkAnswer(userAnswer, expected, { isNoun = false, accentTolerance = false } = {}) {
  let a = normalize(userAnswer, accentTolerance);
  let b = normalize(expected, accentTolerance);
  if (isNoun) {
    const ua = splitArticle(a);
    const eb = splitArticle(b);
    const artA = ARTICLE_CANON[ua.article] || ua.article;
    const artB = ARTICLE_CANON[eb.article] || eb.article;
    return artA === artB && ua.rest === eb.rest;
  }
  return a === b;
}
