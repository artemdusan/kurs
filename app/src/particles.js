// Pikselowe cząsteczki na jednym pełnoekranowym canvasie: wybuchy przy dobrej
// odpowiedzi i dopasowanej parze, unoszące się liczby („+20”), deszcz konfetti
// przy rekordzie, odblokowaniu lekcji i kamieniu milowym. Canvas nie przechwytuje
// dotyku i sam się zatrzymuje, gdy nic nie leci. Przy „ogranicz ruch” nic nie rysuje.

export const COLORS = {
  ok: ['#3fb950', '#84cc16', '#d9f99d', '#ffffff'],
  gold: ['#ffd23f', '#f5a623', '#fff3b0', '#ffffff'],
  blue: ['#4cc2ff', '#9be1ff', '#ffffff'],
  bad: ['#ef4444', '#7f1d1d', '#fca5a5'],
  party: ['#ffd23f', '#3fb950', '#4cc2ff', '#ef4444', '#f5a623', '#ffffff'],
};

let canvas = null;
let ctx = null;
let items = [];
let raf = 0;
let last = 0;

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function ensure() {
  if (canvas || typeof document === 'undefined') return Boolean(canvas);
  canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  };
  resize();
  window.addEventListener('resize', resize);
  return true;
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  const h = window.innerHeight;
  items = items.filter((p) => {
    p.life -= dt;
    if (p.life <= 0 || p.y > h + 30) return false;
    p.vy += p.gravity * dt;
    p.vx *= 1 - p.drag * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const fade = Math.min(1, p.life / p.fade);
    ctx.globalAlpha = fade;
    ctx.fillStyle = p.color;
    if (p.text) {
      ctx.font = `${p.size}px 'Press Start 2P', monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#14101a';
      ctx.fillText(p.text, Math.round(p.x) + 2, Math.round(p.y) + 2); // pikselowy cień
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, Math.round(p.x), Math.round(p.y));
    } else {
      // przyciąganie do siatki 2 px daje „pikselowy” ruch zamiast płynnego
      const s = p.size;
      ctx.fillRect(Math.round(p.x / 2) * 2 - s / 2, Math.round(p.y / 2) * 2 - s / 2, s, s);
    }
    return true;
  });
  ctx.globalAlpha = 1;
  if (items.length) raf = requestAnimationFrame(frame);
  else raf = 0;
}

function run() {
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
}

/** Środek elementu na ekranie (albo środek ekranu, gdy elementu nie ma). */
export function centerOf(target) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  const r = el?.getBoundingClientRect?.();
  if (!r || (!r.width && !r.height)) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Wybuch kwadracików z punktu. `power` skaluje liczbę, prędkość i rozmiar. */
export function burst(at, { colors = COLORS.ok, power = 1, count = 14 } = {}) {
  if (reduced() || !ensure()) return;
  const n = Math.round(count * power);
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (90 + Math.random() * 230) * Math.sqrt(power);
    items.push({
      x: at.x, y: at.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 120,
      gravity: 620, drag: 1.6,
      size: pick([4, 4, 6, 8]) + (power > 1.5 ? 2 : 0),
      color: pick(colors),
      life: 0.5 + Math.random() * 0.5, fade: 0.25,
    });
  }
  run();
}

/** Liczba albo krótki napis unoszący się w górę (jak obrażenia w grach). */
export function floatText(at, text, { color = '#ffd23f', size = 14 } = {}) {
  if (reduced() || !ensure()) return;
  items.push({ x: at.x, y: at.y, vx: (Math.random() - 0.5) * 30, vy: -150, gravity: 130, drag: 0, size, color, text: String(text), life: 0.9, fade: 0.3 });
  run();
}

/** Deszcz konfetti z góry ekranu — na duże chwile. */
export function rain({ colors = COLORS.party, seconds = 1.6, density = 70 } = {}) {
  if (reduced() || !ensure()) return;
  const w = window.innerWidth;
  const total = Math.round(density * seconds);
  for (let i = 0; i < total; i++) {
    setTimeout(() => {
      items.push({
        x: Math.random() * w, y: -10,
        vx: (Math.random() - 0.5) * 120, vy: 140 + Math.random() * 220,
        gravity: 260, drag: 0.4,
        size: pick([4, 6, 6, 8]), color: pick(colors),
        life: 2.6, fade: 0.4,
      });
      run();
    }, (i / total) * seconds * 1000);
  }
}
