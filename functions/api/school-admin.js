import { getSuperAdminSession, hashPassword, passwordPolicy } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const id=()=>crypto.randomUUID();
const norm=v=>String(v||"").trim().toLowerCase();
const text=v=>String(v||"").trim();
export async function onRequestPost({request,env,params}) {
 if(!env.DB)return json({ok:false,error:"Database connection is unavailable."},503);
 const actor=await getSuperAdminSession(request,env);
 if(!actor)return json({ok:false,error:"Only a signed-in Super Admin can create the first School Administrator."},401);
 const path=new URL(request.url).pathname.split("/");
 const schoolId=decodeURIComponent(path[path.length-2]||"");
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid account details."},400)}
 const fullName=text(body.fullName),username=norm(body.username),email=norm(body.email),phone=text(body.phone),password=String(body.password||"");
 if(!schoolId||!fullName||fullName.length>120||! /^[a-z0-9._-]{3,32}$/.test(username)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>190||password.length>128)
  return json({ok:false,error:"Enter a valid name, username, email and password."},400);
 if(!passwordPolicy(password))return json({ok:false,error:"Password must be at least 6 characters and contain at least 3 of uppercase, lowercase, number and special character."},400);
 try {
  const usernameTaken=await env.DB.prepare("SELECT 1 AS found FROM users WHERE username_normalized=? LIMIT 1").bind(username).first();
  if(usernameTaken)return json({ok:false,error:"That username is already taken across NAVSTAR. Please choose a different username."},409);
  const emailTaken=await env.DB.prepare("SELECT 1 AS found FROM users WHERE email_normalized=? LIMIT 1").bind(email).first();
  if(emailTaken)return json({ok:false,error:"That email address is already registered. Use a different email address."},409);
  const school=await env.DB.prepare("SELECT id,name,status FROM schools WHERE id=?").bind(schoolId).first();
  if(!school)return json({ok:false,error:"School not found."},404);
  const role=await env.DB.prepare("SELECT id FROM roles WHERE id='role_school_admin' AND role_key='school_admin'").first();
  if(!role)return json({ok:false,error:"School Administrator role is not installed. Sign in to Super Admin to run the role upgrade."},503);
  const userId=id(),membershipId=id(),assignmentId=id(),passwordHash=await hashPassword(password);
  await env.DB.batch([
   env.DB.prepare("INSERT INTO users(id,email,email_normalized,username,username_normalized,phone,full_name,password_hash,status) VALUES(?,?,?,?,?,?,?,?,'active')").bind(userId,email,email,username,username,phone||null,fullName,passwordHash),
   env.DB.prepare("INSERT INTO school_memberships(id,school_id,user_id,membership_status,job_title,joined_at) VALUES(?,?,?,'active','School Administrator',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(membershipId,schoolId,userId),
   env.DB.prepare("INSERT INTO user_role_assignments(id,user_id,role_id,school_id,scope_json,assigned_by) VALUES(?,?,?,?,'{\"scope\":\"school\",\"level\":\"all\"}',?)").bind(assignmentId,userId,role.id,schoolId,actor.id),
   env.DB.prepare("INSERT INTO audit_logs(id,actor_user_id,school_id,action,resource_type,resource_id,outcome,details_json) VALUES(?,?,?,'school.admin.created','user',?,'success',?)").bind(id(),actor.id,schoolId,userId,JSON.stringify({username,email}))
  ]);
  return json({ok:true,message:"School Administrator account created.",user:{id:userId,fullName,username,email,phone,schoolId,role:"School Administrator"}},201);
 } catch(error) {
  const message=String(error?.message||"");
  console.error("NAVSTAR school admin provisioning failed",message);
  const usernameNow=await env.DB.prepare("SELECT 1 AS found FROM users WHERE username_normalized=? LIMIT 1").bind(username).first().catch(()=>null);const emailNow=await env.DB.prepare("SELECT 1 AS found FROM users WHERE email_normalized=? LIMIT 1").bind(email).first().catch(()=>null);const conflict=/UNIQUE constraint/i.test(message);return json({ok:false,error:usernameNow?"That username is already taken across NAVSTAR. Please choose a different username.":emailNow?"That email address is already registered. Use a different email address.":conflict?"These account details are already registered. Please review the username and email.":"The School Administrator account could not be saved. Please check the database and try again."},conflict?409:500);
 }
}
