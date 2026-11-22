const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const clean=v=>String(v??"").trim();
const normStatus=v=>({Active:"active",Pending:"pending",Suspended:"suspended",Archived:"archived",active:"active",pending:"pending",suspended:"suspended",archived:"archived"}[v]||"pending");
const displayStatus=v=>({active:"Active",pending:"Pending",suspended:"Suspended",archived:"Archived"}[v]||"Pending");
const makeId=()=>crypto.randomUUID();
function mapSchool(row){
  let meta={};
  try{meta=JSON.parse(row.settings_json||"{}").navstar_school_meta||{}}catch{}
  let levels=[];try{levels=JSON.parse(row.school_levels_json||"[]")}catch{}
  return {id:row.id,name:row.name,code:row.school_code,registrationNumber:row.registration_number||"",emisCode:row.emis_code||"",
    category:meta.category||row.institution_type||"",level:meta.level||"",ownership:row.ownership||"",county:row.county||"",
    subCounty:row.sub_county||"",town:row.town||"",contact:row.contact_person||"",email:row.contact_email||"",
    phone:row.contact_phone||"",address:row.physical_address||"",curriculum:row.curriculum||"CBC",
    curriculumLabel:meta.curriculumLabel||row.curriculum||"CBC",levels,plan:meta.plan||"Starter",
    status:displayStatus(row.status),expiry:meta.expiry||"",modules:Array.isArray(meta.modules)?meta.modules:[],
    learnerCount:Number(meta.learnerCount||0),teacherCount:Number(meta.teacherCount||0),created:row.created_at};
}
async function requireAdmin(request,env){
  if(!env.DB)return {error:json({ok:false,error:"Database connection is unavailable."},503)};
  const {getSuperAdminSession}=await import("./auth.js");
  const user=await getSuperAdminSession(request,env);
  return user?{user}:{error:json({ok:false,error:"Your Super Admin session has expired. Please sign in again."},401)};
}
export async function onRequestGet({request,env}){
  const auth=await requireAdmin(request,env);if(auth.error)return auth.error;
  try{
    const rows=await env.DB.prepare(`SELECT s.*,ss.settings_json FROM schools s LEFT JOIN school_settings ss ON ss.school_id=s.id ORDER BY s.created_at DESC`).all();
    return json({ok:true,schools:(rows.results||[]).map(mapSchool)});
  }catch{return json({ok:false,error:"School records could not be loaded from the database."},500)}
}
export async function onRequestPost({request,env}){
  const auth=await requireAdmin(request,env);if(auth.error)return auth.error;
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid school details."},400)}
  const name=clean(body.name),county=clean(body.county);
  if(!name||name.length>180||!county||county.length>100)return json({ok:false,error:"Official school name and county are required."},400);
  const id=makeId(),code=clean(body.code)||("NS-"+crypto.randomUUID().slice(0,8).toUpperCase());
  const status=normStatus(body.status),curriculum=clean(body.curriculum)||"CBC";
  const levels=Array.isArray(body.levels)?body.levels:[];
  const meta={category:clean(body.category),level:clean(body.level),plan:clean(body.plan)||"Starter",expiry:clean(body.expiry),
    modules:Array.isArray(body.modules)?body.modules:[],learnerCount:0,teacherCount:0};
  try{
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO schools
        (id,school_code,name,registration_number,emis_code,institution_type,ownership,county,sub_county,town,physical_address,contact_person,contact_email,contact_phone,curriculum,school_levels_json,status,created_by,activated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='active' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END)`)
        .bind(id,code,name,clean(body.registrationNumber)||null,clean(body.emisCode)||null,meta.category||null,clean(body.ownership)||null,county,clean(body.subCounty)||null,clean(body.town)||null,clean(body.address)||null,clean(body.contact)||null,clean(body.email)||null,clean(body.phone)||null,curriculum,JSON.stringify(levels),status,auth.user.id,status),
      env.DB.prepare("INSERT INTO school_settings (school_id,timezone,currency,settings_json) VALUES (?,'Africa/Nairobi','KES',?)")
        .bind(id,JSON.stringify({navstar_school_meta:meta}))
    ]);
    const row=await env.DB.prepare("SELECT s.*,ss.settings_json FROM schools s LEFT JOIN school_settings ss ON ss.school_id=s.id WHERE s.id=?").bind(id).first();
    await env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,school_id,action,resource_type,resource_id,outcome,details_json) VALUES (?,?,?,'school.created','school',?,'success',?)")
      .bind(makeId(),auth.user.id,id,id,JSON.stringify({name,schoolCode:code})).run().catch(()=>{});
    return json({ok:true,school:mapSchool(row),message:"School registered in the central database."},201);
  }catch(error){
    const msg=String(error?.message||"");
    if(/UNIQUE constraint/i.test(msg))return json({ok:false,error:"That school code is already registered. Use a different institution code."},409);
    return json({ok:false,error:"The school could not be saved. Please check the details and try again."},500);
  }
}
export async function onRequestPatch({request,env}){
  const auth=await requireAdmin(request,env);if(auth.error)return auth.error;
  const id=decodeURIComponent(new URL(request.url).pathname.split("/").pop()||"");
  if(!id||id.length>100)return json({ok:false,error:"A valid school ID is required."},400);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid school update."},400)}
  try{
    const existing=await env.DB.prepare("SELECT s.*,ss.settings_json FROM schools s LEFT JOIN school_settings ss ON ss.school_id=s.id WHERE s.id=?").bind(id).first();
    if(!existing)return json({ok:false,error:"School record was not found."},404);
    let current={};try{current=JSON.parse(existing.settings_json||"{}")}catch{}
    const meta={...(current.navstar_school_meta||{})};
    for(const key of ["category","level","plan","expiry","modules","learnerCount","teacherCount"])if(body[key]!==undefined)meta[key]=body[key];
    const name=body.name===undefined?existing.name:clean(body.name),code=body.code===undefined?existing.school_code:clean(body.code);
    if(!name||name.length>180||!code||code.length>80)return json({ok:false,error:"School name and institution code are required."},400);
    const status=body.status===undefined?existing.status:normStatus(body.status);
    const levels=body.levels===undefined?existing.school_levels_json:JSON.stringify(Array.isArray(body.levels)?body.levels:[]);
    const curriculum=body.curriculum===undefined?existing.curriculum:clean(body.curriculum);
    await env.DB.batch([
      env.DB.prepare(`UPDATE schools SET school_code=?,name=?,registration_number=?,institution_type=?,ownership=?,county=?,sub_county=?,town=?,physical_address=?,contact_person=?,contact_email=?,contact_phone=?,curriculum=?,school_levels_json=?,status=?,activated_at=CASE WHEN ?='active' THEN COALESCE(activated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE activated_at END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
        .bind(code,name,body.registrationNumber===undefined?existing.registration_number:clean(body.registrationNumber),meta.category||null,body.ownership===undefined?existing.ownership:clean(body.ownership),body.county===undefined?existing.county:clean(body.county),body.subCounty===undefined?existing.sub_county:clean(body.subCounty),body.town===undefined?existing.town:clean(body.town),body.address===undefined?existing.physical_address:clean(body.address),body.contact===undefined?existing.contact_person:clean(body.contact),body.email===undefined?existing.contact_email:clean(body.email),body.phone===undefined?existing.contact_phone:clean(body.phone),curriculum,levels,status,status,id),
      env.DB.prepare("INSERT INTO school_settings (school_id,settings_json) VALUES (?,?) ON CONFLICT(school_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
        .bind(id,JSON.stringify({...current,navstar_school_meta:meta}))
    ]);
    const row=await env.DB.prepare("SELECT s.*,ss.settings_json FROM schools s LEFT JOIN school_settings ss ON ss.school_id=s.id WHERE s.id=?").bind(id).first();
    await env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,school_id,action,resource_type,resource_id,outcome,details_json) VALUES (?,?,?,'school.updated','school',?,'success',?)")
      .bind(makeId(),auth.user.id,id,id,JSON.stringify({status})).run().catch(()=>{});
    return json({ok:true,school:mapSchool(row),message:"School changes saved to the central database."});
  }catch(error){
    if(/UNIQUE constraint/i.test(String(error?.message||"")))return json({ok:false,error:"That institution code is already assigned to another school."},409);
    return json({ok:false,error:"School changes could not be saved. Please try again."},500);
  }
}
