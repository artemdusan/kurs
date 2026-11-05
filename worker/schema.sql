-- Schemat D1 dla synchronizacji (lekkie tabele words i progress, soft delete, LWW)

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT UNIQUE NOT NULL,
  -- SHA-256(login + ':' + hasło), hex
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS words (
  user_id INTEGER NOT NULL,
  id TEXT NOT NULL,            -- UUID wygenerowany na urządzeniu, niezmienny
  data TEXT NOT NULL,          -- pełny rekord JSON
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_words_updated ON words (user_id, updated_at);

CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER NOT NULL,
  word_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, word_id)
);
CREATE INDEX IF NOT EXISTS idx_progress_updated ON progress (user_id, updated_at);

-- Statystyki (dailyStats, streak): mały JSON blob per klucz, scalany na
-- serwerze (nie prostym LWW całego bloba — patrz worker/src/index.js),
-- żeby nauka na dwóch urządzeniach w różne dni się nie kasowała.
-- Subskrypcje web push (przypomnienia o 19:00 czasu polskiego, gdy danego
-- dnia nie było sesji). Jedno urządzenie = jedna subskrypcja (endpoint).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  data TEXT NOT NULL,          -- pełna subskrypcja JSON (endpoint + klucze)
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, endpoint)
);

CREATE TABLE IF NOT EXISTS meta (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- Per-device monotone counters: retries do not duplicate totals and concurrent
-- offline sessions on two devices add up. Safe to apply to an existing DB.
CREATE TABLE IF NOT EXISTS daily_counters (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  device_id TEXT NOT NULL,
  correct INTEGER NOT NULL DEFAULT 0,
  wrong INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  advances INTEGER NOT NULL DEFAULT 0,
  drops INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, device_id)
);
