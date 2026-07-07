import React, { useEffect, useRef, useState } from 'react';
import { saveSettings } from '../db.js';
import { buildSessionPool, buildMistakesPool, pickNext, recordAnswer, bumpDailyStats, requiredStreak } from '../engine/session.js';
import { checkAnswer, splitArticle } from '../engine/answer.js';
import { buildKeyboard, articleButtons } from '../engine/keyboard.js';
import { buildMcqOptions } from '../engine/mcq.js';
import Keyboard from './Keyboard.jsx';
import Cloze, { parseExample } from './Cloze.jsx';
import Icon from './Icon.jsx';

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

export default function Session({ settings, maxLesson, mode = 'normal', onExit, onFinished, onSettingsChange }) {
  const [pool, setPool] = useState(null);
  const [tts, setTts] = useState(settings.tts);
  const [task, setTask] = useState(null);
  const [typed, setTyped] = useState('');
  const [article, setArticle] = useState('');
  const [phase, setPhase] = useState('answer'); // 'answer' | 'feedback' | 'more' | 'done'
  const [wasCorrect, setWasCorrect] = useState(false);
  const [counts, setCounts] = useState({ correct: 0, wrong: 0, done: 0 });
  const [remaining, setRemaining] = useState(settings.sessionMinutes * 60);
  const endAtRef = useRef(Date.now() + settings.sessionMinutes * 60 * 1000);
  // sekundy nauki liczone tylko, gdy karta jest widoczna — apka w tle (albo
  // ekran zablokowany) nie ma wliczać się do czasu nauki w statystykach
  const activeSecondsRef = useRef(0);
  const finishedRef = useRef(false);
  const prevWordRef = useRef(null);
  const poolRef = useRef(null);
  const phaseRef = useRef(phase);
  poolRef.current = pool;
  phaseRef.current = phase;

  useEffect(() => {
    let cancelled = false;
    const build = mode === 'mistakes' ? buildMistakesPool : buildSessionPool;
    build(maxLesson).then(async (p) => {
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
      // liczy się tylko czas z kartą widoczną na pierwszym planie
      if (document.visibilityState !== 'hidden') activeSecondsRef.current++;
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // czas minął (w dowolnej fazie) — zakończ sesję; obejmuje też powrót
  // z tła po dłuższej nieaktywności, gdy limit czasu już minął
  useEffect(() => {
    if (remaining === 0 && phase !== 'done') finish(pool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, phase]);

  // wracając z tła sprawdź od razu, czy limit czasu minął — przeglądarka
  // wstrzymuje/spowalnia interwały w ukrytej karcie, więc kolejny tick mógłby
  // przyjść z dużym opóźnieniem
  useEffect(() => {
    function onVisibilityChange() {
      if (
        document.visibilityState === 'visible' &&
        Date.now() >= endAtRef.current &&
        phaseRef.current !== 'done'
      ) {
        finish(poolRef.current);
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function makeTask(currentPool) {
    if (Date.now() >= endAtRef.current) return finish(currentPool);
    const entry = pickNext(currentPool, prevWordRef.current);
    // pula wyczerpana, ale czas jeszcze biegnie — zapytaj o dolosowanie słów
    if (!entry) return setPhase('more');
    prevWordRef.current = entry.word.id;

    const examples = entry.word.examples?.length
      ? entry.word.examples
      : [{ es_form: `[${entry.word.es}::${entry.word.pl}]`, pl_translation: entry.word.pl }];
    const example = examples[Math.floor(Math.random() * examples.length)];
    const parsed = parseExample(example);
    const expected = parsed.answer || entry.word.es;
    const isNoun = entry.word.type === 'noun';

    let answerMode = 'type';
    let mcqOptions = null;
    if (entry.word.type === 'verb_form' && entry.progress.level <= settings.mcqMaxLevel) {
      mcqOptions = await buildMcqOptions(entry.word);
      if (mcqOptions) answerMode = 'mcq';
    }

    setTask({
      entry,
      parsed,
      expected,
      isNoun,
      mode: answerMode,
      mcqOptions,
      keyboard: answerMode === 'type' ? buildKeyboard(expected, { isNoun }) : null,
      articles: isNoun ? articleButtons(splitArticle(expected).article) : [],
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
      done: newPool.filter((e) => e.sessionStreak >= requiredStreak(e.progress)).length,
    }));
    await bumpDailyStats({ correct: correct ? 1 : 0, wrong: correct ? 0 : 1 });
    if (!correct) navigator.vibrate?.(150);
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

  // Dolosowanie nowych słów, gdy pula skończyła się przed czasem —
  // najpierw z pominięciem słów już zaliczonych w tej sesji.
  async function drawMore() {
    const doneIds = new Set(pool.map((e) => e.word.id));
    let extra = await buildSessionPool(maxLesson, 25, doneIds);
    if (!extra.length) extra = await buildSessionPool(maxLesson, 25);
    if (!extra.length) return finish(pool);
    const merged = [...pool, ...extra.filter((e) => !doneIds.has(e.word.id))];
    if (merged.length === pool.length) return finish(pool);
    setPool(merged);
    await makeTask(merged);
  }

  async function finish(currentPool) {
    if (!finishedRef.current) {
      finishedRef.current = true;
      await bumpDailyStats({ finishedSession: true, seconds: activeSecondsRef.current });
    }
    setPhase('done');
    onFinished?.(currentPool || pool);
  }

  if (!pool || (!task && phase !== 'done' && phase !== 'more')) {
    return <div className="screen center">Ładowanie sesji…</div>;
  }

  if (phase === 'done') {
    return (
      <div className="screen center session-summary">
        <h2>Sesja zakończona 🎉</h2>
        <p className="big-num">
          <span className="num-ok">{counts.correct}</span> &nbsp; <span className="num-bad">{counts.wrong}</span>
        </p>
        <p>Zaliczone w tej sesji słowa: {counts.done}</p>
        <button className="btn primary" onClick={onExit}>Wróć do kursu</button>
      </div>
    );
  }

  if (phase === 'more') {
    const minsLeft = Math.floor(remaining / 60);
    const secsLeft = String(remaining % 60).padStart(2, '0');
    return (
      <div className="screen center session-summary">
        <h2>Pula słów ukończona 💪</h2>
        <p>Do końca sesji zostało {minsLeft}:{secsLeft}.</p>
        <p>Dolosować kolejne słowa i kontynuować naukę?</p>
        <button className="btn primary" onClick={drawMore}>Dolosuj słowa</button>
        <button className="btn" onClick={() => finish(pool)}>Zakończ sesję</button>
      </div>
    );
  }

  const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
  const secs = String(remaining % 60).padStart(2, '0');
  const w = task.entry.word;
  const display = task.isNoun ? (article ? article + ' ' + typed : typed) : typed;

  const donePct = Math.round((counts.done / pool.length) * 100) || 0;

  return (
    <div className="screen session">
      <div className="session-top">
        <button className="btn ghost" onClick={() => finish(pool)} aria-label="Zakończ sesję">
          <Icon name="close" />
        </button>
        <span className="timer">{mins}:{secs}</span>
        <button
          className="btn ghost"
          title={tts ? 'Wycisz czytanie na głos' : 'Włącz czytanie na głos'}
          onClick={toggleTts}
        >
          <Icon name={tts ? 'soundOn' : 'soundOff'} />
        </button>
      </div>

      <div className="session-progress" title={`Zaliczone słowa: ${counts.done}/${pool.length}`}>
        <div className="session-progress-fill" style={{ width: donePct + '%' }} />
      </div>

      <div className="prompt-wrap">
        <div className="prompt">
          <div className="level-dots" title={`Poziom słowa: ${task.entry.progress.level}/6`}>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={'level-dot' + (i < task.entry.progress.level ? ' on' : '')} />
            ))}
          </div>
          <div className="prompt-word">
            <span className="pl-word">{w.pl}</span>
          </div>
          <Cloze parsed={task.parsed} revealed={phase === 'feedback'} userText={display} />
        </div>
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
            articles={task.articles}
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
