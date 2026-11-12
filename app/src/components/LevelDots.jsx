import React from 'react';

// Poziom karty na 5 kropkach. Poziomy 1–5 zapełniają je kolorami od czerwieni
// do zieleni; poziomy 6–10 zapełniają te same kropki drugi raz — na złoto.
// Błąd na 6+ zrzuca kartę na 5, czyli „złoto znika, zostaje pełna piątka”.
export default function LevelDots({ level = 1, small = false }) {
  const gold = Math.max(0, Math.min(5, level - 5));
  const base = Math.min(5, level);
  return (
    <span className={'level-dots' + (small ? ' small' : '')} title={`Poziom ${level} z 10`} aria-label={`Poziom ${level} z 10`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={'level-dot' + (i < gold ? ' on gold' : i < base ? ' on dot-' + (gold ? 5 : i + 1) : '')}
        />
      ))}
    </span>
  );
}
