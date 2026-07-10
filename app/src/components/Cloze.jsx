import React from 'react';

export const CLOZE_RE = /\[([^\]:]+)::([^\]]+)\]/;

/** Wyciąga z przykładu tekst hiszpański z luką oraz odpowiedź. */
export function parseExample(example) {
  const m = example.es_form.match(CLOZE_RE);
  if (!m) return { before: example.es_form, answer: '', after: '', pl: example.pl_translation };
  const [full, es] = m;
  const idx = example.es_form.indexOf(full);
  return {
    before: example.es_form.slice(0, idx),
    answer: es,
    after: example.es_form.slice(idx + full.length),
    pl: example.pl_translation,
  };
}

/** Zdanie z luką (lub z odsłoniętą odpowiedzią po ocenie).
 *  Polskie tłumaczenie zdania pokazujemy dopiero po odpowiedzi — wcześniej
 *  zdradzałoby rozwiązanie i rozpraszało. */
export default function Cloze({ parsed, revealed, userText, correct }) {
  return (
    <div className="cloze">
      <p className="cloze-es">
        {parsed.before}
        <span className={'cloze-gap' + (revealed ? ' revealed ' + (correct ? 'ok' : 'bad') : '')}>
          {revealed ? parsed.answer : userText || '____'}
        </span>
        {parsed.after}
      </p>
      {revealed && <p className="cloze-pl">{parsed.pl}</p>}
    </div>
  );
}
