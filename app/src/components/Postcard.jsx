import React, { useEffect, useRef } from 'react';
import { drawScenery } from '../engine/journey.js';
import Icon from './Icon.jsx';

// Pocztówka z „Drogi”: mały kadr sceny regionu (ta sama funkcja, co w grze).
// Niezebrana pokazuje tylko nazwę i kłódkę — wiadomo, dokąd jechać dalej.
export default function Postcard({ region, owned, fresh = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!owned || !ref.current) return;
    const canvas = ref.current;
    canvas.width = 72;
    canvas.height = 48;
    // scena w wyższym kadrze, z którego wycinamy pas wokół horyzontu: więcej krajobrazu, mniej asfaltu
    const full = document.createElement('canvas');
    full.width = 72;
    full.height = 110;
    drawScenery(full.getContext('2d'), full.width, full.height, region, 0.4);
    canvas.getContext('2d').drawImage(full, 0, 6, 72, 48, 0, 0, 72, 48);
  }, [owned, region]);
  return (
    <figure className={'postcard' + (owned ? '' : ' locked') + (fresh ? ' fresh' : '')}>
      {owned ? <canvas ref={ref} aria-hidden="true" /> : <span className="postcard-lock"><Icon name="lock" size={14} /></span>}
      <figcaption>{region.es}</figcaption>
    </figure>
  );
}
