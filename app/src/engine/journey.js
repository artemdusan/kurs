import { getMeta, setMeta } from '../db.js';

// „Droga” jako podróż przez Hiszpanię i kraje hiszpańskojęzyczne (TRIPS): co REGION_HITS trafień bez stłuczki auto
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

// Kolejne trasy po krajach, w których mówi się po hiszpańsku. Każda ma 6 regionów
// (start + 5 pocztówek). Trasa otwiera się, gdy z poprzedniej masz TRIP_UNLOCK pocztówek.
export const TRIP_UNLOCK = 3;

const MEXICO = [
  {
    key: 'cdmx', es: 'Ciudad de México', pl: 'stolica pod wulkanami', country: 'Meksyk',
    sky: ['#13254a', '#1f3a68', '#2f5486', '#4a72a3', '#7096bd', '#a3bfd6'],
    sun: { at: 'high', color: '#fff3b0' }, far: 'cdmx', ground: ['#4d5a2a', '#56642f'],
  },
  {
    key: 'teotihuacan', es: 'Teotihuacán', pl: 'Piramida Słońca', country: 'Meksyk',
    sky: ['#2563a8', '#3378b8', '#4a8fc8', '#68a6d6', '#8fc0e3', '#bcdcef'],
    sun: { at: 'high', color: '#fff7c2' }, far: 'pyramid', ground: ['#a07a3c', '#ab8443'],
  },
  {
    key: 'sonora', es: 'Desierto de Sonora', pl: 'kaktusy saguaro', country: 'Meksyk',
    sky: ['#4a1d5c', '#7a2a5e', '#b8455a', '#e0703f', '#f39a3c', '#f9c64f'],
    sun: { at: 'horizon', color: '#fff1a8' }, far: 'cactus', ground: ['#b0703a', '#bb7a40'],
  },
  {
    key: 'guanajuato', es: 'Guanajuato', pl: 'kolorowe domy na zboczu', country: 'Meksyk',
    sky: ['#1f5f9e', '#2c75b4', '#3f8cc6', '#5aa3d4', '#80bce2', '#acd6ee'],
    sun: { at: 'high', color: '#fff3b0' }, far: 'colorful', ground: ['#6b6a2c', '#757430'],
    houses: ['#f59e0b', '#ef4444', '#3b82f6', '#22c55e', '#ec4899', '#a855f7', '#facc15'],
  },
  {
    key: 'cancun', es: 'Cancún', pl: 'turkusowe Karaiby', country: 'Meksyk',
    sky: ['#0b6fa4', '#138cbc', '#24a7cf', '#4cc0dc', '#86d8e6', '#c2eef0'],
    sun: { at: 'high', color: '#fffbe0' }, far: 'caribe', ground: ['#e9d9a6', '#efe0b0'],
  },
  {
    key: 'muertos', es: 'Oaxaca', pl: 'noc Día de Muertos', country: 'Meksyk',
    sky: ['#0b0618', '#140a28', '#1e0e36', '#2a1244', '#3a1650', '#4a1a58'],
    sun: null, far: 'muertos', ground: ['#2a2a1a', '#30301e'],
  },
];

const CARIBE = [
  {
    key: 'habana', es: 'La Habana', pl: 'Kapitol i kolorowe kamienice', country: 'Kuba',
    sky: ['#1b4f8a', '#2766a3', '#3a80ba', '#579ccc', '#7fb8dc', '#b0d6ec'],
    sun: { at: 'high', color: '#fff3b0' }, far: 'havana', ground: ['#6b6a3a', '#757440'],
  },
  {
    key: 'vinales', es: 'Viñales', pl: 'mogoty i tytoń', country: 'Kuba',
    sky: ['#3a6ea5', '#4a82b6', '#5f97c6', '#7aaed4', '#9cc5e0', '#c3dcec'],
    sun: { at: 'high', color: '#fff7c2' }, far: 'mogotes', ground: ['#8a3f22', '#954626'],
  },
  {
    key: 'sanjuan', es: 'San Juan', pl: 'twierdza El Morro', country: 'Portoryko',
    sky: ['#0d5d8c', '#14739f', '#1e8ab2', '#3aa3c4', '#6cc0d6', '#a8dde6'],
    sun: { at: 'high', color: '#fffbe0' }, far: 'fortress', ground: ['#3f7a3a', '#468540'],
  },
  {
    key: 'arenal', es: 'Volcán Arenal', pl: 'wulkan w lesie deszczowym', country: 'Kostaryka',
    sky: ['#4b5d6e', '#5b6f80', '#6d8293', '#8297a6', '#9cb0bc', '#b8c9d2'],
    sun: null, far: 'volcano', ground: ['#2a5a2a', '#306530'],
  },
  {
    key: 'panama', es: 'Canal de Panamá', pl: 'statki między oceanami', country: 'Panama',
    sky: ['#3a1f5c', '#6b2a6b', '#a3405e', '#d4664a', '#ef9445', '#f7c25a'],
    sun: { at: 'horizon', color: '#fff1a8' }, far: 'canal', ground: ['#3f6b2c', '#457532'],
  },
  {
    key: 'tikal', es: 'Tikal', pl: 'świątynie Majów w dżungli', country: 'Gwatemala',
    sky: ['#0f3b2e', '#16503c', '#20664a', '#2f7d58', '#4a9668', '#6fb07c'],
    sun: null, far: 'jungle', ground: ['#1f4a22', '#245228'],
  },
];

const SUDAMERICA = [
  {
    key: 'bogota', es: 'Bogotá', pl: 'miasto pod Monserrate', country: 'Kolumbia',
    sky: ['#2d4a6e', '#3b5f86', '#4e769c', '#678fb1', '#87aac6', '#adc6da'],
    sun: { at: 'high', color: '#f8fafc' }, far: 'bogota', ground: ['#3d5f2c', '#446a31'],
  },
  {
    key: 'machupicchu', es: 'Machu Picchu', pl: 'miasto Inków w chmurach', country: 'Peru',
    sky: ['#4f7ba3', '#6190b5', '#77a5c5', '#91bbd4', '#b1d0e2', '#d6e7f0'],
    sun: null, far: 'machu', ground: ['#3c6e2e', '#437933'],
  },
  {
    key: 'uyuni', es: 'Salar de Uyuni', pl: 'solne lustro nieba', country: 'Boliwia',
    sky: ['#1e4f9a', '#2b63ad', '#3e7bc0', '#5a95d0', '#7fb1df', '#acd0ec'],
    sun: { at: 'high', color: '#ffffff' }, far: 'salt', ground: ['#e2e8f0', '#d7dee8'],
  },
  {
    key: 'valparaiso', es: 'Valparaíso', pl: 'kolorowe wzgórza nad Pacyfikiem', country: 'Chile',
    sky: ['#14507a', '#1c6690', '#2a7da5', '#4596b8', '#6fb2cb', '#a6cfe0'],
    sun: { at: 'high', color: '#fff3b0' }, far: 'colorful', ground: ['#5c5a2a', '#66642f'], harbor: true,
    houses: ['#f97316', '#eab308', '#06b6d4', '#e11d48', '#84cc16', '#8b5cf6', '#f1f5f9'],
  },
  {
    key: 'buenosaires', es: 'Buenos Aires', pl: 'Obelisk i tango nocą', country: 'Argentyna',
    sky: ['#0b1026', '#121a3a', '#1b244c', '#262f5e', '#343b6e', '#46487c'],
    sun: null, far: 'obelisk', ground: ['#2a3a2a', '#30422f'],
  },
  {
    key: 'patagonia', es: 'Patagonia', pl: 'Fitz Roy i lodowcowe jezioro', country: 'Argentyna',
    sky: ['#3b2a5c', '#5a3a6e', '#86507a', '#b56e7e', '#dc9a86', '#f0c69c'],
    sun: null, far: 'lake', ground: ['#6b6a3a', '#757440'],
  },
];

export const TRIPS = [
  { key: 'espana', es: 'España', pl: 'Hiszpania', regions: REGIONS.map((r) => ({ ...r, country: 'Hiszpania' })) },
  { key: 'mexico', es: 'México', pl: 'Meksyk', regions: MEXICO },
  { key: 'caribe', es: 'Caribe', pl: 'Karaiby i Ameryka Środkowa', regions: CARIBE },
  { key: 'sudamerica', es: 'Sudamérica', pl: 'Ameryka Południowa', regions: SUDAMERICA },
];
export const tripByKey = (key) => TRIPS.find((t) => t.key === key) || TRIPS[0];

/** Region po `hits` trafieniach (ostatni zostaje do końca jazdy). */
export const regionAt = (hits, count = REGIONS.length) => Math.min(count - 1, Math.floor(Math.max(0, hits) / REGION_HITS));

/** Pocztówki są z regionów docelowych — start trasy (np. Madryt) to start, nie cel. */
export const tripPostcards = (trip) => trip.regions.slice(1);
export const POSTCARDS = TRIPS.flatMap(tripPostcards);

/** Które trasy są otwarte przy danym albumie: pierwsza zawsze, kolejna po TRIP_UNLOCK pocztówkach z poprzedniej. */
export function openTrips(album = {}) {
  const open = [TRIPS[0].key];
  for (let i = 1; i < TRIPS.length; i++) {
    const have = tripPostcards(TRIPS[i - 1]).filter((p) => album[p.key]).length;
    if (have < TRIP_UNLOCK) break;
    open.push(TRIPS[i].key);
  }
  return open;
}

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

// najdalszy region Hiszpanii zostaje pod starym kluczem — zapis sprzed tras działa dalej
const farthestKey = (trip) => (!trip || trip === 'espana' ? 'roadFarthest' : 'roadFarthest:' + trip);

/** Najdalszy region trasy, do którego dojechano (indeks w jej regionach). */
export async function farthestRegion(trip = 'espana') {
  return getMeta(farthestKey(trip), 0);
}

export async function saveFarthest(index, trip = 'espana') {
  if (index > (await farthestRegion(trip))) await setMeta(farthestKey(trip), index);
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


function cactus(ctx, x, base, s, color = '#2f6b2f') {
  const h = 9 * s;
  rect(ctx, color, x, base - h, 2 * s, h);
  rect(ctx, color, x - 2 * s, base - h * 0.6, 2 * s, 1.2 * s);
  rect(ctx, color, x - 2 * s, base - h * 0.85, 1.2 * s, h * 0.3);
  rect(ctx, color, x + 2 * s, base - h * 0.45, 2 * s, 1.2 * s);
  rect(ctx, color, x + 2.8 * s, base - h * 0.75, 1.2 * s, h * 0.32);
}

/** Schodkowa piramida (Teotihuacán, Tikal): `steps` coraz węższych stopni. */
function stepPyramid(ctx, x, base, w, h, steps, color, shade, top = null) {
  const sh = h / steps;
  for (let i = 0; i < steps; i++) {
    const ww = w * (1 - (i / steps) * 0.7);
    rect(ctx, i % 2 ? color : shade, x - ww / 2, base - (i + 1) * sh, ww, sh);
  }
  rect(ctx, shade, x - w * 0.06, base - h, w * 0.12, h); // schody pośrodku
  if (top) rect(ctx, top, x - w * 0.12, base - h - sh * 1.4, w * 0.24, sh * 1.4);
}

function houses(ctx, W, y0, s, colors, hill, from = 0, to = 1) {
  for (let i = 0; i < 40; i++) {
    const x = W * from + i * 4.5 * s;
    if (x > W * to - 3 * s) break;
    const ground = y0 - hill(Math.round(x));
    for (let row = 0; row < 3; row++) {
      const top = ground + (row * 3.5 + hash(i * 3 + row) * 1.5) * s;
      if (top > y0 - 2 * s) break;
      const w = (3 + hash(i + row * 7) * 1.5) * s;
      rect(ctx, colors[Math.floor(hash(i * 5 + row) * colors.length)], x, top - 3 * s, w, 3 * s);
      rect(ctx, '#1f2937', x + w / 2, top - 2 * s, 1, 1);
    }
  }
}

function sea(ctx, W, y0, top, color, foam, pos) {
  rect(ctx, color, 0, top, W, y0 - top);
  ctx.fillStyle = foam;
  for (let y = Math.round(top) + 1; y < y0; y += 2) {
    for (let x = (Math.floor(pos * 3) + y * 5) % 9; x < W; x += 9) ctx.fillRect(x, y, 2, 1);
  }
}

function stars(ctx, W, y0, pos, n = 40) {
  for (let i = 0; i < n; i++) {
    rect(ctx, (i + Math.floor(pos * 2)) % 9 === 0 ? '#ffd23f' : '#e2e8f0', hash(i) * W, hash(i + 100) * y0 * 0.7, 1, 1);
  }
}

function drawFarAmericas(ctx, W, y0, s, scene, pos) {
  switch (scene.far) {
    case 'cdmx': {
      // Popocatépetl i Iztaccíhuatl ze śniegiem, przed nimi miasto i Anioł Niepodległości
      const volc = (x) => Math.max(0, 18 * s - Math.abs(x - W * 0.25) * 0.55, 12 * s - Math.abs(x - W * 0.62) * 0.3);
      ridge(ctx, W, y0, '#5b6b86', volc);
      ridge(ctx, W, y0, '#e2e8f0', (x) => (volc(x) > 13 * s ? volc(x) : 0));
      ridge(ctx, W, y0, '#5b6b86', (x) => Math.min(volc(x), 13 * s));
      city(ctx, W, y0, s, '#2a3346', { seed: 21, windows: '#a3bfd6' });
      const ax = W * 0.78;
      rect(ctx, '#e5e7eb', ax, y0 - 22 * s, 1.6 * s, 22 * s);
      rect(ctx, '#ffd23f', ax - 0.6 * s, y0 - 25 * s, 2.8 * s, 3 * s);
      break;
    }
    case 'pyramid': {
      ridge(ctx, W, y0, '#8a6a3a', (x) => (2 + Math.sin(x * 0.05) * 1.5) * s);
      stepPyramid(ctx, W * 0.36, y0, 46 * s, 18 * s, 5, '#b98b52', '#a07440');
      stepPyramid(ctx, W * 0.82, y0, 26 * s, 11 * s, 4, '#b98b52', '#a07440');
      break;
    }
    case 'cactus': {
      // płaskowyże (mesy) i saguaro
      ridge(ctx, W, y0, '#9a4a2a', (x) => ((x > W * 0.1 && x < W * 0.35) || (x > W * 0.62 && x < W * 0.8) ? 10 * s : 1.5 * s));
      ridge(ctx, W, y0, '#c46a35', (x) => ((x > W * 0.1 && x < W * 0.35) || (x > W * 0.62 && x < W * 0.8) ? 3 * s : 0));
      [[0.06, 1], [0.45, 0.8], [0.9, 1.1], [0.56, 0.55]].forEach(([fx, k]) => cactus(ctx, Math.round(W * fx), y0, s * k));
      break;
    }
    case 'colorful': {
      const base = (x) => (14 + Math.sin(x * 0.04) * 4) * s;
      // port (Valparaíso): wzgórza wyrastają dopiero za zatoką po lewej
      const hill = scene.harbor ? (x) => Math.min(base(x), Math.max(0, (x - W * 0.26) * 0.55)) : base;
      if (scene.harbor) sea(ctx, W, y0, y0 - 5 * s, '#1d6fa3', '#7dd3fc', pos);
      ridge(ctx, W, y0, '#4d5a2a', (x) => Math.max(0, hill(x)));
      houses(ctx, W, y0, s, scene.houses, (x) => Math.max(0, hill(x)), scene.harbor ? 0.32 : 0.02, 1);
      if (!scene.harbor) {
        // kościół z żółtą kopułą na szczycie (bazylika w Guanajuato)
        const bx = W * 0.5;
        const by = y0 - hill(Math.round(bx));
        rect(ctx, '#facc15', bx - 3 * s, by - 9 * s, 6 * s, 5 * s);
        rect(ctx, '#b45309', bx - 1, by - 13 * s, 2, 4 * s);
      }
      break;
    }
    case 'caribe': {
      sea(ctx, W, y0, y0 - 7 * s, '#06b6d4', '#cffafe', pos);
      rect(ctx, '#0e7490', 0, y0 - 7 * s, W, 1);
      rect(ctx, '#f5e6b8', 0, y0 - 1.5 * s, W, 1.5 * s);
      palm(ctx, Math.round(W * 0.12), y0, s * 1.2);
      palm(ctx, Math.round(W * 0.2), y0, s * 0.9);
      palm(ctx, Math.round(W * 0.88), y0, s * 1.1);
      // hotel w oddali
      rect(ctx, '#f1f5f9', W * 0.55, y0 - 12 * s, 10 * s, 5 * s);
      break;
    }
    case 'muertos': {
      stars(ctx, W, y0, pos, 30);
      ridge(ctx, W, y0, '#1a1030', mountains(s));
      city(ctx, W, y0, s, '#120a20', { seed: 31, windows: '#f59e0b' });
      // girlandy papel picado
      const cols = ['#f97316', '#ec4899', '#a855f7', '#22c55e', '#facc15', '#06b6d4'];
      for (const [yy, off] of [[0.18, 0], [0.32, 3]]) {
        for (let i = 0; i * 6 * s < W; i++) {
          const x = i * 6 * s + off * s;
          const y = y0 * yy + Math.sin((x / W) * Math.PI) * 4 * s;
          rect(ctx, '#e5e7eb', x, y, 6 * s, 1);
          rect(ctx, cols[(i + off) % cols.length], x + s, y + 1, 4 * s, 3 * s);
        }
      }
      // świece z nagietkami
      for (let i = 0; i < 6; i++) {
        const x = W * (0.1 + i * 0.16);
        rect(ctx, '#f97316', x - s, y0 - 2 * s, 3 * s, 2 * s);
        rect(ctx, '#fef3c7', x, y0 - 4 * s, s, 2 * s);
        rect(ctx, (i + Math.floor(pos * 4)) % 3 ? '#facc15' : '#fb923c', x, y0 - 5 * s, s, s);
      }
      break;
    }
    case 'havana': {
      sea(ctx, W, y0, y0 - 3 * s, '#1d6fa3', '#7dd3fc', pos);
      const cols = ['#f472b6', '#38bdf8', '#facc15', '#4ade80', '#fb923c', '#f1f5f9'];
      for (let i = 0, x = W * 0.2; x < W; i++, x += 5 * s) {
        if (x > W * 0.42 && x < W * 0.62) continue;
        const h = (5 + hash(i + 40) * 4) * s;
        rect(ctx, cols[i % cols.length], x, y0 - 3 * s - h, 5 * s - 1, h);
        for (let wy = 0; wy < h - 2 * s; wy += 2.5 * s) rect(ctx, '#334155', x + 1.5 * s, y0 - 3 * s - h + s + wy, 1.5 * s, s);
      }
      // Kapitol z kopułą
      const cx = W * 0.52;
      rect(ctx, '#e5e7eb', cx - 9 * s, y0 - 9 * s, 18 * s, 6 * s);
      rect(ctx, '#d1d5db', cx - 4 * s, y0 - 13 * s, 8 * s, 4 * s);
      for (let y = 0; y < 5 * s; y++) { const w = 6 * s * Math.sqrt(1 - (y / (5 * s)) ** 2); rect(ctx, '#e5e7eb', cx - w / 2, y0 - 13 * s - y, w, 1); }
      rect(ctx, '#ffd23f', cx - 0.5, y0 - 21 * s, 1, 3 * s);
      break;
    }
    case 'mogotes': {
      // zaokrąglone wapienne wzgórza
      ridge(ctx, W, y0, '#2f6b3a', (x) => Math.max(0, ...[[0.12, 22], [0.4, 17], [0.7, 25], [0.97, 16]].map(([fx, h]) => h * s - ((x - W * fx) ** 2) / (7 * s))));
      ridge(ctx, W, y0, '#3f8a46', (x) => Math.max(0, ...[[0.27, 11], [0.55, 9], [0.85, 12]].map(([fx, h]) => h * s - ((x - W * fx) ** 2) / (6 * s))));
      // suszarnia tytoniu z dachem z liści palmowych
      const tx = W * 0.6;
      rect(ctx, '#7c4a24', tx, y0 - 4 * s, 9 * s, 4 * s);
      for (let y = 0; y < 4 * s; y++) rect(ctx, '#a16207', tx - s + y * 0.6, y0 - 4 * s - y - 1, 11 * s - y * 1.2, 1);
      palm(ctx, Math.round(W * 0.2), y0, s * 1.2);
      break;
    }
    case 'fortress': {
      sea(ctx, W, y0, y0 - 6 * s, '#0e7490', '#a5f3fc', pos);
      // mury El Morro na cyplu z wieżyczką (garita)
      const wx = W * 0.35;
      rect(ctx, '#b08d5b', wx, y0 - 9 * s, W * 0.55, 9 * s);
      rect(ctx, '#9a7a4c', wx, y0 - 9 * s, W * 0.55, s);
      for (let x = wx; x < wx + W * 0.55; x += 4 * s) rect(ctx, '#b08d5b', x, y0 - 10.5 * s, 2 * s, 1.5 * s);
      const gx = wx + W * 0.42;
      rect(ctx, '#d6c29a', gx, y0 - 15 * s, 4 * s, 6 * s);
      for (let y = 0; y < 3 * s; y++) rect(ctx, '#9a7a4c', gx + y * 0.6, y0 - 15 * s - y - 1, 4 * s - y * 1.2, 1);
      rect(ctx, '#1e3a8a', wx + W * 0.1, y0 - 18 * s, 1, 9 * s);
      rect(ctx, '#ef4444', wx + W * 0.1 + 1, y0 - 18 * s, 5 * s, 3 * s);
      break;
    }
    case 'volcano': {
      const cone = (x) => Math.max(0, 26 * s - Math.abs(x - W * 0.55) * 0.9);
      ridge(ctx, W, y0, '#3f4a3f', cone);
      ridge(ctx, W, y0, '#2a3a2a', (x) => Math.min(cone(x), 12 * s));
      // dymiące obłoczki z krateru
      for (let i = 0; i < 4; i++) {
        const t = (pos * 0.4 + i * 0.25) % 1;
        const r = (1.5 + t * 3) * s;
        rect(ctx, t > 0.6 ? '#9ca3af' : '#cbd5e1', W * 0.55 - r + t * 8 * s, y0 - 27 * s - t * 14 * s, r * 2, r * 1.4);
      }
      // las deszczowy
      ridge(ctx, W, y0, '#1f5a2a', (x) => (4 + Math.abs(((x * 5) % 11) - 5) * 0.5) * s);
      break;
    }
    case 'canal': {
      city(ctx, W, y0 - 6 * s, s * 1.4, '#3a1f4a', { seed: 51, windows: '#f7c25a' });
      ridge(ctx, W, y0, '#2f5a2a', (x) => (x < W * 0.2 || x > W * 0.85 ? 6 * s : 0));
      rect(ctx, '#2b6c8a', W * 0.2, y0 - 6 * s, W * 0.65, 6 * s);
      // kontenerowiec przesuwający się kanałem
      const sx = W * 0.22 + ((pos * 2 * s) % (W * 0.45));
      rect(ctx, '#1f2937', sx, y0 - 5 * s, 22 * s, 3 * s);
      const cc = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b'];
      for (let i = 0; i < 5; i++) rect(ctx, cc[i % 4], sx + 2 * s + i * 3.5 * s, y0 - 7.5 * s, 3 * s, 2.5 * s);
      rect(ctx, '#f1f5f9', sx + 18 * s, y0 - 9 * s, 3 * s, 4 * s);
      break;
    }
    case 'jungle': {
      // mgła, świątynie Majów ponad koronami drzew
      stepPyramid(ctx, W * 0.3, y0 - 4 * s, 18 * s, 22 * s, 7, '#8a8a7a', '#6b6b5c', '#6b6b5c');
      stepPyramid(ctx, W * 0.72, y0 - 4 * s, 13 * s, 15 * s, 6, '#8a8a7a', '#6b6b5c', '#6b6b5c');
      ridge(ctx, W, y0, '#1f5a2a', (x) => (7 + Math.abs(((x * 7) % 13) - 6) * 0.7 + Math.sin(x * 0.2) * 1.5) * s);
      ridge(ctx, W, y0, '#2f7a3a', (x) => (3 + Math.abs(((x * 5 + 3) % 9) - 4) * 0.6) * s);
      // ara
      const px = (pos * 6 * s) % W;
      rect(ctx, '#ef4444', px, y0 * 0.45, 2 * s, s);
      rect(ctx, '#3b82f6', px - s, y0 * 0.45, s, s);
      break;
    }
    case 'bogota': {
      ridge(ctx, W, y0, '#2f5a3a', (x) => Math.max(0, 24 * s - Math.abs(x - W * 0.35) * 0.6, 18 * s - Math.abs(x - W * 0.8) * 0.5));
      // kościół na Monserrate
      const mx = W * 0.35;
      rect(ctx, '#f8fafc', mx - 2 * s, y0 - 27 * s, 4 * s, 3 * s);
      rect(ctx, '#f8fafc', mx - 0.5 * s, y0 - 30 * s, s, 3 * s);
      city(ctx, W, y0, s, '#7c2d12', { seed: 61, windows: '#fde68a' }); // ceglane kamienice
      break;
    }
    case 'machu': {
      // Huayna Picchu: stromy zielony szczyt, tarasy i kamienne ruiny
      ridge(ctx, W, y0, '#2f5a2a', (x) => Math.max(0, 30 * s - Math.abs(x - W * 0.62) * 1.4, 14 * s - Math.abs(x - W * 0.2) * 0.4));
      ridge(ctx, W, y0, '#3f7a35', (x) => Math.max(0, 22 * s - Math.abs(x - W * 0.62) * 1.6));
      for (let k = 1; k <= 4; k++) rect(ctx, '#5a8a3a', W * 0.08, y0 - k * 2.5 * s, W * 0.4 - k * 3 * s, 1);
      for (let i = 0; i < 7; i++) {
        const x = W * 0.12 + i * 4 * s;
        rect(ctx, '#9ca3af', x, y0 - (4 + (i % 3)) * s, 3 * s, (4 + (i % 3)) * s);
        rect(ctx, '#78716c', x, y0 - (4 + (i % 3)) * s, 3 * s, 1);
      }
      // chmura opływająca szczyt
      rect(ctx, '#f1f5f9', ((pos * 3 * s) % (W + 20 * s)) - 20 * s, y0 - 20 * s, 18 * s, 2 * s);
      // lama
      const lx = W * 0.88;
      rect(ctx, '#f5f5f4', lx, y0 - 4 * s, 4 * s, 2 * s);
      rect(ctx, '#f5f5f4', lx + 3 * s, y0 - 7 * s, s, 3 * s);
      rect(ctx, '#f5f5f4', lx, y0 - 2 * s, 1, 2 * s); rect(ctx, '#f5f5f4', lx + 3 * s, y0 - 2 * s, 1, 2 * s);
      break;
    }
    case 'salt': {
      // odległe góry i ich odbicie w solnym lustrze
      const hills = (x) => (4 + Math.abs(((x * 3) % 40) - 20) * 0.25) * s;
      ridge(ctx, W, y0 - 3 * s, '#7c6a8a', hills);
      ctx.fillStyle = '#a99bb8';
      for (let x = 0; x < W; x++) ctx.fillRect(x, y0 - 3 * s, 1, Math.ceil(hills(x) * 0.5));
      rect(ctx, '#bcd6ee', 0, y0 - 3 * s + 0, W, 1);
      rect(ctx, '#e8f1fa', 0, y0 - 2 * s, W, 2 * s);
      break;
    }
    case 'obelisk': {
      stars(ctx, W, y0, pos, 25);
      city(ctx, W, y0, s * 1.2, '#0f1530', { seed: 71, windows: '#fde68a', skip: [W * 0.47, W * 0.55] });
      const ox = W * 0.5;
      for (let y = 0; y < 30 * s; y++) { const w = 3 * s * (1 - (y / (30 * s)) * 0.5); rect(ctx, '#f1f5f9', ox - w / 2, y0 - y - 1, w, 1); }
      rect(ctx, '#f1f5f9', ox - 0.5, y0 - 31 * s, 1, s);
      rect(ctx, '#38bdf8', ox - 0.5 * s, y0 - 20 * s, s, s); // okienko
      break;
    }
    case 'lake': {
      // Fitz Roy: postrzępione granitowe iglice, śnieg i turkusowe jezioro
      const spire = (x) => Math.max(0, 28 * s - Math.abs(x - W * 0.5) * 1.1 - Math.abs(((x * 7) % 17) - 8) * 0.6 * s, 18 * s - Math.abs(x - W * 0.2) * 0.6, 16 * s - Math.abs(x - W * 0.85) * 0.6);
      ridge(ctx, W, y0 - 5 * s, '#5b4a5e', spire);
      ridge(ctx, W, y0 - 5 * s, '#f1f5f9', (x) => (spire(x) > 16 * s ? spire(x) : 0));
      ridge(ctx, W, y0 - 5 * s, '#5b4a5e', (x) => Math.min(spire(x), 16 * s));
      sea(ctx, W, y0, y0 - 5 * s, '#22a6b3', '#a5f3fc', pos * 0.3);
      break;
    }
    default:
      return false;
  }
  return true;
}

function drawFar(ctx, W, y0, s, scene, pos) {
  if (drawFarAmericas(ctx, W, y0, s, scene, pos)) return;
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
