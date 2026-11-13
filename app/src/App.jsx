import React, { useEffect, useRef, useState } from 'react';
import { migrateLearningState, getDailyStats } from './activity.js';
import { localDay, currentStreak, FLOOR_LEVEL } from '../../shared/learning.js';
import { db, getMeta, getSettings } from './db.js';
import { loadIndex, ensureLessonImported } from './course.js';
import { getProgressMap, countRecentMistakes, dayStatus } from './engine/session.js';
import { syncNow, resolveSyncUrl } from './sync.js';
import Session from './components/Session.jsx';
import Settings from './components/Settings.jsx';
import Stats from './components/Stats.jsx';
import LessonPreview from './components/LessonPreview.jsx';
import LessonList from './components/LessonList.jsx';
import Pairs from './components/Pairs.jsx';
import Road from './components/Road.jsx';
import Boss from './components/Boss.jsx';
import HardWords from './components/HardWords.jsx';
import Welcome from './components/Welcome.jsx';
import {
  loadDeck, deckGoals, cardBuckets, claimMilestones, hardWords,
  playerXp, playerLevel, dailyChallenge, challengeProgress, gamesToday, claimChallenge, challengeBonus, CHALLENGE_XP, claimLevelUp, rankFor, heartStock, jokerStock,
} from './engine/insights.js';
import { setSoundEnabled, sfx } from './sound.js';
import { rain } from './particles.js';
import { setMeta } from './db.js';
import Icon, { FaceIcon } from './components/Icon.jsx';

const SWIPE_THRESHOLD = 50; // px

// Znacznik na ikonie aplikacji: widoczny, dopóki dzienny cel nie jest zrobiony.
function updateBadge(status) {
  try {
    if (status === 'green') navigator.clearAppBadge?.();
    else navigator.setAppBadge?.(1);
  } catch {
    /* Badging API jest opcjonalne */
  }
}

export default function App() {
  const [startupError, setStartupError] = useState('');
  const [view, setView] = useState('loading'); // loading | welcome | tree | session | boss | quick | mistakes | hard | hardList | pairs | road | settings | stats | lessonList
  const [mistakeCount, setMistakeCount] = useState(0);
  const [browsingLesson, setBrowsingLesson] = useState(null); // przeglądana lekcja (null = bieżąca)
  const [index, setIndex] = useState(null);
  const [settings, setSettings] = useState(null);
  const [unlockedLesson, setUnlockedLesson] = useState(1);
  const knownUnlockedRef = useRef(null); // ostatnio pokazany numer otwartej lekcji
  const [lessonStats, setLessonStats] = useState({});
  const [streak, setStreak] = useState({ count: 0 });
  const [today, setToday] = useState({ status: 'red', minutes: 0, advances: 0 });
  const [goals, setGoals] = useState({ total: 0, missing: 0, ready: 0 });
  const [player, setPlayer] = useState({ level: 1, into: 0, need: 200, xp: 0 });
  const [hearts, setHearts] = useState(0); // zapas dodatkowych serc na bossa
  const [jokers, setJokers] = useState(0); // zapas jokerów 50/50 na bossa
  const [challenge, setChallenge] = useState(null); // { label, target, value, done }
  const [toast, setToast] = useState('');
  const [run, setRun] = useState(0); // kolejne podejście do tej samej sesji (np. rewanż z bossem)

  useEffect(() => {
    (async () => {
      await migrateLearningState();
      const [idx, s, unlocked] = await Promise.all([
        loadIndex(),
        getSettings(),
        getMeta('unlockedLesson', 1),
      ]);
      // importuj wszystkie odblokowane lekcje (przy pierwszym starcie: lekcja 1)
      for (let n = 1; n <= unlocked; n++) await ensureLessonImported(n);
      setIndex(idx);
      setSettings(s);
      setSoundEnabled(s.sfx !== false);
      setUnlockedLesson(unlocked);
      knownUnlockedRef.current = unlocked;
      await refreshStats(idx, unlocked);
      // skróty z ikony aplikacji i powiadomień: /?start=quick albo /?start=pairs
      const start = new URLSearchParams(window.location.search).get('start');
      if (start) window.history.replaceState(null, '', window.location.pathname);
      // pierwsze uruchomienie: krótkie powitanie zamiast gęstego ekranu głównego
      const firstRun = !(await getMeta('welcomed', false)) && unlocked === 1 && Object.keys(await getDailyStats()).length === 0;
      // stary skrót „el/la” (sprint) prowadzi teraz do „Drogi”, która go zastąpiła
      const startView = start === 'sprint' ? 'road' : start;
      setView(['quick', 'pairs', 'road'].includes(startView) ? startView : firstRun ? 'welcome' : 'tree');
      // synchronizacja na starcie (w tle) — po niej sprawdź odblokowania
      // (postępy z innego urządzenia mogą spełniać próg) i odśwież widok
      if (resolveSyncUrl(s) && s.syncLogin) {
        syncNow()
          .then(async () => refreshStats(idx, await checkUnlocks(idx)))
          .catch((e) => setToast(`Synchronizacja: ${e.message}`));
      }
    })().catch((e) => setStartupError(e.message));

    // Przy powrocie do aplikacji (PWA / karta w tle) odśwież status dnia —
    // inaczej buźka może pokazywać wczorajszy stan.
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        (async () => {
          const s = await getSettings();
          const daily = await getDailyStats();
          const day = daily[localDay()];
          const status = dayStatus(day, s.dailyGoalMinutes);
          setToday({ status, minutes: Math.floor((day?.seconds || 0) / 60), advances: day?.advances || 0 });
          updateBadge(status);
          setStreak(currentStreak(await getDailyStats()));
        })();
      }
    }
    const dayTimer = setInterval(onVisibilityChange, 60000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(dayTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  async function refreshStats(idx, unlocked) {
    const words = await db.words.where('lesson').belowOrEqual(unlocked).filter((w) => !w.deleted).toArray();
    const progressMap = await getProgressMap(words.map((w) => w.id));
    const stats = {};
    for (const w of words) {
      const s = (stats[w.lesson] ||= { total: 0, mastered: 0 });
      s.total++;
      const level = progressMap.get(w.id)?.level || 1;
      if (level >= FLOOR_LEVEL) s.mastered++;
    }
    setLessonStats(stats);
    setMistakeCount(await countRecentMistakes(unlocked));
    setStreak(currentStreak(await getDailyStats()));
    // status dnia do buźki w nagłówku (settings ze świeżego odczytu — stan
    // `settings` może być jeszcze pusty przy pierwszym wywołaniu)
    const s = await getSettings();
    const daily = await getDailyStats();
    const day = daily[localDay()];
    const status = dayStatus(day, s.dailyGoalMinutes);
    setToday({ status, minutes: Math.floor((day?.seconds || 0) / 60), advances: day?.advances || 0 });
    updateBadge(status);
    setGoals(deckGoals(await loadDeck(unlocked)));
    setPlayer(playerLevel(playerXp(daily, await challengeBonus())));
    setHearts(await heartStock());
    setJokers(await jokerStock());
    const ch = dailyChallenge(localDay(), s.dailyGoalMinutes || 10);
    setChallenge({ ...ch, ...challengeProgress(ch, day, await gamesToday(localDay())) });
  }

  // Nowości do ogłoszenia: zaliczone wyzwanie dnia, nowy poziom gracza, kamienie
  // milowe. Każda rzecz jest zapisywana jako ogłoszona, więc pojawia się raz.
  async function collectNews(unlocked) {
    const news = [];
    const s = await getSettings();
    const today = localDay();
    let daily = await getDailyStats();
    const ch = dailyChallenge(today, s.dailyGoalMinutes || 10);
    if (challengeProgress(ch, daily[today], await gamesToday(today)).done && (await claimChallenge(today))) {
      news.push(`Wyzwanie dnia: ${ch.label} (+${CHALLENGE_XP} XP)`);
    }
    news.push(...(await claimLevelUp(playerLevel(playerXp(daily, await challengeBonus())).level)));
    return [...news, ...(await collectMilestones(unlocked))];
  }

  // Po grze nie ma ekranu podsumowania sesji — nowości pokazujemy na ekranie głównym.
  async function afterGame() {
    await refreshStats(index, unlockedLesson);
    setView('tree');
    const news = await collectNews(unlockedLesson).catch(() => []);
    if (news.length) {
      await refreshStats(index, unlockedLesson);
      setToast(news.join(' · '));
      rain({ seconds: 1.5 });
      sfx.fanfare();
      setTimeout(() => setToast(''), 6000);
    }
  }

  // Kamienie milowe do ogłoszenia w podsumowaniu sesji (każdy tylko raz).
  async function collectMilestones(unlocked) {
    const daily = await getDailyStats();
    let answers = 0;
    for (const d of Object.values(daily)) answers += d.correct || 0;
    return claimMilestones({
      gold: cardBuckets(await loadDeck(unlocked)).gold,
      streak: currentStreak(daily).count || 0,
      lesson: unlocked,
      answers,
    });
  }

  // Kolejną lekcję otwiera wyłącznie wygrana walka z bossem (Boss.jsx) albo
  // inne urządzenie przez synchronizację. Tutaj tylko dociągamy stan widoku
  // i importujemy materiał nowo otwartych lekcji. Zwraca numer najwyższej.
  async function checkUnlocks(idx, announce = true) {
    const unlocked = await getMeta('unlockedLesson', 1);
    for (let n = 1; n <= unlocked; n++) await ensureLessonImported(n);
    const known = knownUnlockedRef.current;
    knownUnlockedRef.current = unlocked;
    // po wygranej z bossem lekcję ogłasza podsumowanie sesji — tu tylko zmiany z synchronizacji
    if (announce && known !== null && unlocked > known) {
      const next = idx?.lekcje.find((l) => l.numer === unlocked);
      setBrowsingLesson(null);
      setToast(`Otwarto lekcję ${unlocked}: ${next?.temat || ''}`);
      setTimeout(() => setToast(''), 5000);
    }
    setUnlockedLesson(unlocked);
    return unlocked;
  }

  async function handleSessionFinished() {
    const unlocked = await checkUnlocks(index, false);
    await refreshStats(index, unlocked);
    const milestones = await collectNews(unlocked).catch(() => []);
    if (milestones.length) await refreshStats(index, unlocked);

    // automatyczna synchronizacja po sesji, jeśli skonfigurowana; po niej
    // ponownie sprawdź odblokowania i odśwież widok (bez przeładowania strony)
    const s = await getSettings();
    if (resolveSyncUrl(s) && s.syncLogin) {
      syncNow()
        .then(async () => refreshStats(index, await checkUnlocks(index)))
        .catch((e) => {
          setToast(`⚠️ Synchronizacja: ${e.message}`);
          setTimeout(() => setToast(''), 5000);
        });
    }
    return milestones;
  }

  if (startupError) return <div className="screen center"><p>Nie udało się wczytać kursu: {startupError}</p><button className="btn" onClick={() => window.location.reload()}>Spróbuj ponownie</button></div>;

  if (view === 'loading' || !settings) {
    return <div className="screen center">Wczytywanie kursu…</div>;
  }

  if (view === 'pairs') {
    return (
      <Pairs
        maxLesson={unlockedLesson}
        settings={settings}
        onExit={afterGame}
      />
    );
  }

  if (view === 'road') {
    return <Road maxLesson={unlockedLesson} rankTier={rankFor(player.level).tier} onExit={afterGame} />;
  }

  if (view === 'hardList') {
    return <HardWords maxLesson={unlockedLesson} onBack={() => setView('stats')} onStart={() => setView('hard')} />;
  }

  if (view === 'welcome') {
    const start = (next) => { setMeta('welcomed', true); setView(next); };
    return <Welcome lesson={index.lekcje.find((l) => l.numer === 1)} onStart={() => start('session')} onSkip={() => start('tree')} />;
  }

  if (view === 'boss') {
    return (
      <Boss
        maxLesson={unlockedLesson}
        index={index}
        settings={settings}
        onExit={async () => {
          // po wygranej numer otwartej lekcji jest już zapisany — dociągnij widok
          const unlocked = await checkUnlocks(index, false);
          setBrowsingLesson(null);
          await refreshStats(index, unlocked);
          setView('tree');
          const news = await collectNews(unlocked).catch(() => []);
          if (news.length) { await refreshStats(index, unlocked); setToast(news.join(' · ')); setTimeout(() => setToast(''), 6000); }
        }}
      />
    );
  }

  if (view === 'session' || view === 'mistakes' || view === 'quick' || view === 'hard') {
    return (
      <Session
        key={view + run}
        settings={settings}
        maxLesson={unlockedLesson}
        index={index}
        mode={view === 'session' ? 'normal' : view}
        onExit={(next) => { setRun((n) => n + 1); setView(next === 'pairs' ? 'pairs' : 'tree'); }}
        onFinished={handleSessionFinished}
        onSettingsChange={setSettings}
      />
    );
  }

  if (view === 'stats') {
    return <Stats maxLesson={unlockedLesson} lessonCount={index.lekcje.length} onBack={() => setView('tree')} onHard={() => setView('hardList')} />;
  }

  if (view === 'settings') {
    return (
      <Settings
        settings={settings}
        index={index}
        onChange={setSettings}
        onSynced={async () => refreshStats(index, await checkUnlocks(index))}
        onBack={() => setView('tree')}
      />
    );
  }

  // przeglądać można lekcje 1..odblokowana; domyślnie pokazujemy bieżącą
  const shownLesson = browsingLesson ?? unlockedLesson;

  if (view === 'lessonList') {
    return (
      <LessonList
        index={index}
        unlockedLesson={unlockedLesson}
        lessonStats={lessonStats}
        current={shownLesson}
        onSelect={(n) => {
          setBrowsingLesson(n === unlockedLesson ? null : n);
          setView('tree');
        }}
        onBack={() => setView('tree')}
      />
    );
  }

  const current = index.lekcje.find((l) => l.numer === shownLesson);
  const stat = lessonStats[shownLesson];
  const pct = stat ? Math.round((stat.mastered / stat.total) * 100) : 0;

  function goToLesson(n) {
    if (n < 1 || n > unlockedLesson) return;
    setBrowsingLesson(n === unlockedLesson ? null : n);
  }

  let touchStartX = null;
  let touchStartY = null;
  function onTouchStart(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
  function onTouchEnd(e) {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    touchStartX = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
    goToLesson(dx > 0 ? shownLesson - 1 : shownLesson + 1);
  }

  const lessonTotal = index.lekcje.length || 100;
  const hasNext = unlockedLesson < lessonTotal;
  // wszystkie karty mają wymagany poziom — kolejną lekcję otwiera walka z bossem
  const bossReady = hasNext && goals.total > 0 && goals.missing === 0;
  const cards = (n) => (n === 1 ? 'karta' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'karty' : 'kart');

  return (
    <div className="screen home">
      <header className="home-header">
        {/* jeden pasek stanu: seria, dzisiejszy cel minut, poziom gracza — całość otwiera Statystyki */}
        <button
          className="stats-bar"
          title={`Statystyki — ranga ${rankFor(player.level).label}, łącznie ${player.xp} XP`}
          onClick={() => setView('stats')}
        >
          <span className="status-cell" aria-label={`Seria: ${streak.count || 0} dni`}>
            <span className={'status-num' + (streak.count > 0 ? ' hot' : '')}><Icon name="fire" size={13} />{streak.count || 0}</span>
            <span className="status-label">{streak.count === 1 ? 'dzień serii' : 'dni serii'}</span>
          </span>
          <span className="status-cell" aria-label={`Dziś ${today.minutes} z ${settings.dailyGoalMinutes || 10} minut`}>
            <span className={'status-num goal-' + today.status}><FaceIcon status={today.status} size={15} />{today.minutes}<small>/{settings.dailyGoalMinutes || 10}</small></span>
            <span className="status-label">minut dziś</span>
          </span>
          <span className="status-cell" aria-label={`Poziom ${player.level}, na bossa: serca ${hearts}, jokery 50/50 ${jokers}`}>
            <span className="status-num level">LV {player.level}</span>
            <span className="status-label">
              {hearts + jokers > 0
                ? (
                  <span className="rank-hearts">
                    {Array.from({ length: hearts }, (_, i) => <Icon key={'h' + i} name="heart" size={11} />)}
                    {Array.from({ length: jokers }, (_, i) => <span key={'j' + i} className="rank-joker"><Icon name="joker" size={11} /></span>)}
                    {' '}na bossa
                  </span>
                )
                : `${player.need - player.into} XP do ${player.level + 1}`}
            </span>
          </span>
          <span className="xp-line" aria-hidden="true"><span className="xp-fill" style={{ width: Math.min(100, (player.into / player.need) * 100) + '%' }} /></span>
        </button>
        <button className="btn ghost settings-btn" title="Ustawienia" aria-label="Ustawienia" onClick={() => setView('settings')}>
          <Icon name="gear" size={16} />
        </button>
      </header>

      <div className="lesson-card" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="lesson-nav">
          <button
            className="btn ghost lesson-nav-btn"
            disabled={shownLesson <= 1}
            aria-label="Poprzednia lekcja"
            onClick={() => goToLesson(shownLesson - 1)}
          >
            <Icon name="back" size={16} />
          </button>
          <button className="lesson-select-btn" title="Wszystkie lekcje" onClick={() => setView('lessonList')}>
            <span className="lesson-card-kicker">Lekcja {shownLesson}</span>
            <span className="lesson-card-title">{current?.temat}</span>
          </button>
          <button
            className="btn ghost lesson-nav-btn lesson-nav-next"
            disabled={shownLesson >= unlockedLesson}
            aria-label="Następna lekcja"
            onClick={() => goToLesson(shownLesson + 1)}
          >
            <Icon name="back" size={16} />
          </button>
        </div>
        <div className="lesson-card-track">
          <div className="lesson-card-fill" style={{ width: pct + '%' }} />
        </div>
        {/* dwa wiersze „co — ile”: droga do kolejnej lekcji i wyzwanie dnia */}
        <div className="card-rows">
          <div className={'card-row' + (bossReady ? ' ready' : '')} title="Kolejną lekcję otwiera boss; pojawia się, gdy wszystkie karty mają co najmniej poziom 3">
            <Icon name={hasNext && !bossReady ? 'lock' : 'star'} size={12} />
            <span className="card-row-label">{!hasNext ? 'Wszystkie lekcje otwarte' : bossReady ? `Boss strzeże lekcji ${unlockedLesson + 1}` : `Do lekcji ${unlockedLesson + 1}`}</span>
            <span className="card-row-value">{!hasNext ? lessonTotal : bossReady ? 'czeka' : `${goals.missing} ${cards(goals.missing)}`}</span>
          </div>
          {challenge && (
            <div className={'card-row challenge' + (challenge.done ? ' done' : '')} title="Wyzwanie dnia: +100 XP">
              <Icon name="bolt" size={12} />
              <span className="card-row-label">{challenge.label}</span>
              <span className="card-row-value">{challenge.done ? `+${CHALLENGE_XP} XP` : `${challenge.value}/${challenge.target}`}</span>
            </div>
          )}
        </div>
      </div>

      <LessonPreview lesson={shownLesson} grammarNote={current?.gramatyka} />

      {toast && <div className="toast">{toast}</div>}

      <div className="home-bottom">
        <div className="quick-row">
          <button className="quick-btn" onClick={() => setView('quick')}>
            <Icon name="bolt" size={13} /> 2 min
          </button>
          <button className="quick-btn" onClick={() => setView('pairs')}>
            <Icon name="pairs" size={13} /> Pary
          </button>
          <button className="quick-btn" onClick={() => setView('road')}>
            <Icon name="road" size={13} /> Droga
          </button>
          {mistakeCount > 0 && (
            <button className="quick-btn mistakes-btn" title="Powtórka dzisiejszych błędów" onClick={() => setView('mistakes')}>
              <Icon name="repeat" size={13} /> {mistakeCount}
            </button>
          )}
          {bossReady && (
            <button className="quick-btn" onClick={() => setView('session')}>
              <Icon name="play" size={12} /> Sesja
            </button>
          )}
        </div>
        {bossReady ? (
          <button className="btn primary big boss-cta" onClick={() => setView('boss')}>
            <Icon name="star" size={14} /> Walcz z bossem
          </button>
        ) : (
          <button className="btn primary big" onClick={() => setView('session')}>
            <Icon name="play" size={14} /> Rozpocznij sesję
          </button>
        )}
      </div>
    </div>
  );
}
