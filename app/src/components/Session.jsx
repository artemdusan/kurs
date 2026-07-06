import React, { useEffect, useRef, useState } from 'react';
import { saveSettings } from '../db.js';
import { buildSessionPool, pickNext, recordAnswer, bumpDailyStats, SESSION_DONE_STREAK } from '../engine/session.js';
import { checkAnswer, splitArticle } from '../engine/answer.js';
import { buildKeyboard } from '../engine/keyboard.js';
import { buildMcqOptions } from '../engine/mcq.js';
import { describeGrammar } from '../course.js';
import Keyboard from './Keyboard.jsx';
import Cloze, { parseExample } from './Cloze.jsx';

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

export default function Session({ settings, maxLesson, onExit, onFinished, onSettingsChange }) {
  const [pool, setPool] = useState(null);
  const [tts, setTts] = useState(settings.tts);
  const [task, setTask] = useState(null);
  const [typed, setTyped] = useState('');
  const [article, setArticle] = useState('');
  const [phase, setPhase] = useState('answer'); // 'answer' | 'feedback' | 'done'
  const [wasCorrect, setWasCorrect] = useState(false);
  const [counts, setCounts] = useState({ correct: 0, wrong: 0, done: 0 });
  const [remaining, setRemaining] = useState(settings.sessionMinutes * 60);
  const endAtRef = useRef(Date.now() + settings.sessionMinutes * 60 * 1000);
  const prevWordRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    buildSessionPool(maxLesson).then(async (p) => {
      if (cancelled) return;
      setPool(p);
      await makeTask(p);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setRemaining(Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  async function makeTask(currentPool) {
    if (Date.now() >= endAtRef.current) return finish(currentPool);
    const entry = pickNext(currentPool, prevWordRef.current);
    if (!entry) return finish(currentPool);
    prevWordRef.current = entry.word.id;

    const examples = entry.word.examples?.length
      ? entry.word.examples
      : [{ es_form: `[${entry.word.es}::${entry.word.pl}]`, pl_translation: entry.word.pl }];
    const example = examples[Math.floor(Math.random() * examples.length)];
    const parsed = parseExample(example);
    const expected = parsed.answer || entry.word.es;
    const isNoun = entry.word.type === 'noun';

    let mode = 'type';
    let mcqOptions = null;
    if (entry.word.type === 'verb_form' && entry.progress.level <= settings.mcqMaxLevel) {
      mcqOptions = await buildMcqOptions(entry.word);
      if (mcqOptions) mode = 'mcq';
    }

    setTask({
      entry,
      parsed,
      expected,
      isNoun,
      mode,
      mcqOptions,
      keyboard: mode === 'type' ? buildKeyboard(expected, { isNoun }) : null,
    });
    setTyped('');
    setArticle('');
    setPhase('answer');
  }

  async function grade(userAnswer) {
    const correct = checkAnswer(userAnswer, task.expected, {
      isNoun: task.isNoun,
      accentTolerance: settings.accentTolerance,
    });
    const updated = await recordAnswer(task.entry, correct);
    const newPool = pool.map((e) => (e.word.id === updated.word.id ? updated : e));
    setPool(newPool);
    setWasCorrect(correct);
    setCounts((c) => ({
      correct: c.correct + (correct ? 1 : 0),
      wrong: c.wrong + (correct ? 0 : 1),
      done: newPool.filter((e) => e.sessionStreak >= SESSION_DONE_STREAK).length,
    }));
    await bumpDailyStats({ correct: correct ? 1 : 0, wrong: correct ? 0 : 1 });
    speak(task.expected, tts);
    setPhase('feedback');
  }

  function toggleTts() {
    const next = !tts;
    setTts(next);
    if (!next && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    const updated = { ...settings, tts: next };
    saveSettings(updated);
    onSettingsChange?.(updated);
  }

  async function finish(currentPool) {
    await bumpDailyStats({ finishedSession: true });
    setPhase('done');
    onFinished?.(currentPool || pool);
  }

  if (!pool || (!task && phase !== 'done')) return <div className="screen center">Ładowanie sesji…</div>;

  if (phase === 'done') {
    return (
      <div className="screen center session-summary">
        <h2>Sesja zakończona 🎉</h2>
        <p className="big-num">✅ {counts.correct} &nbsp; ❌ {counts.wrong}</p>
        <p>Zaliczone w tej sesji słowa: {counts.done}</p>
        <button className="btn primary" onClick={onExit}>Wróć do kursu</button>
      </div>
    );
  }

  const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
  const secs = String(remaining % 60).padStart(2, '0');
  const w = task.entry.word;
  const display = task.isNoun ? (article ? article + ' ' + typed : typed) : typed;

  return (
    <div className="screen session">
      <div className="session-top">
        <button className="btn ghost" onClick={() => finish(pool)}>✕</button>
        <span className="timer">{mins}:{secs}</span>
        <span className="score">✅ {counts.correct} ❌ {counts.wrong}</span>
        <button
          className="btn ghost"
          title={tts ? 'Wycisz czytanie na głos' : 'Włącz czytanie na głos'}
          onClick={toggleTts}
        >
          {tts ? '🔊' : '🔇'}
        </button>
      </div>

      <div className="prompt">
        <div className="prompt-word">
          <span className="pl-word">{w.pl}</span>
          {w.type === 'verb_form' && w.grammar && (
            <span className="grammar-tag">{describeGrammar(w.grammar)}</span>
          )}
          <span className="level-tag">poz. {task.entry.progress.level}</span>
        </div>
        <Cloze parsed={task.parsed} revealed={phase === 'feedback'} userText={display} />
      </div>

      {phase === 'answer' && task.mode === 'mcq' && (
        <div className="mcq">
          {task.mcqOptions.map((opt) => (
            <button key={opt} className="btn mcq-option" onClick={() => grade(opt)}>
              {opt}
            </button>
          ))}
        </div>
      )}

      {phase === 'answer' && task.mode === 'type' && (
        <>
          <div className="typed-preview">{display || ' '}</div>
          <Keyboard
            layout={task.keyboard}
            isNoun={task.isNoun}
            article={article}
            onArticle={(a) => setArticle(a === article ? '' : a)}
            onKey={(ch) => setTyped((t) => t + ch)}
            onBackspace={() => setTyped((t) => t.slice(0, -1))}
          />
          <button
            className="btn primary check"
            disabled={!typed && !article}
            onClick={() => grade(display)}
          >
            Sprawdź
          </button>
        </>
      )}

      {phase === 'feedback' && (
        <div className={'feedback ' + (wasCorrect ? 'ok' : 'bad')}>
          <p>
            {wasCorrect ? 'Dobrze! 🎉' : 'Poprawna odpowiedź:'}{' '}
            <strong>{task.expected}</strong>
          </p>
          <button className="btn primary" onClick={() => makeTask(pool)}>Dalej</button>
        </div>
      )}
    </div>
  );
}
