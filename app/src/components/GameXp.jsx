import React from 'react';
import { GAME_XP_HITS } from '../engine/insights.js';

/** Linijka na koniec gry: ile XP doszło i czy dzienny limit XP z gier się wyczerpał. */
export default function GameXp({ counted }) {
  if (!counted) return null;
  const xp = counted.correct * 10;
  if (!counted.limited) return <p className="game-xp">+{xp} XP</p>;
  return (
    <p className="game-xp limited" title={`Gry liczą się do XP najwyżej do ${GAME_XP_HITS} trafień dziennie`}>
      {xp ? `+${xp} XP · ` : ''}limit XP z gier na dziś wyczerpany ({GAME_XP_HITS} trafień) — dalej grasz o rekord
    </p>
  );
}
