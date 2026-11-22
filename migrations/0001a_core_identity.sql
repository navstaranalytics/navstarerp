-- NAVSTAR ERP schema installation batch 1 of 4
-- Run this entire batch in the Cloudflare D1 SQL Console for navstar-erp-db.
PRAGMA foreign_keys = ON;

-- NAVSTAR ERP foundational schema
-- Target: Cloudflare D1 (SQLite)
-- Apply once to navstar-erp-db. This script is intentionally idempotent.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  email_normalized TEXT,
  username TEXT,
  username_normalized TEXT,
  phone TEXT,
  full_name TEXT NOT NULL,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','suspended','locked','disabled')),
  email_verified_at TEXT,
  phone_verified_at TEXT,
  last_login_at TEXT,
  password_changed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_normalized ON users(email_normalized) WHERE email_normalized IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username_normalized ON users(username_normalized) WHERE username_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_users_status ON users(status);

CREATE TABLE IF NOT EXISTS super_admin_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  designation TEXT,
  organisation_name TEXT NOT NULL DEFAULT 'NAVSTAR Analytics',
  profile_photo_url TEXT,
  country TEXT NOT NULL DEFAULT 'Kenya',
  timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
  currency TEXT NOT NULL DEFAULT 'KES',
  is_primary_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_primary_owner IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS ix_auth_sessions_user ON auth_sessions(user_id);

CREATE INDEX IF NOT EXISTS ix_auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  school_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  registration_number TEXT,
  emis_code TEXT,
  institution_type TEXT,
  ownership TEXT,
  sponsor TEXT,
  county TEXT,
  sub_county TEXT,
  town TEXT,
  physical_address TEXT,
  contact_person TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  curriculum TEXT NOT NULL DEFAULT 'CBC',
  school_levels_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','archived')),
  timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
  currency TEXT NOT NULL DEFAULT 'KES',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  activated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS ix_schools_status ON schools(status);

CREATE INDEX IF NOT EXISTS ix_schools_county ON schools(county);

CREATE INDEX IF NOT EXISTS ix_schools_name ON schools(name);
