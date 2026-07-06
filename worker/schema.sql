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
