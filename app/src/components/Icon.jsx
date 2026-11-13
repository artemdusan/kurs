import React from 'react';

// Proste ikony SVG (spójne na każdym systemie, w przeciwieństwie do emoji).
const PATHS = {
  close: <path d="M5 5 L19 19 M19 5 L5 19" />,
  back: <path d="M14 5 L7 12 L14 19" />,
  play: <path d="M7 4 L19 12 L7 20 Z" fill="currentColor" stroke="none" />,
  // suwaki — jednoznacznie „ustawienia” (koło z promieniami wyglądało jak słońce)
  gear: (
    <>
      <path d="M4 7h8M18 7h2M4 17h2M12 17h8" />
      <path d="M12 4.5h6v5h-6ZM6 14.5h6v5H6Z" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-8M4 20h17" />,
  repeat: <path d="M4 9a7 7 0 0 1 12-3l3 3M19 4v5h-5M20 15a7 7 0 0 1-12 3l-3-3M5 20v-5h5" />,
  soundOn: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" stroke="none" />
      <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  soundOff: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" stroke="none" />
      <path d="M16 9l5 6M21 9l-5 6" />
    </>
  ),
  fire: <path d="M12 3c1 3-2 4.5-2 7a2 2 0 0 0 4 .4C15.5 9 16 7.5 16 6c2 2 4 4.7 4 8a8 8 0 1 1-16 0c0-4 3-6.5 4-8 .3 1.2 1 2 2 3 .5-2-.5-4 2-6Z" />,
  book: <path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2V5ZM4 19a2 2 0 0 1 2-2h14M8 7h8M8 11h8" />,
  list: <path d="M4 6h16M4 12h16M4 18h16" />,
  bolt: <path d="M13 3 L5 13 h6 l-1 8 l9-11 h-6 Z" fill="currentColor" stroke="none" />,
  pairs: <path d="M3 5h7v7H3ZM14 5h7v7h-7ZM3 15h7v5H3ZM14 15h7v5h-7Z" />,
  lock: <path d="M6 11h12v9H6ZM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11" />,
  up: <path d="M12 20V5M5 12l7-7 7 7" />,
  star: <path d="M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.9 6.4 20l1.3-6.2L3 9.5l6.3-.7Z" fill="currentColor" stroke="none" />,
  // joker 50/50: karta przecięta na pół
  joker: <path d="M6 3h12v18H6ZM6 21 18 3M9 7h2M13 17h2" />,
  heart: <path d="M12 20 L4 12 V7 H7 V5 H10 V7 H12 H14 V5 H17 V7 H20 V12 Z" fill="currentColor" stroke="none" />,
  road: <path d="M9 3 L4 21 M15 3 L20 21 M12 5v3 M12 11v3 M12 17v3" />,
  trophy: <path d="M7 4h10v5a5 5 0 0 1-10 0ZM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v4M8 20h8" />,
};

// Buźka statusu dnia: zielona (cel minut osiągnięty), żółta (była nauka,
// ale poniżej celu), szara i spokojna (dziś jeszcze nic — bez karcenia).
const FACE_COLORS = { green: 'var(--green)', yellow: 'var(--amber)', red: 'var(--muted)' };
const FACE_MOUTHS = {
  green: <path d="M8 14c1 2.2 2.5 3.2 4 3.2s3-1 4-3.2" />,
  yellow: <path d="M8.5 14.8c1 1 2.2 1.5 3.5 1.5s2.5-.5 3.5-1.5" />,
  red: <path d="M8.5 15.2h7" />,
};

export function FaceIcon({ status = 'red', size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={FACE_COLORS[status] || FACE_COLORS.red}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.2" />
      <path d="M8.6 9.4h.01M15.4 9.4h.01" strokeWidth="2.8" />
      {FACE_MOUTHS[status] || FACE_MOUTHS.red}
    </svg>
  );
}

export default function Icon({ name, size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
