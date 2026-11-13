import React, { useEffect, useRef, useState } from 'react';
import { getMeta } from '../db.js';
import { addActivity } from '../activity.js';
import { loadDeck, pairsDeck, dealBoard, pairPoints, saveGameScore, countGameHits, PAIRS_PER_BOARD } from '../engine/insights.js';
import { localDay } from '../../../shared/learning.js';
import { sfx } from '../sound.js';
import Icon from './Icon.jsx';
import GameXp from './GameXp.jsx';
import { burst, floatText, rain, COLORS } from '../particles.js';

// Mini gra „Pary na czas”: 60 sekund, łącz polskie słowo z hiszpańskim.
// Nie zmienia poziomów kart (algorytm nauki zostaje nietknięty), ale liczy się
// do czasu nauki i odpowiedzi dnia, więc podtrzymuje serię.
// Żeby było o co grać: wyczyszczona plansza dolicza czas, od drugiej planszy
// jedno hiszpańskie słowo jest złote (para za ×3), a seria 5 par włącza „gorączkę”.

export const PAIRS_SECONDS = 60;
export const BOARD_BONUS_SECONDS = 3;
export const GOLD_MULTIPLIER = 3;
export const FEVER_COMBO = 5;

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
  const [counted, setCounted] = useState(null); // co z gry zaliczono do XP (limit dzienny)
  const [goldId, setGoldId] = useState(null); // złote słowo na tej planszy
  const boardsRef = useRef(0);
  const cardsRef = useRef([]);
  const usedRef = useRef(new Set());
  const statsRef = useRef({ pairs: 0, mistakes: 0, seconds: 0, saved: false });
  const scoreRef = useRef(0);
  const endAtRef = useRef(0);

  function deal() {
    const next = dealBoard(cardsRef.current, usedRef.current, PAIRS_PER_BOARD);
    setGone(new Set());
    setPicked(null);
    // pierwsza plansza jest zwykła — złote słowo pojawia się od drugiej
    setGoldId(boardsRef.current > 0 && next.length ? next[Math.floor(Math.random() * next.length)].id : null);
    setBoard({ left: shuffle(next), right: shuffle(next) });
  }

  async function save() {
    const s = statsRef.current;
    if (s.saved) return;
    s.saved = true;
    if (s.pairs + s.mistakes + s.seconds === 0) return null;
    const counted = await countGameHits(s.pairs, s.mistakes, localDay()).catch(() => ({ correct: 0, wrong: 0, limited: true }));
    await addActivity({ correct: counted.correct, wrong: counted.wrong, seconds: s.seconds }).catch(() => {});
    return counted;
  }

  async function finish() {
    setPhase('done');
    const previous = await saveGameScore('pairs', scoreRef.current, localDay());
    setBest(Math.max(previous, scoreRef.current));
    if (scoreRef.current > previous && previous > 0) { setRecord(true); rain({ colors: COLORS.gold, seconds: 2 }); sfx.fanfare(); }
    setCounted(await save());
  }

  function start() {
    usedRef.current = new Set();
    statsRef.current = { pairs: 0, mistakes: 0, seconds: 0, saved: false };
    setCounted(null);
    scoreRef.current = 0;
    boardsRef.current = 0;
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

  function tap(side, card, event) {
    if (phase !== 'play' || miss || gone.has(card.id)) return;
    if (!picked || picked.side === side) {
      setPicked(picked && picked.id === card.id ? null : { side, id: card.id });
      return;
    }
    if (picked.id === card.id) {
      const nextCombo = combo + 1;
      const nextGone = new Set(gone).add(card.id);
      const golden = card.id === goldId;
      const points = pairPoints(nextCombo) * (golden ? GOLD_MULTIPLIER : 1);
      scoreRef.current += points;
      // wybuch z obu kafelków; im dłuższa seria, tym większy i bardziej złoty
      const hot = nextCombo >= 3 || golden;
      const tiles = [event?.currentTarget, document.querySelector(`.pair-tile.picked`)].filter(Boolean);
      for (const el of tiles) {
        const r = el.getBoundingClientRect();
        burst({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, { colors: hot ? COLORS.gold : COLORS.blue, power: 0.7 + Math.min(5, nextCombo) * 0.25 });
      }
      if (tiles[0]) {
        const r = tiles[0].getBoundingClientRect();
        floatText({ x: r.left + r.width / 2, y: r.top + 6 }, `+${points}`, { color: hot ? '#ffd23f' : '#ffffff', size: golden ? 20 : hot ? 16 : 13 });
      }
      statsRef.current.pairs++;
      setScore(scoreRef.current);
      setCombo(nextCombo);
      setGone(nextGone);
      setPicked(null);
      if (golden) sfx.gold(); else sfx.pair(nextCombo);
      speak(card.es, settings?.tts);
      if (nextGone.size >= board.left.length) {
        // plansza wyczyszczona: premia czasu, więc dobra gra trwa dłużej
        boardsRef.current++;
        endAtRef.current += BOARD_BONUS_SECONDS * 1000;
        setRemaining((n) => n + BOARD_BONUS_SECONDS);
        const t = document.querySelector('.pairs .timer')?.getBoundingClientRect();
        if (t) floatText({ x: t.left + t.width / 2, y: t.bottom + 14 }, `+${BOARD_BONUS_SECONDS} s`, { color: '#4cc2ff', size: 14 });
        setTimeout(deal, 260);
      }
    } else {
      statsRef.current.mistakes++;
      setCombo(0);
      navigator.vibrate?.(80);
      sfx.wrong();
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
        <p className="hint">Pary: {s.pairs} · plansze: {boardsRef.current} · pomyłki: {s.mistakes}</p>
        <GameXp counted={counted} />
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
    if (side === 'right' && card.id === goldId) cls.push('golden');
    return (
      <button key={side + card.id} className={cls.join(' ')} disabled={gone.has(card.id)} onClick={(e) => tap(side, card, e)}>
        {side === 'right' ? card.es : card.pl}
      </button>
    );
  };

  return (
    <div className={'screen pairs' + (combo >= FEVER_COMBO ? ' fever' : '')}>
      <div className="session-top">
        <button className="btn ghost" onClick={async () => { await save(); onExit(); }} aria-label="Zakończ grę">
          <Icon name="close" />
        </button>
        <span className={'timer' + (remaining <= 10 ? ' timer-low' : '')}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span>
        <span className="pairs-score" aria-label={`Wynik ${score}`}>{score}</span>
      </div>
      <div className="session-progress">
        <div className="session-progress-fill pairs-time" style={{ width: Math.min(100, (remaining / PAIRS_SECONDS) * 100) + '%' }} />
      </div>
      <div className={'pairs-combo' + (combo >= 2 ? ' on' : '')} key={combo}>
        {combo >= FEVER_COMBO ? 'gorączka ×5!' : combo >= 2 ? `seria ×${Math.min(5, combo)}` : goldId ? 'złote słowo: para za ×3' : 'dobierz pary'}
      </div>
      <div className="pairs-board">
        <div className="pairs-col">{board.left.map((c) => tile('left', c))}</div>
        <div className="pairs-col">{board.right.map((c) => tile('right', c))}</div>
      </div>
    </div>
  );
}
