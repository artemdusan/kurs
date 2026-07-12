import React, { useEffect, useState } from 'react';
import { db, getMeta, getSettings } from '../db.js';
import { getProgressMap, MAX_LEVEL, dayStatus, bestStreak } from '../engine/session.js';
import LevelBars from './LevelBars.jsx';
import Icon, { FaceIcon } from './Icon.jsx';

// Ekran statystyk: dzisiejszy cel + seria, kluczowe agregaty,
// minuty z 14 dni (kolor słupka = status dnia) i rozkład poziomów słów.

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
      const settings = await getSettings();
      const goalMin = settings.dailyGoalMinutes || 10;
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
        goalMin,
        todayStatus: dayStatus(today, goalMin),
        streak: streak.count || 0,
        bestStreak: Math.max(bestStreak(daily), streak.count || 0),
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

  const goalPct = Math.min(100, Math.round((data.time.todayMin / data.goalMin) * 100));

  return (
    <div className="screen stats">
      <div className="session-top">
        <button className="btn ghost" onClick={onBack} aria-label="Wróć">
          <Icon name="back" />
        </button>
        <h2>Statystyki</h2>
        <span />
      </div>

      {/* dzisiejszy cel: buźka + pasek postępu, ten sam status co w nagłówku */}
      <div className="today-card">
        <FaceIcon status={data.todayStatus} size={36} />
        <div className="today-info">
          <span className="today-line">
            Dziś: {data.time.todayMin} / {data.goalMin} min
          </span>
          <div className="goal-track">
            <div className={`goal-fill goal-${data.todayStatus}`} style={{ width: goalPct + '%' }} />
          </div>
        </div>
      </div>

      <div className="time-grid">
        <div className="time-cell">
          <span className="time-num"><Icon name="fire" size={13} /> {data.streak}</span>
          <span className="time-label">seria (dni)</span>
        </div>
        <div className="time-cell">
          <span className="time-num">{data.bestStreak}</span>
          <span className="time-label">rekord serii</span>
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
          const status = dayStatus(d, data.goalMin);
          const max = Math.max(data.goalMin, ...data.days.map((x) => Math.round((x.seconds || 0) / 60)));
          return (
            <div key={d.day} className="day-col" title={`${d.day}: ${min} min`}>
              <div className="day-col-track">
                {min > 0 && (
                  <div
                    className={`day-col-minutes goal-${status}`}
                    style={{ height: (min / max) * 100 + '%' }}
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
