import { getSuperAdminSession } from "./auth.js";
const statements = [
"INSERT OR IGNORE INTO roles(id,school_id,role_key,role_name,description,is_system_role) VALUES('role_school_admin',NULL,'school_admin','School Administrator','Manages users and operations within one assigned school',1)",
"INSERT OR IGNORE INTO permissions(id,permission_key,description) VALUES('perm_school_users_manage','school.users.manage','Manage users within one school'),('perm_school_settings_manage','school.settings.manage','Manage assigned school settings'),('perm_attendance_view','attendance.view','View attendance within authorised scope'),('perm_finance_view','finance.view','View school finance'),('perm_assessments_view','assessments.view','View assessments within authorised scope'),('perm_timetable_view','timetable.view','View timetable within authorised scope'),('perm_library_manage','library.manage','Manage school library'),('perm_inventory_manage','inventory.manage','Manage school inventory'),('perm_hr_view','hr.view','View school HR records'),('perm_hr_manage','hr.manage','Manage school HR records'),('perm_discipline_manage','discipline.manage','Manage learner discipline'),('perm_parent_portal','portal.parent','Access linked learner information'),('perm_learner_portal','portal.learner','Access own learner information')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_school_admin',id FROM permissions WHERE permission_key NOT IN ('platform.manage','schools.manage','billing.manage')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_principal',id FROM permissions WHERE permission_key IN ('school.users.manage','school.settings.manage','academics.manage','learners.view','learners.manage','staff.manage','classes.manage','allocations.manage','assessments.manage','assessments.view','attendance.manage','attendance.view','finance.view','reports.view','audit.view','profile.self','library.manage','inventory.manage','hr.view','hr.manage','discipline.manage','timetable.view')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_school_owner',id FROM permissions WHERE permission_key NOT IN ('platform.manage','schools.manage','billing.manage')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_deputy_principal',id FROM permissions WHERE permission_key IN ('school.settings.manage','academics.manage','learners.view','learners.manage','staff.manage','classes.manage','allocations.manage','assessments.manage','assessments.view','attendance.manage','attendance.view','finance.view','reports.view','audit.view','profile.self','library.manage','inventory.manage','hr.view','hr.manage','discipline.manage','timetable.view')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_director_studies',id FROM permissions WHERE permission_key IN ('academics.manage','learners.view','staff.manage','classes.manage','allocations.manage','assessments.manage','assessments.view','attendance.view','reports.view','audit.view','profile.self','timetable.view')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_deputy_dos',id FROM permissions WHERE permission_key IN ('academics.manage','learners.view','staff.manage','classes.manage','allocations.manage','assessments.manage','assessments.view','attendance.view','reports.view','profile.self','timetable.view')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_hod',id FROM permissions WHERE permission_key IN ('learners.view','staff.manage','assessments.manage','assessments.view','attendance.view','reports.view','profile.self','timetable.view')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_exam_officer',id FROM permissions WHERE permission_key IN ('learners.view','assessments.manage','assessments.view','reports.view','profile.self')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_librarian',id FROM permissions WHERE permission_key IN ('library.manage','learners.view','profile.self')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_teacher',id FROM permissions WHERE permission_key IN ('learners.view','assessments.view','assessments.manage','attendance.view','attendance.manage','timetable.view','reports.view','profile.self')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_class_teacher',id FROM permissions WHERE permission_key IN ('learners.view','learners.manage','assessments.view','attendance.view','attendance.manage','timetable.view','reports.view','profile.self')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_bursar',id FROM permissions WHERE permission_key IN ('finance.view','finance.manage','reports.view','profile.self')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_hr',id FROM permissions WHERE permission_key IN ('hr.view','hr.manage','staff.manage','reports.view','profile.self')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_admissions',id FROM permissions WHERE permission_key IN ('learners.view','learners.manage','classes.manage','reports.view','profile.self')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_parent',id FROM permissions WHERE permission_key IN ('portal.parent','profile.self')",
"INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT 'role_student',id FROM permissions WHERE permission_key IN ('portal.learner','profile.self')",
"INSERT OR IGNORE INTO schema_migrations(version,description) VALUES('0003_role_access_control','School administrator role and role permission catalogue')",
"CREATE TABLE IF NOT EXISTS learner_user_links (id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE, learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(school_id,learner_id), UNIQUE(school_id,user_id))",
"CREATE INDEX IF NOT EXISTS ix_learner_user_links_user ON learner_user_links(school_id,user_id)",
"INSERT OR IGNORE INTO schema_migrations(version,description) VALUES('0004_learner_portal_links','Secure learner account links for learner portal')"
];
export async function onRequestPost({request,env}) {
 if(!env.DB)return Response.json({ok:false,error:"Database connection is unavailable."},{status:503});
 const actor=await getSuperAdminSession(request,env);
 if(!actor)return Response.json({ok:false,error:"A Super Admin session is required."},{status:401});
 let done=false;
 try {
  done=!!(await env.DB.prepare("SELECT 1 FROM schema_migrations WHERE version='0003_role_access_control'").first());
 } catch {}
 for(let i=0;i<statements.length;i++){
  try{await env.DB.prepare(statements[i]).run();}
  catch(error){console.error("NAVSTAR role migration",i+1,error);return Response.json({ok:false,failedStatement:i+1,error:String(error?.message||"Role migration failed").slice(0,220)},{status:500});}
 }
 return Response.json({ok:true,alreadyApplied:!!done,executed:statements.length,message:"School role, permission and learner portal schema installed."});
}
