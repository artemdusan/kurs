import React, { useEffect, useRef, useState } from 'react';
import { loadDeck, pairPoints } from '../engine/insights.js';
import { nextFrom } from '../engine/games.js';
import { useGameRun } from './useGameRun.js';
import { sfx } from '../sound.js';
import { burst, floatText, COLORS } from '../particles.js';
import Icon from './Icon.jsx';
import GameOver from './GameOver.jsx';

// Wspólny szkielet szybkich quizów z salonu („Luka”, „Eco”): 60 sekund, cztery
// odpowiedzi, seria bezbłędnych mnoży punkty (do ×5) jak w „Parach”. Błąd zabiera
// sekundy i serię, a dobra odpowiedź zostaje na chwilę podświetlona — ta chwila uczy.

export const QUIZ_SECONDS = 60;
export const MISS_PENALTY = 3;

export default function TimedQuiz({ game, icon, title, maxLesson, buildDeck, optionsFor, renderPrompt, onShow, onAnswer, emptyText, onExit }) {
  const [phase, setPhase] = useState('loading'); // loading | empty | play | done
  const [item, setItem] = useState(null);
  const [options, setOptions] = useState([]);
  const [answer, setAnswer] = useState(null); // { picked, ok }
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [remaining, setRemaining] = useState(QUIZ_SECONDS);
  const run = useGameRun(game, phase === 'play');
  const deckRef = useRef([]);
  const recentRef = useRef([]);
  const endAtRef = useRef(0);
  const liveRef = useRef({ score: 0, combo: 0, over: false });

  function show() {
    const next = nextFrom(deckRef.current, recentRef.current);
    recentRef.current.push(next.key || next.id);
    setItem(next);
    setOptions(optionsFor(next, deckRef.current));
    setAnswer(null);
    onShow?.(next);
  }

  function start() {
    run.reset();
    liveRef.current = { score: 0, combo: 0, over: false };
    recentRef.current = [];
    setScore(0); setCombo(0);
    setRemaining(QUIZ_SECONDS);
    endAtRef.current = Date.now() + QUIZ_SECONDS * 1000;
    setPhase('play');
    show();
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const deck = buildDeck(await loadDeck(maxLesson));
      if (cancelled) return;
      deckRef.current = deck;
      if (deck.length < 4) { setPhase('empty'); return; }
      start();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function end() {
    if (liveRef.current.over) return;
    liveRef.current.over = true;
    setPhase('done');
    await run.finish(liveRef.current.score);
  }

  useEffect(() => {
    if (phase !== 'play') return undefined;
    const t = setInterval(() => {
      if (document.visibilityState === 'hidden') { endAtRef.current += 1000; return; } // w tle czas stoi
      const left = Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) end();
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function pick(option, event) {
    if (phase !== 'play' || answer || !item) return;
    const correct = optionsCorrect(item);
    const ok = option === correct;
    const live = liveRef.current;
    setAnswer({ picked: option, ok });
    onAnswer?.(item, ok);
    if (ok) {
      run.hit();
      live.combo++;
      const points = pairPoints(live.combo);
      live.score += points;
      setScore(live.score);
      setCombo(live.combo);
      sfx.pair(live.combo);
      const r = event.currentTarget.getBoundingClientRect();
      const hot = live.combo >= 3;
      burst({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, { colors: hot ? COLORS.gold : COLORS.blue, power: 0.7 + Math.min(5, live.combo) * 0.25 });
      floatText({ x: r.left + r.width / 2, y: r.top + 6 }, `+${points}`, { color: hot ? '#ffd23f' : '#ffffff', size: hot ? 16 : 13 });
      setTimeout(() => { if (!live.over) show(); }, 420);
    } else {
      run.miss();
      live.combo = 0;
      setCombo(0);
      sfx.wrong();
      navigator.vibrate?.(80);
      endAtRef.current -= MISS_PENALTY * 1000;
      setRemaining((n) => Math.max(0, n - MISS_PENALTY));
      const t = document.querySelector('.game .timer')?.getBoundingClientRect();
      if (t) floatText({ x: t.left + t.width / 2, y: t.bottom + 14 }, `−${MISS_PENALTY} s`, { color: '#ff5c5c', size: 14 });
      setTimeout(() => { if (!live.over) show(); }, 1300); // czas na zobaczenie dobrej odpowiedzi
    }
  }

  const exit = async () => { await run.save(); onExit(); };

  if (phase === 'loading') return <div className="screen center">Tasowanie…</div>;
  if (phase === 'empty') {
    return (
      <div className="screen center">
        <p>{emptyText}</p>
        <button className="btn primary" onClick={onExit}>Wróć</button>
      </div>
    );
  }
  if (phase === 'done') {
    const s = run.stats.current;
    return (
      <GameOver title="Koniec czasu!" result={run.result} onAgain={start} onExit={onExit}>
        <p className="hint">Dobrze: {s.hits} · pomyłki: {s.mistakes}</p>
      </GameOver>
    );
  }

  const correct = item ? optionsCorrect(item) : null;
  return (
    <div className={'screen game quiz ' + game + (combo >= 5 ? ' fever' : '')}>
      <div className="session-top">
        <button className="btn ghost" onClick={exit} aria-label="Zakończ grę"><Icon name="close" /></button>
        <span className={'timer' + (remaining <= 10 ? ' timer-low' : '')}>
          <Icon name={icon} size={13} /> {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
        </span>
        <span className="pairs-score" aria-label={`Wynik ${score}`}>{score}</span>
      </div>
      <div className="session-progress">
        <div className="session-progress-fill pairs-time" style={{ width: Math.min(100, (remaining / QUIZ_SECONDS) * 100) + '%' }} />
      </div>
      <div className={'pairs-combo' + (combo >= 2 ? ' on' : '')} key={combo}>
        {combo >= 5 ? 'seria ×5!' : combo >= 2 ? `seria ×${combo}` : title}
      </div>
      <div className="quiz-prompt">{item && renderPrompt(item, answer)}</div>
      <div className="quiz-options">
        {options.map((o) => {
          const cls = ['quiz-option'];
          if (answer && o === correct) cls.push('ok');
          else if (answer && o === answer.picked) cls.push('bad');
          return (
            <button key={o} className={cls.join(' ')} disabled={!!answer} onClick={(e) => pick(o, e)}>{o}</button>
          );
        })}
      </div>
    </div>
  );
}

// opcje są tekstami; poprawna to `answer` (Luka) albo `pl` (Eco)
function optionsCorrect(item) {
  return item.answer ?? item.pl;
}
