import { getAuthenticatedSession } from "./auth.js";

const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const id=()=>crypto.randomUUID();
const clean=v=>typeof v==="string"?v.trim():v;
const resources={
  plans:{table:"subscription_plans",scope:false,fields:["plan_code","name","description","billing_model","rate_kes","max_learners","storage_gb","ai_credits","onboarding_fee_kes","grace_period_days","learner_count_basis","capabilities_json","school_levels_json","payment_methods_json","is_active"],required:["plan_code","name","billing_model"]},
  subscriptions:{table:"school_subscriptions",scope:true,fields:["plan_id","billing_model_override","rate_override_kes","learner_count","learner_count_basis","discount_percent","contract_start_date","next_due_date","preferred_payment_method","payment_terms","status","estimated_amount_kes"],required:["school_id"],refs:{plan_id:"subscription_plans"}},
  invoices:{table:"invoices",scope:true,fields:["subscription_id","invoice_number","currency","subtotal","discount","tax","total","amount_paid","status","issue_date","due_date"],required:["school_id","invoice_number"],refs:{subscription_id:"school_subscriptions"}},
  payments:{table:"payments",scope:true,fields:["invoice_id","amount","currency","method","provider_reference","status","received_at","recorded_by"],required:["school_id","amount","method"],refs:{invoice_id:"invoices"}},
  years:{table:"academic_years",scope:true,fields:["name","start_date","end_date","status"],required:["school_id","name","start_date","end_date"]},
  terms:{table:"terms",scope:true,fields:["academic_year_id","name","start_date","end_date","status"],required:["school_id","academic_year_id","name","start_date","end_date"],refs:{academic_year_id:"academic_years"}},
  grades:{table:"grade_levels",scope:true,fields:["curriculum","stage_code","stage_name","stage_order","school_level","is_active"],required:["school_id","stage_code","stage_name"]},
  streams:{table:"streams",scope:true,fields:["grade_level_id","name","capacity","classroom","status"],required:["school_id","grade_level_id","name"],refs:{grade_level_id:"grade_levels"}},
  "learning-areas":{table:"learning_areas",scope:true,fields:["curriculum","code","name","stage_code","pathway","is_active"],required:["school_id","name"]},
  staff:{table:"staff_profiles",scope:true,fields:["user_id","staff_number","department","employment_type","employment_status","hire_date","profile_json"],required:["school_id"],refs:{user_id:"users"}},
  classes:{table:"classes",scope:true,fields:["academic_year_id","grade_level_id","stream_id","class_teacher_staff_id","capacity","room","status"],required:["school_id","academic_year_id","grade_level_id","stream_id"],refs:{academic_year_id:"academic_years",grade_level_id:"grade_levels",stream_id:"streams",class_teacher_staff_id:"staff_profiles"}},
  learners:{table:"learners",scope:true,fields:["admission_number","first_name","middle_name","last_name","gender","date_of_birth","status","pathway","profile_json"],required:["school_id","admission_number","first_name","last_name"]},
  enrollments:{table:"learner_enrollments",scope:true,fields:["learner_id","academic_year_id","grade_level_id","stream_id","status","enrolled_at"],required:["school_id","learner_id","academic_year_id","grade_level_id"],refs:{learner_id:"learners",academic_year_id:"academic_years",grade_level_id:"grade_levels",stream_id:"streams"}},
  guardians:{table:"guardians",scope:true,fields:["user_id","full_name","phone","email","relationship"],required:["school_id","full_name"],refs:{user_id:"users"}},
  "teacher-allocations":{table:"teacher_allocations",scope:true,fields:["staff_id","academic_year_id","term_id","grade_level_id","stream_id","learning_area_id","pathway"],required:["school_id","staff_id","academic_year_id","grade_level_id","learning_area_id"],refs:{staff_id:"staff_profiles",academic_year_id:"academic_years",term_id:"terms",grade_level_id:"grade_levels",stream_id:"streams",learning_area_id:"learning_areas"}},
  transfers:{table:"learner_transfers",scope:true,fields:["learner_id","from_enrollment_id","to_enrollment_id","reason"],required:["school_id","learner_id"],refs:{learner_id:"learners",from_enrollment_id:"learner_enrollments",to_enrollment_id:"learner_enrollments"}},
  assessments:{table:"assessments",scope:true,fields:["academic_year_id","term_id","grade_level_id","stream_id","learning_area_id","title","assessment_type","max_score","weight","pathway","due_date","status"],required:["school_id","academic_year_id","grade_level_id","learning_area_id","title"],refs:{academic_year_id:"academic_years",term_id:"terms",grade_level_id:"grade_levels",stream_id:"streams",learning_area_id:"learning_areas"}},
  "assessment-results":{table:"assessment_results",scope:true,fields:["assessment_id","learner_id","score","grade","feedback","status"],required:["school_id","assessment_id","learner_id"],refs:{assessment_id:"assessments",learner_id:"learners"}},
  "grading-schemes":{table:"grading_schemes",scope:true,fields:["curriculum","stage_code","name","description","is_active"],required:["school_id","name"]},
  "grade-boundaries":{table:"grade_boundaries",scope:false,fields:["scheme_id","label","min_score","max_score","points","descriptor"],required:["scheme_id","label","min_score","max_score"]},
  "attendance-sessions":{table:"attendance_sessions",scope:true,fields:["academic_year_id","term_id","grade_level_id","stream_id","attendance_date","session_name","status"],required:["school_id","academic_year_id","grade_level_id","attendance_date"],refs:{academic_year_id:"academic_years",term_id:"terms",grade_level_id:"grade_levels",stream_id:"streams"}},
  "attendance-records":{table:"attendance_records",scope:true,fields:["session_id","learner_id","attendance_status","notes"],required:["school_id","session_id","learner_id","attendance_status"],refs:{session_id:"attendance_sessions",learner_id:"learners"}},
  timetable:{table:"timetable_entries",scope:true,fields:["academic_year_id","term_id","grade_level_id","stream_id","learning_area_id","staff_id","weekday","start_time","end_time","room"],required:["school_id","academic_year_id","grade_level_id","learning_area_id","weekday","start_time","end_time"],refs:{academic_year_id:"academic_years",term_id:"terms",grade_level_id:"grade_levels",stream_id:"streams",learning_area_id:"learning_areas",staff_id:"staff_profiles"}},
  "fee-structures":{table:"fee_structures",scope:true,fields:["name","grade_level_id","amount","currency","frequency","due_date","is_active"],required:["school_id","name","amount"],refs:{grade_level_id:"grade_levels"}},
  "learner-fee-accounts":{table:"learner_fee_accounts",scope:true,fields:["learner_id","fee_structure_id","academic_year_id","amount_due","amount_paid","balance","status"],required:["school_id","learner_id","fee_structure_id"],refs:{learner_id:"learners",fee_structure_id:"fee_structures",academic_year_id:"academic_years"}},
  "finance-transactions":{table:"finance_transactions",scope:true,fields:["transaction_type","category","description","amount","transaction_date","payment_method","reference"],required:["school_id","transaction_type","category","amount","transaction_date"]},
  inventory:{table:"inventory_items",scope:true,fields:["sku","name","category","unit","quantity","reorder_level","unit_cost","status"],required:["school_id","name"]},
  "inventory-movements":{table:"inventory_movements",scope:true,fields:["item_id","movement_type","quantity","reason","reference"],required:["school_id","item_id","movement_type","quantity"],refs:{item_id:"inventory_items"}},
  "library-books":{table:"library_books",scope:true,fields:["isbn","accession_number","title","author","publisher","category","copies_total","copies_available","status"],required:["school_id","title"]},
  "library-loans":{table:"library_loans",scope:true,fields:["book_id","learner_id","staff_id","issued_at","due_at","returned_at","status","fine_amount"],required:["school_id","book_id","issued_at","due_at"],refs:{book_id:"library_books",learner_id:"learners",staff_id:"staff_profiles"}},
  "transport-routes":{table:"transport_routes",scope:true,fields:["route_name","vehicle_registration","driver_name","driver_phone","capacity","pickup_points_json","status"],required:["school_id","route_name"]},
  "transport-assignments":{table:"transport_assignments",scope:true,fields:["route_id","learner_id","pickup_point","effective_from","effective_to"],required:["school_id","route_id","learner_id"],refs:{route_id:"transport_routes",learner_id:"learners"}},
  "boarding-houses":{table:"boarding_houses",scope:true,fields:["name","house_type","capacity","supervisor_staff_id","status"],required:["school_id","name"],refs:{supervisor_staff_id:"staff_profiles"}},
  "boarding-allocations":{table:"boarding_allocations",scope:true,fields:["house_id","learner_id","room_number","bed_number","start_date","end_date","status"],required:["school_id","house_id","learner_id"],refs:{house_id:"boarding_houses",learner_id:"learners"}},
  payroll:{table:"payroll_records",scope:true,fields:["staff_id","pay_period","basic_pay","allowances","deductions","net_pay","status","paid_at"],required:["school_id","staff_id","pay_period"],refs:{staff_id:"staff_profiles"}},
  regions:{table:"platform_regions",scope:false,fields:["region_name","counties_json","is_active"],required:["region_name"]},
  "ai-usage":{table:"ai_usage_ledger",scope:false,fields:["school_id","user_id","service","credits_used","usage_details_json"],required:["service"]},
  integrations:{table:"integration_connections",scope:false,fields:["school_id","provider","display_name","status","config_json","last_sync_at"],required:["provider","display_name"]},
  "report-cards":{table:"report_cards",scope:true,fields:["learner_id","academic_year_id","term_id","report_data_json","status","published_at"],required:["school_id","learner_id","academic_year_id"],refs:{learner_id:"learners",academic_year_id:"academic_years",term_id:"terms"}},
  discipline:{table:"learner_discipline_records",scope:true,fields:["learner_id","incident_date","category","description","action_taken"],required:["school_id","learner_id","incident_date","description"],refs:{learner_id:"learners"}},
  "platform-users":{table:"users",scope:false,readOnly:true,fields:[]},
  analytics:{table:"schools",scope:false,readOnly:true,fields:[]},
  announcements:{table:"announcements",scope:false,fields:["school_id","title","body","audience","channel","status","scheduled_at","published_at"],required:["title","body"]},
  settings:{table:"platform_settings",scope:false,fields:["setting_key","setting_value"],required:["setting_key","setting_value"]},
  audit:{table:"audit_logs",scope:false,readOnly:true,fields:[]}
};
const scopedTables=new Set(["academic_years","grade_levels","learning_areas","staff_profiles","learners","guardians"]);
async function auth(request,env){
  if(!env.DB)return {error:json({ok:false,error:"Database connection is unavailable."},503)};
  const user=await getAuthenticatedSession(request,env);
  return user?{user}:{error:json({ok:false,error:"A valid active account session is required."},401)};
}
const permissionFor=(name,write=false)=>{
  if(["plans","subscriptions","invoices","payments","regions","platform-users","analytics","settings","audit","ai-usage","integrations"].includes(name))return "platform.manage";
  if(name==="grade-boundaries")return "platform.manage";
  if(name==="classes")return "classes.manage";
  if(["years","terms","grades","streams","learning-areas","grading-schemes"].includes(name))return "academics.manage";
  if(["staff"].includes(name))return "staff.manage";
  if(["learners","enrollments","guardians","transfers"].includes(name))return write?"learners.manage":"learners.view";
  if(name==="teacher-allocations")return "allocations.manage";
  if(["assessments","assessment-results"].includes(name))return write?"assessments.manage":"assessments.view";
  if(["attendance-sessions","attendance-records"].includes(name))return write?"attendance.manage":"attendance.view";
  if(name==="timetable")return write?"academics.manage":"timetable.view";
  if(["fee-structures","learner-fee-accounts","finance-transactions"].includes(name))return write?"finance.manage":"finance.view";
  if(["inventory","inventory-movements"].includes(name))return "inventory.manage";
  if(["library-books","library-loans"].includes(name))return "library.manage";
  if(["transport-routes","transport-assignments","boarding-houses","boarding-allocations"].includes(name))return "school.settings.manage";
  if(name==="payroll")return write?"hr.manage":"hr.view";
  if(name==="report-cards")return write?"academics.manage":"reports.view";
  if(name==="discipline")return "discipline.manage";
  if(name==="announcements")return "school.settings.manage";
  return null;
};
function allowed(user,permission){
  if(user.is_super_admin)return true;
  if(!user.school_id||!permission||permission==="platform.manage")return false;
  return user.permissions.includes(permission);
}
async function schoolScope(request,user,cfg){
  if(!cfg.scope)return user.is_super_admin?{schoolId:null}: {error:json({ok:false,error:"This platform resource is restricted to Super Admin."},403)};
  const requested=new URL(request.url).searchParams.get("schoolId")||"";
  const schoolId=user.is_super_admin?requested:user.school_id;
  if(!schoolId)return {error:json({ok:false,error:"schoolId is required for school records."},400)};
  if(!user.is_super_admin&&requested&&requested!==user.school_id)return {error:json({ok:false,error:"You cannot access another school's workspace."},403)};
  return {schoolId};
}
async function validateTeacherWrite(db,user,name,values){
 if(user.is_super_admin||!["teacher","class_teacher"].includes(user.role_key))return null;
 const staff=await db.prepare("SELECT id FROM staff_profiles WHERE user_id=? AND school_id=? AND employment_status='active'").bind(user.id,user.school_id).first();
 if(!staff)return "Your staff profile is not active.";
 let year=values.academic_year_id,term=values.term_id,grade=values.grade_level_id,stream=values.stream_id,area=values.learning_area_id,pathway=values.pathway;
 if(name==="assessment-results"){
  const a=await db.prepare("SELECT academic_year_id,term_id,grade_level_id,stream_id,learning_area_id,pathway FROM assessments WHERE id=? AND school_id=?").bind(values.assessment_id,user.school_id).first();
  if(!a)return "The assessment is not available in your school.";
  year=a.academic_year_id;term=a.term_id;grade=a.grade_level_id;stream=a.stream_id;area=a.learning_area_id;pathway=a.pathway;
  const enrolled=await db.prepare("SELECT 1 FROM learner_enrollments le JOIN learners l ON l.id=le.learner_id AND l.school_id=le.school_id WHERE le.learner_id=? AND le.school_id=? AND le.academic_year_id=? AND le.grade_level_id=? AND (le.stream_id IS ? OR le.stream_id=?) AND le.status='active' AND (? IS NULL OR l.pathway=?)").bind(values.learner_id,user.school_id,year,grade,stream,stream,pathway,pathway).first();
  if(!enrolled)return "The learner is not enrolled in the class or pathway for this assessment.";
 }
 if(name==="attendance-records"){
  const a=await db.prepare("SELECT academic_year_id,term_id,grade_level_id,stream_id FROM attendance_sessions WHERE id=? AND school_id=?").bind(values.session_id,user.school_id).first();
  if(!a)return "The attendance session is not available in your school.";
  year=a.academic_year_id;term=a.term_id;grade=a.grade_level_id;stream=a.stream_id;area=null;pathway=undefined;
  const enrolled=await db.prepare("SELECT 1 FROM learner_enrollments WHERE learner_id=? AND school_id=? AND academic_year_id=? AND grade_level_id=? AND (stream_id IS ? OR stream_id=?) AND status='active'").bind(values.learner_id,user.school_id,year,grade,stream,stream).first();
  if(!enrolled)return "The learner is not enrolled in the class for this attendance session.";
 }
 if(!year||!grade)return "Academic year and grade are required for your allocated teaching scope.";
 let sql="SELECT 1 FROM teacher_allocations ta WHERE ta.school_id=? AND ta.staff_id=? AND ta.academic_year_id=? AND ta.grade_level_id=? AND (ta.stream_id IS NULL OR ta.stream_id IS ? OR ta.stream_id=?) AND (ta.term_id IS NULL OR ta.term_id=?)";
 const args=[user.school_id,staff.id,year,grade,stream,stream,term??null];
 if(pathway!==undefined){sql+=" AND (ta.pathway IS NULL OR ta.pathway=?)";args.push(pathway??null)}
 if(area){sql+=" AND ta.learning_area_id=?";args.push(area)}
 const allocation=await db.prepare(sql+" LIMIT 1").bind(...args).first();
 return allocation?null:"This action is outside your assigned academic year, term, grade, stream, learning area or pathway.";
}
function teacherFilter(name,user){
 if(user.is_super_admin||!["teacher","class_teacher"].includes(user.role_key))return "";
 const staff="EXISTS (SELECT 1 FROM staff_profiles sp JOIN teacher_allocations ta ON ta.staff_id=sp.id WHERE sp.user_id='"+user.id+"' AND ta.school_id='"+user.school_id+"' AND ";
 if(name==="learners")return " AND EXISTS (SELECT 1 FROM learner_enrollments le JOIN teacher_allocations ta ON ta.school_id=le.school_id AND ta.academic_year_id=le.academic_year_id AND ta.grade_level_id=le.grade_level_id AND (ta.stream_id IS NULL OR ta.stream_id=le.stream_id) JOIN staff_profiles sp ON sp.id=ta.staff_id WHERE sp.user_id='"+user.id+"' AND le.school_id=learners.school_id AND le.learner_id=learners.id AND le.status='active' AND (ta.pathway IS NULL OR ta.pathway=learners.pathway))";
 if(name==="enrollments")return " AND "+staff+"ta.academic_year_id=learner_enrollments.academic_year_id AND ta.grade_level_id=learner_enrollments.grade_level_id AND (ta.stream_id IS NULL OR ta.stream_id=learner_enrollments.stream_id) AND (ta.term_id IS NULL OR ta.term_id IS (SELECT t.id FROM terms t WHERE t.academic_year_id=learner_enrollments.academic_year_id AND t.status='active' LIMIT 1)) )";
 if(name==="assessments")return " AND "+staff+"ta.academic_year_id=assessments.academic_year_id AND (ta.term_id IS NULL OR ta.term_id=assessments.term_id) AND ta.grade_level_id=assessments.grade_level_id AND (ta.stream_id IS NULL OR ta.stream_id=assessments.stream_id) AND ta.learning_area_id=assessments.learning_area_id AND (ta.pathway IS NULL OR ta.pathway=assessments.pathway) )";
 if(name==="assessment-results")return " AND EXISTS (SELECT 1 FROM assessments ax JOIN learners l ON l.id=assessment_results.learner_id AND l.school_id=assessment_results.school_id WHERE ax.id=assessment_results.assessment_id AND "+staff+"ta.academic_year_id=ax.academic_year_id AND (ta.term_id IS NULL OR ta.term_id=ax.term_id) AND ta.grade_level_id=ax.grade_level_id AND (ta.stream_id IS NULL OR ta.stream_id=ax.stream_id) AND ta.learning_area_id=ax.learning_area_id AND (ta.pathway IS NULL OR ta.pathway=ax.pathway) AND (ax.pathway IS NULL OR l.pathway=ax.pathway)) )";
 if(name==="attendance-sessions")return " AND "+staff+"ta.academic_year_id=attendance_sessions.academic_year_id AND (ta.term_id IS NULL OR ta.term_id=attendance_sessions.term_id) AND ta.grade_level_id=attendance_sessions.grade_level_id AND (ta.stream_id IS NULL OR ta.stream_id=attendance_sessions.stream_id) )";
 if(name==="attendance-records")return " AND EXISTS (SELECT 1 FROM attendance_sessions ats WHERE ats.id=attendance_records.session_id AND "+staff+"ta.academic_year_id=ats.academic_year_id AND (ta.term_id IS NULL OR ta.term_id=ats.term_id) AND ta.grade_level_id=ats.grade_level_id AND (ta.stream_id IS NULL OR ta.stream_id=ats.stream_id)) )";
 if(name==="timetable")return " AND "+staff+"ta.academic_year_id=timetable_entries.academic_year_id AND (ta.term_id IS NULL OR ta.term_id=timetable_entries.term_id) AND ta.grade_level_id=timetable_entries.grade_level_id AND (ta.stream_id IS NULL OR ta.stream_id=timetable_entries.stream_id) AND ta.learning_area_id=timetable_entries.learning_area_id )";
 if(name==="report-cards")return " AND EXISTS (SELECT 1 FROM learner_enrollments le JOIN learners l ON l.id=le.learner_id AND l.school_id=le.school_id JOIN teacher_allocations ta ON ta.school_id=le.school_id AND ta.academic_year_id=le.academic_year_id AND (ta.term_id IS NULL OR ta.term_id=report_cards.term_id) AND ta.grade_level_id=le.grade_level_id AND (ta.stream_id IS NULL OR ta.stream_id=le.stream_id) AND (ta.pathway IS NULL OR ta.pathway=l.pathway) JOIN staff_profiles sp ON sp.id=ta.staff_id WHERE sp.user_id='"+user.id+"' AND le.school_id=report_cards.school_id AND le.learner_id=report_cards.learner_id AND le.academic_year_id=report_cards.academic_year_id AND le.status='active')";
 return "";
}
async function existsInSchool(db,table,ref,schoolId){
  if(!ref)return true;
  const allowed=new Set(["subscription_plans","school_subscriptions","academic_years","grade_levels","streams","staff_profiles","users","terms","learning_areas","learners","learner_enrollments","assessments","attendance_sessions","attendance_records","attendance_sessions","fee_structures","invoices","grading_schemes","inventory_items","library_books","transport_routes","boarding_houses","assessments"]);
  if(!allowed.has(table))return false;
  if(table==="subscription_plans")return !!(await db.prepare("SELECT 1 FROM subscription_plans WHERE id=?").bind(ref).first());
  if(table==="users")return !!(await db.prepare("SELECT 1 FROM school_memberships WHERE user_id=? AND school_id=? AND membership_status IN ('active','invited')").bind(ref,schoolId).first());
  return !!(await db.prepare("SELECT 1 FROM "+table+" WHERE id=? AND school_id=?").bind(ref,schoolId).first());
}
function bodyFields(body,config){
  const values={};
  if(config.scope&&body.school_id!==undefined){const v=clean(body.school_id);values.school_id=v===""?null:v;}
  for(const field of config.fields)if(body[field]!==undefined){const v=clean(body[field]);values[field]=v===""?null:v;}
  return values;
}
async function validateConfiguredGrade(db,name,schoolId,values,current={}){
 if(name!=="grades")return null;
 const school=await db.prepare("SELECT school_levels_json FROM schools WHERE id=?").bind(schoolId).first();
 if(!school)return "School workspace was not found.";
 let selected=[];try{selected=JSON.parse(school.school_levels_json||"[]")}catch{}
 if(!Array.isArray(selected)||!selected.length)return null;
 const stageName=String(values.stage_name??current.stage_name??"").trim().toLowerCase();
 const stageCode=String(values.stage_code??current.stage_code??"").trim().toLowerCase();
 const allowed=new Set(selected.map(x=>String(x).trim().toLowerCase()));
 if(!allowed.has(stageName)&&!allowed.has(stageCode))return "This grade is not enabled for the school. Ask Super Admin to activate the matching school level first.";
 return null;
}
async function validateRefs(db,config,values,schoolId){
  if(!config.refs)return null;
  for(const [field,table] of Object.entries(config.refs)){
    const ref=values[field];if(ref===undefined||ref===null||ref==="")continue;
    if(!await existsInSchool(db,table,ref,schoolId))return field+" does not belong to this school or does not exist.";
  }
  return null;
}
async function audit(db,user,schoolId,action,resource,resourceId){
  try{await db.prepare("INSERT INTO audit_logs (id,actor_user_id,school_id,action,resource_type,resource_id,outcome,details_json) VALUES (?,?,?,?,?,?,'success','{}')")
    .bind(id(),user.id,schoolId||null,action,resource,resourceId||null).run()}catch{}
}
export async function onRequestGet({request,env}){
  const a=await auth(request,env);if(a.error)return a.error;
  const url=new URL(request.url),name=url.pathname.split("/").pop(),cfg=resources[name];
  if(!cfg)return json({ok:false,error:"Unknown data resource."},404);
  const needed=permissionFor(name,false);if(!allowed(a.user,needed))return json({ok:false,error:"Your role does not have permission to view this resource."},403);
  if(name==="platform-users"){
    try{const rows=await env.DB.prepare("SELECT u.id,u.full_name,u.username,u.email,u.phone,u.status,u.created_at,u.last_login_at,r.role_key,r.role_name FROM users u JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id IS NULL JOIN roles r ON r.id=a.role_id WHERE r.role_key IN ('super_admin','platform_operations','regional_administrator','finance_administrator','academic_standards_administrator','support_administrator') ORDER BY u.created_at DESC LIMIT 1000").all();return json({ok:true,records:rows.results||[]});}
    catch(error){console.error("NAVSTAR platform users read",error);return json({ok:false,error:"Could not load platform users."},500)}
  }
  if(name==="analytics"){
    try{
      const q=await Promise.all([
        env.DB.prepare("SELECT COUNT(*) total FROM schools").first(),
        env.DB.prepare("SELECT COUNT(*) total FROM schools WHERE status='active'").first(),
        env.DB.prepare("SELECT COUNT(*) total FROM learners").first(),
        env.DB.prepare("SELECT COUNT(*) total FROM users").first(),
        env.DB.prepare("SELECT COUNT(*) total FROM invoices").first(),
        env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE status='confirmed'").first(),
        env.DB.prepare("SELECT strftime('%Y-%m',created_at) AS month, COUNT(*) AS total FROM schools WHERE created_at >= date('now','start of month','-11 months') GROUP BY strftime('%Y-%m',created_at) ORDER BY month").all()
      ]);
      return json({ok:true,analytics:{schools:Number(q[0]?.total||0),activeSchools:Number(q[1]?.total||0),learners:Number(q[2]?.total||0),users:Number(q[3]?.total||0),invoices:Number(q[4]?.total||0),confirmedPayments:Number(q[5]?.total||0),schoolRegistrationsByMonth:q[6]?.results||[]}});
    }catch(error){console.error("NAVSTAR analytics read",error);return json({ok:false,error:"Could not load platform analytics."},500)}
  }
  const scope=await schoolScope(request,a.user,cfg);if(scope.error)return scope.error;const schoolId=scope.schoolId;
  if(cfg.scope&&!await env.DB.prepare("SELECT 1 FROM schools WHERE id=?"+(a.user.is_super_admin?"":" AND status='active'")).bind(schoolId).first())return json({ok:false,error:"School not found or inactive."},404);
  try{
    if(name==="settings"){
      const rows=await env.DB.prepare("SELECT setting_key,setting_value,updated_at FROM platform_settings ORDER BY setting_key").all();
      return json({ok:true,records:rows.results||[]});
    }
    if(name==="staff"){
      const rows=await env.DB.prepare("SELECT sp.*,u.full_name,u.username,u.email FROM staff_profiles sp LEFT JOIN users u ON u.id=sp.user_id WHERE sp.school_id=? ORDER BY u.full_name").bind(schoolId).all();
      return json({ok:true,records:rows.results||[]});
    }
    let sql="SELECT * FROM "+cfg.table+(cfg.scope?" WHERE school_id=?":"");
    if(cfg.scope)sql+=teacherFilter(name,a.user);
    sql+=(name==="audit"?" ORDER BY created_at DESC LIMIT 500":" ORDER BY rowid DESC LIMIT 1000");
    const rows=cfg.scope?await env.DB.prepare(sql).bind(schoolId).all():await env.DB.prepare(sql).all();
    return json({ok:true,records:rows.results||[]});
  }catch(error){console.error("NAVSTAR data read",name,error);return json({ok:false,error:"Could not load "+name+" from the database."},500)}
}
export async function onRequestPost({request,env}){
  const a=await auth(request,env);if(a.error)return a.error;
  const name=new URL(request.url).pathname.split("/").pop(),cfg=resources[name];
  if(!cfg)return json({ok:false,error:"Unknown data resource."},404);
  if(!allowed(a.user,permissionFor(name,true)))return json({ok:false,error:"Your role does not have permission to change this resource."},403);
  if(cfg.readOnly)return json({ok:false,error:"This resource is read-only."},405);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid record data."},400)}
  const values=bodyFields(body,cfg);
  for(const key of cfg.required)if(values[key]===undefined||values[key]===null||values[key]==="")return json({ok:false,error:key+" is required."},400);
  const schoolId=cfg.scope?(a.user.is_super_admin?values.school_id:a.user.school_id):(values.school_id||null);
  if(cfg.scope&&!schoolId)return json({ok:false,error:"School workspace is required."},400);
  if(cfg.scope&&!a.user.is_super_admin&&values.school_id&&values.school_id!==a.user.school_id)return json({ok:false,error:"You cannot create records for another school."},403);
  if(cfg.scope&&!await env.DB.prepare("SELECT 1 FROM schools WHERE id=?"+(a.user.is_super_admin?"":" AND status='active'")).bind(schoolId).first())return json({ok:false,error:"School not found or inactive."},404);
  if(cfg.scope)values.school_id=schoolId;
  const gradeError=await validateConfiguredGrade(env.DB,name,schoolId,values);if(gradeError)return json({ok:false,error:gradeError},403);
  if(name==="announcements")values.created_by=a.user.id;
  const refError=await validateRefs(env.DB,cfg,values,schoolId);if(refError)return json({ok:false,error:refError},400);
    if(name==="classes"){const grade=values.grade_level_id??current.grade_level_id,streamId=values.stream_id??current.stream_id;const stream=await env.DB.prepare("SELECT grade_level_id FROM streams WHERE id=? AND school_id=?").bind(streamId,schoolId).first();if(!stream||stream.grade_level_id!==grade)return json({ok:false,error:"The selected stream must belong to the selected grade."},400);const teacherId=values.class_teacher_staff_id??current.class_teacher_staff_id;if(teacherId){const teacher=await env.DB.prepare("SELECT 1 FROM staff_profiles WHERE id=? AND school_id=? AND employment_status='active'").bind(teacherId,schoolId).first();if(!teacher)return json({ok:false,error:"Select an active staff member as class teacher."},400);}}
  if(name==="classes"){const stream=await env.DB.prepare("SELECT grade_level_id FROM streams WHERE id=? AND school_id=?").bind(values.stream_id,schoolId).first();if(!stream||stream.grade_level_id!==values.grade_level_id)return json({ok:false,error:"The selected stream must belong to the selected grade."},400);if(values.class_teacher_staff_id){const teacher=await env.DB.prepare("SELECT 1 FROM staff_profiles WHERE id=? AND school_id=? AND employment_status='active'").bind(values.class_teacher_staff_id,schoolId).first();if(!teacher)return json({ok:false,error:"Select an active staff member as class teacher."},400);}}
  if(name==="payments"){if(values.status&&!["pending","confirmed","failed"].includes(values.status))return json({ok:false,error:"New payment status must be Pending, Confirmed or Failed. Reversals require a separate audited workflow."},400);values.recorded_by=a.user.id;values.currency=values.currency||"KES";}
  if(name==="invoices"){
    const subtotal=Number(values.subtotal??0),discount=Number(values.discount??0),tax=Number(values.tax??0),total=Number(values.total??0);
    if(![subtotal,discount,tax,total].every(Number.isFinite)||subtotal<0||discount<0||tax<0||total<0||discount>subtotal||Math.abs(total-(subtotal-discount+tax))>0.01)return json({ok:false,error:"Invoice total must equal subtotal minus discount plus tax."},400);
    if(values.status&&!["draft","issued"].includes(values.status))return json({ok:false,error:"New invoices must be Draft or Issued. Settlement status is calculated from confirmed payments."},400);
    values.amount_paid=0;values.currency=values.currency||"KES";
  }
  const teacherError=await validateTeacherWrite(env.DB,a.user,name,values);if(teacherError)return json({ok:false,error:teacherError},403);
  const recordId=id();
  try{
    if(name==="settings"){
      await env.DB.prepare("INSERT INTO platform_settings (setting_key,setting_value,updated_by) VALUES (?,?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
        .bind(body.setting_key,String(body.setting_value??""),a.user.id).run();
      await audit(env.DB,a.user,null,"platform.setting.updated","platform_setting",body.setting_key);
      return json({ok:true,id:body.setting_key,record:{setting_key:body.setting_key,setting_value:String(body.setting_value??"")} },201);
    }
    const columns=["id",...(cfg.scope?["school_id"]:[]),...Object.keys(values).filter(k=>k!=="school_id")];
    const vals=[recordId,...(cfg.scope?[schoolId]:[]),...Object.entries(values).filter(([k])=>k!=="school_id").map(([,v])=>v)];
    const sql="INSERT INTO "+cfg.table+" ("+columns.join(",")+") VALUES ("+columns.map(()=>"?").join(",")+")";
    if(name==="payments"){
      const invoiceId=values.invoice_id||null;
      if(invoiceId){
        const invoice=await env.DB.prepare("SELECT id,total,amount_paid FROM invoices WHERE id=? AND school_id=?").bind(invoiceId,schoolId).first();
        if(!invoice)return json({ok:false,error:"The invoice does not belong to this school."},400);
        if(values.status==="confirmed"){
          const nextPaid=Number(invoice.amount_paid||0)+Number(values.amount||0),total=Number(invoice.total||0);
          if(nextPaid>total+0.01)return json({ok:false,error:"This payment would exceed the invoice balance."},400);
          const nextStatus=nextPaid>=total-0.01?"paid":"part_paid";
          await env.DB.batch([
            env.DB.prepare(sql).bind(...vals),
            env.DB.prepare("UPDATE invoices SET amount_paid=?,status=? WHERE id=? AND school_id=?").bind(nextPaid,nextStatus,invoiceId,schoolId)
          ]);
        }else await env.DB.prepare(sql).bind(...vals).run();
      }else await env.DB.prepare(sql).bind(...vals).run();
    }else await env.DB.prepare(sql).bind(...vals).run();
    const record=await env.DB.prepare("SELECT * FROM "+cfg.table+" WHERE id=?").bind(recordId).first();
    await audit(env.DB,a.user,schoolId,"record.created",name,recordId);
    return json({ok:true,record},201);
  }catch(error){
    console.error("NAVSTAR data create",name,error);
    const msg=String(error?.message||"");
    return json({ok:false,error:/UNIQUE constraint/i.test(msg)?"A record with these details already exists.":/FOREIGN KEY constraint/i.test(msg)?"A linked record is missing or belongs to another school.":"The record could not be saved. Check required fields and try again."},/UNIQUE constraint/i.test(msg)?409:400);
  }
}
export async function onRequestPatch({request,env}){
  const a=await auth(request,env);if(a.error)return a.error;
  const parts=new URL(request.url).pathname.split("/"),name=parts[parts.length-2],recordId=decodeURIComponent(parts[parts.length-1]||""),cfg=resources[name];
  if(!cfg||!recordId)return json({ok:false,error:"Unknown resource or record."},404);
  if(!allowed(a.user,permissionFor(name,true)))return json({ok:false,error:"Your role does not have permission to change this resource."},403);
  if(cfg.readOnly)return json({ok:false,error:"This resource is read-only."},405);
  if(name==="payments")return json({ok:false,error:"Payment records are immutable. Record a separate reversal or correction instead."},405);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid record update."},400)}
  if(name==="invoices"&&body.amount_paid!==undefined)return json({ok:false,error:"Invoice payments must be recorded through the payment register."},403);
  if(name==="invoices"&&["paid","part_paid"].includes(String(body.status||"")))return json({ok:false,error:"Invoice settlement status is calculated from confirmed payments."},403);
  const values=bodyFields(body,cfg);delete values.school_id;
  if(!Object.keys(values).length)return json({ok:false,error:"No editable fields were supplied."},400);
  try{
    const where=cfg.scope?"id=? AND school_id=?":"id=?";
    const requested=String(body.school_id||new URL(request.url).searchParams.get("schoolId")||"");
    const schoolId=cfg.scope?(a.user.is_super_admin?requested:a.user.school_id):"";
    if(cfg.scope&&!schoolId)return json({ok:false,error:"schoolId is required for school records."},400);
    if(cfg.scope&&!a.user.is_super_admin&&requested&&requested!==a.user.school_id)return json({ok:false,error:"You cannot update records in another school."},403);
    const current=await env.DB.prepare("SELECT * FROM "+cfg.table+" WHERE "+where).bind(...(cfg.scope?[recordId,schoolId]:[recordId])).first();
    if(!current)return json({ok:false,error:"Record not found in the selected school."},404);
    const gradeError=await validateConfiguredGrade(env.DB,name,schoolId,values,current);if(gradeError)return json({ok:false,error:gradeError},403);
    const refError=await validateRefs(env.DB,cfg,values,schoolId);if(refError)return json({ok:false,error:refError},400);
    const teacherError=await validateTeacherWrite(env.DB,a.user,name,{...current,...values});if(teacherError)return json({ok:false,error:teacherError},403);
    const keys=Object.keys(values),sql="UPDATE "+cfg.table+" SET "+keys.map(k=>k+"=?").join(",")+(cfg.table==="schools"?",updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')":"")+" WHERE "+where;
    await env.DB.prepare(sql).bind(...keys.map(k=>values[k]),...(cfg.scope?[recordId,schoolId]:[recordId])).run();
    const record=await env.DB.prepare("SELECT * FROM "+cfg.table+" WHERE "+where).bind(...(cfg.scope?[recordId,schoolId]:[recordId])).first();
    await audit(env.DB,a.user,schoolId||null,"record.updated",name,recordId);
    return json({ok:true,record});
  }catch(error){console.error("NAVSTAR data update",name,error);return json({ok:false,error:"The record could not be updated. Check linked records and try again."},400)}
}
