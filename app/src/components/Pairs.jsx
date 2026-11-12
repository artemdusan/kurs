import React, { useEffect, useRef, useState } from 'react';
import { getMeta, setMeta } from '../db.js';
import { addActivity } from '../activity.js';
import { loadDeck, pairsDeck, dealBoard, pairPoints, PAIRS_PER_BOARD } from '../engine/insights.js';
import Icon from './Icon.jsx';

// Mini gra „Pary na czas”: 60 sekund, łącz polskie słowo z hiszpańskim.
// Nie zmienia poziomów kart (algorytm nauki zostaje nietknięty), ale liczy się
// do czasu nauki i odpowiedzi dnia, więc podtrzymuje serię.

export const PAIRS_SECONDS = 60;

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function speak(text, enabled) {
  if (!enabled || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-ES';
    window.speechSynthesis.speak(u);
  } catch {
    /* TTS jest opcjonalne */
  }
}

export default function Pairs({ maxLesson, settings, onExit }) {
  const [board, setBoard] = useState(null); // { left: [card], right: [card] }
  const [picked, setPicked] = useState(null); // { side, id }
  const [gone, setGone] = useState(() => new Set());
  const [miss, setMiss] = useState(null); // { left, right } — błędna para (animacja)
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [remaining, setRemaining] = useState(PAIRS_SECONDS);
  const [phase, setPhase] = useState('play'); // play | done
  const [best, setBest] = useState(0);
  const [record, setRecord] = useState(false);
  const cardsRef = useRef([]);
  const usedRef = useRef(new Set());
  const statsRef = useRef({ pairs: 0, mistakes: 0, seconds: 0, saved: false });
  const scoreRef = useRef(0);
  const endAtRef = useRef(0);

  function deal() {
    const next = dealBoard(cardsRef.current, usedRef.current, PAIRS_PER_BOARD);
    setGone(new Set());
    setPicked(null);
    setBoard({ left: shuffle(next), right: shuffle(next) });
  }

  async function save() {
    const s = statsRef.current;
    if (s.saved) return;
    s.saved = true;
    if (s.pairs + s.mistakes + s.seconds > 0) {
      await addActivity({ correct: s.pairs, wrong: s.mistakes, seconds: s.seconds }).catch(() => {});
    }
  }

  async function finish() {
    setPhase('done');
    const previous = await getMeta('pairsBest', 0);
    setBest(Math.max(previous, scoreRef.current));
    if (scoreRef.current > previous) {
      setRecord(previous > 0);
      await setMeta('pairsBest', scoreRef.current);
    }
    await save();
  }

  function start() {
    usedRef.current = new Set();
    statsRef.current = { pairs: 0, mistakes: 0, seconds: 0, saved: false };
    scoreRef.current = 0;
    setScore(0); setCombo(0); setRecord(false);
    setRemaining(PAIRS_SECONDS);
    endAtRef.current = Date.now() + PAIRS_SECONDS * 1000;
    setPhase('play');
    deal();
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const deck = await loadDeck(maxLesson);
      if (cancelled) return;
      cardsRef.current = pairsDeck(deck);
      setBest(await getMeta('pairsBest', 0));
      start();
    })();
    return () => { cancelled = true; save(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== 'play' || !board) return undefined;
    const t = setInterval(() => {
      if (document.visibilityState === 'hidden') { endAtRef.current += 1000; return; } // w tle czas stoi
      statsRef.current.seconds++;
      const left = Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) finish();
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, board !== null]);

  function tap(side, card) {
    if (phase !== 'play' || miss || gone.has(card.id)) return;
    if (!picked || picked.side === side) {
      setPicked(picked && picked.id === card.id ? null : { side, id: card.id });
      return;
    }
    if (picked.id === card.id) {
      const nextCombo = combo + 1;
      const nextGone = new Set(gone).add(card.id);
      scoreRef.current += pairPoints(nextCombo);
      statsRef.current.pairs++;
      setScore(scoreRef.current);
      setCombo(nextCombo);
      setGone(nextGone);
      setPicked(null);
      speak(card.es, settings?.tts);
      if (nextGone.size >= board.left.length) setTimeout(deal, 260);
    } else {
      statsRef.current.mistakes++;
      setCombo(0);
      navigator.vibrate?.(80);
      setMiss(side === 'left' ? { left: card.id, right: picked.id } : { left: picked.id, right: card.id });
      setTimeout(() => { setMiss(null); setPicked(null); }, 380);
    }
  }

  if (!board) return <div className="screen center">Tasowanie kart…</div>;

  if (board.left.length < 2) {
    return (
      <div className="screen center">
        <p>Za mało słów na grę — najpierw zrób pierwszą sesję.</p>
        <button className="btn primary" onClick={() => onExit()}>Wróć do kursu</button>
      </div>
    );
  }

  if (phase === 'done') {
    const s = statsRef.current;
    return (
      <div className="screen center pairs-done">
        <h2>{record ? 'Nowy rekord!' : 'Koniec czasu!'}</h2>
        <p className={'pairs-final' + (record ? ' record' : '')}>{score}</p>
        <p className="pairs-sub">
          <Icon name="trophy" size={14} /> rekord: {best}
        </p>
        <p className="hint">Pary: {s.pairs} · pomyłki: {s.mistakes}</p>
        <button className="btn primary big" onClick={start}>Jeszcze raz</button>
        <button className="btn" onClick={() => onExit()}>Wróć do kursu</button>
      </div>
    );
  }

  const tile = (side, card) => {
    const cls = ['pair-tile', side === 'right' ? 'es' : 'pl'];
    if (gone.has(card.id)) cls.push('gone');
    if (picked && picked.side === side && picked.id === card.id) cls.push('picked');
    if (miss && miss[side] === card.id) cls.push('miss');
    return (
      <button key={side + card.id} className={cls.join(' ')} disabled={gone.has(card.id)} onClick={() => tap(side, card)}>
        {side === 'right' ? card.es : card.pl}
      </button>
    );
  };

  return (
    <div className="screen pairs">
      <div className="session-top">
        <button className="btn ghost" onClick={async () => { await save(); onExit(); }} aria-label="Zakończ grę">
          <Icon name="close" />
        </button>
        <span className={'timer' + (remaining <= 10 ? ' timer-low' : '')}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span>
        <span className="pairs-score" aria-label={`Wynik ${score}`}>{score}</span>
      </div>
      <div className="session-progress">
        <div className="session-progress-fill pairs-time" style={{ width: (remaining / PAIRS_SECONDS) * 100 + '%' }} />
      </div>
      <div className={'pairs-combo' + (combo >= 2 ? ' on' : '')} key={combo}>
        {combo >= 2 ? `seria ×${Math.min(5, combo)}` : 'dobierz pary'}
      </div>
      <div className="pairs-board">
        <div className="pairs-col">{board.left.map((c) => tile('left', c))}</div>
        <div className="pairs-col">{board.right.map((c) => tile('right', c))}</div>
      </div>
    </div>
  );
}
