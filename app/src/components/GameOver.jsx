import React from 'react';
import Icon from './Icon.jsx';
import GameXp from './GameXp.jsx';

/** Ekran końca gry z salonu: wynik, rekord, XP w ramach limitu i co dalej. */
export default function GameOver({ title, result, children, onAgain, onExit }) {
  if (!result) return <div className="screen center">Zapisywanie wyniku…</div>;
  return (
    <div className="screen center pairs-done">
      <h2>{result.record ? 'Nowy rekord!' : title}</h2>
      <p className={'pairs-final' + (result.record ? ' record' : '')}>{result.score}</p>
      <p className="pairs-sub">
        <Icon name="trophy" size={14} /> rekord: {result.best}
      </p>
      {children}
      <GameXp counted={result.counted} />
      <button className="btn primary big" onClick={onAgain}>Jeszcze raz</button>
      <button className="btn" onClick={onExit}>Wróć</button>
    </div>
  );
}
