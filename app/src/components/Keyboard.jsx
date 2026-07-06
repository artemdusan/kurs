import React from 'react';
import { keyboardRows } from '../engine/keyboard.js';

// Mini klawiatura ekranowa — układ jak fizyczna klawiatura (rzędy, stała
// kolejność QWERTY, duże klawisze), użytkownik nie potrzebuje systemowej.
export default function Keyboard({ layout, isNoun, articles = [], article, onArticle, onKey, onBackspace, disabled }) {
  const rows = keyboardRows(layout.letters);
  return (
    <div className="kbd">
      {isNoun && (
        <div className="kbd-row kbd-articles">
          {articles.map((a) => (
            <button
              key={a}
              className={'kbd-key kbd-article' + (article === a ? ' active' : '')}
              disabled={disabled}
              onClick={() => onArticle(a)}
            >
              {a}
            </button>
          ))}
        </div>
      )}
      {rows.map((row, i) => (
        <div key={i} className="kbd-row kbd-letters">
          {row.map((ch) => (
            <button key={ch} className="kbd-key" disabled={disabled} onClick={() => onKey(ch)}>
              {ch}
            </button>
          ))}
        </div>
      ))}
      <div className="kbd-row kbd-bottom">
        {layout.hasSpace && (
          <button className="kbd-key kbd-space" disabled={disabled} onClick={() => onKey(' ')}>
            spacja
          </button>
        )}
        <button className="kbd-key kbd-back" disabled={disabled} onClick={onBackspace} aria-label="Usuń znak">
          ⌫
        </button>
      </div>
    </div>
  );
}
