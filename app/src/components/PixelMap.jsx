import React from 'react';
import { MAP_CELLS, ISLANDS } from '../engine/map.js';

// Pikselowa mapa kursu: 100 pól w kształcie Półwyspu Iberyjskiego, jedno na lekcję.
// Zamknięte lekcje to ciemna sylwetka, otwarte zielenieją wraz z postępem,
// w pełni opanowane są złote. Pola idą wężykiem od północnego zachodu na południe.
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
