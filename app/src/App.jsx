import React, { useEffect, useState } from 'react';
import { migrateLearningState, getDailyStats } from './activity.js';
import { localDay, currentStreak, FLOOR_LEVEL } from '../../shared/learning.js';
import { db, getMeta, setUnlockedLesson, getSettings } from './db.js';
import { loadIndex, ensureLessonImported } from './course.js';
import { lessonFloorReached, getProgressMap, countRecentMistakes, dayStatus } from './engine/session.js';
import { syncNow, resolveSyncUrl } from './sync.js';
import Session from './components/Session.jsx';
import Settings from './components/Settings.jsx';
import Stats from './components/Stats.jsx';
import LessonPreview from './components/LessonPreview.jsx';
import LessonList from './components/LessonList.jsx';
import Pairs from './components/Pairs.jsx';
import { loadDeck, deckGoals, cardBuckets, claimMilestones } from './engine/insights.js';
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
  const [view, setView] = useState('loading'); // loading | tree | session | quick | mistakes | pairs | settings | stats | lessonList
  const [mistakeCount, setMistakeCount] = useState(0);
  const [browsingLesson, setBrowsingLesson] = useState(null); // przeglądana lekcja (null = bieżąca)
  const [index, setIndex] = useState(null);
  const [settings, setSettings] = useState(null);
  const [unlockedLesson, setUnlockedLesson] = useState(1);
  const [lessonStats, setLessonStats] = useState({});
  const [streak, setStreak] = useState({ count: 0 });
  const [today, setToday] = useState({ status: 'red', minutes: 0 });
  const [goals, setGoals] = useState({ total: 0, missing: 0, ready: 0, promotable: 0 });
  const [toast, setToast] = useState('');

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
      setUnlockedLesson(unlocked);
      await refreshStats(idx, unlocked);
      // skróty z ikony aplikacji i powiadomień: /?start=quick albo /?start=pairs
      const start = new URLSearchParams(window.location.search).get('start');
      if (start) window.history.replaceState(null, '', window.location.pathname);
      setView(start === 'quick' || start === 'pairs' ? start : 'tree');
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
          setToday({ status, minutes: Math.floor((day?.seconds || 0) / 60) });
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
    setToday({ status, minutes: Math.floor((day?.seconds || 0) / 60) });
    updateBadge(status);
    setGoals(deckGoals(await loadDeck(unlocked)));
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

  // Sprawdza „floor” — odblokowanie kolejnej lekcji wymaga minimalnego poziomu
  // WSZYSTKICH dotychczas poznanych słów. Pętla, bo po synchronizacji postępy
  // z innego urządzenia mogą odblokować kilka lekcji naraz. Zwraca numer
  // najwyższej odblokowanej lekcji.
  async function checkUnlocks(idx) {
    const s = await getSettings();
    let unlocked = await getMeta('unlockedLesson', 1);
    for (let n = 1; n <= unlocked; n++) await ensureLessonImported(n);
    const total = idx?.lekcje.length || 100;
    let lastUnlocked = null;
    while (unlocked < total && (await lessonFloorReached(unlocked, s.floorLevel))) {
      unlocked++;
      await setUnlockedLesson(unlocked);
      await ensureLessonImported(unlocked);
      lastUnlocked = unlocked;
    }
    // Zsynchronizuj stan z meta (idempotentnie) — obejmuje też przypadek, gdy
    // odblokowania dokonała już sesja (Session.finish), a tutaj tylko dociągamy
    // stan widoku. Toast pokazujemy wyłącznie, gdy odblokowanie nastąpiło w tej
    // ścieżce (np. po synchronizacji z innym urządzeniem), by nie dublować go
    // z toastem z ekranu podsumowania sesji.
    setUnlockedLesson(unlocked);
    if (lastUnlocked) {
      const next = idx?.lekcje.find((l) => l.numer === lastUnlocked);
      setToast(`🎉 Odblokowano lekcję ${lastUnlocked}: ${next?.temat || ''}`);
      setTimeout(() => setToast(''), 5000);
    }
    return unlocked;
  }

  async function handleSessionFinished() {
    const unlocked = await checkUnlocks(index);
    await refreshStats(index, unlocked);
    const milestones = await collectMilestones(unlocked).catch(() => []);

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
        onExit={async () => { await refreshStats(index, unlockedLesson); setView('tree'); }}
      />
    );
  }

  if (view === 'session' || view === 'mistakes' || view === 'quick') {
    return (
      <Session
        key={view}
        settings={settings}
        maxLesson={unlockedLesson}
        index={index}
        mode={view === 'session' ? 'normal' : view}
        onExit={(next) => setView(next === 'pairs' ? 'pairs' : 'tree')}
        onFinished={handleSessionFinished}
        onSettingsChange={setSettings}
      />
    );
  }

  if (view === 'stats') {
    return <Stats maxLesson={unlockedLesson} lessonCount={index.lekcje.length} onBack={() => setView('tree')} />;
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

  return (
    <div className="screen home">
      <header className="home-header">
        <button
          className="btn ghost stats-bar"
          title={`Statystyki — dziś ${today.minutes} min (cel ${settings.dailyGoalMinutes || 10}), seria ${streak.count || 0} dni`}
          onClick={() => setView('stats')}
        >
          <FaceIcon status={today.status} size={18} />
          {streak.count > 0 && <span className="streak-chip"><Icon name="fire" size={12} />{streak.count}</span>}
        </button>
        <button className="btn ghost lesson-select-btn" onClick={() => setView('lessonList')}>
          <Icon name="list" size={14} /> Lekcja {shownLesson}
        </button>
        <button className="btn ghost settings-btn" title="Ustawienia" onClick={() => setView('settings')}>
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
          <span className="lesson-card-title">{current?.temat}</span>
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
      </div>

      {/* cel na dziś: ile kart dzieli od kolejnej lekcji i ile może dziś awansować */}
      <div className="goal-strip">
        {unlockedLesson < (index.lekcje.length || 100) ? (
          <div className="goal-cell" title="Kolejna lekcja otwiera się, gdy wszystkie karty mają co najmniej poziom 3">
            <span className="goal-num">{goals.missing === 0 ? <Icon name="star" size={12} /> : <Icon name="lock" size={12} />} {goals.missing}</span>
            <span className="goal-label">{goals.missing === 0 ? 'sesja otworzy lekcję ' + (unlockedLesson + 1) : 'kart do lekcji ' + (unlockedLesson + 1)}</span>
          </div>
        ) : (
          <div className="goal-cell">
            <span className="goal-num"><Icon name="star" size={12} /> 100</span>
            <span className="goal-label">wszystkie lekcje otwarte</span>
          </div>
        )}
        <div className="goal-cell">
          <span className="goal-num goal-up"><Icon name="up" size={12} /> {goals.promotable}</span>
          <span className="goal-label">kart do awansu dziś</span>
        </div>
      </div>

      <LessonPreview lesson={shownLesson} grammarNote={current?.gramatyka} />

      {toast && <div className="toast">{toast}</div>}

      <div className="home-bottom">
        <div className="quick-row">
          <button className="btn quick-btn" onClick={() => setView('quick')}>
            <Icon name="bolt" size={13} /> 2 min
          </button>
          <button className="btn quick-btn" onClick={() => setView('pairs')}>
            <Icon name="pairs" size={13} /> Pary
          </button>
          {mistakeCount > 0 && (
            <button className="btn quick-btn mistakes-btn" onClick={() => setView('mistakes')}>
              <Icon name="repeat" size={13} /> {mistakeCount}
            </button>
          )}
        </div>
        <button className="btn primary big" onClick={() => setView('session')}>
          <Icon name="play" size={14} /> Rozpocznij sesję
        </button>
      </div>
    </div>
  );
}
