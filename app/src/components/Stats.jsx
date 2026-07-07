import React, { useEffect, useState } from 'react';
import { db, getMeta } from '../db.js';
import { getProgressMap, MAX_LEVEL } from '../engine/session.js';
import LevelBars from './LevelBars.jsx';
import Icon from './Icon.jsx';

// Ekran statystyk: rozkład poziomów słów + historia ostatnich 14 dni.

function lastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  }
  return days;
}

export default function Stats({ maxLesson, onBack }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      const words = await db.words
        .where('lesson')
        .belowOrEqual(maxLesson)
        .filter((w) => !w.deleted)
        .toArray();
      const progressMap = await getProgressMap(words.map((w) => w.id));
      const levels = Array.from({ length: MAX_LEVEL }, () => 0);
      for (const w of words) {
        levels[(progressMap.get(w.id)?.level || 1) - 1]++;
      }
      const daily = await getMeta('dailyStats', {});
      const days = lastNDays(14).map((day) => ({
        day,
        correct: 0,
        wrong: 0,
        seconds: 0,
        ...(daily[day] || {}),
      }));
      // agregaty czasu i skuteczności ze WSZYSTKICH dni nauki
      let totalSeconds = 0;
      let totalSessions = 0;
      let totalCorrect = 0;
      let totalWrong = 0;
      let activeDays = 0;
      for (const d of Object.values(daily)) {
        totalSeconds += d.seconds || 0;
        totalSessions += d.sessions || 0;
        totalCorrect += d.correct || 0;
        totalWrong += d.wrong || 0;
        if ((d.correct || 0) + (d.wrong || 0) > 0) activeDays++;
      }
      const today = daily[new Date().toISOString().slice(0, 10)] || {};
      const streak = await getMeta('streak', { count: 0 });
      setData({
        levels,
        wordCount: words.length,
        days,
        streak: streak.count || 0,
        time: {
          todayMin: Math.round((today.seconds || 0) / 60),
          avgMin: activeDays ? Math.round(totalSeconds / activeDays / 60) : 0,
          totalMin: Math.round(totalSeconds / 60),
          sessions: totalSessions,
          accuracy: totalCorrect + totalWrong
            ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 100)
            : 0,
        },
      });
    })();
  }, [maxLesson]);

  if (!data) return <div className="screen center">Liczenie statystyk…</div>;

  return (
    <div className="screen stats">
      <div className="session-top">
        <button className="btn ghost" onClick={onBack} aria-label="Wróć">
          <Icon name="back" />
        </button>
        <h2>Statystyki</h2>
        <span />
      </div>

      <h3>Czas nauki</h3>
      <div className="time-grid">
        <div className="time-cell">
          <span className="time-num"><Icon name="fire" size={13} /> {data.streak}</span>
          <span className="time-label">dni z rzędu</span>
        </div>
        <div className="time-cell">
          <span className="time-num">{data.time.todayMin}</span>
          <span className="time-label">min dziś</span>
        </div>
        <div className="time-cell">
          <span className="time-num">{data.time.avgMin}</span>
          <span className="time-label">min/dzień śr.</span>
        </div>
        <div className="time-cell">
          <span className="time-num">{Math.floor(data.time.totalMin / 60)}h {data.time.totalMin % 60}m</span>
          <span className="time-label">łącznie</span>
        </div>
        <div className="time-cell">
          <span className="time-num">{data.time.sessions}</span>
          <span className="time-label">sesji</span>
        </div>
        <div className="time-cell">
          <span className="time-num">{data.time.accuracy}%</span>
          <span className="time-label">skuteczność</span>
        </div>
      </div>

      <h3>Minuty nauki (14 dni)</h3>
      <div className="day-bars day-bars-short">
        {data.days.map((d) => {
          const min = Math.round((d.seconds || 0) / 60);
          return (
            <div key={d.day} className="day-col" title={`${d.day}: ${min} min`}>
              <div className="day-col-track">
                {min > 0 && (
                  <div
                    className="day-col-minutes"
                    style={{ height: (min / Math.max(1, ...data.days.map((x) => Math.round((x.seconds || 0) / 60)))) * 100 + '%' }}
                  />
                )}
              </div>
              <span className="day-col-label">{d.day.slice(8)}</span>
            </div>
          );
        })}
      </div>

      <h3>Poziomy słów ({data.wordCount})</h3>
      <LevelBars levels={data.levels} />
    </div>
  );
}
