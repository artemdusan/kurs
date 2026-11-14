import React from 'react';
import { listenDeck, listenOptions } from '../engine/games.js';
import { speak } from './useGameRun.js';
import Icon from './Icon.jsx';
import TimedQuiz from './TimedQuiz.jsx';

// „Eco”: lektor czyta hiszpańskie słowo, a ty wybierasz polskie tłumaczenie.
// Słowo na ekranie pojawia się dopiero po odpowiedzi — wcześniej liczy się tylko ucho.
export default function Eco({ maxLesson, onExit }) {
  return (
    <TimedQuiz
      game="eco"
      icon="ear"
      title="słuchaj i wybierz"
      maxLesson={maxLesson}
      buildDeck={listenDeck}
      optionsFor={(item, deck) => listenOptions(item, deck)}
      emptyText="Za mało słów na grę — najpierw zrób pierwszą sesję."
      onShow={(item) => setTimeout(() => speak(item.es, { rate: 0.9 }), 120)}
      renderPrompt={(item, answer) => (
        <div className="eco-prompt">
          <button className="eco-play" aria-label="Posłuchaj jeszcze raz" onClick={() => speak(item.es, { rate: 0.7 })}>
            <Icon name="soundOn" size={34} />
          </button>
          <p className={'eco-word' + (answer ? ' shown' : '')}>{answer ? item.es : 'dotknij, żeby powtórzyć wolniej'}</p>
        </div>
      )}
      onExit={onExit}
    />
  );
}
