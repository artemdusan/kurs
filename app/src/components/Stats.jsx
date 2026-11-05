import React, { useEffect, useState } from 'react';
import { db, getMeta, getSettings } from '../db.js';
import { getProgressMap, dayStatus, bestStreak } from '../engine/session.js';
import LevelBars from './LevelBars.jsx';
import { getDailyStats } from '../activity.js';
import { localDay, shiftDay, currentStreak } from '../../../shared/learning.js';
import Icon, { FaceIcon } from './Icon.jsx';

// Ekran statystyk: dzisiejszy cel + seria, kluczowe agregaty,
// awanse i spadki z 7 dni oraz rozkład poziomów kart.

function lastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    days.push(shiftDay(localDay(), -i));
  }
  return days;
}

export default function Stats({ maxLesson, onBack }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const words = await db.words
        .where('lesson')
        .belowOrEqual(maxLesson)
        .filter((w) => !w.deleted)
        .toArray();
      const progressMap = await getProgressMap(words.map((w) => w.id));
      const levelsObj = {};
      let maxLevel = 1;
      for (const w of words) {
        const lvl = progressMap.get(w.id)?.level || 1;
        levelsObj[lvl] = (levelsObj[lvl] || 0) + 1;
        if (lvl > maxLevel) maxLevel = lvl;
      }
      const levels = [];
      for (let i = 1; i <= Math.max(maxLevel, 6); i++) {
        levels.push(levelsObj[i] || 0);
      }
      const settings = await getSettings();
      const goalMin = settings.dailyGoalMinutes || 10;
      const daily = await getDailyStats();
      const historySince = await getMeta('levelHistorySince');
      const days = lastNDays(7).map((day) => ({
        day,
        correct: 0,
        wrong: 0,
        seconds: 0,
        advances: 0, drops: 0,
        known: Boolean(historySince && day >= historySince),
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
      const today = daily[localDay()] || {};
      const streak = currentStreak(daily);
      if (cancelled) return;
      setData({
        levels,
        wordCount: words.length,
        days,
        historySince,
        goalMin,
        todayStatus: dayStatus(today, goalMin),
        streak: streak.count || 0,
        bestStreak: Math.max(bestStreak(daily), streak.count || 0),
        time: {
          todayMin: Math.floor((today.seconds || 0) / 60),
          avgMin: activeDays ? Math.round(totalSeconds / activeDays / 60) : 0,
          totalMin: Math.round(totalSeconds / 60),
          sessions: totalSessions,
          accuracy: totalCorrect + totalWrong
            ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 100)
            : 0,
        },
      });
    };
    refresh();
    const timer = setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
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
          <span className="time-label">min/dzień nauki</span>
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

      <h3>Postęp (7 dni)</h3>
      <div className="progress-legend">
        <span className="num-ok">↑ {data.days.reduce((n, d) => n + d.advances, 0)} awansów</span>
        <span className="num-bad">↓ {data.days.reduce((n, d) => n + d.drops, 0)} spadków</span>
      </div>
      <div className="progress-days">
        {data.days.map((d) => {
          const max = Math.max(1, ...data.days.flatMap((x) => [x.advances, x.drops]));
          const label = d.known ? `${d.day}: ${d.advances} awansów, ${d.drops} spadków` : `${d.day}: brak danych`;
          return (
            <div className="progress-day" key={d.day} title={label} aria-label={label} tabIndex={0}>
              <div className="progress-values">{d.known ? <><span className="num-ok">{d.advances}</span> / <span className="num-bad">{d.drops}</span></> : '—'}</div>
              <div className={'progress-pair' + (d.known ? '' : ' no-data')}>
                {d.known && <>
                  <div className="progress-up" style={{ height: `${d.advances / max * 100}%` }} />
                  <div className="progress-down" style={{ height: `${d.drops / max * 100}%` }} />
                </>}
              </div>
              <span className="day-col-label">{d.day.slice(8)}.{d.day.slice(5, 7)}</span>
            </div>
          );
        })}
      </div>
      {data.days.some((d) => !d.known) && <p className="hint">— brak danych sprzed rozpoczęcia zapisu zmian poziomów.</p>}

      <h3>Poziomy kart ({data.wordCount})</h3>
      <LevelBars levels={data.levels} />
    </div>
  );
}
