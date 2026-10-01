CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  words TEXT NOT NULL DEFAULT '[]',
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
  revision INTEGER NOT NULL DEFAULT 0,
  last_gain INTEGER NOT NULL DEFAULT 0,
  deadline INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  reason TEXT CHECK (reason IN ('timeout', 'forfeit')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rankings (
  game_id TEXT PRIMARY KEY REFERENCES games(id),
  nickname TEXT NOT NULL CHECK (length(nickname) BETWEEN 1 AND 12),
  score INTEGER NOT NULL CHECK (score > 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ranking_order ON rankings(score DESC, created_at ASC, game_id ASC);
