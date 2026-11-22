import { getSuperAdminSession } from "./auth.js";

const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const id=()=>crypto.randomUUID();
const clean=v=>typeof v==="string"?v.trim():v;
const resources={
  plans:{table:"subscription_plans",scope:false,fields:["plan_code","name","description","billing_model","rate_kes","max_learners","storage_gb","ai_credits","onboarding_fee_kes","grace_period_days","learner_count_basis","capabilities_json","school_levels_json","payment_methods_json","is_active"],required:["plan_code","name","billing_model"]},
  subscriptions:{table:"school_subscriptions",scope:true,fields:["plan_id","billing_model_override","rate_override_kes","learner_count","learner_count_basis","discount_percent","contract_start_date","next_due_date","preferred_payment_method","payment_terms","status","estimated_amount_kes"],required:["school_id"],refs:{plan_id:"subscription_plans"}},
  invoices:{table:"invoices",scope:true,fields:["subscription_id","invoice_number","currency","subtotal","discount","tax","total","amount_paid","status","issue_date","due_date"],required:["school_id","invoice_number"],refs:{subscription_id:"school_subscriptions"}},
  payments:{table:"payments",scope:true,fields:["invoice_id","amount","currency","method","provider_reference","status","received_at"],required:["school_id","amount","method"],refs:{invoice_id:"invoices"}},
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
  announcements:{table:"announcements",scope:false,fields:["school_id","title","body","audience","channel","status","scheduled_at","published_at"],required:["title","body"]},
  settings:{table:"platform_settings",scope:false,fields:["setting_value"],required:["setting_key"]},
  audit:{table:"audit_logs",scope:false,readOnly:true,fields:[]}
};
const scopedTables=new Set(["academic_years","grade_levels","learning_areas","staff_profiles","learners","guardians"]);
async function auth(request,env){
  if(!env.DB)return {error:json({ok:false,error:"Database connection is unavailable."},503)};
  const user=await getSuperAdminSession(request,env);
  return user?{user}:{error:json({ok:false,error:"A valid Super Admin session is required."},401)};
}
async function existsInSchool(db,table,ref,schoolId){
  if(!ref)return true;
  const allowed=new Set(["subscription_plans","school_subscriptions","academic_years","grade_levels","streams","staff_profiles","users","terms","learning_areas","learners","learner_enrollments"]);
  if(!allowed.has(table))return false;
  if(table==="subscription_plans"||table==="users")return !!(await db.prepare("SELECT 1 FROM "+table+" WHERE id=?").bind(ref).first());
  return !!(await db.prepare("SELECT 1 FROM "+table+" WHERE id=? AND school_id=?").bind(ref,schoolId).first());
}
function bodyFields(body,config){
  const values={};
  for(const field of config.fields)if(body[field]!==undefined)values[field]=clean(body[field]);
  return values;
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
  const schoolId=url.searchParams.get("schoolId");
  if(cfg.scope&&!schoolId)return json({ok:false,error:"schoolId is required for school records."},400);
  if(cfg.scope&&!await env.DB.prepare("SELECT 1 FROM schools WHERE id=?").bind(schoolId).first())return json({ok:false,error:"School not found."},404);
  try{
    if(name==="settings"){
      const rows=await env.DB.prepare("SELECT setting_key,setting_value,updated_at FROM platform_settings ORDER BY setting_key").all();
      return json({ok:true,records:rows.results||[]});
    }
    let sql="SELECT * FROM "+cfg.table+(cfg.scope?" WHERE school_id=?":"")+(name==="audit"?" ORDER BY created_at DESC LIMIT 500":" ORDER BY "+(cfg.scope?"rowid":"rowid")+" DESC LIMIT 1000");
    const rows=cfg.scope?await env.DB.prepare(sql).bind(schoolId).all():await env.DB.prepare(sql).all();
    return json({ok:true,records:rows.results||[]});
  }catch(error){console.error("NAVSTAR data read",name,error);return json({ok:false,error:"Could not load "+name+" from the database."},500)}
}
export async function onRequestPost({request,env}){
  const a=await auth(request,env);if(a.error)return a.error;
  const name=new URL(request.url).pathname.split("/").pop(),cfg=resources[name];
  if(!cfg)return json({ok:false,error:"Unknown data resource."},404);
  if(cfg.readOnly)return json({ok:false,error:"This resource is read-only."},405);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid record data."},400)}
  const values=bodyFields(body,cfg);
  for(const key of cfg.required)if(values[key]===undefined||values[key]===null||values[key]==="")return json({ok:false,error:key+" is required."},400);
  const schoolId=cfg.scope?values.school_id:values.school_id||null;
  if(cfg.scope&&!await env.DB.prepare("SELECT 1 FROM schools WHERE id=?").bind(schoolId).first())return json({ok:false,error:"School not found."},404);
  const refError=await validateRefs(env.DB,cfg,values,schoolId);if(refError)return json({ok:false,error:refError},400);
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
    await env.DB.prepare(sql).bind(...vals).run();
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
  if(cfg.readOnly)return json({ok:false,error:"This resource is read-only."},405);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid record update."},400)}
  const values=bodyFields(body,cfg);delete values.school_id;
  if(!Object.keys(values).length)return json({ok:false,error:"No editable fields were supplied."},400);
  try{
    const where=cfg.scope?"id=? AND school_id=?":"id=?";
    const schoolId=cfg.scope?String(body.school_id||new URL(request.url).searchParams.get("schoolId")||""):"";
    if(cfg.scope&&!schoolId)return json({ok:false,error:"schoolId is required for school records."},400);
    const current=await env.DB.prepare("SELECT * FROM "+cfg.table+" WHERE "+where).bind(...(cfg.scope?[recordId,schoolId]:[recordId])).first();
    if(!current)return json({ok:false,error:"Record not found in the selected school."},404);
    const refError=await validateRefs(env.DB,cfg,values,schoolId);if(refError)return json({ok:false,error:refError},400);
    const keys=Object.keys(values),sql="UPDATE "+cfg.table+" SET "+keys.map(k=>k+"=?").join(",")+(cfg.table==="schools"?",updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')":"")+" WHERE "+where;
    await env.DB.prepare(sql).bind(...keys.map(k=>values[k]),...(cfg.scope?[recordId,schoolId]:[recordId])).run();
    const record=await env.DB.prepare("SELECT * FROM "+cfg.table+" WHERE "+where).bind(...(cfg.scope?[recordId,schoolId]:[recordId])).first();
    await audit(env.DB,a.user,schoolId||null,"record.updated",name,recordId);
    return json({ok:true,record});
  }catch(error){console.error("NAVSTAR data update",name,error);return json({ok:false,error:"The record could not be updated. Check linked records and try again."},400)}
}
