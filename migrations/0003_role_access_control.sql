-- NAVSTAR role-based access control extension. Idempotent.
INSERT OR IGNORE INTO roles(id,school_id,role_key,role_name,description,is_system_role) VALUES
('role_school_admin',NULL,'school_admin','School Administrator','Manages users and operations within one assigned school',1);
INSERT OR IGNORE INTO permissions(id,permission_key,description) VALUES
('perm_school_users_manage','school.users.manage','Create, update, suspend and assign users within one school'),
('perm_school_settings_manage','school.settings.manage','Manage settings for the assigned school'),
('perm_attendance_view','attendance.view','View attendance within authorised academic scope'),
('perm_finance_view','finance.view','View school finance within authorised scope'),
('perm_assessments_view','assessments.view','View assessments within authorised academic scope'),
('perm_timetable_view','timetable.view','View timetable within authorised academic scope'),
('perm_library_manage','library.manage','Manage school library'),
('perm_inventory_manage','inventory.manage','Manage school inventory'),
('perm_hr_view','hr.view','View staff and HR records within school'),
('perm_hr_manage','hr.manage','Manage staff and HR records within school'),
('perm_discipline_manage','discipline.manage','Manage learner discipline within school'),
('perm_parent_portal','portal.parent','Access linked learner information only'),
('perm_learner_portal','portal.learner','Access own learner information only');
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT 'role_school_admin',id FROM permissions WHERE permission_key NOT IN ('platform.manage','schools.manage','billing.manage');
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT 'role_principal',id FROM permissions WHERE permission_key IN ('school.users.manage','school.settings.manage','academics.manage','learners.view','learners.manage','staff.manage','classes.manage','allocations.manage','assessments.manage','assessments.view','attendance.manage','attendance.view','finance.view','reports.view','audit.view','profile.self','library.manage','inventory.manage','hr.view','hr.manage','discipline.manage','timetable.view');
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT 'role_teacher',id FROM permissions WHERE permission_key IN ('learners.view','assessments.view','assessments.manage','attendance.view','attendance.manage','timetable.view','reports.view','profile.self');
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT 'role_class_teacher',id FROM permissions WHERE permission_key IN ('learners.view','learners.manage','assessments.view','attendance.view','attendance.manage','timetable.view','reports.view','profile.self');
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT 'role_bursar',id FROM permissions WHERE permission_key IN ('finance.view','finance.manage','reports.view','profile.self');
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT 'role_hr',id FROM permissions WHERE permission_key IN ('hr.view','hr.manage','staff.manage','reports.view','profile.self');
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT 'role_admissions',id FROM permissions WHERE permission_key IN ('learners.view','learners.manage','classes.manage','reports.view','profile.self');
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT 'role_parent',id FROM permissions WHERE permission_key IN ('portal.parent','profile.self');
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT 'role_student',id FROM permissions WHERE permission_key IN ('portal.learner','profile.self');
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES('0003_role_access_control','School administrator role and role permission catalogue');
