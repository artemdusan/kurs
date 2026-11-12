import React from 'react';
import Icon from './Icon.jsx';

// Pierwsze uruchomienie: trzy zdania o tym, jak działa kurs, i od razu pierwsza sesja.
export default function Welcome({ lesson, onStart, onSkip }) {
  return (
    <div className="screen welcome">
      <div className="welcome-body">
        <p className="welcome-hola">¡Hola!</p>
        <h2>Hiszpański od zera, 10 minut dziennie</h2>
        <ul className="welcome-list">
          <li><Icon name="book" size={18} /><span>Nowe słowo najpierw się przedstawia, dopiero potem pada pytanie.</span></li>
          <li><Icon name="up" size={18} /><span>Dobra odpowiedź podnosi poziom karty, błąd go obniża.</span></li>
          <li><Icon name="lock" size={18} /><span>Gdy wszystkie karty lekcji są na poziomie 3, pokonaj bossa i otwórz następną.</span></li>
        </ul>
      </div>
      <div className="home-bottom">
        <button className="btn primary big" onClick={onStart}>
          <Icon name="play" size={14} /> Zacznij: {lesson?.temat || 'lekcja 1'}
        </button>
        <button className="link-btn" onClick={onSkip}>najpierw się rozejrzę</button>
      </div>
    </div>
  );
}
