import React from 'react';
import { SPRITES } from '../engine/sprites.js';

// Pikselowi bossowie. Każdy rodzaj ma własny kształt, a kolor zależy od numeru
// lekcji, więc kolejne walki wyglądają inaczej bez dodatkowych grafik.
export default function BossSprite({ kind = 'guardian', seed = 1, size = 56, className = '' }) {
  const rows = SPRITES[kind] || SPRITES.guardian;
  const hue = (seed * 47) % 360;
  const fill = { X: `hsl(${hue} 55% 55%)`, a: `hsl(${(hue + 150) % 360} 60% 60%)`, o: '#f1f5f9', e: '#17131c', m: '#17131c', w: '#f1f5f9' };
  const shade = `hsl(${hue} 55% 38%)`;
  return (
    <svg className={'boss-sprite ' + className} width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
      {rows.flatMap((row, y) => [...row].map((c, x) => (c === '.' ? null : (
        <rect key={x + '-' + y} x={x} y={y} width="1" height="1" fill={c === 'X' && y >= 10 ? shade : fill[c]} />
      ))))}
    </svg>
  );
}

