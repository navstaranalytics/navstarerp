-- NAVSTAR ERP schema installation batch 3 of 4
-- Run this entire batch in the Cloudflare D1 SQL Console for navstar-erp-db.
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
