import React from 'react';

// Drzewko umiejętności w stylu Duolingo: pionowa ścieżka lekcji.
export default function SkillTree({ index, unlockedLesson, lessonStats, onStart }) {
  return (
    <div className="tree">
      {index.lekcje.map((l) => {
        const unlocked = l.numer <= unlockedLesson;
        const current = l.numer === unlockedLesson;
        const stat = lessonStats[l.numer];
        const pct = stat ? Math.round((stat.mastered / stat.total) * 100) : 0;
        return (
          <button
            key={l.numer}
            className={
              'tree-node' +
              (unlocked ? ' unlocked' : ' locked') +
              (current ? ' current' : '')
            }
            disabled={!unlocked}
            onClick={() => onStart(l.numer)}
          >
            <span className="tree-bubble">
              {unlocked ? (current ? '★' : '✓') : '🔒'}
            </span>
            <span className="tree-info">
              <span className="tree-title">
                {l.numer}. {l.temat}
              </span>
              <span className="tree-sub">
                {l.poziom} · {l.czasownik}
                {stat ? ` · opanowane ${pct}%` : ''}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
