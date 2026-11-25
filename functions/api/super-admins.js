import { getSuperAdminSession, hashPassword, passwordPolicy } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const id=()=>crypto.randomUUID();
const norm=v=>String(v??"").trim().toLowerCase();
const clean=v=>String(v??"").trim();
async function guard(request,env){
 if(!env?.DB)return {error:json({ok:false,error:"Account service is unavailable."},503)};
 const actor=await getSuperAdminSession(request,env);
 return actor?{actor}:{error:json({ok:false,error:"Only Super Admin can manage platform administrator accounts."},403)};
}
async function ensureLimit(db){
 await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_super_admin_max_two
 BEFORE INSERT ON super_admin_profiles
 WHEN (SELECT COUNT(*) FROM super_admin_profiles)>=2
 BEGIN SELECT RAISE(ABORT,'Maximum of two Super Admin accounts allowed.'); END`).run();
}
async function list(db){
 const rows=await db.prepare(`SELECT u.id,u.full_name,u.username,u.email,u.phone,u.status,u.created_at,u.last_login_at,
 p.designation,p.organisation_name,p.is_primary_owner
 FROM super_admin_profiles p JOIN users u ON u.id=p.user_id
 ORDER BY p.is_primary_owner DESC,p.created_at ASC`).all();
 return rows.results||[];
}
async function audit(db,actor,action,userId,details){
 await db.prepare("INSERT INTO audit_logs(id,actor_user_id,action,resource_type,resource_id,outcome,details_json) VALUES(?,?,?,'super_admin','?','success',?)")
 .bind(id(),actor,action,userId,JSON.stringify(details||{})).run().catch(async()=>{
  await db.prepare("INSERT INTO audit_logs(id,actor_user_id,action,resource_type,resource_id,outcome,details_json) VALUES(?,?,?,'user',?,'success',?)")
   .bind(id(),actor,action,userId,JSON.stringify(details||{})).run().catch(()=>{});
 });
}
export async function onRequestGet({request,env}){
 const g=await guard(request,env);if(g.error)return g.error;
 try{await ensureLimit(env.DB);const records=await list(env.DB);return json({ok:true,records,count:records.length,maximum:2,canCreate:records.length<2});}
 catch(error){console.error("Super Admin directory load failed",error);return json({ok:false,error:"Super Admin records could not be loaded."},500)}
}
export async function onRequestPost({request,env}){
 const g=await guard(request,env);if(g.error)return g.error;
 let b;try{b=await request.json()}catch{return json({ok:false,error:"Enter valid account details."},400)}
 const fullName=clean(b.fullName),username=norm(b.username),email=norm(b.email),phone=clean(b.phone),designation=clean(b.designation)||"Super Administrator",organisation=clean(b.organisationName)||"NAVSTAR Analytics",password=String(b.password||"");
 if(!fullName||fullName.length>120||!/^[a-z0-9._-]{3,32}$/.test(username)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>190||phone.length>40||designation.length>100||organisation.length>140)
  return json({ok:false,error:"Enter a valid full name, username and email address."},400);
 if(!passwordPolicy(password))return json({ok:false,error:"Password must be at least 6 characters and contain at least 3 character types."},400);
 try{
  await ensureLimit(env.DB);
  const existing=await env.DB.prepare("SELECT COUNT(*) AS total FROM super_admin_profiles").first();
  if(Number(existing?.total||0)>=2)return json({ok:false,error:"The platform already has its maximum of two Super Admin accounts. Reset an existing account's credentials instead of creating another."},409);
  if(await env.DB.prepare("SELECT 1 FROM users WHERE username_normalized=?").bind(username).first())return json({ok:false,error:"That username is already in use."},409);
  if(await env.DB.prepare("SELECT 1 FROM users WHERE email_normalized=?").bind(email).first())return json({ok:false,error:"That email address is already registered."},409);
  const role=await env.DB.prepare("SELECT id FROM roles WHERE role_key='super_admin' AND school_id IS NULL").first();
  if(!role)return json({ok:false,error:"The platform administrator role is not configured."},503);
  const userId=id(),passwordHash=await hashPassword(password);
  await env.DB.batch([
   env.DB.prepare("INSERT INTO users(id,email,email_normalized,username,username_normalized,phone,full_name,password_hash,status,password_changed_at) VALUES(?,?,?,?,?,?,?,?, 'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(userId,email,email,username,username,phone||null,fullName,passwordHash),
   env.DB.prepare("INSERT INTO super_admin_profiles(user_id,designation,organisation_name,country,timezone,currency,is_primary_owner) VALUES(?,?,?,'Kenya','Africa/Nairobi','KES',0)").bind(userId,designation,organisation),
   env.DB.prepare("INSERT INTO user_role_assignments(id,user_id,role_id,school_id,scope_json,assigned_by) VALUES(?,?,?,NULL,'{\"scope\":\"platform\"}',?)").bind(id(),userId,role.id,g.actor.id),
   env.DB.prepare("INSERT INTO audit_logs(id,actor_user_id,action,resource_type,resource_id,outcome,details_json) VALUES(?,?,'super_admin.created','user',?,'success',?)").bind(id(),g.actor.id,userId,JSON.stringify({username,email}))
  ]);
  const records=await list(env.DB);
  const saved=records.find(x=>x.id===userId);
  if(!saved)throw new Error("New administrator read-back verification failed.");
  return json({ok:true,message:"Super Admin account created and verified.",record:saved,records,count:records.length,maximum:2,canCreate:records.length<2},201);
 }catch(error){
  const message=String(error?.message||"");
  if(/Maximum of two Super Admin/i.test(message))return json({ok:false,error:"The platform already has two Super Admin accounts. Reset an existing account instead."},409);
  if(/UNIQUE constraint/i.test(message))return json({ok:false,error:"The username or email address is already registered."},409);
  console.error("Super Admin account creation failed",message);
  return json({ok:false,error:"The Super Admin account could not be created. No success was recorded."},500);
 }
}
export async function onRequestPatch({request,env}){
 const g=await guard(request,env);if(g.error)return g.error;
 let b;try{b=await request.json()}catch{return json({ok:false,error:"Invalid account update."},400)}
 const userId=clean(b.userId);if(!userId)return json({ok:false,error:"Choose a Super Admin account."},400);
 const current=await env.DB.prepare("SELECT u.id,p.is_primary_owner FROM users u JOIN super_admin_profiles p ON p.user_id=u.id WHERE u.id=?").bind(userId).first();
 if(!current)return json({ok:false,error:"Super Admin account not found."},404);
 const fullName=clean(b.fullName),username=norm(b.username),email=norm(b.email),phone=clean(b.phone),designation=clean(b.designation),password=String(b.newPassword||"");
 if(!fullName||fullName.length>120||!/^[a-z0-9._-]{3,32}$/.test(username)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>190||phone.length>40||designation.length>100)
  return json({ok:false,error:"Enter valid name, username, email and designation details."},400);
 if(password&&!passwordPolicy(password))return json({ok:false,error:"New password must be at least 6 characters and contain at least 3 character types."},400);
 try{
  const u=await env.DB.prepare("SELECT id FROM users WHERE username_normalized=? AND id<>?").bind(username,userId).first();
  if(u)return json({ok:false,error:"That username is already in use."},409);
  const em=await env.DB.prepare("SELECT id FROM users WHERE email_normalized=? AND id<>?").bind(email,userId).first();
  if(em)return json({ok:false,error:"That email address is already registered."},409);
  const statements=[
   env.DB.prepare("UPDATE users SET full_name=?,username=?,username_normalized=?,email=?,email_normalized=?,phone=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(fullName,username,username,email,email,phone||null,userId),
   env.DB.prepare("UPDATE super_admin_profiles SET designation=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=?").bind(designation,userId)
  ];
  if(password){statements.push(env.DB.prepare("UPDATE users SET password_hash=?,password_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(await hashPassword(password),userId));statements.push(env.DB.prepare("UPDATE auth_sessions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=? AND revoked_at IS NULL").bind(userId));}
  statements.push(env.DB.prepare("INSERT INTO audit_logs(id,actor_user_id,action,resource_type,resource_id,outcome,details_json) VALUES(?,?,'super_admin.updated','user',?,'success',?)").bind(id(),g.actor.id,userId,JSON.stringify({credentialsReset:!!password})));
  await env.DB.batch(statements);
  const records=await list(env.DB),saved=records.find(x=>x.id===userId);
  if(!saved||saved.full_name!==fullName||saved.username!==username||saved.email!==email||saved.designation!==designation)throw new Error("Super Admin update read-back verification failed.");
  return json({ok:true,message:password?"Account updated; password reset and existing sessions revoked.":"Super Admin account updated and verified.",record:saved,records,count:records.length,maximum:2,canCreate:records.length<2});
 }catch(error){if(/UNIQUE constraint/i.test(String(error?.message||"")))return json({ok:false,error:"The username or email address is already registered."},409);console.error("Super Admin account update failed",error);return json({ok:false,error:"The account changes could not be saved and verified."},500)}
}
export async function onRequestDelete({request,env}){
 const g=await guard(request,env);if(g.error)return g.error;
 let b;try{b=await request.json()}catch{return json({ok:false,error:"Choose an account to delete."},400)}
 const userId=clean(b.userId);if(!userId)return json({ok:false,error:"Choose an account to delete."},400);
 if(userId===g.actor.id)return json({ok:false,error:"You cannot delete the Super Admin account you are currently using."},403);
 try{
  const target=await env.DB.prepare("SELECT p.is_primary_owner,(SELECT COUNT(*) FROM super_admin_profiles) AS total FROM super_admin_profiles p WHERE p.user_id=?").bind(userId).first();
  if(!target)return json({ok:false,error:"Super Admin account not found."},404);
  if(Number(target.is_primary_owner)===1)return json({ok:false,error:"The primary platform owner account is protected and cannot be deleted."},403);
  if(Number(target.total)<=1)return json({ok:false,error:"At least one Super Admin account must remain."},409);
  const linked=await env.DB.prepare("SELECT COUNT(*) AS total FROM school_memberships WHERE user_id=?").bind(userId).first();
  if(Number(linked?.total||0)>0)return json({ok:false,error:"This account is linked to school memberships and cannot be deleted from this screen."},409);
  await env.DB.batch([
   env.DB.prepare("INSERT INTO audit_logs(id,actor_user_id,action,resource_type,resource_id,outcome,details_json) VALUES(?,?,'super_admin.deleted','user',?,'success','{}')").bind(id(),g.actor.id,userId),
   env.DB.prepare("DELETE FROM users WHERE id=?").bind(userId)
  ]);
  const records=await list(env.DB);
  return json({ok:true,message:"Super Admin account deleted.",records,count:records.length,maximum:2,canCreate:records.length<2});
 }catch(error){console.error("Super Admin deletion failed",error);return json({ok:false,error:"The account could not be deleted."},500)}
}
