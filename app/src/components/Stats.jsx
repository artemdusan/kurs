import React, { useEffect, useState } from 'react';
import { db, getMeta } from '../db.js';
import { getProgressMap, MAX_LEVEL } from '../engine/session.js';

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
      let correctTotal = 0;
      let wrongTotal = 0;
      for (const w of words) {
        const p = progressMap.get(w.id);
        levels[(p?.level || 1) - 1]++;
        correctTotal += p?.correctTotal || 0;
        wrongTotal += p?.wrongTotal || 0;
      }
      const daily = await getMeta('dailyStats', {});
      const days = lastNDays(14).map((day) => ({ day, ...(daily[day] || { correct: 0, wrong: 0 }) }));
      const streak = await getMeta('streak', { count: 0 });
      setData({ levels, wordCount: words.length, correctTotal, wrongTotal, days, streak });
    })();
  }, [maxLesson]);

  if (!data) return <div className="screen center">Liczenie statystyk…</div>;

  const maxLevelCount = Math.max(1, ...data.levels);
  const maxDayCount = Math.max(1, ...data.days.map((d) => d.correct + d.wrong));

  return (
    <div className="screen stats">
      <div className="session-top">
        <button className="btn ghost" onClick={onBack}>←</button>
        <h2>Statystyki</h2>
        <span />
      </div>

      <div className="stats-summary">
        <span>🔥 streak: <strong>{data.streak.count || 0}</strong></span>
        <span>📚 słów: <strong>{data.wordCount}</strong></span>
        <span>✅ {data.correctTotal} ❌ {data.wrongTotal}</span>
      </div>

      <h3>Poziomy słów</h3>
      <div className="level-bars">
        {data.levels.map((count, i) => (
          <div key={i} className="level-bar-row">
            <span className="level-bar-label">poz. {i + 1}</span>
            <div className="level-bar-track">
              <div
                className={'level-bar-fill lvl-' + (i + 1)}
                style={{ width: (count / maxLevelCount) * 100 + '%' }}
              />
            </div>
            <span className="level-bar-count">{count}</span>
          </div>
        ))}
      </div>

      <h3>Ostatnie 14 dni</h3>
      <div className="day-bars">
        {data.days.map((d) => {
          const total = d.correct + d.wrong;
          return (
            <div key={d.day} className="day-col" title={`${d.day}: ✅ ${d.correct} ❌ ${d.wrong}`}>
              <div className="day-col-track">
                {total > 0 && (
                  <>
                    <div className="day-col-wrong" style={{ height: (d.wrong / maxDayCount) * 100 + '%' }} />
                    <div className="day-col-correct" style={{ height: (d.correct / maxDayCount) * 100 + '%' }} />
                  </>
                )}
              </div>
              <span className="day-col-label">{d.day.slice(8)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
