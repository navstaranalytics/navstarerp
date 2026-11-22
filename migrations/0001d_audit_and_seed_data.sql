-- NAVSTAR ERP schema installation batch 4 of 4
-- Run this entire batch in the Cloudflare D1 SQL Console for navstar-erp-db.
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
