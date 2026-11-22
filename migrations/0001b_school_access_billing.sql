-- NAVSTAR ERP schema installation batch 2 of 4
-- Run this entire batch in the Cloudflare D1 SQL Console for navstar-erp-db.
CREATE TABLE IF NOT EXISTS school_settings (
  school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_start_month INTEGER NOT NULL DEFAULT 1 CHECK (academic_year_start_month BETWEEN 1 AND 12),
  timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
  currency TEXT NOT NULL DEFAULT 'KES',
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  role_name TEXT NOT NULL,
  description TEXT,
  is_system_role INTEGER NOT NULL DEFAULT 0 CHECK (is_system_role IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_roles_global_key ON roles(role_key) WHERE school_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_roles_school_key ON roles(school_id, role_key) WHERE school_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  permission_key TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS school_memberships (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_status TEXT NOT NULL DEFAULT 'active' CHECK (membership_status IN ('invited','active','suspended','ended')),
  job_title TEXT,
  staff_number TEXT,
  joined_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (school_id, user_id)
);

CREATE INDEX IF NOT EXISTS ix_memberships_user ON school_memberships(user_id);

CREATE TABLE IF NOT EXISTS user_role_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  scope_json TEXT NOT NULL DEFAULT '{}',
  assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS ix_role_assignments_user_school ON user_role_assignments(user_id, school_id);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  plan_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  billing_model TEXT NOT NULL CHECK (billing_model IN ('per_learner_year','per_learner_term','per_learner_month','flat_school_year','flat_school_term','flat_school_month','one_time','custom')),
  rate_kes REAL NOT NULL DEFAULT 0 CHECK (rate_kes >= 0),
  max_learners INTEGER,
  storage_gb REAL,
  ai_credits INTEGER,
  onboarding_fee_kes REAL NOT NULL DEFAULT 0 CHECK (onboarding_fee_kes >= 0),
  grace_period_days INTEGER NOT NULL DEFAULT 7,
  learner_count_basis TEXT NOT NULL DEFAULT 'active' CHECK (learner_count_basis IN ('active','enrolled')),
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  school_levels_json TEXT NOT NULL DEFAULT '[]',
  payment_methods_json TEXT NOT NULL DEFAULT '["mpesa","bank","card","manual"]',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS school_subscriptions (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES subscription_plans(id) ON DELETE SET NULL,
  billing_model_override TEXT,
  rate_override_kes REAL,
  learner_count INTEGER NOT NULL DEFAULT 0,
  learner_count_basis TEXT NOT NULL DEFAULT 'active' CHECK (learner_count_basis IN ('active','enrolled')),
  discount_percent REAL NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  contract_start_date TEXT,
  next_due_date TEXT,
  preferred_payment_method TEXT,
  payment_terms TEXT,
  status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','past_due','suspended','cancelled','expired')),
  estimated_amount_kes REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS ix_subscriptions_school ON school_subscriptions(school_id);

CREATE INDEX IF NOT EXISTS ix_subscriptions_status ON school_subscriptions(status);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subscription_id TEXT REFERENCES school_subscriptions(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'KES',
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','part_paid','paid','overdue','void')),
  issue_date TEXT,
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
