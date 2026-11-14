import React, { useEffect, useState } from 'react';
import { getMeta } from '../db.js';
import { gamesToday, GAME_XP_HITS } from '../engine/insights.js';
import { GAMES, gameLock, featuredGame, FEATURED_XP } from '../engine/games.js';
import { POSTCARDS, postcards } from '../engine/journey.js';
import { localDay } from '../../../shared/learning.js';
import { hasVoice } from './useGameRun.js';
import Icon from './Icon.jsx';

// Salon gier: wszystkie gry w jednym miejscu. Na górze dzienny limit XP z gier
// (widać go przed grą, nie dopiero na końcu), pod nim gra dnia z bonusem
// za pierwszą rozgrywkę, a niżej siatka gier z tym, czego uczą, i rekordami.
export default function Arcade({ unlockedLesson, onPlay, onBack }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      const today = localDay();
      const played = await gamesToday(today);
      const best = {};
      for (const g of GAMES) best[g.id] = await getMeta(g.id + 'Best', 0);
      const album = await postcards();
      const voice = hasVoice();
      const open = GAMES.filter((g) => !gameLock(g, unlockedLesson, voice));
      const featured = featuredGame(today, open);
      setData({
        played,
        best,
        voice,
        counted: Math.min(GAME_XP_HITS, played.counted || 0),
        postcards: POSTCARDS.filter((p) => album[p.key]).length,
        featured,
        featuredDone: (await getMeta('featuredDone', '')) === today,
      });
    })();
  }, [unlockedLesson]);

  if (!data) return <div className="screen center">Otwieranie salonu…</div>;
  const left = GAME_XP_HITS - data.counted;

  return (
    <div className="screen arcade">
      <div className="arcade-top">
        <button className="btn ghost" onClick={onBack} aria-label="Wróć"><Icon name="back" /></button>
        <h2>Gry</h2>
        <div className="arcade-xp" title={`Gry liczą się do XP najwyżej do ${GAME_XP_HITS} trafień dziennie, łącznie ze wszystkich gier`}>
          <span>{left > 0 ? `XP z gier ${data.counted}/${GAME_XP_HITS}` : 'limit XP na dziś'}</span>
          <span className="xp-line"><span className="xp-fill" style={{ width: (data.counted / GAME_XP_HITS) * 100 + '%' }} /></span>
        </div>
      </div>

      {data.featured && (
        <button className={'arcade-featured' + (data.featuredDone ? ' done' : '')} onClick={() => onPlay(data.featured.id)}>
          <Icon name="star" size={14} />
          <span className="arcade-featured-label">Gra dnia: <b>{data.featured.name}</b></span>
          <span className="arcade-featured-value">{data.featuredDone ? 'zaliczona' : `+${FEATURED_XP} XP`}</span>
        </button>
      )}

      <div className="arcade-grid">
        {GAMES.map((g) => {
          const lock = gameLock(g, unlockedLesson, data.voice);
          const featured = data.featured?.id === g.id;
          return (
            <button
              key={g.id}
              className={'arcade-card' + (lock ? ' locked' : '') + (featured ? ' featured' : '')}
              disabled={!!lock}
              onClick={() => onPlay(g.id)}
            >
              <span className="arcade-card-head">
                <Icon name={lock ? 'lock' : g.icon} size={16} />
                <span className="arcade-card-name">{g.name}</span>
              </span>
              <span className="arcade-card-teaches">{g.teaches}</span>
              <span className="arcade-card-blurb">{g.blurb}</span>
              <span className="arcade-card-foot">
                {lock ? lock : (
                  <>
                    <Icon name="trophy" size={11} /> {data.best[g.id] || '—'}
                    {g.id === 'road' && <span className="arcade-card-extra"> · {data.postcards}/{POSTCARDS.length} pocztówek</span>}
                    {data.played[g.id] > 0 && <span className="arcade-card-extra"> · dziś {data.played[g.id]}</span>}
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="hint arcade-note">Gry nie zmieniają poziomów kart, ale czas gry liczy się do dziennego celu.</p>
    </div>
  );
}
