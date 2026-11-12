// Czysta logika przypomnień — osobny moduł, żeby dało się ją testować bez Workera.
export const DEFAULT_REMINDER_PREFS = { morning: false, evening: true, streak: true };

export function reminderKind(hour, { answersToday = 0, answersYesterday = 0, prefs = {} } = {}) {
  const p = { ...DEFAULT_REMINDER_PREFS, ...prefs };
  if (answersToday > 0) return null;
  if (hour === 8) return p.morning ? 'morning' : null;
  if (hour === 19) return p.evening ? 'evening' : null;
  if (hour === 21) return p.streak && answersYesterday > 0 ? 'streak' : null;
  return null;
}
