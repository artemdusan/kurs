import React, { useEffect, useRef, useState } from 'react';
import { setUnlockedLesson } from '../db.js';
import { ensureLessonImported } from '../course.js';
import { addActivity } from '../activity.js';
import { loadDeck, heartStock, takeBossHeart, jokerStock, takeJoker } from '../engine/insights.js';
import { bossFor, buildBossQuestions, finisherWords, applyHit, applyMiss, isDefeated, fiftyFifty, BOSS_HEARTS, CRIT_SHARE } from '../engine/boss.js';
import { checkAnswer, splitArticle } from '../engine/answer.js';
import { buildKeyboard, articleButtons } from '../engine/keyboard.js';
import Keyboard from './Keyboard.jsx';
import BossSprite from './BossSprite.jsx';
import Icon from './Icon.jsx';
import { burst, floatText, rain, centerOf, COLORS } from '../particles.js';
import { sfx } from '../sound.js';

// Walka z bossem (zasady: engine/boss.js). Nie zmienia poziomów kart — to
// sprawdzian i nagroda, nie powtórka — ale liczy się do dnia nauki, a wygrana
// otwiera kolejną lekcję.

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

export default function Boss({ maxLesson, index, settings, onExit }) {
  const lesson = useRef(maxLesson + 1).current; // lekcja, o którą toczy się walka
  const boss = useRef(bossFor(lesson)).current;
  const [phase, setPhase] = useState('load'); // load | empty | intro | fight | reveal | finisher | won | lost
  const [state, setState] = useState({ hp: boss.hp, hearts: BOSS_HEARTS, shield: Boolean(boss.shield) });
  const [q, setQ] = useState(null);
  const [picked, setPicked] = useState(null); // wybrana opcja (albo '' po upływie czasu)
  const [fx, setFx] = useState('');
  const [note, setNote] = useState('');
  const [fin, setFin] = useState(null); // cios kończący: { word, expected, isNoun, keyboard, articles }
  const [typed, setTyped] = useState('');
  const [article, setArticle] = useState('');
  const [finWrong, setFinWrong] = useState(false);
  const [maxHearts, setMaxHearts] = useState(BOSS_HEARTS); // z dodatkowym sercem za poziom gracza
  const [spare, setSpare] = useState(0); // zapas dodatkowych serc
  const [jokers, setJokers] = useState(0); // zapas jokerów 50/50
  const [jokerUsed, setJokerUsed] = useState(false); // joker działa raz na walkę
  const [removed, setRemoved] = useState([]); // opcje zdjęte jokerem w bieżącym pytaniu
  const ref = useRef({ state, questions: [], pos: 0, finishers: [], finPos: 0, startedAt: 0, timer: 0, locked: false, alive: true });
  const statsRef = useRef({ hits: 0, mistakes: 0, seconds: 0, saved: false });
  const r = ref.current;

  const later = (fn, ms) => setTimeout(() => { if (r.alive) fn(); }, ms);
  const put = (next) => { r.state = next; setState(next); };
  const animate = (name) => { setFx(''); requestAnimationFrame(() => setFx(name)); };

  async function save(extra = {}) {
    const s = statsRef.current;
    if (s.saved) return;
    s.saved = true;
    if (s.hits + s.mistakes + s.seconds > 0) {
      await addActivity({ correct: s.hits, wrong: s.mistakes, seconds: s.seconds, ...extra }).catch(() => {});
    }
  }

  async function prepare() {
    const deck = await loadDeck(maxLesson);
    r.questions = await buildBossQuestions(deck, maxLesson, boss);
    r.finishers = finisherWords(deck, maxLesson);
    r.pos = 0; r.finPos = 0;
    if (r.alive) { setSpare(await heartStock()); setJokers(await jokerStock()); }
    return r.questions.length >= 4 && r.finishers.length > 0;
  }

  useEffect(() => {
    r.alive = true;
    prepare().then((ok) => { if (r.alive) setPhase(ok ? 'intro' : 'empty'); });
    const clock = setInterval(() => {
      if (document.visibilityState !== 'hidden' && !statsRef.current.saved) statsRef.current.seconds++;
    }, 1000);
    return () => { r.alive = false; clearTimeout(r.timer); clearInterval(clock); save(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function nextQuestion() {
    const next = r.questions[r.pos % r.questions.length];
    r.pos++;
    r.locked = false;
    r.startedAt = Date.now();
    setQ(next); setPicked(null); setNote(''); setRemoved([]);
    setPhase('fight');
    clearTimeout(r.timer);
    r.timer = later(() => answer(''), boss.time * 1000);
  }

  async function startFight() {
    statsRef.current = { hits: 0, mistakes: 0, seconds: 0, saved: false };
    // dodatkowe serce czeka w zapasie i zużywa się dopiero wtedy, gdy uratuje walkę
    const total = BOSS_HEARTS + ((await heartStock()) > 0 ? 1 : 0);
    setMaxHearts(total);
    setJokerUsed(false);
    put({ hp: boss.hp, hearts: total, shield: Boolean(boss.shield) });
    setFx('');
    nextQuestion();
  }

  // serc bazowych nie ma, więc każdy przeżyty błąd zużył serce za poziom gracza
  function spendHeart(next) {
    if (!isDefeated(next)) takeBossHeart().then(() => heartStock()).then((n) => { if (r.alive) setSpare(n); });
  }

  async function useJoker() {
    if (r.locked || jokerUsed || jokers <= 0 || !q) return;
    const gone = fiftyFifty(q.options, q.answer);
    if (!gone.length) return;
    setJokerUsed(true);
    setRemoved(gone);
    sfx.levelUp();
    if (await takeJoker()) setJokers((n) => Math.max(0, n - 1));
  }

  async function rematch() {
    setPhase('load');
    await prepare();
    if (r.alive) await startFight();
  }

  function openFinisher() {
    const word = r.finishers[r.finPos % r.finishers.length];
    r.finPos++;
    const isNoun = word.type === 'noun';
    setFin({ word, expected: word.es, isNoun, keyboard: buildKeyboard(word.es, { isNoun }), articles: isNoun ? articleButtons(splitArticle(word.es).article) : [] });
    setTyped(''); setArticle(''); setFinWrong(false);
    r.locked = false;
    setPhase('finisher');
  }

  function answer(option) {
    if (r.locked) return;
    r.locked = true;
    clearTimeout(r.timer);
    const current = r.questions[(r.pos - 1) % r.questions.length];
    const ok = option === current.answer;
    const at = centerOf('.boss-stage .boss-sprite');
    setPicked(option);
    setPhase('reveal');
    if (ok) {
      const fast = Date.now() - r.startedAt <= boss.time * 1000 * CRIT_SHARE;
      const next = applyHit(r.state, boss, fast);
      put(next);
      statsRef.current.hits++;
      animate('hit');
      if (next.broke) { setNote('Tarcza pękła!'); sfx.levelUp(); burst(at, { colors: COLORS.blue, power: 1.2 }); }
      else {
        setNote(next.crit ? 'Cios krytyczny!' : '');
        burst(at, { colors: next.crit ? COLORS.gold : COLORS.ok, power: next.crit ? 2 : 1.1 });
        floatText({ x: at.x, y: at.y - 50 }, `−${next.damage}`, { color: next.crit ? '#ffd23f' : '#ffffff', size: next.crit ? 20 : 15 });
        (next.crit ? sfx.gold : sfx.levelUp)();
      }
      speak(current.es, settings?.tts);
      later(() => (r.state.hp <= 0 ? openFinisher() : nextQuestion()), 650);
    } else {
      const next = applyMiss(r.state, boss);
      put(next);
      statsRef.current.mistakes++;
      animate('attack');
      setNote(option === '' ? 'Za wolno!' : next.healed ? 'Wampir się leczy!' : boss.shield ? 'Tarcza wróciła!' : '');
      navigator.vibrate?.(150);
      burst(centerOf('.hearts'), { colors: COLORS.bad, power: 0.8 });
      sfx.wrong();
      spendHeart(next);
      later(() => (isDefeated(next) ? lose() : nextQuestion()), 1500);
    }
  }

  function strike() {
    if (r.locked) return;
    r.locked = true;
    const display = fin.isNoun ? (article ? article + ' ' + typed : typed) : typed;
    const ok = checkAnswer(display, fin.expected, { isNoun: fin.isNoun, accentTolerance: true });
    if (ok) {
      statsRef.current.hits++;
      speak(fin.expected, settings?.tts);
      win();
    } else {
      // boss się otrząsa: wraca z 1 punktem życia, a gracz traci serce
      const next = { ...applyMiss(r.state, { ...boss, heals: false }), hp: 1 };
      put(next);
      statsRef.current.mistakes++;
      setFinWrong(true);
      animate('attack');
      navigator.vibrate?.(150);
      sfx.wrong();
      spendHeart(next);
      later(() => (isDefeated(next) ? lose() : nextQuestion()), 2200);
    }
  }

  async function win() {
    setPhase('won');
    rain({ seconds: 2.5 });
    sfx.fanfare();
    if (index && lesson <= (index.lekcje?.length || 0)) {
      await setUnlockedLesson(lesson);
      await ensureLessonImported(lesson);
    }
    await save({ sessions: 1 }); // wygrana liczy się jak ukończona sesja (XP)
  }

  async function lose() {
    setPhase('lost');
    await save();
  }

  if (phase === 'load') return <div className="screen center">Boss nadchodzi…</div>;

  if (phase === 'empty') {
    return (
      <div className="screen center">
        <p>Za mało słów na walkę — najpierw zrób sesję.</p>
        <button className="btn primary" onClick={() => onExit()}>Wróć do kursu</button>
      </div>
    );
  }

  const title = `${boss.name} · strażnik lekcji ${lesson}`.replace('Strażnik · strażnik', 'Strażnik');

  if (phase === 'intro') {
    return (
      <div className="screen boss-screen boss-intro">
        <div className="session-top">
          <button className="btn ghost" onClick={() => onExit()} aria-label="Wróć"><Icon name="back" /></button>
          <span />
          <span />
        </div>
        <div className="boss-intro-body">
          <BossSprite kind={boss.key} seed={lesson} size={160} className="boss-idle" />
          <h2>{boss.name}</h2>
          <p className="boss-sub">strażnik lekcji {lesson}</p>
          <p className="boss-trait">{boss.trait}</p>
          <ul className="boss-rules">
            <li><Icon name="bolt" size={16} /><span>Odpowiedz, zanim pasek ataku się zapełni. Szybka odpowiedź to cios krytyczny.</span></li>
            <li><Icon name="heart" size={16} /><span>{spare ? 'Masz serce za rangę: uratuje cię przy pierwszym błędzie i dopiero wtedy się zużyje. Kolejny błąd kończy walkę.' : 'Bez serc: pierwszy błąd albo spóźnienie kończy walkę. Serce daje każda nowa ranga.'}</span></li>
            <li><Icon name="joker" size={16} /><span>{jokers ? `Joker 50/50: raz na walkę usuwa złe odpowiedzi, zostają dwie. Masz ${jokers}.` : 'Jokery 50/50 dają kolejne poziomy gracza.'}</span></li>
            <li><Icon name="star" size={16} /><span>Na koniec cios kończący: wpisz słowo z lekcji.</span></li>
          </ul>
        </div>
        <div className="home-bottom">
          <button className="btn primary big boss-cta" onClick={startFight}><Icon name="play" size={14} /> Walcz!</button>
        </div>
      </div>
    );
  }

  if (phase === 'won' || phase === 'lost') {
    const s = statsRef.current;
    const won = phase === 'won';
    const next = index?.lekcje.find((l) => l.numer === lesson);
    return (
      <div className="screen boss-screen center boss-end">
        <BossSprite kind={boss.key} seed={lesson} size={128} className={won ? 'boss-final defeated' : 'boss-final gloat'} />
        <h2>{won ? 'Boss pokonany!' : `${boss.name} wygrywa tę rundę`}</h2>
        <p className={'boss-verdict' + (won ? ' won' : '')}>
          {won ? `Lekcja ${lesson} otwarta: ${next?.temat || ''}` : state.hp <= 1 ? 'Zabrakło ciosu kończącego.' : `Zostało mu ${state.hp} z ${boss.hp} punktów życia.`}
        </p>
        <p className="hint">Trafienia: {s.hits} · błędy: {s.mistakes}{won && state.hearts === maxHearts ? ' · bezbłędnie!' : ''}</p>
        {won ? (
          <button className="btn primary big" onClick={() => onExit()}>Otwórz lekcję {lesson}</button>
        ) : (
          <>
            <button className="btn primary big" onClick={rematch}><Icon name="repeat" size={14} /> Rewanż</button>
            <button className="btn" onClick={() => onExit()}>Wróć do kursu</button>
          </>
        )}
      </div>
    );
  }

  const finisher = phase === 'finisher';
  const display = fin && fin.isNoun ? (article ? article + ' ' + typed : typed) : typed;

  return (
    <div className="screen boss-screen">
      <div className="session-top">
        <button className="btn ghost" onClick={async () => { await save(); onExit(); }} aria-label="Zakończ walkę">
          <Icon name="close" />
        </button>
        <span className="hearts" aria-label={`Dodatkowe serca: ${Math.max(0, state.hearts)} z ${maxHearts}`}>
          {Array.from({ length: maxHearts }, (_, i) => (
            <span key={i} className={'heart' + (i < state.hearts ? '' : ' lost')}><Icon name="heart" size={20} /></span>
          ))}
        </span>
        {!finisher && jokers > 0 && !jokerUsed ? (
          <button
            className="btn ghost boss-joker"
            onClick={useJoker}
            disabled={phase !== 'fight' || !q || q.options.length <= 2}
            aria-label={`Joker 50/50, zapas ${jokers}`}
            title="Joker 50/50: usuwa złe odpowiedzi, zostają dwie"
          >
            50:50<small>×{jokers}</small>
          </button>
        ) : <span className="top-spacer" />}
      </div>

      <div className="boss-stage">
        <div className={'boss-figure' + (state.shield ? ' shielded' : '')}>
          <BossSprite kind={boss.key} seed={lesson} size={finisher ? 72 : 104} className={finisher && !finWrong ? 'boss-dizzy' : fx ? 'boss-' + fx : 'boss-idle'} />
        </div>
        <span className="boss-name">{title}</span>
        <div className="boss-hp" aria-label={`Życie bossa: ${state.hp} z ${boss.hp}`}>
          {Array.from({ length: boss.hp }, (_, i) => <span key={i} className={'boss-hp-seg' + (i < state.hp ? ' on' : '')} />)}
        </div>
        {!finisher && (
          <div className="boss-charge" aria-hidden="true">
            <div className={'boss-charge-fill' + (phase === 'fight' ? ' run' : '')} key={r.pos} style={{ animationDuration: boss.time + 's' }} />
          </div>
        )}
        <span className={'boss-note' + (note ? ' on' : '')} key={note + r.pos}>{note || (finisher ? 'ogłuszony!' : state.shield ? 'tarcza: pierwsza dobra odpowiedź ją rozbije' : ' ')}</span>
      </div>

      {!finisher && q && (
        <>
          <div className="boss-question">
            <span className="boss-hint">{q.hint}</span>
            <span className="pl-word">{q.prompt}</span>
            {q.sub && <span className="sprint-pl">{q.sub}</span>}
          </div>
          <div className={'boss-options kind-' + q.kind + (q.options.length === 3 ? ' three' : '')}>
            {q.options.map((opt) => {
              const gone = removed.includes(opt);
              const cls = phase === 'reveal' ? (opt === q.answer ? ' right' : opt === picked ? ' wrong' : ' dim') : gone ? ' gone' : '';
              return (
                <button key={opt} className={'btn boss-option' + cls} disabled={phase !== 'fight' || gone} onClick={() => answer(opt)}>{opt}</button>
              );
            })}
          </div>
        </>
      )}

      {finisher && fin && (
        <>
          <div className={'boss-question finisher' + (finWrong ? ' bad' : '')}>
            <span className="boss-hint">{finWrong ? 'Boss się otrząsnął! Poprawnie:' : 'Cios kończący — wpisz po hiszpańsku'}</span>
            <span className="pl-word">{fin.word.pl}</span>
            {finWrong && <span className="boss-answer">{fin.expected}</span>}
          </div>
          {!finWrong && (
            <>
              <div className="typed-preview">{display || ' '}</div>
              <Keyboard
                layout={fin.keyboard}
                isNoun={fin.isNoun}
                articles={fin.articles}
                article={article}
                onArticle={(a) => setArticle(a === article ? '' : a)}
                onKey={(ch) => setTyped((t) => t + ch)}
                onBackspace={() => setTyped((t) => t.slice(0, -1))}
              />
              <button className="btn primary check boss-cta" disabled={!typed && !article} onClick={strike}>Zadaj cios</button>
            </>
          )}
        </>
      )}
    </div>
  );
}
