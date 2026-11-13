import React, { useEffect, useRef, useState } from 'react';
import { addActivity } from '../activity.js';
import { loadDeck, sprintDeck, pairPoints, saveGameScore, countGameHits } from '../engine/insights.js';
import { REGIONS, REGION_HITS, POSTCARDS, regionAt, drawScenery, postcards, collectPostcard, farthestRegion, saveFarthest } from '../engine/journey.js';
import { localDay } from '../../../shared/learning.js';
import Icon from './Icon.jsx';
import GameXp from './GameXp.jsx';
import Postcard from './Postcard.jsx';
import { burst, floatText, rain, centerOf, COLORS } from '../particles.js';
import { sfx } from '../sound.js';

// Mini gra „Droga”: jedziesz w głąb ekranu, nadjeżdża bramka z dwoma pasami —
// lewy to „el”, prawy to „la”. Wjedź w pas pasujący do rzeczownika. Każde trafienie
// przyspiesza jazdę, pierwsza stłuczka kończy grę. Co 10 trafień auto wjeżdża
// do kolejnego regionu Hiszpanii (engine/journey.js) — pierwszy wjazd daje pocztówkę. Jak „Pary”: nie zmienia poziomów kart,
// ale liczy się do dnia nauki.
// Droga jest rysowana w pseudo-3D na zwykłym canvasie 2D, w niskiej rozdzielczości
// powiększonej bez wygładzania — stąd pikselowy wygląd bez żadnej biblioteki.

const PIXEL = 3;          // jeden piksel gry = 3 piksele CSS
const GATE_START = 9;     // odległość, w której pojawia się bramka (1 = przy samochodzie)
const GATE_HIT = 1.12;    // odległość, przy której rozstrzyga się pas
export const roadSpeed = (hits) => Math.min(6, 2.4 + hits * 0.12); // jednostek odległości na sekundę

// Lakier auta zmienia się z rangą gracza (nagroda za rangę, bez wyboru w ustawieniach).
// { body, trim, roof, lights } — od Turisty po Nativo, dalej chrom.
export const CAR_PAINTS = [
  { name: 'żółty', body: '#ffd23f', trim: '#9a6a00', roof: '#f5a623', lights: '#ef4444' },
  { name: 'niebieski', body: '#4cc2ff', trim: '#0b5a86', roof: '#2b8fd6', lights: '#ef4444' },
  { name: 'zielony', body: '#3fb950', trim: '#1a5c26', roof: '#2c8a3c', lights: '#ef4444' },
  { name: 'różowy', body: '#ff9bd0', trim: '#8a2f63', roof: '#e46aa9', lights: '#ef4444' },
  { name: 'fioletowy', body: '#b28dff', trim: '#4b2a8a', roof: '#8a5cf0', lights: '#ef4444' },
  { name: 'czerwony', body: '#ef4444', trim: '#7a1414', roof: '#c62828', lights: '#ffd23f' },
  { name: 'chromowany', body: '#e2e8f0', trim: '#64748b', roof: '#94a3b8', lights: '#ef4444' },
];
export const carPaint = (tier) => CAR_PAINTS[Math.max(0, Math.min(CAR_PAINTS.length - 1, tier || 0))];

function draw(ctx, W, H, g, labels, paint) {
  const { y0, ground, cx, roadW } = drawScenery(ctx, W, H, REGIONS[g.region], g.pos);
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
  r(paint.body, -5, -6, 10, 5);
  r(paint.trim, -5, -2, 10, 1);
  r(paint.roof, -4, -9, 8, 3);
  r('#17131c', -3, -8, 6, 2);
  r(paint.lights, -5, -5, 2, 1); r(paint.lights, 3, -5, 2, 1);
}

export default function Road({ maxLesson, rankTier = 0, onExit }) {
  const paint = carPaint(rankTier);
  const [card, setCard] = useState(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [lane, setLane] = useState(0);
  const [flash, setFlash] = useState(null); // { ok, article }
  const [phase, setPhase] = useState('load'); // load | play | done | empty
  const [best, setBest] = useState(0);
  const [record, setRecord] = useState(false);
  const [region, setRegion] = useState(0); // indeks w REGIONS
  const [banner, setBanner] = useState(null); // { es, pl, fresh } po wjeździe do regionu
  const [counted, setCounted] = useState(null); // co z jazdy zaliczono do XP (limit dzienny)
  const [album, setAlbum] = useState({}); // zebrane pocztówki
  const [farthest, setFarthest] = useState(0);
  const freshRef = useRef([]); // pocztówki zdobyte w tej jeździe
  const canvasRef = useRef(null);
  const deckRef = useRef([]);
  const posRef = useRef(0);
  const cardRef = useRef(null);
  const statsRef = useRef({ hits: 0, mistakes: 0, seconds: 0, saved: false });
  const g = useRef({ pos: 0, gate: GATE_START, lane: 0, carX: 0.25, shake: 0, wait: 0, verdict: null, combo: 0, score: 0, crashed: false, region: 0 }).current;

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
    if (s.saved) return null;
    s.saved = true;
    if (s.hits + s.mistakes + s.seconds === 0) return null;
    const counted = await countGameHits(s.hits, s.mistakes, localDay()).catch(() => ({ correct: 0, wrong: 0, limited: true }));
    await addActivity({ correct: counted.correct, wrong: counted.wrong, seconds: s.seconds }).catch(() => {});
    return counted;
  }

  async function finish() {
    setPhase('done');
    const previous = await saveGameScore('road', g.score, localDay());
    setBest(Math.max(previous, g.score));
    if (g.score > previous && previous > 0) { setRecord(true); rain({ colors: COLORS.gold, seconds: 2 }); sfx.fanfare(); }
    await saveFarthest(g.region);
    setFarthest(await farthestRegion());
    setAlbum(await postcards());
    setCounted(await save());
  }

  function start() {
    statsRef.current = { hits: 0, mistakes: 0, seconds: 0, saved: false };
    deckRef.current = [...deckRef.current].sort(() => Math.random() - 0.5);
    posRef.current = 0;
    Object.assign(g, { pos: 0, lane: 0, carX: 0.25, shake: 0, wait: 0, combo: 0, score: 0, crashed: false, region: 0 });
    setScore(0); setCombo(0); setLane(0); setRecord(false);
    setRegion(0); setBanner(null); setCounted(null);
    freshRef.current = [];
    setPhase('play');
    nextCard();
  }

  function steer(n) {
    g.lane = n;
    setLane(n);
  }

  // kolejny region podróży: baner powitalny, a przy pierwszym wjeździe pocztówka
  async function enterRegion(next) {
    if (next <= g.region) return;
    g.region = next;
    setRegion(next);
    const place = REGIONS[next];
    setBanner({ es: place.es, pl: place.pl, fresh: false });
    rain({ seconds: 1.2 });
    const fresh = await collectPostcard(place.key, localDay());
    if (fresh) {
      freshRef.current.push(place.key);
      setBanner((b) => (b && b.es === place.es ? { ...b, fresh: true } : b));
    }
    setTimeout(() => setBanner((b) => (b && b.es === place.es ? null : b)), 2400);
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
      enterRegion(regionAt(statsRef.current.hits));
    } else {
      g.combo = 0;
      g.crashed = true; // bez żyć: pierwsza stłuczka kończy jazdę
      g.shake = 0.5;
      statsRef.current.mistakes++;
      setCombo(0);
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
          if (g.crashed) { over = true; finish(); } else nextCard();
        }
      } else if (!over) {
        g.gate -= v * dt;
        if (g.gate <= GATE_HIT) resolve();
      }
      const c = cardRef.current;
      draw(ctx, canvas.width, canvas.height, g, c && c.plural ? ['los', 'las'] : ['el', 'la'], paint);
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
        <p className="hint">Trafione: {s.hits} · region: <b>{REGIONS[region].es}</b>{farthest > region ? ` · najdalej: ${REGIONS[farthest].es}` : ''}</p>
        <GameXp counted={counted} />
        {freshRef.current.length > 0 && (
          <p className="road-fresh">Nowa pocztówka: {freshRef.current.map((k) => REGIONS.find((r) => r.key === k).es).join(', ')}!</p>
        )}
        <div className="postcards" aria-label={`Pocztówki: ${POSTCARDS.filter((p) => album[p.key]).length} z ${POSTCARDS.length}`}>
          {POSTCARDS.map((p) => <Postcard key={p.key} region={p} owned={Boolean(album[p.key])} fresh={freshRef.current.includes(p.key)} />)}
        </div>
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
        <span className="road-region" aria-label={`Region: ${REGIONS[region].es}`}>
          <span className="road-region-name">{REGIONS[region].es}</span>
          {region < REGIONS.length - 1 && (
            <span className="road-region-bar" aria-hidden="true">
              {Array.from({ length: REGION_HITS }, (_, i) => <i key={i} className={i < statsRef.current.hits - region * REGION_HITS ? 'on' : ''} />)}
            </span>
          )}
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
      <div className="road-view">
        <canvas
          ref={canvasRef}
          className="road-canvas"
          onPointerDown={(e) => { const r = e.currentTarget.getBoundingClientRect(); steer(e.clientX - r.left < r.width / 2 ? 0 : 1); }}
        />
        {banner && (
          <div className="road-banner" key={banner.es} role="status">
            <span className="road-banner-hi">Bienvenidos a</span>
            <b>{banner.es}</b>
            <span>{banner.pl}</span>
            {banner.fresh && <span className="road-banner-card">nowa pocztówka!</span>}
          </div>
        )}
      </div>
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
