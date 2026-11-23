-- Navstar school role permissions, multi-role access and output template catalogue.
-- Apply this migration once to the navstar-erp-db D1 database.

INSERT OR IGNORE INTO roles(id,school_id,role_key,role_name,description,is_system_role) VALUES
('role_school_admin',NULL,'school_admin','School Administrator','Full administration of one school workspace',1),
('role_senior_teacher',NULL,'senior_teacher','Senior Teacher','Teacher supervision and academic monitoring',1);

INSERT OR IGNORE INTO permissions(id,permission_key,description) VALUES
('perm_school_users_manage','school.users.manage','Manage accounts within the assigned school'),
('perm_school_settings_manage','school.settings.manage','Manage school settings and communication'),
('perm_staff_view','staff.view','View staff records within the school'),
('perm_classes_view','classes.view','View classes and streams'),
('perm_attendance_view','attendance.view','View attendance registers and summaries'),
('perm_timetable_view','timetable.view','View published timetable'),
('perm_finance_view','finance.view','View fees and finance records'),
('perm_assessments_view','assessments.view','View assessments and learner results'),
('perm_hr_view','hr.view','View HR and staff employment information'),
('perm_hr_manage','hr.manage','Manage HR records and payroll'),
('perm_library_manage','library.manage','Manage library books and loans'),
('perm_inventory_manage','inventory.manage','Manage school inventory'),
('perm_discipline_manage','discipline.manage','Manage learner discipline records'),
('perm_support_view','support.view','View and raise school support requests');

UPDATE roles SET role_name='Subject Teacher' WHERE role_key='teacher' AND school_id IS NULL;
UPDATE roles SET role_name='Finance Officer / Bursar' WHERE role_key='bursar_accountant' AND school_id IS NULL;
UPDATE roles SET role_name='Admissions Registrar' WHERE role_key='admissions_registrar' AND school_id IS NULL;

-- School Administrator: complete school-level administration, never platform-wide access.
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT 'role_school_admin',id FROM permissions WHERE permission_key IN (
'academics.manage','learners.view','learners.manage','staff.view','staff.manage','classes.view','classes.manage',
'allocations.manage','assessments.view','assessments.manage','attendance.view','attendance.manage','timetable.view',
'finance.view','finance.manage','hr.view','hr.manage','reports.view','audit.view','school.users.manage',
'school.settings.manage','library.manage','inventory.manage','discipline.manage','support.view','profile.self'
);

-- School Owner / Director and school leadership.
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key IN (
'academics.manage','learners.view','learners.manage','staff.view','staff.manage','classes.view','classes.manage',
'allocations.manage','assessments.view','assessments.manage','attendance.view','attendance.manage','timetable.view',
'finance.view','reports.view','hr.view','hr.manage','audit.view','school.users.manage','school.settings.manage',
'library.manage','inventory.manage','discipline.manage','support.view','profile.self'
) WHERE r.school_id IS NULL AND r.role_key IN ('school_owner','principal','deputy_principal');

-- Academic leadership and supervision.
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key IN (
'academics.manage','learners.view','staff.view','classes.view','allocations.manage','assessments.view',
'assessments.manage','attendance.view','timetable.view','reports.view','discipline.manage','profile.self'
) WHERE r.school_id IS NULL AND r.role_key IN ('director_of_studies','deputy_director_of_studies');
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key IN ('learners.view','staff.view','classes.view','assessments.view','attendance.view','timetable.view','reports.view','profile.self') WHERE r.school_id IS NULL AND r.role_key='senior_teacher';

-- Heads of Department.
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key IN (
'learners.view','staff.view','classes.view','allocations.manage','assessments.view','assessments.manage',
'attendance.view','timetable.view','reports.view','profile.self'
) WHERE r.school_id IS NULL AND r.role_key='head_of_department';

-- Subject and class teachers.
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key IN (
'learners.view','classes.view','attendance.view','attendance.manage','timetable.view',
'assessments.view','assessments.manage','reports.view','discipline.manage','profile.self'
) WHERE r.school_id IS NULL AND r.role_key IN ('teacher','class_teacher');

-- Examinations officers.
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key IN (
'learners.view','classes.view','assessments.view','assessments.manage','academics.manage','reports.view','timetable.view','profile.self'
) WHERE r.school_id IS NULL AND r.role_key='examinations_officer';

-- Finance, HR, admissions and library positions.
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key IN (
'finance.view','finance.manage','reports.view','profile.self'
) WHERE r.school_id IS NULL AND r.role_key='bursar_accountant';
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key IN (
'staff.view','staff.manage','hr.view','hr.manage','reports.view','profile.self'
) WHERE r.school_id IS NULL AND r.role_key='hr_administrator';
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key IN (
'learners.view','learners.manage','classes.view','reports.view','profile.self'
) WHERE r.school_id IS NULL AND r.role_key='admissions_registrar';
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key IN (
'library.manage','learners.view','reports.view','profile.self'
) WHERE r.school_id IS NULL AND r.role_key='librarian';

DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE school_id IS NULL AND role_key IN ('parent_guardian','student_learner')) AND permission_id=(SELECT id FROM permissions WHERE permission_key='reports.view');

-- Parent and learner accounts only receive their linked-personal information.
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key IN ('profile.self')
WHERE r.school_id IS NULL AND r.role_key IN ('parent_guardian','student_learner');

CREATE TABLE IF NOT EXISTS platform_output_templates (
 id TEXT PRIMARY KEY,
 template_key TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 category TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1,
 template_json TEXT NOT NULL DEFAULT '{}',
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO platform_output_templates(id,template_key,name,category,description,template_json) VALUES
('out_learner_import','learner_import','Learner registration import','Import template','CSV template for registering learners and enrolling them into a school year, grade and stream.','{"columns":["admission_number","first_name","middle_name","last_name","gender","date_of_birth","status","pathway","academic_year","grade","stream"],"required":["admission_number","first_name","last_name","academic_year","grade"],"format":"csv"}'),
('out_enrollment_import','enrollment_import','Bulk learner enrolment','Import template','CSV template for enrolling existing learners into an academic year, grade and stream.','{"columns":["admission_number","academic_year","grade","stream"],"required":["admission_number","academic_year","grade"],"format":"csv"}'),
('out_staff_import','staff_import','Staff directory import','Import template','CSV template for importing staff records and linking them to existing user accounts.','{"columns":["username","staff_number","department","employment_type","employment_status","hire_date"],"required":["username","staff_number"],"format":"csv"}'),
('out_marks_import','marks_import','Assessment marks import','Import template','CSV template for importing assessment marks by admission number.','{"columns":["assessment_id","admission_number","score","feedback"],"required":["assessment_id","admission_number","score"],"format":"csv"}'),
('out_attendance_register','attendance_register','Class attendance register','School report','Printable attendance register with learner admission numbers and daily attendance status.','{"sections":["school_identity","class_details","attendance_date","learner_list","attendance_totals","teacher_signature"],"format":"pdf"}'),
('out_fee_statement','fee_statement','Learner fee statement','Finance report','Learner fee statement with charges, receipts, balance and school payment details.','{"sections":["school_identity","learner_identity","fee_charges","receipts","balance","finance_signoff"],"format":"pdf"}'),
('out_report_card','report_card','Learner report card','Academic report','Term report card with school branding, learner details, learning areas, marks, grades, descriptors, attendance, teacher comments and approval signatures.','{"sections":["school_identity","learner_identity","academic_period","learning_area_results","overall_performance","attendance_summary","teacher_comment","dos_comment","principal_comment","next_term_opening","signatures"],"grading_scheme":"school_configured","format":"pdf"}'),
('out_school_performance','school_performance','School performance report','Management report','Whole-school academic and operational performance report with period, cohort and class summaries.','{"sections":["school_identity","report_period","enrolment_summary","attendance_summary","assessment_performance","class_comparison","learning_area_analysis","prepared_by","approval"],"format":"pdf"}');
