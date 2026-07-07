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
      const days = lastNDays(14).map((day) => ({ day, ...(daily[day] || { correct: 0, wrong: 0 }) }));
      setData({ levels, wordCount: words.length, days });
    })();
  }, [maxLesson]);

  if (!data) return <div className="screen center">Liczenie statystyk…</div>;

  const maxDayCount = Math.max(1, ...data.days.map((d) => d.correct + d.wrong));

  return (
    <div className="screen stats">
      <div className="session-top">
        <button className="btn ghost" onClick={onBack} aria-label="Wróć">
          <Icon name="back" />
        </button>
        <h2>Statystyki</h2>
        <span />
      </div>

      <h3>Poziomy słów ({data.wordCount})</h3>
      <LevelBars levels={data.levels} />

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
