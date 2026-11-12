import React from 'react';

// Pikselowa mapa kursu: 100 pól w kształcie Półwyspu Iberyjskiego, jedno na lekcję.
// Zamknięte lekcje to ciemna sylwetka, otwarte zielenieją wraz z postępem,
// w pełni opanowane są złote. Pola idą wężykiem od północnego zachodu na południe.
// X = pole lekcji, o = Baleary (ozdoba, bez lekcji).
const SHAPE = [
  '.XXXXXXXXX......',
  'XXXXXXXXXXXXX...',
  'XXXXXXXXXXXXXX..',
  '.XXXXXXXXXXX....',
  '.XXXXXXXXXXX..o.',
  '.XXXXXXXXXX..o..',
  'XXXXXXXXXXX.....',
  '.XXXXXXXX.......',
  '.XXXXXXX........',
  '..XXXXX.........',
  '....X...........',
];
const cellsOf = (ch) => SHAPE.flatMap((row, y) => {
  const xs = [...row].map((c, x) => (c === ch ? x : -1)).filter((x) => x >= 0);
  return (y % 2 ? xs.reverse() : xs).map((x) => ({ x, y }));
});
export const MAP_CELLS = cellsOf('X');
const ISLANDS = cellsOf('o');

export default function PixelMap({ unlockedLesson, lessonStats, current, onSelect }) {
  return (
    <svg className="pixel-map" viewBox="-0.5 -0.5 17 12" shapeRendering="crispEdges" role="img" aria-label={`Mapa kursu: otwarte ${unlockedLesson} z ${MAP_CELLS.length} lekcji`}>
      {ISLANDS.map(({ x, y }) => <rect key={x + '-' + y} x={x + 0.05} y={y + 0.05} width="0.9" height="0.9" fill="var(--card)" />)}
      {MAP_CELLS.map(({ x, y }, i) => {
        const n = i + 1;
        const open = n <= unlockedLesson;
        const stat = lessonStats[n];
        const pct = open && stat ? stat.mastered / stat.total : 0;
        const fill = !open ? 'var(--card)' : pct >= 1 ? 'var(--gold)' : `hsl(130 ${25 + pct * 30}% ${24 + pct * 26}%)`;
        return (
          <rect
            key={n}
            x={x + 0.05} y={y + 0.05} width="0.9" height="0.9"
            fill={fill}
            className={'map-cell' + (open ? ' open' : '') + (n === current ? ' current' : '')}
            onClick={open ? () => onSelect(n) : undefined}
          >
            <title>{`Lekcja ${n}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
