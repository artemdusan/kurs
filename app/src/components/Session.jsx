import React, { useEffect, useRef, useState } from 'react';
import { saveSettings, setUnlockedLesson } from '../db.js';
import { buildSessionPool, buildMistakesPool, buildHardPool, pickNext, recordAnswer, requiredStreak, SESSION_POOL_SIZE } from '../engine/session.js';
import { ensureLessonImported } from '../course.js';
import { addActivity } from '../activity.js';
import { localDay } from '../../../shared/learning.js';
import { checkAnswer, splitArticle, diffAnswer } from '../engine/answer.js';
import { buildKeyboard, articleButtons } from '../engine/keyboard.js';
import { buildMcqOptions } from '../engine/mcq.js';
import Keyboard from './Keyboard.jsx';
import Cloze, { parseExample } from './Cloze.jsx';
import Icon from './Icon.jsx';
import LevelDots from './LevelDots.jsx';
import BossSprite from './BossSprite.jsx';
import { burst, floatText, rain, centerOf, COLORS } from '../particles.js';
import { sfx } from '../sound.js';

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

// Tryby: 'normal' (pełna sesja na czas), 'quick' (2 minuty, niski próg wejścia),
// 'mistakes' (powtórka dzisiejszych spadków) i 'hard' (trudne słowa) — obie bez limitu czasu,
// oraz 'boss': walka o kolejną lekcję. Dobra odpowiedź zabiera bossowi punkt życia,
// błąd zabiera serce. Wygrana otwiera lekcję; poziomy kart zmieniają się jak w zwykłej sesji.
export const BOSS_HP = 8;
export const BOSS_HEARTS = 3;
export const QUICK_MINUTES = 2;
// Zadania ze słuchu: dla kart od tego poziomu co czwarte pytanie jest dyktandem.
export const LISTEN_MIN_LEVEL = 4;
export const LISTEN_SHARE = 0.25;

export default function Session({ settings, maxLesson, index, mode = 'normal', onExit, onFinished, onSettingsChange }) {
  const sessionMinutes = mode === 'quick' ? QUICK_MINUTES : settings.sessionMinutes;
  const boss = mode === 'boss';
  const untimed = mode === 'mistakes' || mode === 'hard' || boss;
  const [bossHp, setBossHp] = useState(BOSS_HP);
  const [hearts, setHearts] = useState(BOSS_HEARTS);
  const [bossFx, setBossFx] = useState(''); // '' | 'hit' | 'attack' — animacja po odpowiedzi
  const [outcome, setOutcome] = useState(null); // wynik walki: 'won' | 'lost'
  const fightRef = useRef({ hp: BOSS_HP, hearts: BOSS_HEARTS });
  // lekcja, o którą toczy się walka — po wygranej maxLesson rośnie, a ekran ma dalej mówić o tej samej
  const bossLesson = useRef(maxLesson + 1).current;
  const [pool, setPool] = useState(null);
  const [tts, setTts] = useState(settings.tts);
  const [task, setTask] = useState(null);
  const [typed, setTyped] = useState('');
  const [article, setArticle] = useState('');
  const [phase, setPhase] = useState('answer'); // 'intro' | 'answer' | 'feedback' | 'done'
  const [userAnswer, setUserAnswer] = useState('');
  const [mistakes, setMistakes] = useState([]); // słowa z błędem w tej sesji (do podsumowania)
  const [advances, setAdvances] = useState(0);
  const [news, setNews] = useState([]); // kamienie milowe ogłaszane w podsumowaniu
  const introducedRef = useRef(new Set());
  const [streak, setStreak] = useState(0); // poprawne odpowiedzi z rzędu w tej sesji
  const listenOffRef = useRef(false); // „nie mogę teraz słuchać” wyłącza dyktanda do końca sesji
  const [wasCorrect, setWasCorrect] = useState(false);
  const [counts, setCounts] = useState({ correct: 0, wrong: 0, done: 0 });
  const [remaining, setRemaining] = useState(sessionMinutes * 60);
  const [toast, setToast] = useState('');
  // powtórka błędów: bez limitu czasu — trwa, dopóki starczy słów w puli
  const endAtRef = useRef(untimed ? Infinity : Date.now() + sessionMinutes * 60 * 1000);
  // sekundy nauki liczone tylko, gdy karta jest widoczna — apka w tle (albo
  // ekran zablokowany) nie ma wliczać się do czasu nauki w statystykach
  const timeSaveRef = useRef(Promise.resolve());
  const gradingRef = useRef(null);
  const answerLockedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const finishedRef = useRef(false);
  const introStartRef = useRef(0);
  const prevWordRef = useRef(null);
  const poolRef = useRef(null);
  // Ukończenie sesji przypisujemy do dnia rozpoczęcia; czas i odpowiedzi
  // zapisujemy na bieżąco w dniu ich wystąpienia.
  const sessionDayRef = useRef(localDay());
  poolRef.current = pool;
  const countsRef = useRef(counts);
  countsRef.current = counts;

  useEffect(() => {
    let cancelled = false;
    const build = mode === 'mistakes' ? buildMistakesPool : mode === 'hard' ? buildHardPool : buildSessionPool;
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
      if (!finishedRef.current && poolRef.current && document.visibilityState !== 'hidden') {
        const day = localDay();
        timeSaveRef.current = timeSaveRef.current.then(() => addActivity({ seconds: 1 }, day))
          .catch((e) => setToast(`Nie zapisano czasu nauki: ${e.message}`));
      }
      if (!untimed) {
        setRemaining(Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000)));
      }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Czas minął — nie kończymy sesji w trakcie pytania ani w trakcie feedbacku.
  // Użytkownik zawsze ma dokończyć bieżące pytanie i zobaczyć, czy odpowiedział
  // dobrze czy źle. Sesja kończy się dopiero po kliknięciu „Dalej", bo makeTask()
  // sprawdza zegar (endAtRef) i wtedy woła finish(). Dzięki temu feedback dla
  // ostatniej odpowiedzi nie jest pomijany na rzecz podsumowania sesji.

  async function makeTask(currentPool) {
    if (Date.now() >= endAtRef.current) return finish(currentPool);
    if (boss && (fightRef.current.hp <= 0 || fightRef.current.hearts <= 0)) return finish(currentPool);
    const entry = pickNext(currentPool, prevWordRef.current);
    if (!entry) {
      // powtórka błędów: pula skończona = koniec sesji (bez dolosowywania obcych słów)
      if (untimed && !boss) return finish(currentPool);
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

    const p = entry.progress;
    const firstContact = !p.lastSeenAt && !(p.correctTotal || 0) && !(p.wrongTotal || 0);
    // Dyktando: lektor czyta słowo, a polska podpowiedź i zdanie są ukryte.
    const listen =
      answerMode === 'type' && !firstContact && p.level >= LISTEN_MIN_LEVEL &&
      settings.listening !== false && tts && !listenOffRef.current &&
      'speechSynthesis' in window && Math.random() < LISTEN_SHARE;

    answerLockedRef.current = false;
    setTask({
      entry,
      listen,
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
    setUserAnswer('');
    // Pierwszy kontakt ze słowem: najpierw je pokazujemy (słowo, zdanie, lektor),
    // dopiero potem pytamy. Formy odmiany zaczynają od wyboru z trzech opcji,
    // więc prezentacji nie potrzebują.
    if (firstContact && entry.word.type !== 'verb_form' && !introducedRef.current.has(entry.word.id)) {
      introducedRef.current.add(entry.word.id);
      // prezentacja nie zużywa czasu sesji — to nauka, nie odpytywanie
      introStartRef.current = Date.now();
      setPhase('intro');
      speak(expected, tts);
    } else {
      setPhase('answer');
      if (listen) speak(expected, true);
    }
  }

  function skipListening() {
    listenOffRef.current = true;
    window.speechSynthesis?.cancel();
    setTask((t) => ({ ...t, listen: false }));
  }

  function closeIntro() {
    if (endAtRef.current !== Infinity) endAtRef.current += Date.now() - introStartRef.current;
    setPhase('answer');
  }

  async function grade(userAnswer) {
    if (answerLockedRef.current || finishedRef.current) return;
    answerLockedRef.current = true;
    setSubmitting(true);
    gradingRef.current = saveAnswer(userAnswer);
    try { await gradingRef.current; }
    catch (e) { answerLockedRef.current = false; setToast(`Nie zapisano odpowiedzi: ${e.message}`); }
    finally { gradingRef.current = null; setSubmitting(false); }
  }

  async function saveAnswer(userAnswer) {
    // Tolerancja akcentów automatyczna: poziom ≤5 → tolerancja, >5 → perfekcyjnie
    const accentTolerance = task.entry.progress.level <= 5;
    const correct = checkAnswer(userAnswer, task.expected, {
      isNoun: task.isNoun,
      accentTolerance,
    });
    const levelBefore = task.entry.progress.level;
    const updated = await recordAnswer(task.entry, correct, { clearMistake: mode === 'mistakes' });
    setUserAnswer(userAnswer);
    const advanced = updated.progress.level > levelBefore;
    if (advanced) setAdvances((n) => n + 1);
    // cząsteczki: mały wybuch za dobrą odpowiedź, większy za awans, złoty od poziomu 6
    const at = centerOf(task.listen ? '.typed-preview' : '.cloze-gap');
    if (boss) {
      const f = fightRef.current;
      if (correct) { f.hp -= 1; setBossHp(f.hp); } else { f.hearts -= 1; setHearts(f.hearts); }
      setBossFx('');
      requestAnimationFrame(() => setBossFx(correct ? 'hit' : 'attack'));
    }
    const nextStreak = correct ? streak + 1 : 0;
    setStreak(nextStreak);
    if (correct) {
      const gold = updated.progress.level >= 6;
      const heat = Math.min(1, nextStreak / 10); // seria podkręca efekty
      burst(at, { colors: gold ? COLORS.gold : COLORS.ok, power: (advanced ? (gold ? 2.2 : 1.6) : 0.8) + heat });
      if (advanced) (gold ? sfx.gold : sfx.levelUp)(); else sfx.correct(nextStreak);
      if (nextStreak >= 5 && nextStreak % 5 === 0) floatText({ x: window.innerWidth / 2, y: at.y - 60 }, `seria ×${nextStreak}`, { color: '#ffd23f', size: 16 });
      if (advanced) floatText({ x: at.x, y: at.y - 18 }, `poz. ${updated.progress.level}`, { color: gold ? '#ffd23f' : '#3fb950', size: 12 });
    } else {
      burst(at, { colors: COLORS.bad, power: 0.5 });
      sfx.wrong();
    }
    if (!correct) {
      setMistakes((list) => (list.some((m) => m.id === task.entry.word.id)
        ? list
        : [...list, { id: task.entry.word.id, es: task.expected, pl: task.entry.word.pl }]));
    }
    const newPool = pool.map((e) => (e.word.id === updated.word.id ? updated : e));
    setPool(newPool);
    setWasCorrect(correct);
    setCounts((c) => ({
      correct: c.correct + (correct ? 1 : 0),
      wrong: c.wrong + (correct ? 0 : 1),
      done: newPool.filter((e) => e.sessionStreak >= requiredStreak()).length,
    }));
    if (!correct) navigator.vibrate?.(150);

    // po odpowiedzi lektor czyta całe zdanie — słowo słychać w kontekście
    speak(task.parsed.before + task.expected + task.parsed.after, tts);
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
    let extra = await buildSessionPool(maxLesson, SESSION_POOL_SIZE, doneIds);
    if (!extra.length) extra = await buildSessionPool(maxLesson, SESSION_POOL_SIZE);
    if (!extra.length) return finish(p);
    const merged = [...p, ...extra.filter((e) => !doneIds.has(e.word.id))];
    if (merged.length === p.length) return finish(p);
    setPool(merged);
    await makeTask(merged);
  }

  async function finish(currentPool) {
    // Strażnik musi obejmować całą funkcję (łącznie z onFinished) — inaczej
    // podwójne wywołanie finish() (np. przez podwójne dotknięcie przycisku
    // „Zakończ sesję" na ekranie dotykowym) wywoła onFinished dwa razy: za
    // drugim razem natychmiast, jeszcze zanim pierwsze wywołanie zdąży
    // zapisać unlockedLesson — App.jsx odczyta wtedy starą wartość, sam
    // wykona to samo odblokowanie i pokaże duplikat komunikatu.
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (gradingRef.current) await gradingRef.current.catch(() => {});
    await timeSaveRef.current;

    // Sekundy są już zapisane; tutaj zapisujemy jedynie ukończenie sesji.
    await addActivity({ sessions: 1 }, sessionDayRef.current);

    // Kolejną lekcję otwiera wygrana z bossem. Walka jest dostępna dopiero, gdy
    // wszystkie karty mają wymagany poziom, więc sama wygrana wystarcza —
    // potknięcie w trakcie walki nie odbiera nagrody.
    const nextLesson = bossLesson;
    let unlockedNow = false;
    if (boss) {
      const won = fightRef.current.hp <= 0;
      setOutcome(won ? 'won' : 'lost');
      if (won && index && nextLesson <= (index.lekcje?.length || 0)) {
        await setUnlockedLesson(nextLesson);
        unlockedNow = true;
        await ensureLessonImported(nextLesson);
      }
    }
    setPhase('done');
    const found = await onFinished?.(poolRef.current || currentPool || pool);
    if (Array.isArray(found)) setNews(found);
    // duże chwile: nowa lekcja, kamień milowy albo sesja bez błędu
    const unlocked = unlockedNow;
    if (unlocked || (Array.isArray(found) && found.length)) { rain({ seconds: 2 }); sfx.fanfare(); }
    else if (countsRef.current.correct > 0 && countsRef.current.wrong === 0) rain({ colors: COLORS.ok, seconds: 1, density: 45 });
  }

  if (!pool || (!task && phase !== 'done')) {
    return <div className="screen center">Ładowanie sesji…</div>;
  }

  if (phase === 'done') {
    const answered = counts.correct + counts.wrong;
    const accuracy = answered ? Math.round((counts.correct / answered) * 100) : 0;
    return (
      <div className="screen session-summary">
        {boss && <BossSprite seed={bossLesson} size={96} className={'boss-final ' + (outcome === 'won' ? 'defeated' : 'gloat')} />}
        <h2>{boss ? (outcome === 'won' ? 'Boss pokonany!' : 'Boss wygrał tę rundę') : mode === 'quick' ? 'Szybka sesja zaliczona' : 'Sesja zakończona'}</h2>
        {boss && (
          <p className={'boss-verdict' + (outcome === 'won' ? ' won' : '')}>
            {outcome === 'won'
              ? `Lekcja ${bossLesson} otwarta: ${index?.lekcje.find((l) => l.numer === bossLesson)?.temat || ''}`
              : `Zabrakło ${fightRef.current.hp} ${fightRef.current.hp === 1 ? 'trafienia' : 'trafień'}. Odpowiedzi i tak zapisały się w kartach.`}
          </p>
        )}
        <div className="summary-grid">
          <div className="time-cell"><span className="time-num num-ok">{counts.correct}</span><span className="time-label">dobrze</span></div>
          <div className="time-cell"><span className="time-num num-bad">{counts.wrong}</span><span className="time-label">źle</span></div>
          <div className="time-cell"><span className="time-num">{accuracy}%</span><span className="time-label">skuteczność</span></div>
          <div className="time-cell"><span className="time-num"><Icon name="up" size={12} /> {advances}</span><span className="time-label">awansów</span></div>
        </div>
        {toast && <div className="toast">{toast}</div>}
        {news.map((label) => (
          <div className="milestone" key={label}><Icon name="star" size={14} /> {label}</div>
        ))}
        {mistakes.length > 0 ? (
          <div className="summary-mistakes">
            <h3>Do poprawki ({mistakes.length})</h3>
            <div className="summary-list">
              {mistakes.map((m) => (
                <div className="vocab-row" key={m.id}>
                  <span className="vocab-es">{m.es}</span>
                  <span className="vocab-pl">{m.pl}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          answered > 0 && <p className="summary-clean">Bez ani jednego błędu!</p>
        )}
        <div className="home-bottom">
          {boss && outcome === 'lost' ? (
            <button className="btn" onClick={() => onExit('boss')}>
              <Icon name="repeat" size={14} /> Rewanż
            </button>
          ) : (
            <button className="btn" onClick={() => onExit('pairs')}>
              <Icon name="pairs" size={14} /> Runda bonusowa: Pary
            </button>
          )}
          <button className="btn primary big" onClick={() => onExit()}>Wróć do kursu</button>
        </div>
      </div>
    );
  }

  const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
  const secs = String(remaining % 60).padStart(2, '0');
  const w = task.entry.word;
  const display = task.isNoun ? (article ? article + ' ' + typed : typed) : typed;

  // pasek postępu pokazuje upływ czasu sesji; powtórka błędów nie ma limitu
  // czasu, więc tam pokazuje odsetek zaliczonych słów z puli
  const totalSeconds = sessionMinutes * 60;
  const progressPct =
    untimed
      ? Math.round((counts.done / pool.length) * 100) || 0
      : Math.min(100, Math.round(((totalSeconds - remaining) / totalSeconds) * 100));
  const progressTitle =
    untimed
      ? `Zaliczone słowa: ${counts.done}/${pool.length}`
      : `Upływ czasu sesji — pozostało ${mins}:${secs}`;

  return (
    <div className="screen session">
      <div className="session-top">
        <button className="btn ghost" onClick={() => finish(pool)} aria-label="Zakończ sesję">
          <Icon name="close" />
        </button>
        {boss ? (
          <span className="hearts" aria-label={`Życia: ${hearts} z ${BOSS_HEARTS}`}>
            {Array.from({ length: BOSS_HEARTS }, (_, i) => (
              <span key={i} className={'heart' + (i < hearts ? '' : ' lost')}><Icon name="heart" size={20} /></span>
            ))}
          </span>
        ) : untimed ? (
          <span className="timer" title="Powtórka bez limitu czasu"><Icon name="repeat" size={16} /></span>
        ) : mode === 'quick' ? (
          <span className="timer"><Icon name="bolt" size={12} /> {mins}:{secs}</span>
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

      {boss ? (
        <div className="boss-row">
          <BossSprite seed={bossLesson} size={56} className={bossFx ? 'boss-' + bossFx : ''} />
          <div className="boss-info">
            <span className="boss-name">Strażnik lekcji {bossLesson}</span>
            <div className="boss-hp" aria-label={`Życie bossa: ${bossHp} z ${BOSS_HP}`}>
              {Array.from({ length: BOSS_HP }, (_, i) => <span key={i} className={'boss-hp-seg' + (i < bossHp ? ' on' : '')} />)}
            </div>
          </div>
        </div>
      ) : (
        <div className="session-progress" title={progressTitle}>
          <div className="session-progress-fill" style={{ width: progressPct + '%' }} />
        </div>
      )}

      <div className="prompt-wrap">
        <div className="prompt">
          <div className="prompt-head">
            {phase === 'intro' ? <span className="intro-badge">Nowe słowo</span> : <LevelDots level={task.entry.progress.level} />}
            {streak >= 2 && phase !== 'intro' && <span className={'streak-x' + (streak >= 5 ? ' hot' : '')} key={streak}>×{streak}</span>}
          </div>
          {task.listen && phase === 'answer' ? (
            <div className="listen">
              <button className="btn listen-btn" onClick={() => speak(task.expected, true)} aria-label="Posłuchaj jeszcze raz">
                <Icon name="soundOn" size={30} />
              </button>
              <p className="listen-hint">Wpisz, co słyszysz</p>
              <button className="listen-skip" onClick={skipListening}>nie mogę teraz słuchać</button>
            </div>
          ) : (
            <>
              <div className="prompt-word">
                <span className="pl-word">{w.pl}</span>
              </div>
              {phase === 'intro' && <div className="intro-es">{task.expected}</div>}
              <Cloze
                parsed={task.parsed}
                revealed={phase === 'feedback' || phase === 'intro'}
                userText={display}
                correct={phase === 'intro' ? true : wasCorrect}
              />
            </>
          )}
        </div>
      </div>

      {phase === 'answer' && task.mode === 'mcq' && (
        <div className="mcq">
          {task.mcqOptions.map((opt) => (
            <button key={opt} className="btn mcq-option" disabled={submitting} onClick={() => grade(opt)}>
              {opt}
            </button>
          ))}
        </div>
      )}

      {phase === 'answer' && task.mode === 'type' && (
        <>
          <div className="typed-preview">{display || ' '}</div>
          <Keyboard
            disabled={submitting}
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
            disabled={submitting || (!typed && !article)}
            onClick={() => grade(display)}
          >
            Sprawdź
          </button>
        </>
      )}

      {phase === 'intro' && (
        <div className="feedback intro">
          <p>Przeczytaj i zapamiętaj — zaraz o nie zapytam.</p>
          <div className="row gap">
            <button className="btn" onClick={() => speak(task.expected, true)} aria-label="Posłuchaj jeszcze raz">
              <Icon name="soundOn" size={16} />
            </button>
            <button className="btn primary intro-go" onClick={closeIntro}>Rozumiem</button>
          </div>
        </div>
      )}

      {phase === 'feedback' && (
        <div className={'feedback ' + (wasCorrect ? 'ok' : 'bad')}>
          <p>
            {wasCorrect ? 'Dobrze!' : 'Poprawna odpowiedź:'}{' '}
            <strong>{task.expected}</strong>
          </p>
          {!wasCorrect && userAnswer && (
            <p className="your-answer">
              Twoja:{' '}
              {diffAnswer(userAnswer, task.expected).map((c, i) => (
                <span key={i} className={c.ok ? '' : 'diff-bad'}>{c.ch}</span>
              ))}
            </p>
          )}
          <button className="btn primary" onClick={() => makeTask(pool)}>Dalej</button>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
