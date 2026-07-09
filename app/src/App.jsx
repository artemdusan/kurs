import React, { useEffect, useState } from 'react';
import { db, getMeta, setMeta, getSettings } from './db.js';
import { loadIndex, ensureLessonImported } from './course.js';
import { lessonFloorReached, getProgressMap, countRecentMistakes } from './engine/session.js';
import { syncNow, resolveSyncUrl } from './sync.js';
import Session from './components/Session.jsx';
import Settings from './components/Settings.jsx';
import Stats from './components/Stats.jsx';
import LessonPreview from './components/LessonPreview.jsx';
import LessonList from './components/LessonList.jsx';
import Icon from './components/Icon.jsx';

const SWIPE_THRESHOLD = 50; // px

export default function App() {
  const [view, setView] = useState('loading'); // loading | tree | session | mistakes | settings | stats | lessonList
  const [mistakeCount, setMistakeCount] = useState(0);
  const [browsingLesson, setBrowsingLesson] = useState(null); // przeglądana lekcja (null = bieżąca)
  const [index, setIndex] = useState(null);
  const [settings, setSettings] = useState(null);
  const [unlockedLesson, setUnlockedLesson] = useState(1);
  const [lessonStats, setLessonStats] = useState({});
  const [streak, setStreak] = useState({ count: 0 });
  const [toast, setToast] = useState('');

  useEffect(() => {
    (async () => {
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
      setView('tree');
      // synchronizacja na starcie (w tle) — po niej sprawdź odblokowania
      // (postępy z innego urządzenia mogą spełniać próg) i odśwież widok
      if (resolveSyncUrl(s) && s.syncLogin) {
        syncNow()
          .then(async () => refreshStats(idx, await checkUnlocks(idx)))
          .catch(() => {});
      }
    })();
  }, []);

  async function refreshStats(idx, unlocked) {
    const words = await db.words.where('lesson').belowOrEqual(unlocked).filter((w) => !w.deleted).toArray();
    const progressMap = await getProgressMap(words.map((w) => w.id));
    const stats = {};
    for (const w of words) {
      const s = (stats[w.lesson] ||= { total: 0, mastered: 0 });
      s.total++;
      const level = progressMap.get(w.id)?.level || 1;
      if (level >= (settings?.floorLevel || 2)) s.mastered++;
    }
    setLessonStats(stats);
    setMistakeCount(await countRecentMistakes(unlocked));
    setStreak(await getMeta('streak', { count: 0 }));
  }

  // Sprawdza „floor” — odblokowanie kolejnej lekcji wymaga minimalnego poziomu
  // WSZYSTKICH dotychczas poznanych słów. Pętla, bo po synchronizacji postępy
  // z innego urządzenia mogą odblokować kilka lekcji naraz. Zwraca numer
  // najwyższej odblokowanej lekcji.
  async function checkUnlocks(idx) {
    const s = await getSettings();
    let unlocked = await getMeta('unlockedLesson', 1);
    const total = idx?.lekcje.length || 100;
    let lastUnlocked = null;
    while (unlocked < total && (await lessonFloorReached(unlocked, s.floorLevel))) {
      unlocked++;
      await setMeta('unlockedLesson', unlocked);
      await ensureLessonImported(unlocked);
      lastUnlocked = unlocked;
    }
    if (lastUnlocked) {
      setUnlockedLesson(lastUnlocked);
      const next = idx?.lekcje.find((l) => l.numer === lastUnlocked);
      setToast(`🎉 Odblokowano lekcję ${lastUnlocked}: ${next?.temat || ''}`);
      setTimeout(() => setToast(''), 5000);
    }
    return unlocked;
  }

  async function handleSessionFinished() {
    const unlocked = await checkUnlocks(index);
    await refreshStats(index, unlocked);

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
  }

  if (view === 'loading' || !settings) {
    return <div className="screen center">Wczytywanie kursu…</div>;
  }

  if (view === 'session' || view === 'mistakes') {
    return (
      <Session
        settings={settings}
        maxLesson={unlockedLesson}
        index={index}
        mode={view === 'mistakes' ? 'mistakes' : 'normal'}
        onExit={() => setView('tree')}
        onFinished={handleSessionFinished}
        onSettingsChange={setSettings}
      />
    );
  }

  if (view === 'stats') {
    return <Stats maxLesson={unlockedLesson} onBack={() => setView('tree')} />;
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
        <button className="btn ghost stats-bar" title="Statystyki" onClick={() => setView('stats')}>
          <Icon name="fire" size={16} /> {streak.count || 0}
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

      <LessonPreview lesson={shownLesson} grammarNote={current?.gramatyka} />

      {toast && <div className="toast">{toast}</div>}

      <div className="home-bottom">
        {mistakeCount > 0 && (
          <button className="btn mistakes-btn" onClick={() => setView('mistakes')}>
            <Icon name="repeat" size={14} /> Powtórka ({mistakeCount})
          </button>
        )}
        <button className="btn primary big" onClick={() => setView('session')}>
          <Icon name="play" size={14} /> Rozpocznij sesję
        </button>
      </div>
    </div>
  );
}
