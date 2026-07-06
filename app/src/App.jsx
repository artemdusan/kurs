import React, { useEffect, useState } from 'react';
import { db, getMeta, setMeta, getSettings } from './db.js';
import { loadIndex, ensureLessonImported } from './course.js';
import { lessonFloorReached, getProgressMap, countRecentMistakes, levelDistribution } from './engine/session.js';
import { syncNow, resolveSyncUrl } from './sync.js';
import Session from './components/Session.jsx';
import Settings from './components/Settings.jsx';
import Stats from './components/Stats.jsx';
import LevelBars from './components/LevelBars.jsx';
import Icon from './components/Icon.jsx';

export default function App() {
  const [view, setView] = useState('loading'); // loading | tree | session | mistakes | settings | stats
  const [mistakeCount, setMistakeCount] = useState(0);
  const [levels, setLevels] = useState(null);
  const [index, setIndex] = useState(null);
  const [settings, setSettings] = useState(null);
  const [unlockedLesson, setUnlockedLesson] = useState(1);
  const [lessonStats, setLessonStats] = useState({});
  const [streak, setStreak] = useState({ count: 0 });
  const [todayStats, setTodayStats] = useState({ correct: 0, wrong: 0 });
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
    setLevels(await levelDistribution(unlocked));
    setStreak(await getMeta('streak', { count: 0 }));
    const daily = await getMeta('dailyStats', {});
    const today = daily[new Date().toISOString().slice(0, 10)] || { correct: 0, wrong: 0 };
    setTodayStats(today);
  }

  async function handleSessionFinished() {
    // sprawdź „floor” — odblokowanie kolejnej lekcji wymaga minimalnego poziomu
    // WSZYSTKICH dotychczas poznanych słów
    const s = await getSettings();
    let unlocked = await getMeta('unlockedLesson', 1);
    if (unlocked < (index?.lekcje.length || 100)) {
      const reached = await lessonFloorReached(unlocked, s.floorLevel);
      if (reached) {
        unlocked++;
        await setMeta('unlockedLesson', unlocked);
        await ensureLessonImported(unlocked);
        setUnlockedLesson(unlocked);
        const next = index.lekcje.find((l) => l.numer === unlocked);
        setToast(`🎉 Odblokowano lekcję ${unlocked}: ${next?.temat || ''}`);
        setTimeout(() => setToast(''), 5000);
      }
    }
    await refreshStats(index, unlocked);

    // automatyczna synchronizacja po sesji, jeśli skonfigurowana
    if (resolveSyncUrl(s) && s.syncLogin) {
      syncNow()
        .then(() => setToast((t) => t || '🔄 Zsynchronizowano'))
        .catch((e) => setToast((t) => t || `⚠️ Synchronizacja: ${e.message}`))
        .finally(() => setTimeout(() => setToast(''), 5000));
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
        onChange={setSettings}
        onBack={() => setView('tree')}
      />
    );
  }

  const current = index.lekcje.find((l) => l.numer === unlockedLesson);
  const stat = lessonStats[unlockedLesson];
  const pct = stat ? Math.round((stat.mastered / stat.total) * 100) : 0;
  const totalWords = levels ? levels.reduce((s, n) => s + n, 0) : 0;

  return (
    <div className="screen home">
      <header className="home-header">
        <div className="stats-bar">
          <span title="Streak dni nauki"><Icon name="fire" size={16} /> {streak.count || 0}</span>
          <span title="Dzisiejsze odpowiedzi: poprawne / błędne">
            <span className="num-ok">{todayStats.correct}</span> <span className="num-bad">{todayStats.wrong}</span>
          </span>
        </div>
        <div>
          <button className="btn ghost" title="Statystyki" onClick={() => setView('stats')}>
            <Icon name="chart" />
          </button>
          <button className="btn ghost" title="Ustawienia" onClick={() => setView('settings')}>
            <Icon name="gear" />
          </button>
        </div>
      </header>

      <div className="lesson-card">
        <span className="lesson-card-label">Lekcja {unlockedLesson} · {current?.poziom}</span>
        <span className="lesson-card-title">{current?.temat}</span>
        <span className="lesson-card-sub">{current?.czasownik} · opanowane {pct}%</span>
        <div className="lesson-card-track">
          <div className="lesson-card-fill" style={{ width: pct + '%' }} />
        </div>
      </div>

      <h3>Słowa według poziomu ({totalWords})</h3>
      {levels && <LevelBars levels={levels} />}

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
