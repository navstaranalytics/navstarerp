CREATE TABLE IF NOT EXISTS platform_backups (
  id TEXT PRIMARY KEY,
  backup_type TEXT NOT NULL DEFAULT 'full',
  object_key TEXT NOT NULL UNIQUE,
  byte_count INTEGER NOT NULL CHECK (byte_count > 0),
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified','failed')),
  source TEXT NOT NULL DEFAULT 'github-actions',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_platform_backups_created
ON platform_backups(status, created_at DESC);
