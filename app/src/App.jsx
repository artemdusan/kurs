import React, { useEffect, useState } from 'react';
import { db, getMeta, setMeta, getSettings } from './db.js';
import { loadIndex, ensureLessonImported } from './course.js';
import { lessonFloorReached, getProgressMap } from './engine/session.js';
import SkillTree from './components/SkillTree.jsx';
import Session from './components/Session.jsx';
import Settings from './components/Settings.jsx';

export default function App() {
  const [view, setView] = useState('loading'); // loading | tree | session | settings
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
  }

  if (view === 'loading' || !settings) {
    return <div className="screen center">Wczytywanie kursu…</div>;
  }

  if (view === 'session') {
    return (
      <Session
        settings={settings}
        maxLesson={unlockedLesson}
        onExit={() => setView('tree')}
        onFinished={handleSessionFinished}
      />
    );
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

  return (
    <div className="screen home">
      <header className="home-header">
        <div>
          <h1>🇪🇸 Hiszpański</h1>
          <p className="subtitle">
            Lekcja {unlockedLesson}: {current?.temat} · {current?.poziom}
          </p>
        </div>
        <button className="btn ghost" onClick={() => setView('settings')}>⚙️</button>
      </header>

      <div className="stats-bar">
        <span title="Streak dni nauki">🔥 {streak.count || 0}</span>
        <span title="Dzisiejsze odpowiedzi">✅ {todayStats.correct} ❌ {todayStats.wrong}</span>
      </div>

      <button className="btn primary big" onClick={() => setView('session')}>
        ▶ Rozpocznij sesję ({settings.sessionMinutes} min)
      </button>

      {toast && <div className="toast">{toast}</div>}

      <SkillTree
        index={index}
        unlockedLesson={unlockedLesson}
        lessonStats={lessonStats}
        onStart={() => setView('session')}
      />
    </div>
  );
}
