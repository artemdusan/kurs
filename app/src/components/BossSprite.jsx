import React from 'react';

// Pikselowy strażnik lekcji. Kształt jest jeden, kolor zależy od numeru lekcji,
// więc każdy boss wygląda trochę inaczej bez dodatkowych grafik.
const ROWS = [
  '.X........X.',
  '.XX......XX.',
  '.XXXXXXXXXX.',
  'XXXXXXXXXXXX',
  'XXooXXXXooXX',
  'XXoeXXXXoeXX',
  'XXXXXXXXXXXX',
  'XXmwmwmwmwXX',
  'XXmmmmmmmmXX',
  'XXXwmwmwmXXX',
  '.XXXXXXXXXX.',
  '.XX.XXXX.XX.',
];

export default function BossSprite({ seed = 1, size = 56, className = '' }) {
  const hue = (seed * 47) % 360;
  const fill = { X: `hsl(${hue} 55% 55%)`, o: '#f1f5f9', e: '#17131c', m: '#17131c', w: '#f1f5f9' };
  const shade = `hsl(${hue} 55% 38%)`;
  return (
    <svg className={'boss-sprite ' + className} width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
      {ROWS.flatMap((row, y) => [...row].map((c, x) => (c === '.' ? null : (
        <rect key={x + '-' + y} x={x} y={y} width="1" height="1" fill={c === 'X' && (y >= 10 || x >= 10) ? shade : fill[c]} />
      ))))}
    </svg>
  );
}
