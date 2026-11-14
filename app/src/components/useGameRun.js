import { useEffect, useRef, useState } from 'react';
import { addActivity } from '../activity.js';
import { saveGameScore, countGameHits } from '../engine/insights.js';
import { localDay } from '../../../shared/learning.js';
import { sfx } from '../sound.js';
import { rain, COLORS } from '../particles.js';

/**
 * Wspólny przebieg gier z salonu (Lluvia, Luka, Eco): liczy sekundy gry
 * (w tle czas stoi), trafienia i błędy, a na końcu zapisuje rekord, dzisiejszy
 * wynik (wyzwanie / gra dnia) i odpowiedzi dnia w ramach limitu XP z gier.
 * Zapis dzieje się raz — także przy wyjściu z gry w trakcie.
 */
export function useGameRun(game, running) {
  const stats = useRef({ hits: 0, mistakes: 0, seconds: 0, saved: false });
  const [result, setResult] = useState(null); // { score, best, record, counted }

  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => {
      if (document.visibilityState !== 'hidden') stats.current.seconds++;
    }, 1000);
    return () => clearInterval(t);
  }, [running]);

  async function save() {
    const s = stats.current;
    if (s.saved) return null;
    s.saved = true;
    if (s.hits + s.mistakes + s.seconds === 0) return null;
    const counted = await countGameHits(s.hits, s.mistakes, localDay()).catch(() => ({ correct: 0, wrong: 0, limited: true }));
    await addActivity({ correct: counted.correct, wrong: counted.wrong, seconds: s.seconds }).catch(() => {});
    return counted;
  }

  // wyjście z gry (np. zamknięcie karty) też zapisuje czas i odpowiedzi
  useEffect(() => () => { save(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function finish(score) {
    const previous = await saveGameScore(game, score, localDay()).catch(() => 0);
    const record = score > previous && previous > 0;
    if (record) { rain({ colors: COLORS.gold, seconds: 2 }); sfx.fanfare(); }
    const counted = await save();
    setResult({ score, best: Math.max(previous, score), record, counted });
  }

  function reset() {
    stats.current = { hits: 0, mistakes: 0, seconds: 0, saved: false };
    setResult(null);
  }

  return {
    stats,
    result,
    hit: () => { stats.current.hits++; },
    miss: () => { stats.current.mistakes++; },
    finish,
    save,
    reset,
  };
}

/** Lektor (es-ES); bez Web Speech gra po prostu milczy. */
export function speak(text, { rate = 0.95 } = {}) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-ES';
    u.rate = rate;
    window.speechSynthesis.speak(u);
  } catch {
    /* TTS jest opcjonalne */
  }
}

export const hasVoice = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
