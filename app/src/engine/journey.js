import { getMeta, setMeta } from '../db.js';

// „Droga” jako podróż przez Hiszpanię: co REGION_HITS trafień bez stłuczki auto
// wjeżdża do kolejnego regionu i krajobraz się zmienia. Pierwszy wjazd do regionu
// daje pocztówkę do kolekcji (bez XP — XP z gier ma dzienny limit).
// Sceneria jest rysowana kodem na canvasie 2D w niskiej rozdzielczości, więc
// wszystkie rozmiary liczymy względem szerokości (s = W / 120): ta sama scena
// działa w grze i na małej pocztówce.

export const REGION_HITS = 10;

export const REGIONS = [
  {
    key: 'madrid', es: 'Madrid', pl: 'start podróży',
    sky: ['#1b1035', '#2b1648', '#4a1d5c', '#7a2a5e', '#b8455a', '#e8804f'],
    sun: { at: 'horizon', color: '#ffd23f' }, far: 'city', ground: ['#5f6b2c', '#687632'],
  },
  {
    key: 'mancha', es: 'La Mancha', pl: 'wiatraki Don Kichota',
    sky: ['#2b6cb0', '#3b82c4', '#4f97d4', '#68aee0', '#86c3ea', '#a8d8f0'],
    sun: { at: 'high', color: '#fff3b0' }, far: 'windmills', ground: ['#c9a227', '#d4ae32'],
  },
  {
    key: 'andalucia', es: 'Andalucía', pl: 'białe wioski i palmy',
    sky: ['#3a1f5c', '#6b2a6b', '#a3405e', '#d4664a', '#ef9445', '#f7c25a'],
    sun: { at: 'horizon', color: '#fff1a8' }, far: 'village', ground: ['#7a6b2a', '#86762f'],
  },
  {
    key: 'pirineos', es: 'Pirineos', pl: 'ośnieżone szczyty',
    sky: ['#1e3a5f', '#2b5079', '#3d6a93', '#5585ad', '#73a2c6', '#98c0dc'],
    sun: { at: 'high', color: '#f8fafc' }, far: 'peaks', ground: ['#2f5a35', '#356640'],
  },
  {
    key: 'costa', es: 'Costa Brava', pl: 'morze i latarnia',
    sky: ['#0e4f6e', '#126e8a', '#1990a6', '#3fb0bf', '#7acfd1', '#b7ead8'],
    sun: { at: 'high', color: '#fff7c2' }, far: 'sea', ground: ['#d9c08a', '#e2ca95'],
  },
  {
    key: 'barcelona', es: 'Barcelona', pl: 'nocą, pod Sagradą Familią',
    sky: ['#05040f', '#0a0820', '#120e30', '#1a1440', '#241a4f', '#2e2160'],
    sun: null, far: 'night', ground: ['#1f3a2a', '#23412f'],
  },
];

/** Region po `hits` trafieniach (ostatni zostaje do końca jazdy). */
export const regionAt = (hits) => Math.min(REGIONS.length - 1, Math.floor(Math.max(0, hits) / REGION_HITS));

/** Pocztówki są z regionów docelowych — Madryt to start, nie cel. */
export const POSTCARDS = REGIONS.slice(1);

export async function postcards() {
  return getMeta('postcards', {});
}

/** Dopisuje pocztówkę (raz). Zwraca true, gdy jest nowa. */
export async function collectPostcard(key, day) {
  const have = await postcards();
  if (have[key]) return false;
  await setMeta('postcards', { ...have, [key]: day });
  return true;
}

/** Najdalszy region, do którego dojechano (indeks w REGIONS). */
export async function farthestRegion() {
  return getMeta('roadFarthest', 0);
}

export async function saveFarthest(index) {
  if (index > (await farthestRegion())) await setMeta('roadFarthest', index);
}

// --- rysowanie ---------------------------------------------------------------
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function rect(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

/** Sylwetka od wysokości h(x) do horyzontu, kolumna po kolumnie. */
function ridge(ctx, W, y0, color, h) {
  ctx.fillStyle = color;
  for (let x = 0; x < W; x++) {
    const v = Math.max(0, h(x));
    if (v > 0) ctx.fillRect(x, Math.round(y0 - v), 1, Math.ceil(v));
  }
}

function line(ctx, color, x0, y0, x1, y1) {
  ctx.fillStyle = color;
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
}

const mountains = (s) => (x) => (Math.abs(((x * 7 + 13) % 46) - 23) * 0.35 + Math.abs(((x * 3) % 90) - 45) * 0.22) * s * 0.8;

function city(ctx, W, y0, s, color, { seed = 0, windows = null, skip = null } = {}) {
  const bw = Math.max(2, Math.round(4 * s));
  for (let i = 0, x = 0; x < W; i++, x += bw) {
    if (skip && x + bw > skip[0] && x < skip[1]) continue;
    const h = (3 + hash(i + seed) * 8) * s;
    rect(ctx, color, x, y0 - h, bw, h);
    if (windows) {
      for (let wy = y0 - h + s; wy < y0 - 1; wy += Math.max(2, 2 * s)) {
        if (hash(i * 13 + wy) > 0.55) rect(ctx, windows, x + bw / 3, wy, 1, 1);
      }
    }
  }
}

function windmill(ctx, x, base, k, pos, i) {
  const th = 10 * k;
  for (let y = 0; y < th; y++) {
    const half = (2 - (y / th) * 0.8) * k;
    rect(ctx, '#f1f5f9', x - half, base - y - 1, half * 2, 1);
  }
  rect(ctx, '#3f2a1d', x - 1.4 * k, base - th - 1.5 * k, 2.8 * k, 1.8 * k); // daszek
  const hx = x;
  const hy = base - th - 0.5 * k;
  const a = pos * 0.9 + i;
  const len = 7 * k;
  for (let q = 0; q < 4; q++) {
    const ang = a + (q * Math.PI) / 2;
    line(ctx, '#3b2f2f', hx, hy, hx + Math.cos(ang) * len, hy + Math.sin(ang) * len);
  }
}

function palm(ctx, x, base, s) {
  const h = 9 * s;
  for (let y = 0; y < h; y++) rect(ctx, '#5b3a1e', x + Math.sin(y / h) * 1.5 * s, base - y - 1, 1, 1);
  const tx = x + Math.sin(1) * 1.5 * s;
  const ty = base - h;
  for (const [dx, dy] of [[-4, 1], [4, 1], [-3, -1], [3, -1], [0, -2]]) line(ctx, '#2f7a3a', tx, ty, tx + dx * s, ty + dy * s + 1);
}

function drawFar(ctx, W, y0, s, scene, pos) {
  switch (scene.far) {
    case 'city': {
      ridge(ctx, W, y0, '#2a1a3e', mountains(s)); // Sierra de Guadarrama w tle
      city(ctx, W, y0, s, '#1a1028', { seed: 3, windows: '#7a2a5e' });
      // Cuatro Torres
      for (let t = 0; t < 4; t++) rect(ctx, '#140c20', W * 0.6 + t * 4 * s, y0 - (22 + (t % 2) * 3) * s, 2 * s, (22 + (t % 2) * 3) * s);
      break;
    }
    case 'windmills': {
      const hill = (x) => (2.5 + Math.sin(x * 0.06) * 1.5) * s;
      ridge(ctx, W, y0, '#a8892a', hill);
      [[0.16, 1], [0.48, 0.75], [0.82, 0.9]].forEach(([fx, k], i) => {
        const x = Math.round(W * fx);
        windmill(ctx, x, y0 - hill(x) + 1, k * s, pos, i);
      });
      break;
    }
    case 'village': {
      const hill = (x) => (3.5 + Math.sin(x * 0.045 + 1) * 2.5) * s;
      ridge(ctx, W, y0, '#6b5a2a', hill);
      // Alhambra na wzgórzu
      const ax = W * 0.08;
      const ay = y0 - hill(Math.round(ax + 9 * s));
      rect(ctx, '#a8553a', ax, ay - 4 * s, 20 * s, 4 * s);
      for (const tx of [0, 7, 15]) rect(ctx, '#934530', ax + tx * s, ay - 7 * s, 3 * s, 3 * s);
      // białe domki z dachówką
      for (let i = 0; i < 9; i++) {
        const x = W * 0.38 + i * 6 * s + hash(i) * 2 * s;
        if (x > W - 4 * s) break;
        const top = y0 - hill(Math.round(x)) + (1 + hash(i + 9) * 3) * s;
        const w = (3 + hash(i + 4) * 2) * s;
        const h = (3 + hash(i + 7)) * s;
        rect(ctx, '#f8fafc', x, top - h, w, h);
        rect(ctx, '#c2410c', x, top - h - 1, w, 1);
        rect(ctx, '#334155', x + w / 2, top - h / 2, 1, 1);
      }
      palm(ctx, Math.round(W * 0.34), y0, s);
      palm(ctx, Math.round(W * 0.93), y0, s * 0.8);
      break;
    }
    case 'peaks': {
      const peak = (x) => (Math.abs(((x * 5 + 40) % 70) - 35) * 0.55 + Math.abs(((x * 2 + 7) % 50) - 25) * 0.35) * s;
      ctx.fillStyle = '#475569';
      for (let x = 0; x < W; x++) {
        const h = peak(x);
        const top = Math.round(y0 - h);
        ctx.fillStyle = '#475569';
        ctx.fillRect(x, top, 1, Math.ceil(h));
        const snow = Math.max(0, (h - 12 * s) * 0.7);
        if (snow > 0) { ctx.fillStyle = '#e2e8f0'; ctx.fillRect(x, top, 1, Math.ceil(snow)); }
      }
      // las świerków bliżej
      ctx.fillStyle = '#1e3a2a';
      for (let x = 0; x < W; x++) {
        const h = (2 + ((x * 3) % 7 < 4 ? (x * 3) % 7 : 7 - ((x * 3) % 7))) * s * 0.9;
        ctx.fillRect(x, Math.round(y0 - h), 1, Math.ceil(h));
      }
      break;
    }
    case 'sea': {
      const top = y0 - 6 * s;
      rect(ctx, '#1d6fa3', 0, top, W, y0 - top);
      ctx.fillStyle = '#7dd3fc';
      for (let y = Math.round(top) + 1; y < y0; y += 2) {
        for (let x = (Math.floor(pos * 3) + y * 5) % 9; x < W; x += 9) ctx.fillRect(x, y, 2, 1);
      }
      // klif z latarnią
      ridge(ctx, W, y0, '#8b5e3c', (x) => (x > W * 0.74 ? Math.min(9 * s, (x - W * 0.74) * 0.8) : 0));
      const lx = W * 0.86;
      const lb = y0 - 9 * s;
      for (let y = 0; y < 10 * s; y++) rect(ctx, Math.floor(y / (2 * s)) % 2 ? '#ef4444' : '#f8fafc', lx, lb - y - 1, 2.5 * s, 1);
      rect(ctx, '#ffd23f', lx, lb - 12 * s, 2.5 * s, 2 * s);
      // żaglówka
      const bx = W * 0.25 + Math.sin(pos * 0.3) * 2 * s;
      for (let y = 0; y < 4 * s; y++) rect(ctx, '#f8fafc', bx, top - y + 2 * s, y * 0.7, 1);
      rect(ctx, '#7c2d12', bx - s, top + 2 * s, 4 * s, s);
      break;
    }
    case 'night': {
      for (let i = 0; i < 45; i++) {
        const x = hash(i) * W;
        const y = hash(i + 100) * y0 * 0.75;
        rect(ctx, (i + Math.floor(pos * 2)) % 9 === 0 ? '#ffd23f' : '#e2e8f0', x, y, 1, 1);
      }
      // księżyc (sierp)
      const mx = W * 0.8;
      const my = y0 * 0.25;
      const mr = 4 * s;
      for (let y = -mr; y <= mr; y++) {
        for (let x = -mr; x <= mr; x++) {
          const inMoon = x * x + y * y <= mr * mr;
          const shadow = (x - mr * 0.6) ** 2 + (y + mr * 0.2) ** 2 <= mr * mr * 0.8;
          if (inMoon && !shadow) rect(ctx, '#f1f5f9', mx + x, my + y, 1, 1);
        }
      }
      // Sagrada Familia
      const sx = W * 0.36;
      const sw = 20 * s;
      city(ctx, W, y0, s, '#120c24', { seed: 11, windows: '#ffd23f', skip: [sx - 2, sx + sw + 2] });
      rect(ctx, '#120c24', sx, y0 - 8 * s, sw, 8 * s);
      [[1, 22], [5, 27], [9, 30], [12, 30], [15, 26]].forEach(([dx, h]) => {
        for (let y = 0; y < h * s; y++) {
          const w = Math.max(1, 2.4 * s * (1 - (y / (h * s)) * 0.6));
          rect(ctx, '#120c24', sx + dx * s + (2.4 * s - w) / 2, y0 - y - 1, w, 1);
        }
        rect(ctx, '#ffd23f', sx + dx * s + s, y0 - h * s - 1, 1, 1);
      });
      break;
    }
    default:
      ridge(ctx, W, y0, '#2a1a3e', mountains(s));
  }
}

/**
 * Niebo, krajobraz, ziemia i droga dla regionu `scene`. `pos` to przejechana
 * odległość (pasy na drodze, wiatraki, fale). Zwraca geometrię drogi dla bramki i auta.
 */
export function drawScenery(ctx, W, H, scene, pos = 0) {
  const y0 = Math.round(H * 0.36);
  const ground = H - y0;
  const cx = W / 2;
  const roadW = W * 0.5; // połowa szerokości drogi przy dolnej krawędzi
  const s = W / 120;
  const band = Math.ceil(y0 / scene.sky.length);
  scene.sky.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * band, W, band); });
  if (scene.sun) {
    ctx.fillStyle = scene.sun.color;
    if (scene.sun.at === 'horizon') {
      const r = Math.round(W * 0.09);
      for (let y = -r; y <= 0; y++) { const half = Math.round(Math.sqrt(r * r - y * y)); if ((y & 3) !== 3) ctx.fillRect(Math.round(cx - half), y0 + y, half * 2, 1); }
    } else {
      const r = Math.max(2, Math.round(W * 0.05));
      const sx = Math.round(W * 0.74);
      const sy = Math.round(y0 * 0.3);
      for (let y = -r; y <= r; y++) { const half = Math.round(Math.sqrt(r * r - y * y)); ctx.fillRect(sx - half, sy + y, half * 2, 1); }
    }
  }
  drawFar(ctx, W, y0, s, scene, pos);
  // ziemia i droga: linia po linii, im bliżej horyzontu, tym większa odległość
  for (let y = y0; y < H; y++) {
    const k = (y - y0 + 1) / ground; // 0 przy horyzoncie, 1 przy dole
    const d = 1 / k;
    const stripe = Math.floor((d + pos) * 1.4) & 1;
    const half = roadW * k;
    ctx.fillStyle = scene.ground[stripe];
    ctx.fillRect(0, y, W, 1);
    ctx.fillStyle = stripe ? '#f1f5f9' : '#ef4444';
    ctx.fillRect(Math.round(cx - half * 1.12), y, Math.ceil(half * 2.24), 1);
    ctx.fillStyle = stripe ? '#3a3145' : '#40374c';
    ctx.fillRect(Math.round(cx - half), y, Math.ceil(half * 2), 1);
    if (stripe) { ctx.fillStyle = '#f1f5f9'; ctx.fillRect(Math.round(cx - Math.max(0.5, half * 0.03)), y, Math.max(1, Math.round(half * 0.06)), 1); }
  }
  return { y0, ground, cx, roadW };
}
