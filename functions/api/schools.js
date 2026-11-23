import { sendNavstarEmail } from "../lib/email.js";
import { getSuperAdminSession, hashPassword } from "./auth.js";

const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const clean=v=>String(v??"").trim();
const normStatus=v=>({Active:"active",Pending:"pending",Suspended:"suspended",Archived:"archived",active:"active",pending:"pending",suspended:"suspended",archived:"archived"}[v]||"pending");
const displayStatus=v=>({active:"Active",pending:"Pending",suspended:"Suspended",archived:"Archived"}[v]||"Pending");
const makeId=()=>crypto.randomUUID();
function modulesForLevels(levels){
  const selected=Array.isArray(levels)?levels:[];
  const modules=new Set(["Core","Learners","Staff & HR","Academics","Examinations","Reports","Parent Portal"]);
  if(selected.some(x=>/^Grade (7|8|9)$/.test(String(x))))["Junior School","Pathway Planning"].forEach(x=>modules.add(x));
  if(selected.some(x=>/^Grade (10|11|12)$/.test(String(x))))["Senior School","Pathway Planning","AI Analytics"].forEach(x=>modules.add(x));
  if(selected.some(x=>/^Form /.test(String(x))))modules.add("Secondary School");
  if(selected.length)modules.add("Attendance");
  return [...modules];
}
function mapSchool(row){
  let meta={};
  try{meta=JSON.parse(row.settings_json||"{}").navstar_school_meta||{}}catch{}
  let levels=[];try{levels=JSON.parse(row.school_levels_json||"[]")}catch{}
  return {id:row.id,name:row.name,code:row.school_code,registrationNumber:row.registration_number||"",emisCode:row.emis_code||"",
    category:meta.category||row.institution_type||"",level:meta.level||"",ownership:row.ownership||"",county:row.county||"",
    subCounty:row.sub_county||"",town:row.town||"",contact:row.contact_person||"",email:row.contact_email||"",
    phone:row.contact_phone||"",address:row.physical_address||"",curriculum:row.curriculum||"CBC",
    curriculumLabel:meta.curriculumLabel||row.curriculum||"CBC",levels,plan:meta.plan||"Starter",
    status:displayStatus(row.status),expiry:meta.expiry||"",modules:modulesForLevels(levels),
    learnerCount:Number(meta.learnerCount||0),teacherCount:Number(meta.teacherCount||0),created:row.created_at,schoolAdmin:row.admin_user_id?{id:row.admin_user_id,fullName:row.admin_full_name,username:row.admin_username,email:row.admin_email,phone:row.admin_phone,status:row.admin_status,role:"School Administrator"}:null};
}
async function requireAdmin(request,env){
  if(!env.DB)return {error:json({ok:false,error:"Database connection is unavailable."},503)};
  const user=await getSuperAdminSession(request,env);
  return user?{user}:{error:json({ok:false,error:"Your Super Admin session has expired. Please sign in again."},401)};
}

export async function onRequestGet({request,env}){
  const auth=await requireAdmin(request,env);if(auth.error)return auth.error;
  try{
    const rows=await env.DB.prepare(`SELECT s.*,ss.settings_json,
      (SELECT u.id FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_user_id,
      (SELECT u.full_name FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_full_name,
      (SELECT u.username FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_username,
      (SELECT u.email FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_email,
      (SELECT u.phone FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_phone,
      (SELECT u.status FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_status
      FROM schools s LEFT JOIN school_settings ss ON ss.school_id=s.id ORDER BY s.created_at DESC`).all();
    return json({ok:true,schools:(rows.results||[]).map(mapSchool)});
  }catch{return json({ok:false,error:"School records could not be loaded from the database."},500)}
}
export async function onRequestPost({request,env}){
  const auth=await requireAdmin(request,env);if(auth.error)return auth.error;
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid school details."},400)}
  const name=clean(body.name),county=clean(body.county),contact=clean(body.contact),email=clean(body.email).toLowerCase(),phone=clean(body.phone);
  if(!name||name.length>180||!county||county.length>100)return json({ok:false,error:"Official school name and county are required."},400);
  if(!/^\S+@\S+\.\S+$/.test(email)||email.length>190)return json({ok:false,error:"Enter the school's official email address so Navstar can send its welcome information."},400);
  if(phone.length>40||contact.length>120)return json({ok:false,error:"Check the school contact name and phone number."},400);
  const id=makeId(),code=clean(body.code)||("NS-"+crypto.randomUUID().slice(0,8).toUpperCase());
  const status=normStatus(body.status),curriculum=clean(body.curriculum)||"CBC";
  const levels=Array.isArray(body.levels)?[...new Set(body.levels.map(clean).filter(Boolean))]:[];
  const meta={category:clean(body.category),level:clean(body.level),plan:clean(body.plan)||"Starter",expiry:clean(body.expiry),modules:modulesForLevels(levels),learnerCount:0,teacherCount:0};
  try{
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO schools (id,school_code,name,registration_number,emis_code,institution_type,ownership,county,sub_county,town,physical_address,contact_person,contact_email,contact_phone,curriculum,school_levels_json,status,created_by,activated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='active' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END)`)
        .bind(id,code,name,clean(body.registrationNumber)||null,clean(body.emisCode)||null,meta.category||null,clean(body.ownership)||null,county,clean(body.subCounty)||null,clean(body.town)||null,clean(body.address)||null,contact||null,email,phone||null,curriculum,JSON.stringify(levels),status,auth.user.id,status),
      env.DB.prepare("INSERT INTO school_settings (school_id,timezone,currency,settings_json) VALUES (?,'Africa/Nairobi','KES',?)").bind(id,JSON.stringify({navstar_school_meta:meta})),
      env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,school_id,action,resource_type,resource_id,outcome,details_json) VALUES (?,?,?,'school.created','school',?,'success',?)").bind(makeId(),auth.user.id,id,id,JSON.stringify({name,schoolCode:code,levels}))
    ]);
    let emailDelivery="not_configured";
    if(env.RESEND_API_KEY){
      const from=env.MAIL_FROM||"Navstar Analytics <no-reply@mail.navstardigitalhub.co.ke>",loginUrl=new URL("/login.html",new URL(request.url).origin).toString();
      const safe=v=>String(v).replace(/[&<>"]/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[x]));
      const html="<div style='font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#17233b'><div style='background:#082b70;color:#fff;padding:26px;border-radius:14px 14px 0 0'><div style='font-size:20px;font-weight:800;letter-spacing:1px'>Navstar Analytics</div><div style='font-size:12px;opacity:.9'>Smart School Management & Education Analytics</div></div><div style='padding:28px;border:1px solid #e5eaf2;border-radius:0 0 14px 14px'><p>Hello "+safe(contact||name)+" team,</p><h2 style='color:#102b5c'>Welcome to Navstar Analytics</h2><p>We are delighted to welcome <b>"+safe(name)+"</b> to Navstar, a centralised school management platform designed to support school administration, teaching, learning and informed decision-making.</p><h3>Your school workspace</h3><p><b>School:</b> "+safe(name)+"<br><b>Institution code:</b> "+safe(code)+"<br><b>County:</b> "+safe(county)+"<br><b>Curriculum:</b> "+safe(curriculum)+"<br><b>Configured levels:</b> "+safe(levels.join(", ")||"To be configured")+"</p><h3>What Navstar helps your school manage</h3><ul><li>School administration, staff and user accounts with role-based access</li><li>Learner admissions, records and parent/learner portals</li><li>Academic years, terms, classes, streams and learning areas</li><li>Teacher allocations, attendance, assessments and performance reporting</li><li>Finance, communication, records and operational management</li><li>School dashboards and analytics with role-restricted access</li></ul><h3>Getting started</h3><ol><li>Your Navstar platform administrator will configure your School Administrator account separately.</li><li>The School Administrator will receive a username and instructions to set a password securely using the Forgot password OTP process.</li><li>After activation, the School Administrator can set up staff, teachers, learners and other authorised users.</li></ol><p><a href='"+loginUrl+"' style='display:inline-block;background:#1264e8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700'>Visit Navstar login</a></p><p>For assistance, contact the Navstar support team using the details supplied by your platform administrator.</p><p>We look forward to supporting your institution.</p><p>Kind regards,<br><b>Navstar Analytics Team</b></p></div></div>";
      try{const sent=await sendNavstarEmail(env,{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from,to:[email],subject:"Welcome to Navstar Analytics · "+name,html,text:"Welcome to Navstar Analytics, "+name+".\n\nYour school workspace has been registered. Institution code: "+code+". County: "+county+". Curriculum: "+curriculum+". Levels: "+(levels.join(", ")||"To be configured")+". Navstar supports school administration, staff and learner records, academics, teacher allocations, attendance, assessments, finance, communications, portals and analytics with role-based access. Your platform administrator will separately configure your School Administrator account. Once received, use the username and Forgot password OTP process to set a secure password. Login: "+loginUrl+".\n\nKind regards, Navstar Analytics Team."})});emailDelivery=sent.ok?"sent":"failed";if(!sent.ok)console.error("Navstar school welcome email failed:",sent.status,await sent.text());}
      catch(error){emailDelivery="failed";console.error("Navstar school welcome email error:",String(error?.message||error));}
    }
    const row=await env.DB.prepare("SELECT s.*,ss.settings_json FROM schools s LEFT JOIN school_settings ss ON ss.school_id=s.id WHERE s.id=?").bind(id).first();
    return json({ok:true,school:mapSchool(row),emailDelivery,message:"School registered. Add its School Administrator from the school profile."},201);
  }catch(error){
    const msg=String(error?.message||"");console.error("Navstar school registration failed:",msg);
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
    let selectedLevels=[];
    try{selectedLevels=body.levels===undefined?JSON.parse(existing.school_levels_json||"[]"):(Array.isArray(body.levels)?body.levels:[])}catch{selectedLevels=[]}
    selectedLevels=[...new Set(selectedLevels.map(clean).filter(Boolean))];
    const levels=JSON.stringify(selectedLevels);
    meta.modules=modulesForLevels(selectedLevels);
    const curriculum=body.curriculum===undefined?existing.curriculum:clean(body.curriculum);
    await env.DB.batch([
      env.DB.prepare(`UPDATE schools SET school_code=?,name=?,registration_number=?,institution_type=?,ownership=?,county=?,sub_county=?,town=?,physical_address=?,contact_person=?,contact_email=?,contact_phone=?,curriculum=?,school_levels_json=?,status=?,activated_at=CASE WHEN ?='active' THEN COALESCE(activated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE activated_at END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
        .bind(code,name,body.registrationNumber===undefined?existing.registration_number:clean(body.registrationNumber),meta.category||null,body.ownership===undefined?existing.ownership:clean(body.ownership),body.county===undefined?existing.county:clean(body.county),body.subCounty===undefined?existing.sub_county:clean(body.subCounty),body.town===undefined?existing.town:clean(body.town),body.address===undefined?existing.physical_address:clean(body.address),body.contact===undefined?existing.contact_person:clean(body.contact),body.email===undefined?existing.contact_email:clean(body.email),body.phone===undefined?existing.contact_phone:clean(body.phone),curriculum,levels,status,status,id),
      env.DB.prepare("INSERT INTO school_settings (school_id,settings_json) VALUES (?,?) ON CONFLICT(school_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
        .bind(id,JSON.stringify({...current,navstar_school_meta:meta}))
    ]);
    const row=await env.DB.prepare(`SELECT s.*,ss.settings_json,
      (SELECT u.id FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_user_id,
      (SELECT u.full_name FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_full_name,
      (SELECT u.username FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_username,
      (SELECT u.email FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_email,
      (SELECT u.phone FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_phone,
      (SELECT u.status FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_status
      FROM schools s LEFT JOIN school_settings ss ON ss.school_id=s.id WHERE s.id=?`).bind(id).first();
    await env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,school_id,action,resource_type,resource_id,outcome,details_json) VALUES (?,?,?,'school.updated','school',?,'success',?)")
      .bind(makeId(),auth.user.id,id,id,JSON.stringify({status})).run().catch(()=>{});
    return json({ok:true,school:mapSchool(row),message:"School changes saved to the central database."});
  }catch(error){
    if(/UNIQUE constraint/i.test(String(error?.message||"")))return json({ok:false,error:"That institution code is already assigned to another school."},409);
    return json({ok:false,error:"School changes could not be saved. Please try again."},500);
  }
}
