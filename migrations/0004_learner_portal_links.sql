-- NAVSTAR ERP Stage II: parent and learner account links.
-- Safe to apply repeatedly in Cloudflare D1.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS learner_user_links (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(school_id, learner_id),
  UNIQUE(school_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_learner_user_links_user ON learner_user_links(school_id,user_id);
INSERT OR IGNORE INTO schema_migrations(version,description)
VALUES('0004_learner_portal_links','Secure learner account links for learner portal');
