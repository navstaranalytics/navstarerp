import { getSuperAdminSession, hashPassword } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const clean=v=>String(v??"").trim();
const makeId=()=>crypto.randomUUID();
export async function onRequestPost({request,env}){
  if(!env.DB)return json({ok:false,error:"Database connection is unavailable."},503);
  const actor=await getSuperAdminSession(request,env);
  if(!actor)return json({ok:false,error:"Only Super Admin can provision a School Administrator."},403);
  const schoolId=decodeURIComponent(new URL(request.url).pathname.split("/").slice(-2,-1)[0]||"");
  if(!schoolId)return json({ok:false,error:"A valid school ID is required."},400);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Enter the School Administrator details."},400)}
  const fullName=clean(body.fullName),username=clean(body.username).toLowerCase(),email=clean(body.email).toLowerCase(),phone=clean(body.phone);
  if(!fullName||fullName.length>120||!/^[a-z0-9._-]{3,32}$/.test(username)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>190||!phone||phone.length>40)
    return json({ok:false,error:"Enter a full name, username (3–32 letters/numbers/dots/underscores/hyphens), valid email and phone number."},400);
  try{
    const school=await env.DB.prepare("SELECT id,name,school_code,status,contact_email,contact_phone FROM schools WHERE id=?").bind(schoolId).first();
    if(!school)return json({ok:false,error:"School was not found."},404);
    const existing=await env.DB.prepare(`SELECT u.id,u.full_name,u.username,u.email,u.phone FROM school_memberships m
      JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=m.school_id
      JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin'
      WHERE m.school_id=? AND m.membership_status IN ('active','invited') LIMIT 1`).bind(schoolId).first();
    if(existing)return json({ok:false,error:"This school already has a School Administrator account. View the existing account in the school profile."},409);
    if(await env.DB.prepare("SELECT 1 AS found FROM users WHERE username_normalized=? LIMIT 1").bind(username).first())
      return json({ok:false,error:"That username is already taken across NAVSTAR. Choose a different username."},409);
    if(await env.DB.prepare("SELECT 1 AS found FROM users WHERE email_normalized=? LIMIT 1").bind(email).first())
      return json({ok:false,error:"That email address is already registered. Use a different email address."},409);
    const role=await env.DB.prepare("SELECT id FROM roles WHERE id='role_school_admin' AND role_key='school_admin' AND school_id IS NULL").first();
    if(!role)return json({ok:false,error:"The School Administrator role is not installed. Run the access-control upgrade."},503);
    const userId=makeId(),membershipId=makeId(),assignmentId=makeId();
    const randomPassword=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
    const passwordHash=await hashPassword(randomPassword);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users(id,email,email_normalized,username,username_normalized,phone,full_name,password_hash,status) VALUES(?,?,?,?,?,?,?,?,'active')").bind(userId,email,email,username,username,phone,fullName,passwordHash),
      env.DB.prepare("INSERT INTO school_memberships(id,school_id,user_id,membership_status,job_title,joined_at) VALUES(?,?,?,'active','School Administrator',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(membershipId,schoolId,userId),
      env.DB.prepare("INSERT INTO user_role_assignments(id,user_id,role_id,school_id,scope_json,assigned_by) VALUES(?,?,?,?,?,?)").bind(assignmentId,userId,role.id,schoolId,JSON.stringify({scope:"school",level:"all"}),actor.id),
      env.DB.prepare("INSERT INTO audit_logs(id,actor_user_id,school_id,action,resource_type,resource_id,outcome,details_json) VALUES(?,?,?,'school.admin.created','user',?,'success',?)").bind(makeId(),actor.id,schoolId,userId,JSON.stringify({username,email}))
    ]);
    let emailDelivery="not_configured";
    if(env.RESEND_API_KEY){
      const from=env.MAIL_FROM||"Navstar Analytics <onboarding@resend.dev>",loginUrl=new URL("/login.html",new URL(request.url).origin).toString();
      const safe=v=>String(v).replace(/[&<>"]/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[x]));
      const html="<div style='font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#17233b'><div style='background:#082b70;color:#fff;padding:26px;border-radius:14px 14px 0 0'><b style='font-size:20px;letter-spacing:1px'>NAVSTAR ANALYTICS</b><div style='font-size:12px'>Smart School Management & Education Analytics</div></div><div style='padding:28px;border:1px solid #e5eaf2;border-radius:0 0 14px 14px'><p>Hello "+safe(fullName)+",</p><h2>Your School Administrator account is ready</h2><p>You have been appointed as the School Administrator for <b>"+safe(school.name)+"</b>.</p><div style='background:#f3f6fb;padding:16px;border-radius:10px'><p><b>Username:</b> "+safe(username)+"</p><p><b>Registered email:</b> "+safe(email)+"</p><p><b>Phone:</b> "+safe(phone)+"</p><p><b>School code:</b> "+safe(school.school_code)+"</p></div><h3>What you can do in NAVSTAR</h3><ul><li>Set up school staff, teachers and other authorised users</li><li>Configure academic years, terms, levels, classes, streams and learning areas</li><li>Manage learner records, admissions and parent/learner access</li><li>Coordinate teacher allocations, attendance and assessments</li><li>Oversee school operations, reports and permitted finance functions</li></ul><h3>Activate your password</h3><p>For security, no temporary password is sent. Open the NAVSTAR login page, enter your username and choose <b>Forgot password</b>. A one-time code will be sent to your registered email so you can set your own password.</p><p><a href='"+loginUrl+"' style='display:inline-block;background:#1264e8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700'>Open NAVSTAR login</a></p><p>"+(school.status==="active"?"Your school workspace is active.":"Your account has been created; sign-in will be available once the school is activated by NAVSTAR.")+"</p><p>Welcome aboard,<br><b>NAVSTAR Analytics Team</b></p></div></div>";
      try{const sent=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from,to:[email],subject:"Your School Administrator account · "+school.name,html,text:"Hello "+fullName+",\n\nYou are the School Administrator for "+school.name+".\nUsername: "+username+"\nEmail: "+email+"\nPhone: "+phone+"\nSchool code: "+school.school_code+"\n\nUse Forgot password on "+loginUrl+" to receive an OTP and set your password. No temporary password is sent.\n\nNAVSTAR supports school users, academics, learners, teacher allocations, attendance, assessments, operations and reports.\n\nNAVSTAR Analytics Team."})});emailDelivery=sent.ok?"sent":"failed";if(!sent.ok)console.error("NAVSTAR School Admin email failed:",sent.status,await sent.text());}
      catch(error){emailDelivery="failed";console.error("NAVSTAR School Admin email error:",String(error?.message||error));}
    }
    return json({ok:true,emailDelivery,admin:{id:userId,fullName,username,email,phone,role:"School Administrator",status:"active"},message:"School Administrator account created."},201);
  }catch(error){
    const msg=String(error?.message||"");console.error("NAVSTAR School Admin provisioning failed:",msg);
    if(/UNIQUE constraint/i.test(msg))return json({ok:false,error:"The username or email has just been registered. Refresh and choose another."},409);
    return json({ok:false,error:"The School Administrator account could not be created. Please try again."},500);
  }
}
