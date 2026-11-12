import React, { useEffect, useRef, useState } from 'react';
import { addActivity } from '../activity.js';
import { loadDeck, sprintDeck, pairPoints, saveGameScore } from '../engine/insights.js';
import { localDay } from '../../../shared/learning.js';
import Icon from './Icon.jsx';
import { burst, floatText, rain, centerOf, COLORS } from '../particles.js';
import { sfx } from '../sound.js';

// Mini gra „Sprint el/la”: 45 sekund, rzeczownik na środku, stukasz rodzajnik.
// Jak „Pary”: nie zmienia poziomów kart, ale liczy się do dnia nauki.

export const SPRINT_SECONDS = 45;

export default function Sprint({ maxLesson, onExit }) {
  const [card, setCard] = useState(null);
  const [flash, setFlash] = useState(null); // { ok, article } — krótka informacja zwrotna
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [remaining, setRemaining] = useState(SPRINT_SECONDS);
  const [phase, setPhase] = useState('load'); // load | play | done | empty
  const [best, setBest] = useState(0);
  const [record, setRecord] = useState(false);
  const deckRef = useRef([]);
  const posRef = useRef(0);
  const statsRef = useRef({ hits: 0, mistakes: 0, seconds: 0, saved: false });
  const scoreRef = useRef(0);
  const endAtRef = useRef(0);
  const lockRef = useRef(false);

  function next() {
    const deck = deckRef.current;
    setCard(deck[posRef.current % deck.length]);
    posRef.current++;
    setFlash(null);
    lockRef.current = false;
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
    const previous = await saveGameScore('sprint', scoreRef.current, localDay());
    setBest(Math.max(previous, scoreRef.current));
    if (scoreRef.current > previous && previous > 0) { setRecord(true); rain({ colors: COLORS.gold, seconds: 2 }); sfx.fanfare(); }
    await save();
  }

  function start() {
    statsRef.current = { hits: 0, mistakes: 0, seconds: 0, saved: false };
    scoreRef.current = 0;
    deckRef.current = [...deckRef.current].sort(() => Math.random() - 0.5);
    posRef.current = 0;
    setScore(0); setCombo(0); setRecord(false);
    setRemaining(SPRINT_SECONDS);
    endAtRef.current = Date.now() + SPRINT_SECONDS * 1000;
    setPhase('play');
    next();
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
    const t = setInterval(() => {
      if (document.visibilityState === 'hidden') { endAtRef.current += 1000; return; }
      statsRef.current.seconds++;
      const left = Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) finish();
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function answer(article) {
    if (phase !== 'play' || lockRef.current || !card) return;
    lockRef.current = true;
    const ok = article === card.article;
    const at = centerOf('.sprint-noun');
    if (ok) {
      const nextCombo = combo + 1;
      const points = pairPoints(nextCombo);
      scoreRef.current += points;
      statsRef.current.hits++;
      setScore(scoreRef.current);
      setCombo(nextCombo);
      burst(at, { colors: nextCombo >= 3 ? COLORS.gold : COLORS.ok, power: 0.7 + Math.min(5, nextCombo) * 0.25 });
      floatText({ x: at.x, y: at.y - 40 }, `+${points}`, { color: nextCombo >= 3 ? '#ffd23f' : '#ffffff' });
      sfx.pair(nextCombo);
    } else {
      statsRef.current.mistakes++;
      setCombo(0);
      navigator.vibrate?.(80);
      burst(at, { colors: COLORS.bad, power: 0.5 });
      sfx.wrong();
    }
    setFlash({ ok, article: card.article });
    setTimeout(next, ok ? 220 : 800); // po błędzie chwila na przeczytanie poprawnej formy
  }

  if (phase === 'load') return <div className="screen center">Tasowanie kart…</div>;

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
        <h2>{record ? 'Nowy rekord!' : 'Koniec czasu!'}</h2>
        <p className={'pairs-final' + (record ? ' record' : '')}>{score}</p>
        <p className="pairs-sub"><Icon name="trophy" size={14} /> rekord: {best}</p>
        <p className="hint">Trafione: {s.hits} · pomyłki: {s.mistakes}</p>
        <button className="btn primary big" onClick={start}>Jeszcze raz</button>
        <button className="btn" onClick={() => onExit()}>Wróć do kursu</button>
      </div>
    );
  }

  const options = card.plural ? ['los', 'las'] : ['el', 'la'];
  return (
    <div className="screen pairs sprint">
      <div className="session-top">
        <button className="btn ghost" onClick={async () => { await save(); onExit(); }} aria-label="Zakończ grę">
          <Icon name="close" />
        </button>
        <span className={'timer' + (remaining <= 10 ? ' timer-low' : '')}>0:{String(remaining).padStart(2, '0')}</span>
        <span className="pairs-score" aria-label={`Wynik ${score}`}>{score}</span>
      </div>
      <div className="session-progress">
        <div className="session-progress-fill pairs-time" style={{ width: (remaining / SPRINT_SECONDS) * 100 + '%' }} />
      </div>
      <div className={'pairs-combo' + (combo >= 2 ? ' on' : '')} key={combo}>
        {combo >= 2 ? `seria ×${Math.min(5, combo)}` : 'el czy la?'}
      </div>
      <div className="sprint-stage">
        <div className={'sprint-card' + (flash ? (flash.ok ? ' ok' : ' bad') : '')} key={card.id + posRef.current}>
          <span className="sprint-article">{flash ? flash.article : '?'}</span>
          <span className="sprint-noun">{card.noun}</span>
          <span className="sprint-pl">{card.pl}</span>
        </div>
      </div>
      <div className="sprint-buttons">
        {options.map((a) => (
          <button key={a} className={'btn sprint-btn sprint-' + (a === 'el' || a === 'los' ? 'm' : 'f')} onClick={() => answer(a)}>{a}</button>
        ))}
      </div>
    </div>
  );
}
