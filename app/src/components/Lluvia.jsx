import React, { useEffect, useRef, useState } from 'react';
import { loadDeck, pairPoints } from '../engine/insights.js';
import { conjugationDeck, fallMs, nextFrom, PERSONS } from '../engine/games.js';
import { useGameRun, speak } from './useGameRun.js';
import { sfx } from '../sound.js';
import { burst, floatText, COLORS } from '../particles.js';
import Icon from './Icon.jsx';
import GameOver from './GameOver.jsx';

// „Lluvia”: z góry spada forma czasownika (np. „bebimos”), a ty dotykasz osoby,
// do której pasuje (nosotros). Każde trafienie przyspiesza deszcz. Jak w „Drodze”
// nie ma żyć: błąd albo forma, która spadnie na ziemię, kończy grę — a ekran końca
// pokazuje, jak było poprawnie.

const LABEL = Object.fromEntries(PERSONS.map((p) => [p.key, p.label]));

export default function Lluvia({ maxLesson, settings, onExit }) {
  const [phase, setPhase] = useState('loading'); // loading | empty | play | done
  const [item, setItem] = useState(null);
  const [score, setScore] = useState(0);
  const [hits, setHits] = useState(0);
  const [flash, setFlash] = useState(null); // { key, ok }
  const [ending, setEnding] = useState(null); // { item, picked } — jak zakończyła się gra
  const run = useGameRun('lluvia', phase === 'play');
  const deckRef = useRef([]);
  const recentRef = useRef([]);
  const blockRef = useRef(null);
  const fieldRef = useRef(null);
  const fallRef = useRef({ start: 0, dur: 6000, last: 0 });
  const liveRef = useRef({ score: 0, hits: 0, busy: false });

  function spawn() {
    const next = nextFrom(deckRef.current, recentRef.current);
    recentRef.current.push(next.id);
    const now = performance.now();
    fallRef.current = { start: now, dur: fallMs(liveRef.current.hits), last: now };
    liveRef.current.busy = false;
    setFlash(null);
    setItem(next);
  }

  function start() {
    run.reset();
    liveRef.current = { score: 0, hits: 0, busy: false };
    recentRef.current = [];
    setScore(0); setHits(0); setEnding(null);
    setPhase('play');
    spawn();
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const deck = conjugationDeck(await loadDeck(maxLesson));
      if (cancelled) return;
      deckRef.current = deck;
      if (deck.length < 6) { setPhase('empty'); return; }
      start();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lose(current, picked) {
    if (liveRef.current.busy && picked === undefined) return;
    liveRef.current.busy = true;
    sfx.wrong();
    navigator.vibrate?.(120);
    setFlash(picked ? { key: picked, ok: false } : null);
    setEnding({ item: current, picked });
    if (settings?.tts !== false) speak(current.es);
    setTimeout(async () => {
      setPhase('done');
      await run.finish(liveRef.current.score);
    }, 700);
  }

  // spadanie: pozycja liczona z czasu, a nie z klatek — tak samo szybko na każdym telefonie
  useEffect(() => {
    if (phase !== 'play' || !item) return undefined;
    let raf = 0;
    const step = (now) => {
      const f = fallRef.current;
      // karta w tle albo zacięcie: przesuwamy start, żeby forma nie „przeskoczyła” na dół
      if (now - f.last > 250) f.start += now - f.last;
      f.last = now;
      const p = Math.min(1, (now - f.start) / f.dur);
      const field = fieldRef.current;
      const block = blockRef.current;
      if (field && block && !liveRef.current.busy) {
        const room = Math.max(0, field.clientHeight - block.offsetHeight);
        block.style.transform = `translate(-50%, ${Math.round(p * room)}px)`;
        block.classList.toggle('low', p > 0.75);
      }
      if (p >= 1 && !liveRef.current.busy) { lose(item); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, item]);

  function tap(key, event) {
    if (phase !== 'play' || !item || liveRef.current.busy) return;
    if (!item.persons.includes(key)) { run.miss(); lose(item, key); return; }
    liveRef.current.busy = true;
    run.hit();
    const live = liveRef.current;
    live.hits++;
    const points = pairPoints(live.hits);
    live.score += points;
    setScore(live.score);
    setHits(live.hits);
    setFlash({ key, ok: true });
    sfx.pair(Math.min(8, live.hits));
    const r = (blockRef.current || event.currentTarget).getBoundingClientRect();
    burst({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, { colors: live.hits >= 5 ? COLORS.gold : COLORS.blue, power: 0.8 + Math.min(5, live.hits) * 0.2 });
    floatText({ x: r.left + r.width / 2, y: r.top }, `+${points}`, { color: live.hits >= 5 ? '#ffd23f' : '#ffffff', size: 15 });
    setTimeout(spawn, 220);
  }

  const exit = async () => { await run.save(); onExit(); };

  if (phase === 'loading') return <div className="screen center">Zbieranie chmur…</div>;
  if (phase === 'empty') {
    return (
      <div className="screen center">
        <p>Za mało form czasowników na deszcz — otwórz kolejną lekcję.</p>
        <button className="btn primary" onClick={onExit}>Wróć</button>
      </div>
    );
  }

  if (phase === 'done') {
    const e = ending;
    return (
      <GameOver title={e?.picked ? 'Pudło!' : 'Za późno!'} result={run.result} onAgain={start} onExit={onExit}>
        {e && (
          <p className="game-answer">
            <b>{e.item.es}</b> = {e.item.persons.map((k) => LABEL[k]).join(' / ')}
            <small>{e.item.verb}, {e.item.tense}{e.picked ? ` · wybrano: ${LABEL[e.picked]}` : ''}</small>
          </p>
        )}
        <p className="hint">Złapane formy: {run.stats.current.hits}</p>
      </GameOver>
    );
  }

  return (
    <div className={'screen game lluvia' + (hits >= 10 ? ' fever' : '')}>
      <div className="session-top">
        <button className="btn ghost" onClick={exit} aria-label="Zakończ grę"><Icon name="close" /></button>
        <span className="game-tag"><Icon name="rain" size={13} /> {hits}</span>
        <span className="pairs-score" aria-label={`Wynik ${score}`}>{score}</span>
      </div>
      <div className="lluvia-field" ref={fieldRef}>
        {item && (
          <div key={item.id + recentRef.current.length} ref={blockRef} className={'lluvia-drop' + (flash?.ok ? ' ok' : flash ? ' bad' : '')}>
            <span className="lluvia-form">{item.es}</span>
            <span className="lluvia-meta">{item.verb} · {item.tense}</span>
          </div>
        )}
      </div>
      <div className="lluvia-persons">
        {PERSONS.map((p) => (
          <button
            key={p.key}
            className={'lluvia-person' + (flash?.key === p.key ? (flash.ok ? ' ok' : ' bad') : '') + (ending && ending.item.persons.includes(p.key) ? ' right' : '')}
            onClick={(e) => tap(p.key, e)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
