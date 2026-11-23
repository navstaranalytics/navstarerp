import { getSuperAdminSession, hashPassword } from "./auth.js";

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
  if(!contact||contact.length>120||!/^\S+@\S+\.\S+$/.test(email)||email.length>190||!phone||phone.length>40)
    return json({ok:false,error:"To automatically create the School Administrator account, enter the administrator's full name, valid email address and phone number in the school contact fields."},400);
  const id=makeId(),code=clean(body.code)||("NS-"+crypto.randomUUID().slice(0,8).toUpperCase());
  const status=normStatus(body.status),curriculum=clean(body.curriculum)||"CBC";
  const levels=Array.isArray(body.levels)?body.levels:[];
  const meta={category:clean(body.category),level:clean(body.level),plan:clean(body.plan)||"Starter",expiry:clean(body.expiry),
    modules:Array.isArray(body.modules)?body.modules:[],learnerCount:0,teacherCount:0};
  try{
    const adminRole=await env.DB.prepare("SELECT id FROM roles WHERE id='role_school_admin' AND role_key='school_admin' AND school_id IS NULL").first();
    if(!adminRole)return json({ok:false,error:"The School Administrator role is not installed. Run the latest access-control upgrade before registering schools."},503);
    const emailTaken=await env.DB.prepare("SELECT 1 AS found FROM users WHERE email_normalized=? LIMIT 1").bind(email).first();
    if(emailTaken)return json({ok:false,error:"The administrator email address is already registered. Each School Administrator must have a unique email address."},409);
    const base="admin."+code.toLowerCase().replace(/[^a-z0-9._-]/g,"").slice(0,23);
    let username=base.slice(0,32),suffix=1;
    while(await env.DB.prepare("SELECT 1 AS found FROM users WHERE username_normalized=? LIMIT 1").bind(username).first()){
      const tail=String(++suffix);username=(base.slice(0,32-tail.length-1)+"."+tail).slice(0,32);
    }
    const userId=makeId(),membershipId=makeId(),assignmentId=makeId();
    const bootstrapPassword=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
    const passwordHash=await hashPassword(bootstrapPassword);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO schools
        (id,school_code,name,registration_number,emis_code,institution_type,ownership,county,sub_county,town,physical_address,contact_person,contact_email,contact_phone,curriculum,school_levels_json,status,created_by,activated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='active' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END)`)
        .bind(id,code,name,clean(body.registrationNumber)||null,clean(body.emisCode)||null,meta.category||null,clean(body.ownership)||null,county,clean(body.subCounty)||null,clean(body.town)||null,clean(body.address)||null,contact,email,phone,curriculum,JSON.stringify(levels),status,auth.user.id,status),
      env.DB.prepare("INSERT INTO school_settings (school_id,timezone,currency,settings_json) VALUES (?,'Africa/Nairobi','KES',?)")
        .bind(id,JSON.stringify({navstar_school_meta:meta})),
      env.DB.prepare("INSERT INTO users(id,email,email_normalized,username,username_normalized,phone,full_name,password_hash,status) VALUES(?,?,?,?,?,?,?,?,'active')")
        .bind(userId,email,email,username,username,phone,contact,passwordHash),
      env.DB.prepare("INSERT INTO school_memberships(id,school_id,user_id,membership_status,job_title,joined_at) VALUES(?,?,?,'active','School Administrator',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(membershipId,id,userId),
      env.DB.prepare("INSERT INTO user_role_assignments(id,user_id,role_id,school_id,scope_json,assigned_by) VALUES(?,?,?,?,?,?)").bind(assignmentId,userId,adminRole.id,id,JSON.stringify({scope:"school",level:"all"}),auth.user.id),
      env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,school_id,action,resource_type,resource_id,outcome,details_json) VALUES (?,?,?,'school.created','school',?,'success',?)")
        .bind(makeId(),auth.user.id,id,id,JSON.stringify({name,schoolCode:code,schoolAdminUserId:userId,schoolAdminUsername:username}))
    ]);
    let emailDelivery="not_configured";
    if(env.RESEND_API_KEY){
      const from=env.MAIL_FROM||"Navstar Analytics <onboarding@resend.dev>";
      const loginUrl=new URL("/login.html",new URL(request.url).origin).toString();
      const html="<div style='font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#17233b'><div style='background:#082b70;color:#fff;padding:24px;border-radius:12px 12px 0 0'><b>NAVSTAR ANALYTICS</b><div style='font-size:12px;opacity:.85'>School management platform</div></div><div style='padding:26px;border:1px solid #e5eaf2;border-radius:0 0 12px 12px'><p>Hello "+contact.replace(/[&<>"]/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[x]))+",</p><h2>Your School Administrator account is ready</h2><p>You have been assigned as the School Administrator for <b>"+name.replace(/[&<>"]/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[x]))+"</b>.</p><p><b>Username:</b> "+username+"</p><p><b>Registered email:</b> "+email+"</p><p><b>Phone:</b> "+phone+"</p><p>Use the NAVSTAR login page and select <b>Forgot password</b> to receive a one-time code by email and securely set your password. No temporary password is sent by email.</p><p><a href='"+loginUrl+"' style='display:inline-block;background:#1264e8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none'>Open NAVSTAR login</a></p><p>"+(status==="active"?"Your school workspace is active.":"Your school workspace will become available once the institution is activated by NAVSTAR.")+"</p><p>Regards,<br>NAVSTAR Analytics</p></div></div>";
      try{
        const sent=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from,to:[email],subject:"Your NAVSTAR School Administrator account · "+name,html,text:"Hello "+contact+",\\n\\nYour School Administrator username is "+username+". Use Forgot password on "+loginUrl+" to receive an email OTP and set your password. School: "+name+". Phone: "+phone+". No temporary password is sent."})});
        emailDelivery=sent.ok?"sent":"failed";
        if(!sent.ok)console.error("NAVSTAR school administrator welcome email failed:",sent.status,await sent.text());
      }catch(error){emailDelivery="failed";console.error("NAVSTAR school administrator email error:",String(error?.message||error));}
    }
    const row=await env.DB.prepare(`SELECT s.*,ss.settings_json,? AS admin_user_id,? AS admin_full_name,? AS admin_username,? AS admin_email,? AS admin_phone, 'active' AS admin_status FROM schools s LEFT JOIN school_settings ss ON ss.school_id=s.id WHERE s.id=?`)
      .bind(userId,contact,username,email,phone,id).first();
    return json({ok:true,school:mapSchool(row),schoolAdmin:{fullName:contact,username,email,phone,role:"School Administrator"},emailDelivery,message:"School and School Administrator account created automatically."},201);
  }catch(error){
    const msg=String(error?.message||"");
    console.error("NAVSTAR school registration failed:",msg);
    if(/UNIQUE constraint/i.test(msg))return json({ok:false,error:"The school code, administrator username or email is already registered. Review the details and try again."},409);
    return json({ok:false,error:"The school and its automatic School Administrator account could not be saved. Please try again."},500);
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
