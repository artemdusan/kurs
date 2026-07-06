import React from 'react';
import { ARTICLE_BUTTONS } from '../engine/keyboard.js';

// Mini klawiatura ekranowa — użytkownik nigdy nie potrzebuje klawiatury systemowej.
export default function Keyboard({ layout, isNoun, article, onArticle, onKey, onBackspace, disabled }) {
  return (
    <div className="kbd">
      {isNoun && (
        <div className="kbd-row kbd-articles">
          {ARTICLE_BUTTONS.map((a) => (
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
      <div className="kbd-row kbd-letters">
        {layout.letters.map((ch) => (
          <button key={ch} className="kbd-key" disabled={disabled} onClick={() => onKey(ch)}>
            {ch}
          </button>
        ))}
      </div>
      <div className="kbd-row">
        {layout.hasSpace && (
          <button className="kbd-key kbd-space" disabled={disabled} onClick={() => onKey(' ')}>
            spacja
          </button>
        )}
        <button className="kbd-key kbd-back" disabled={disabled} onClick={onBackspace}>
          ⌫
        </button>
      </div>
    </div>
  );
}
