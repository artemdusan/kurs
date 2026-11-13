import React, { useEffect, useRef, useState } from 'react';
import { addActivity } from '../activity.js';
import { loadDeck, sprintDeck, pairPoints, saveGameScore } from '../engine/insights.js';
import { localDay } from '../../../shared/learning.js';
import Icon from './Icon.jsx';
import { burst, floatText, rain, centerOf, COLORS } from '../particles.js';
import { sfx } from '../sound.js';

// Mini gra „Droga”: jedziesz w głąb ekranu, nadjeżdża bramka z dwoma pasami —
// lewy to „el”, prawy to „la”. Wjedź w pas pasujący do rzeczownika. Każde trafienie
// przyspiesza jazdę, trzy stłuczki kończą grę. Jak „Pary”: nie zmienia poziomów kart,
// ale liczy się do dnia nauki.
// Droga jest rysowana w pseudo-3D na zwykłym canvasie 2D, w niskiej rozdzielczości
// powiększonej bez wygładzania — stąd pikselowy wygląd bez żadnej biblioteki.

export const ROAD_LIVES = 3;
const PIXEL = 3;          // jeden piksel gry = 3 piksele CSS
const GATE_START = 9;     // odległość, w której pojawia się bramka (1 = przy samochodzie)
const GATE_HIT = 1.12;    // odległość, przy której rozstrzyga się pas
export const roadSpeed = (hits) => Math.min(6, 2.4 + hits * 0.12); // jednostek odległości na sekundę

const SKY = ['#1b1035', '#2b1648', '#4a1d5c', '#7a2a5e', '#b8455a', '#e8804f'];

function draw(ctx, W, H, g, labels) {
  const y0 = Math.round(H * 0.36);
  const ground = H - y0;
  const cx = W / 2;
  const roadW = W * 0.5; // połowa szerokości drogi przy dolnej krawędzi
  // niebo o zachodzie słońca, słońce i góry
  const band = Math.ceil(y0 / SKY.length);
  SKY.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * band, W, band); });
  ctx.fillStyle = '#ffd23f';
  const sunR = Math.round(W * 0.09);
  for (let y = -sunR; y <= 0; y++) { const half = Math.round(Math.sqrt(sunR * sunR - y * y)); if ((y & 3) !== 3) ctx.fillRect(Math.round(cx - half), y0 + y, half * 2, 1); }
  ctx.fillStyle = '#2a1a3e';
  for (let x = 0; x < W; x++) {
    const h = Math.abs(((x * 7 + 13) % 46) - 23) * 0.35 + Math.abs(((x * 3) % 90) - 45) * 0.22;
    ctx.fillRect(x, Math.round(y0 - h), 1, Math.ceil(h));
  }
  // ziemia i droga: linia po linii, im bliżej horyzontu, tym większa odległość
  for (let y = y0; y < H; y++) {
    const k = (y - y0 + 1) / ground;      // 0 przy horyzoncie, 1 przy dole
    const d = 1 / k;
    const stripe = Math.floor((d + g.pos) * 1.4) & 1;
    const half = roadW * k;
    ctx.fillStyle = stripe ? '#3b6b2f' : '#44792f';
    ctx.fillRect(0, y, W, 1);
    ctx.fillStyle = stripe ? '#f1f5f9' : '#ef4444';
    ctx.fillRect(Math.round(cx - half * 1.12), y, Math.ceil(half * 2.24), 1);
    ctx.fillStyle = stripe ? '#3a3145' : '#40374c';
    ctx.fillRect(Math.round(cx - half), y, Math.ceil(half * 2), 1);
    if (stripe) { ctx.fillStyle = '#f1f5f9'; ctx.fillRect(Math.round(cx - Math.max(0.5, half * 0.03)), y, Math.max(1, Math.round(half * 0.06)), 1); }
  }
  // bramka: dwa pola nad pasami, rosną wraz z przybliżaniem
  if (g.gate > 0) {
    const k = 1 / g.gate;
    const y = Math.round(y0 + ground * k);
    const half = roadW * k;
    const h = Math.max(2, Math.round(half * 0.62));
    const post = Math.max(1, Math.round(half * 0.06));
    const sides = [['#4cc2ff', '#06283d', cx - half, labels[0]], ['#ff9bd0', '#3d0626', cx, labels[1]]];
    sides.forEach(([bg, fg, x, text], lane) => {
      const lit = g.verdict && g.verdict.lane === lane;
      ctx.fillStyle = lit ? (g.verdict.ok ? '#3fb950' : '#ef4444') : bg;
      ctx.fillRect(Math.round(x), y - h, Math.ceil(half), Math.round(h * 0.55));
      const size = Math.floor(h * 0.34);
      if (size >= 5) {
        ctx.fillStyle = lit ? '#fff' : fg;
        ctx.font = `${size}px 'Press Start 2P', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, Math.round(x + half / 2), Math.round(y - h + h * 0.29));
      }
    });
    ctx.fillStyle = '#17131c';
    for (const x of [cx - half, cx - post / 2, cx + half - post]) ctx.fillRect(Math.round(x), y - h, post, h);
  }
  // samochód gracza (widok z tyłu)
  const u = Math.max(1, Math.round(W / 60));
  const carX = Math.round(cx + (g.carX - 0.5) * roadW * 0.95 + (g.shake > 0 ? Math.sin(g.shake * 60) * 2 : 0));
  const by = H - u * 2;
  const r = (c, x, y, w, h) => { ctx.fillStyle = c; ctx.fillRect(carX + x * u, by + y * u, w * u, h * u); };
  r('rgba(0,0,0,0.35)', -6, 0, 12, 1);
  r('#14101a', -6, -3, 2, 3); r('#14101a', 4, -3, 2, 3);
  r('#ffd23f', -5, -6, 10, 5);
  r('#9a6a00', -5, -2, 10, 1);
  r('#f5a623', -4, -9, 8, 3);
  r('#17131c', -3, -8, 6, 2);
  r('#ef4444', -5, -5, 2, 1); r('#ef4444', 3, -5, 2, 1);
}

export default function Road({ maxLesson, onExit }) {
  const [card, setCard] = useState(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [lives, setLives] = useState(ROAD_LIVES);
  const [lane, setLane] = useState(0);
  const [flash, setFlash] = useState(null); // { ok, article }
  const [phase, setPhase] = useState('load'); // load | play | done | empty
  const [best, setBest] = useState(0);
  const [record, setRecord] = useState(false);
  const canvasRef = useRef(null);
  const deckRef = useRef([]);
  const posRef = useRef(0);
  const cardRef = useRef(null);
  const statsRef = useRef({ hits: 0, mistakes: 0, seconds: 0, saved: false });
  const g = useRef({ pos: 0, gate: GATE_START, lane: 0, carX: 0.25, shake: 0, wait: 0, verdict: null, combo: 0, score: 0, lives: ROAD_LIVES }).current;

  function nextCard() {
    const deck = deckRef.current;
    cardRef.current = deck[posRef.current % deck.length];
    posRef.current++;
    setCard(cardRef.current);
    setFlash(null);
    g.gate = GATE_START;
    g.verdict = null;
  }

  async function save() {
    const s = statsRef.current;
    if (s.saved) return;
    s.saved = true;
    if (s.hits + s.mistakes + s.seconds > 0) {
      await addActivity({ correct: s.hits, wrong: s.mistakes, seconds: s.seconds }).catch(() => {});
    }
  }

  async function finish() {
    setPhase('done');
    const previous = await saveGameScore('road', g.score, localDay());
    setBest(Math.max(previous, g.score));
    if (g.score > previous && previous > 0) { setRecord(true); rain({ colors: COLORS.gold, seconds: 2 }); sfx.fanfare(); }
    await save();
  }

  function start() {
    statsRef.current = { hits: 0, mistakes: 0, seconds: 0, saved: false };
    deckRef.current = [...deckRef.current].sort(() => Math.random() - 0.5);
    posRef.current = 0;
    Object.assign(g, { pos: 0, lane: 0, carX: 0.25, shake: 0, wait: 0, combo: 0, score: 0, lives: ROAD_LIVES });
    setScore(0); setCombo(0); setLives(ROAD_LIVES); setLane(0); setRecord(false);
    setPhase('play');
    nextCard();
  }

  function steer(n) {
    g.lane = n;
    setLane(n);
  }

  // bramka dojechała do samochodu: pas rozstrzyga odpowiedź
  function resolve() {
    const c = cardRef.current;
    const masculine = c.article === 'el' || c.article === 'los';
    const ok = (g.lane === 0) === masculine;
    const at = centerOf('.road-noun');
    g.verdict = { ok, lane: g.lane };
    if (ok) {
      g.combo++;
      const points = pairPoints(g.combo);
      g.score += points;
      statsRef.current.hits++;
      setScore(g.score); setCombo(g.combo);
      burst(at, { colors: g.combo >= 3 ? COLORS.gold : COLORS.ok, power: 0.7 + Math.min(5, g.combo) * 0.25 });
      floatText({ x: at.x, y: at.y - 40 }, `+${points}`, { color: g.combo >= 3 ? '#ffd23f' : '#ffffff' });
      sfx.pair(g.combo);
      g.wait = 0.25;
    } else {
      g.combo = 0;
      g.lives--;
      g.shake = 0.5;
      statsRef.current.mistakes++;
      setCombo(0); setLives(g.lives);
      navigator.vibrate?.(120);
      burst(at, { colors: COLORS.bad, power: 0.6 });
      sfx.wrong();
      g.wait = 1; // chwila na przeczytanie poprawnej formy
    }
    setFlash({ ok, article: c.article });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const deck = sprintDeck(await loadDeck(maxLesson));
      if (cancelled) return;
      deckRef.current = deck;
      if (deck.length < 4) { setPhase('empty'); return; }
      start();
    })();
    return () => { cancelled = true; save(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== 'play') return undefined;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const fit = () => {
      canvas.width = Math.max(60, Math.round(canvas.clientWidth / PIXEL));
      canvas.height = Math.max(60, Math.round(canvas.clientHeight / PIXEL));
    };
    fit();
    window.addEventListener('resize', fit);
    const onKey = (e) => { if (e.key === 'ArrowLeft') steer(0); if (e.key === 'ArrowRight') steer(1); };
    window.addEventListener('keydown', onKey);
    const clock = setInterval(() => { if (document.visibilityState !== 'hidden') statsRef.current.seconds++; }, 1000);
    let raf = 0;
    let last = performance.now();
    let over = false;
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const v = roadSpeed(statsRef.current.hits);
      g.pos += v * dt;
      g.carX += ((g.lane ? 0.75 : 0.25) - g.carX) * Math.min(1, dt * 14);
      if (g.shake > 0) g.shake -= dt;
      if (g.wait > 0) {
        g.wait -= dt;
        g.gate -= v * dt; // rozstrzygnięta bramka przejeżdża pod samochodem
        if (g.wait <= 0 && !over) {
          if (g.lives <= 0) { over = true; finish(); } else nextCard();
        }
      } else if (!over) {
        g.gate -= v * dt;
        if (g.gate <= GATE_HIT) resolve();
      }
      const c = cardRef.current;
      draw(ctx, canvas.width, canvas.height, g, c && c.plural ? ['los', 'las'] : ['el', 'la']);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); clearInterval(clock); window.removeEventListener('resize', fit); window.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === 'load') return <div className="screen center">Rozgrzewanie silnika…</div>;

  if (phase === 'empty') {
    return (
      <div className="screen center">
        <p>Za mało rzeczowników na grę — najpierw zrób pierwszą sesję.</p>
        <button className="btn primary" onClick={() => onExit()}>Wróć do kursu</button>
      </div>
    );
  }

  if (phase === 'done') {
    const s = statsRef.current;
    return (
      <div className="screen center pairs-done">
        <h2>{record ? 'Nowy rekord!' : 'Koniec jazdy!'}</h2>
        <p className={'pairs-final' + (record ? ' record' : '')}>{score}</p>
        <p className="pairs-sub"><Icon name="trophy" size={14} /> rekord: {best}</p>
        <p className="hint">Trafione: {s.hits} · stłuczki: {s.mistakes}</p>
        <button className="btn primary big" onClick={start}>Jeszcze raz</button>
        <button className="btn" onClick={() => onExit()}>Wróć do kursu</button>
      </div>
    );
  }

  const options = card.plural ? ['los', 'las'] : ['el', 'la'];
  return (
    <div className="screen pairs road">
      <div className="session-top">
        <button className="btn ghost" onClick={async () => { await save(); onExit(); }} aria-label="Zakończ grę">
          <Icon name="close" />
        </button>
        <span className="hearts" aria-label={`Życia: ${lives} z ${ROAD_LIVES}`}>
          {Array.from({ length: ROAD_LIVES }, (_, i) => (
            <span key={i} className={'heart' + (i < lives ? '' : ' lost')}><Icon name="heart" size={20} /></span>
          ))}
        </span>
        <span className="pairs-score road-score" aria-label={`Wynik ${score}, mnożnik ×${Math.min(5, Math.max(1, combo))}`}>
          {/* mnożnik punktów za serię (najwyżej ×5) — przy wyniku, nie przy słowie */}
          {combo >= 2 && <span className={'road-mult' + (combo >= 5 ? ' max' : '')} key={Math.min(5, combo)}>×{Math.min(5, combo)}</span>}
          {score}
        </span>
      </div>
      <div className={'road-card' + (flash ? (flash.ok ? ' ok' : ' bad') : '')}>
        <span className="road-noun">{flash ? flash.article + ' ' : ''}{card.noun}</span>
        <span className="sprint-pl">{card.pl}</span>
      </div>
      <canvas
        ref={canvasRef}
        className="road-canvas"
        onPointerDown={(e) => { const r = e.currentTarget.getBoundingClientRect(); steer(e.clientX - r.left < r.width / 2 ? 0 : 1); }}
      />
      <div className="sprint-buttons">
        {options.map((a, i) => (
          <button
            key={a}
            className={'btn sprint-btn road-btn sprint-' + (i === 0 ? 'm' : 'f') + (lane === i ? ' active' : '')}
            aria-pressed={lane === i}
            onPointerDown={() => steer(i)}
          >
            {i === 0 ? '← ' + a : a + ' →'}
          </button>
        ))}
      </div>
    </div>
  );
}
