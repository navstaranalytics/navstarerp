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
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  method TEXT NOT NULL,
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','failed','reversed')),
  received_at TEXT,
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_payments_school ON payments(school_id);

CREATE TABLE IF NOT EXISTS academic_years (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','completed','archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (school_id, name),
  CHECK (end_date >= start_date)
);
CREATE TABLE IF NOT EXISTS terms (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','completed','archived')),
  UNIQUE (academic_year_id, name),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS grade_levels (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  curriculum TEXT NOT NULL DEFAULT 'CBC',
  stage_code TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  stage_order INTEGER NOT NULL DEFAULT 0,
  school_level TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  UNIQUE (school_id, curriculum, stage_code)
);
CREATE TABLE IF NOT EXISTS streams (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  grade_level_id TEXT NOT NULL REFERENCES grade_levels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER,
  classroom TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  UNIQUE (grade_level_id, name)
);
CREATE TABLE IF NOT EXISTS learning_areas (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  curriculum TEXT NOT NULL DEFAULT 'CBC',
  code TEXT,
  name TEXT NOT NULL,
  stage_code TEXT,
  pathway TEXT CHECK (pathway IS NULL OR pathway IN ('STEM','Social Sciences','Arts & Sports Science')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);
CREATE INDEX IF NOT EXISTS ix_learning_areas_school ON learning_areas(school_id);

CREATE TABLE IF NOT EXISTS staff_profiles (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  staff_number TEXT,
  department TEXT,
  employment_type TEXT,
  employment_status TEXT NOT NULL DEFAULT 'active',
  hire_date TEXT,
  profile_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (school_id, staff_number)
);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  grade_level_id TEXT NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
  stream_id TEXT NOT NULL REFERENCES streams(id) ON DELETE RESTRICT,
  class_teacher_staff_id TEXT REFERENCES staff_profiles(id) ON DELETE SET NULL,
  capacity INTEGER,
  room TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  UNIQUE (academic_year_id, stream_id)
);

CREATE TABLE IF NOT EXISTS learners (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  admission_number TEXT NOT NULL,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  gender TEXT,
  date_of_birth TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('applicant','active','transferred','graduated','withdrawn','inactive')),
  pathway TEXT CHECK (pathway IS NULL OR pathway IN ('STEM','Social Sciences','Arts & Sports Science')),
  profile_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (school_id, admission_number)
);
CREATE INDEX IF NOT EXISTS ix_learners_school_name ON learners(school_id, last_name, first_name);

CREATE TABLE IF NOT EXISTS learner_enrollments (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  grade_level_id TEXT NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
  stream_id TEXT REFERENCES streams(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','transferred','withdrawn')),
  enrolled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (learner_id, academic_year_id)
);
CREATE INDEX IF NOT EXISTS ix_enrollments_class ON learner_enrollments(school_id, academic_year_id, grade_level_id, stream_id);

CREATE TABLE IF NOT EXISTS guardians (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  relationship TEXT
);
CREATE TABLE IF NOT EXISTS learner_guardians (
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  guardian_id TEXT NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  receives_communications INTEGER NOT NULL DEFAULT 1 CHECK (receives_communications IN (0,1)),
  PRIMARY KEY (learner_id, guardian_id)
);

CREATE TABLE IF NOT EXISTS teacher_allocations (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  term_id TEXT REFERENCES terms(id) ON DELETE SET NULL,
  grade_level_id TEXT NOT NULL REFERENCES grade_levels(id) ON DELETE CASCADE,
  stream_id TEXT REFERENCES streams(id) ON DELETE CASCADE,
  learning_area_id TEXT NOT NULL REFERENCES learning_areas(id) ON DELETE CASCADE,
  pathway TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_teacher_allocations_scope ON teacher_allocations(school_id, staff_id, academic_year_id, grade_level_id, stream_id);

CREATE TABLE IF NOT EXISTS learner_transfers (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  from_enrollment_id TEXT REFERENCES learner_enrollments(id) ON DELETE SET NULL,
  to_enrollment_id TEXT REFERENCES learner_enrollments(id) ON DELETE SET NULL,
  reason TEXT,
  transferred_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  transferred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  outcome TEXT NOT NULL DEFAULT 'success' CHECK (outcome IN ('success','denied','failure')),
  ip_hash TEXT,
  user_agent TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS ix_audit_logs_school ON audit_logs(school_id, created_at);

CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',
  channel TEXT NOT NULL DEFAULT 'in_app',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','archived')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  scheduled_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);


-- Seed the platform and school role catalogue.
INSERT OR IGNORE INTO roles(id, school_id, role_key, role_name, description, is_system_role) VALUES
('role_super_admin', NULL, 'super_admin', 'Super Admin', 'Full platform administration', 1),
('role_school_owner', NULL, 'school_owner', 'School Owner / Director', 'School governance and ownership', 1),
('role_principal', NULL, 'principal', 'Principal / Headteacher', 'Overall school leadership', 1),
('role_deputy_principal', NULL, 'deputy_principal', 'Deputy Principal', 'Delegated school leadership', 1),
('role_director_studies', NULL, 'director_of_studies', 'Director of Studies', 'Academic leadership and oversight', 1),
('role_deputy_dos', NULL, 'deputy_director_of_studies', 'Deputy Director of Studies', 'Delegated academic coordination', 1),
('role_hod', NULL, 'head_of_department', 'Head of Department', 'Department leadership', 1),
('role_exam_officer', NULL, 'examinations_officer', 'Examinations Officer', 'Examination administration', 1),
('role_class_teacher', NULL, 'class_teacher', 'Class Teacher', 'Assigned class management', 1),
('role_teacher', NULL, 'teacher', 'Teacher', 'Allocated learning-area teaching', 1),
('role_bursar', NULL, 'bursar_accountant', 'Bursar / Accountant', 'School finance operations', 1),
('role_hr', NULL, 'hr_administrator', 'HR Administrator', 'Staff and HR administration', 1),
('role_admissions', NULL, 'admissions_registrar', 'Admissions / Registrar', 'Admissions and learner records', 1),
('role_librarian', NULL, 'librarian', 'Librarian', 'Library operations', 1),
('role_parent', NULL, 'parent_guardian', 'Parent / Guardian', 'Linked learner access', 1),
('role_student', NULL, 'student_learner', 'Student / Learner', 'Personal learner access', 1);

INSERT OR IGNORE INTO permissions(id, permission_key, description) VALUES
('perm_platform_manage','platform.manage','Manage platform configuration and administration'),
('perm_schools_view','schools.view','View school tenants'),
('perm_schools_manage','schools.manage','Create and manage school tenants'),
('perm_users_manage','users.manage','Manage platform and school user accounts'),
('perm_billing_manage','billing.manage','Manage plans, subscriptions, invoices and payments'),
('perm_academics_manage','academics.manage','Manage school academic setup'),
('perm_learners_view','learners.view','View learners within authorised scope'),
('perm_learners_manage','learners.manage','Manage learner records within authorised scope'),
('perm_staff_manage','staff.manage','Manage staff within authorised scope'),
('perm_classes_manage','classes.manage','Manage classes and streams'),
('perm_allocations_manage','allocations.manage','Manage teacher allocations'),
('perm_assessments_manage','assessments.manage','Manage assessments and results'),
('perm_attendance_manage','attendance.manage','Manage attendance'),
('perm_finance_manage','finance.manage','Manage school finance'),
('perm_reports_view','reports.view','View reports within authorised scope'),
('perm_audit_view','audit.view','View authorised audit records'),
('perm_profile_self','profile.self','Manage own profile and credentials');

INSERT OR IGNORE INTO role_permissions(role_id, permission_id)
SELECT 'role_super_admin', id FROM permissions;

INSERT OR IGNORE INTO schema_migrations(version, description)
VALUES ('0001_initial_schema', 'Initial NAVSTAR multi-tenant ERP schema');
