import React from 'react';

// Proste ikony SVG (spójne na każdym systemie, w przeciwieństwie do emoji).
const PATHS = {
  close: <path d="M5 5 L19 19 M19 5 L5 19" />,
  back: <path d="M14 5 L7 12 L14 19" />,
  play: <path d="M7 4 L19 12 L7 20 Z" fill="currentColor" stroke="none" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" />
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
};

// Buźka statusu dnia: zielona (cel minut osiągnięty), żółta (była nauka,
// ale poniżej celu), czerwona (dziś jeszcze nic). Kolory z motywu aplikacji.
const FACE_COLORS = { green: 'var(--green)', yellow: 'var(--amber)', red: 'var(--red)' };
const FACE_MOUTHS = {
  green: <path d="M8 14c1 2.2 2.5 3.2 4 3.2s3-1 4-3.2" />,
  yellow: <path d="M8.5 15.2h7" />,
  red: <path d="M8 16.8c1-2.2 2.5-3.2 4-3.2s3 1 4 3.2" />,
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
