import React, { useEffect, useState } from 'react';
import { loadDeck, hardWords } from '../engine/insights.js';
import Icon from './Icon.jsx';
import LevelDots from './LevelDots.jsx';

// Lista kart, na których najczęściej pada błąd, z osobną powtórką bez limitu czasu.
export default function HardWords({ maxLesson, onBack, onStart }) {
  const [list, setList] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadDeck(maxLesson).then((deck) => { if (!cancelled) setList(hardWords(deck)); });
    return () => { cancelled = true; };
  }, [maxLesson]);

  if (!list) return <div className="screen center">Szukam trudnych słów…</div>;

  return (
    <div className="screen hard-words">
      <div className="session-top">
        <button className="btn ghost" onClick={onBack} aria-label="Wróć"><Icon name="back" /></button>
        <h2>Trudne słowa</h2>
        <span className="top-spacer" />
      </div>
      {list.length === 0 ? (
        <p className="summary-clean">Brak trudnych słów — żadna karta nie ma jeszcze dwóch pomyłek.</p>
      ) : (
        <>
          <p className="hint">Karty z największym odsetkiem błędów. Powtórka nie ma limitu czasu.</p>
          <div className="summary-list hard-list">
            {list.map(({ word, wrong, rate, level }) => (
              <div className="vocab-row" key={word.id}>
                <span className="vocab-es">{word.es}</span>
                <span className="vocab-pl">{word.pl}</span>
                <span className="hard-rate" title={`${wrong} pomyłek`}>{Math.round(rate * 100)}%</span>
                <LevelDots level={level} small />
              </div>
            ))}
          </div>
          <div className="home-bottom">
            <button className="btn primary big" onClick={onStart}><Icon name="repeat" size={14} /> Powtórz ({list.length})</button>
          </div>
        </>
      )}
    </div>
  );
}
