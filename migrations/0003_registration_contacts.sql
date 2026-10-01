ALTER TABLE rankings RENAME TO rankings_previous;
CREATE TABLE rankings (
  game_id TEXT PRIMARY KEY REFERENCES games(id),
  nickname TEXT NOT NULL CHECK (length(nickname) BETWEEN 1 AND 12),
  score INTEGER NOT NULL CHECK (score >= 0),
  created_at INTEGER NOT NULL
);
INSERT INTO rankings SELECT * FROM rankings_previous;
DROP TABLE rankings_previous;
CREATE INDEX ranking_order ON rankings(score DESC, created_at ASC, game_id ASC);
CREATE TABLE ranking_contacts (
  game_id TEXT PRIMARY KEY REFERENCES rankings(game_id),
  phone TEXT NOT NULL CHECK (length(phone) BETWEEN 9 AND 16),
  created_at INTEGER NOT NULL
);
