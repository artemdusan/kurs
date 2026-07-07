import React from 'react';

// Poziome paski rozkładu poziomów słów (poz. 1 = czerwony ... poz. 6 = zielony).
// Szerokość jest procentem WSZYSTKICH słów, więc paski razem sumują się do 100%.
export default function LevelBars({ levels }) {
  const total = Math.max(1, levels.reduce((s, n) => s + n, 0));
  return (
    <div className="level-bars">
      {levels.map((count, i) => (
        <div key={i} className="level-bar-row">
          <span className="level-bar-label">poz. {i + 1}</span>
          <div className="level-bar-track">
            <div
              className={'level-bar-fill lvl-' + (i + 1)}
              style={{ width: (count / total) * 100 + '%' }}
            />
          </div>
          <span className="level-bar-count">{count}</span>
        </div>
      ))}
    </div>
  );
}
