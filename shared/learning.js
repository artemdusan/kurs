export const FLOOR_LEVEL = 3;
export const MAX_LEVEL = 10;
export const RULES_VERSION = 2;

export function localDay(value = Date.now()) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Calendar arithmetic, not 24-hour subtraction: safe across DST transitions.
export function shiftDay(day, amount) {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + amount, 12));
}

export function normalizeProgress(p) {
  return { ...p, level: Math.max(1, Math.min(MAX_LEVEL, Math.trunc(Number(p.level) || 1))), rulesVersion: RULES_VERSION };
}

export function progressWins(incoming, local) {
  if (!local) return true;
  const version = (incoming.rulesVersion || 1) - (local.rulesVersion || 1);
  return version > 0 || (version === 0 && incoming.updated_at > local.updated_at);
}

export const COUNTERS = ['correct', 'wrong', 'seconds', 'sessions', 'advances', 'drops'];
export function mergeCounter(a, b) {
  const merged = { ...a, ...b };
  for (const key of COUNTERS) merged[key] = Math.max(0, a?.[key] || 0, b?.[key] || 0);
  merged.updated_at = Math.max(a?.updated_at || 0, b?.updated_at || 0);
  return merged;
}

export function aggregateDays(rows) {
  const days = {};
  for (const row of rows) {
    const day = days[row.day] ||= Object.fromEntries(COUNTERS.map((key) => [key, 0]));
    for (const key of COUNTERS) day[key] += row[key] || 0;
  }
  return days;
}

export function currentStreak(daily, today = localDay()) {
  const active = (day) => ((daily[day]?.correct || 0) + (daily[day]?.wrong || 0)) > 0;
  let day = active(today) ? today : shiftDay(today, -1);
  let count = 0;
  const lastDay = active(day) ? day : '';
  while (active(day)) { count++; day = shiftDay(day, -1); }
  return { count, lastDay };
}
