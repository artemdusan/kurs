import React, { useEffect, useRef, useState } from 'react';
import { saveSettings, setMeta } from '../db.js';
import { buildSessionPool, buildMistakesPool, pickNext, recordAnswer, bumpDailyStats, requiredStreak, lessonFloorReached, clearMistake } from '../engine/session.js';
import { ensureLessonImported } from '../course.js';
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

export default function Session({ settings, maxLesson, index, mode = 'normal', onExit, onFinished, onSettingsChange }) {
  const [pool, setPool] = useState(null);
  const [tts, setTts] = useState(settings.tts);
  const [task, setTask] = useState(null);
  const [typed, setTyped] = useState('');
  const [article, setArticle] = useState('');
  const [phase, setPhase] = useState('answer'); // 'answer' | 'feedback' | 'done'
  const [wasCorrect, setWasCorrect] = useState(false);
  const [counts, setCounts] = useState({ correct: 0, wrong: 0, done: 0 });
  const [remaining, setRemaining] = useState(settings.sessionMinutes * 60);
  const [toast, setToast] = useState('');
  const unlockedToastedRef = useRef(new Set());
  // powtórka błędów: bez limitu czasu — trwa, dopóki starczy słów w puli
  const endAtRef = useRef(mode === 'mistakes' ? Infinity : Date.now() + settings.sessionMinutes * 60 * 1000);
  // sekundy nauki liczone tylko, gdy karta jest widoczna — apka w tle (albo
  // ekran zablokowany) nie ma wliczać się do czasu nauki w statystykach
  const activeSecondsRef = useRef(0);
  const finishedRef = useRef(false);
  const prevWordRef = useRef(null);
  const poolRef = useRef(null);
  const phaseRef = useRef(phase);
  // dzień rozpoczęcia sesji — służy do przypisania statystyk (sekund, ukończenia)
  // do właściwego dnia, nawet gdy sesja przeciągnie się po północy
  const sessionDayRef = useRef(new Date().toISOString().slice(0, 10));
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
      // liczy się tylko czas z kartą widoczną na pierwszym planie
      if (document.visibilityState !== 'hidden') activeSecondsRef.current++;
      if (mode !== 'mistakes') {
        setRemaining(Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000)));
      }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // czas minął — zakończ sesję, ale pozwól dokończyć bieżące pytanie
  // (gdy użytkownik właśnie wpisuje odpowiedź, sesja kończy się po jej sprawdzeniu)
  useEffect(() => {
    if (mode === 'mistakes') return;
    if (remaining === 0 && phase !== 'done' && phase !== 'answer') finish(pool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, phase]);

  // wracając z tła sprawdź od razu, czy limit czasu minął — przeglądarka
  // wstrzymuje/spowalnia interwały w ukrytej karcie, więc kolejny tick mógłby
  // przyjść z dużym opóźnieniem. Nie przerywaj trwającego pytania.
  useEffect(() => {
    function onVisibilityChange() {
      if (
        document.visibilityState === 'visible' &&
        Date.now() >= endAtRef.current &&
        phaseRef.current !== 'done' &&
        phaseRef.current !== 'answer'
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
    if (!entry) {
      // powtórka błędów: pula skończona = koniec sesji (bez dolosowywania obcych słów)
      if (mode === 'mistakes') return finish(currentPool);
      // tryb zwykły: pula wyczerpana, ale czas jeszcze biegnie — dolosuj automatycznie
      return drawMore(currentPool);
    }
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
    // Tolerancja akcentów automatyczna: poziom ≤5 → tolerancja, >5 → perfekcyjnie
    const accentTolerance = task.entry.progress.level <= 5;
    const correct = checkAnswer(userAnswer, task.expected, {
      isNoun: task.isNoun,
      accentTolerance,
    });
    const updated = await recordAnswer(task.entry, correct);
    // powtórka błędów: słowo powtórzone poprawnie znika z puli do powtórki na stałe
    // (dopóki znów nie spadnie poziom), więc poza sesją nie trzeba go już powtarzać
    if (mode === 'mistakes' && correct && updated.sessionStreak >= requiredStreak(updated.progress)) {
      await clearMistake(updated.word.id);
    }
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

    // sprawdź, czy odblokowała się kolejna lekcja (wszystkie słowa 1..maxLesson na floorLevel)
    checkLessonUnlock();

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
  async function drawMore(currentPool) {
    const p = currentPool || poolRef.current;
    const doneIds = new Set(p.map((e) => e.word.id));
    let extra = await buildSessionPool(maxLesson, 25, doneIds);
    if (!extra.length) extra = await buildSessionPool(maxLesson, 25);
    if (!extra.length) return finish(p);
    const merged = [...p, ...extra.filter((e) => !doneIds.has(e.word.id))];
    if (merged.length === p.length) return finish(p);
    setPool(merged);
    await makeTask(merged);
  }

  // Sprawdza, czy wszystkie słowa z lekcji 1..maxLesson osiągnęły floorLevel —
  // jeśli tak, kolejna lekcja właśnie się odblokowała (toast raz na odblokowanie).
  // Odblokowanie jest NATYCHMIAST utrwalane w meta — nawet jeśli później w tej
  // samej sesji jakieś słowo spadnie poniżej progu, lekcja pozostaje dostępna.
  async function checkLessonUnlock() {
    if (!index) return;
    const nextLesson = maxLesson + 1;
    if (nextLesson > (index.lekcje?.length || 0)) return;
    if (unlockedToastedRef.current.has(nextLesson)) return;
    const reached = await lessonFloorReached(maxLesson, settings.floorLevel);
    if (reached) {
      unlockedToastedRef.current.add(nextLesson);
      await setMeta('unlockedLesson', nextLesson);
      await ensureLessonImported(nextLesson);
      const next = index.lekcje.find((l) => l.numer === nextLesson);
      setToast(`🎉 Odblokowano lekcję ${nextLesson}: ${next?.temat || ''}`);
      setTimeout(() => setToast(''), 5000);
    }
  }

  async function finish(currentPool) {
    if (!finishedRef.current) {
      finishedRef.current = true;
      // Przypisz sekundy i ukończenie sesji do dnia, w którym sesja się zaczęła —
      // dzięki temu sesja przeciągnięta po północy nie fałszuje dzisiejszych statystyk.
      await bumpDailyStats({ finishedSession: true, seconds: activeSecondsRef.current, dayOverride: sessionDayRef.current });
    }
    setPhase('done');
    onFinished?.(currentPool || pool);
  }

  if (!pool || (!task && phase !== 'done')) {
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

  const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
  const secs = String(remaining % 60).padStart(2, '0');
  const w = task.entry.word;
  const display = task.isNoun ? (article ? article + ' ' + typed : typed) : typed;

  // pasek postępu pokazuje upływ czasu sesji; powtórka błędów nie ma limitu
  // czasu, więc tam pokazuje odsetek zaliczonych słów z puli
  const totalSeconds = settings.sessionMinutes * 60;
  const progressPct =
    mode === 'mistakes'
      ? Math.round((counts.done / pool.length) * 100) || 0
      : Math.min(100, Math.round(((totalSeconds - remaining) / totalSeconds) * 100));
  const progressTitle =
    mode === 'mistakes'
      ? `Zaliczone słowa: ${counts.done}/${pool.length}`
      : `Upływ czasu sesji — pozostało ${mins}:${secs}`;

  return (
    <div className="screen session">
      <div className="session-top">
        <button className="btn ghost" onClick={() => finish(pool)} aria-label="Zakończ sesję">
          <Icon name="close" />
        </button>
        {mode === 'mistakes' ? (
          <span className="timer" title="Powtórka bez limitu czasu"><Icon name="repeat" size={16} /></span>
        ) : (
          <span className="timer">{mins}:{secs}</span>
        )}
        <button
          className="btn ghost"
          title={tts ? 'Wycisz czytanie na głos' : 'Włącz czytanie na głos'}
          onClick={toggleTts}
        >
          <Icon name={tts ? 'soundOn' : 'soundOff'} />
        </button>
      </div>

      <div className="session-progress" title={progressTitle}>
        <div className="session-progress-fill" style={{ width: progressPct + '%' }} />
      </div>

      <div className="prompt-wrap">
        <div className="prompt">
          <div className="level-dots" title={`Poziom słowa: ${task.entry.progress.level}`}>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={'level-dot' + (i < task.entry.progress.level ? ' on dot-' + (i + 1) : '')} />
            ))}
          </div>
          <div className="prompt-word">
            <span className="pl-word">{w.pl}</span>
          </div>
          <Cloze parsed={task.parsed} revealed={phase === 'feedback'} userText={display} correct={wasCorrect} />
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
