import React, { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import PixelMap from './PixelMap.jsx';

// Ścieżka całego kursu: otwarte lekcje można przeglądać, zamknięte pokazują,
// co jest przed nami. Lekcje są pogrupowane poziomami (A0, A1, …).
export default function LessonList({ index, unlockedLesson, lessonStats, current, onSelect, onBack }) {
  const currentRef = useRef(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  const groups = [];
  for (const l of index.lekcje) {
    const last = groups[groups.length - 1];
    if (last && last.level === l.poziom) last.items.push(l);
    else groups.push({ level: l.poziom, items: [l] });
  }

  return (
    <div className="screen lesson-list">
      <div className="session-top">
        <button className="btn ghost" onClick={onBack} aria-label="Wróć">
          <Icon name="back" />
        </button>
        <h2>Lekcje</h2>
        <span className="lesson-list-count">{unlockedLesson}/{index.lekcje.length}</span>
      </div>

      <PixelMap unlockedLesson={unlockedLesson} lessonStats={lessonStats} current={current} onSelect={onSelect} />

      <div className="lesson-list-items">
        {groups.map((g) => (
          <React.Fragment key={g.level + g.items[0].numer}>
            <h3 className="lesson-list-level">
              {g.level}
              <span>lekcje {g.items[0].numer}–{g.items[g.items.length - 1].numer}</span>
            </h3>
            {g.items.map((l) => {
              const locked = l.numer > unlockedLesson;
              const stat = lessonStats[l.numer];
              const pct = stat ? Math.round((stat.mastered / stat.total) * 100) : 0;
              return (
                <button
                  key={l.numer}
                  ref={l.numer === current ? currentRef : null}
                  className={'lesson-list-item' + (l.numer === current ? ' active' : '') + (locked ? ' locked' : '')}
                  disabled={locked}
                  onClick={() => onSelect(l.numer)}
                >
                  <span className="lesson-list-num">{locked ? <Icon name="lock" size={14} /> : l.numer}</span>
                  <span className="lesson-list-info">
                    <span className="lesson-list-title">{l.temat}</span>
                    <span className="lesson-list-sub">{locked ? `lekcja ${l.numer} · ${l.czasownik}` : l.czasownik}</span>
                  </span>
                  {!locked && (
                    <span className={'lesson-list-pct' + (pct === 100 ? ' full' : '')}>{pct === 100 ? <Icon name="star" size={12} /> : pct + '%'}</span>
                  )}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
