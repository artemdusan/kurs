// Dźwięki 8-bit generowane w przeglądarce (Web Audio, fala prostokątna) — bez
// plików. Każdy efekt to krótka sekwencja nut. Wyłącznik: Ustawienia → Dźwięki.

let ctx = null;
let enabled = true;

export function setSoundEnabled(on) { enabled = Boolean(on); }

function audio() {
  if (!enabled || typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** notes: [częstotliwość Hz, długość s][] grane jedna po drugiej. */
function play(notes, { type = 'square', volume = 0.06 } = {}) {
  const ac = audio();
  if (!ac) return;
  try {
    let t = ac.currentTime;
    for (const [freq, dur] of notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur * 0.85;
    }
  } catch {
    /* dźwięk jest dodatkiem — brak wsparcia niczego nie psuje */
  }
}

const NOTE = { C5: 523, D5: 587, E5: 659, G5: 784, A5: 880, C6: 1047, E6: 1319, G6: 1568 };
const SCALE = [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568];

export const sfx = {
  /** poprawna odpowiedź; im dłuższa seria, tym wyższy ton */
  correct: (streak = 1) => play([[SCALE[Math.min(SCALE.length - 1, Math.max(0, streak - 1))], 0.09]]),
  wrong: () => play([[196, 0.12], [147, 0.18]], { type: 'sawtooth', volume: 0.05 }),
  levelUp: () => play([[NOTE.C5, 0.08], [NOTE.E5, 0.08], [NOTE.G5, 0.14]]),
  gold: () => play([[NOTE.E5, 0.07], [NOTE.G5, 0.07], [NOTE.C6, 0.07], [NOTE.E6, 0.2]]),
  pair: (combo = 1) => play([[SCALE[Math.min(SCALE.length - 1, combo)], 0.08]]),
  fanfare: () => play([[NOTE.C5, 0.1], [NOTE.E5, 0.1], [NOTE.G5, 0.1], [NOTE.C6, 0.12], [NOTE.G5, 0.08], [NOTE.C6, 0.32]], { volume: 0.07 }),
  tick: () => play([[NOTE.A5, 0.04]], { volume: 0.03 }),
};
