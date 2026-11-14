import React from 'react';
import { clozeDeck, clozeOptions } from '../engine/games.js';
import { speak } from './useGameRun.js';
import TimedQuiz from './TimedQuiz.jsx';

// „Luka”: zdanie z przykładów lekcji z dziurą i cztery słowa do wyboru.
// Polskie tłumaczenie zdania jest widoczne od razu — bez niego kilka opcji
// pasowałoby gramatycznie („Preparo ___ para mis amigos”), a chodzi o znaczenie.
export default function Luka({ maxLesson, settings, onExit }) {
  return (
    <TimedQuiz
      game="luka"
      icon="gap"
      title="uzupełnij zdanie"
      maxLesson={maxLesson}
      buildDeck={clozeDeck}
      optionsFor={(item, deck) => clozeOptions(item, deck)}
      emptyText="Za mało zdań na grę — najpierw zrób pierwszą sesję."
      onAnswer={(item) => { if (settings?.tts !== false) speak(item.before + item.answer + item.after); }}
      renderPrompt={(item, answer) => (
        <div className="cloze">
          <p className="cloze-es">
            {item.before}
            <span className={'cloze-gap' + (answer ? ' revealed ' + (answer.ok ? 'ok' : 'bad') : '')}>{answer ? item.answer : '____'}</span>
            {item.after}
          </p>
          <p className="cloze-pl">{item.pl}</p>
        </div>
      )}
      onExit={onExit}
    />
  );
}
