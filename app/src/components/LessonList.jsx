import React from 'react';
import Icon from './Icon.jsx';

// Lista wszystkich odblokowanych lekcji do wyboru (przeglądanie materiału).
export default function LessonList({ index, unlockedLesson, lessonStats, current, onSelect, onBack }) {
  const lekcje = index.lekcje.filter((l) => l.numer <= unlockedLesson);

  return (
    <div className="screen lesson-list">
      <div className="session-top">
        <button className="btn ghost" onClick={onBack} aria-label="Wróć">
          <Icon name="back" />
        </button>
        <h2>Wybierz lekcję</h2>
        <span />
      </div>

      <div className="lesson-list-items">
        {lekcje.map((l) => {
          const stat = lessonStats[l.numer];
          const pct = stat ? Math.round((stat.mastered / stat.total) * 100) : 0;
          return (
            <button
              key={l.numer}
              className={'lesson-list-item' + (l.numer === current ? ' active' : '')}
              onClick={() => onSelect(l.numer)}
            >
              <span className="lesson-list-num">{l.numer}</span>
              <span className="lesson-list-info">
                <span className="lesson-list-title">{l.temat}</span>
                <span className="lesson-list-sub">{l.poziom} · {l.czasownik} · {pct}%</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
