import { getSuperAdminSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function onRequestGet({request,env}){
 const actor=await getSuperAdminSession(request,env);if(!actor)return json({ok:false,error:"Only Super Admin can view all school-user access statuses."},403);
 try{
  const rows=await env.DB.prepare(`SELECT u.id AS user_id,u.full_name,u.username,u.email,u.phone,u.status AS user_status,u.last_login_at,
   m.school_id,m.membership_status,m.job_title,s.name AS school_name,s.school_code,s.status AS school_status,
   r.role_key,r.role_name,
   sub.status AS subscription_status,sub.next_due_date
   FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN schools s ON s.id=m.school_id
   LEFT JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=m.school_id
   LEFT JOIN roles r ON r.id=a.role_id
   LEFT JOIN (SELECT ss1.school_id,ss1.status,ss1.next_due_date FROM school_subscriptions ss1 JOIN (SELECT school_id,MAX(updated_at) AS latest FROM school_subscriptions GROUP BY school_id) x ON x.school_id=ss1.school_id AND x.latest=ss1.updated_at) sub ON sub.school_id=s.id
   ORDER BY s.name,u.full_name`).all();
  const today=new Date().toISOString().slice(0,10);
  const users=(rows.results||[]).map(x=>({...x,access_status:x.school_status==="suspended"?"School suspended":x.school_status==="archived"?"Archived":x.user_status!=="active"?x.user_status:x.membership_status!=="active"?x.membership_status:x.subscription_status==="expired"||x.subscription_status==="cancelled"||x.next_due_date&&x.next_due_date<today?"Expired":x.subscription_status==="past_due"?"Past due":x.school_status==="pending"?"Pending approval":"Active"}));
  return json({ok:true,users,summary:{total:users.length,active:users.filter(x=>x.access_status==="Active").length,suspended:users.filter(x=>["suspended","School suspended"].includes(x.access_status)).length,expired:users.filter(x=>x.access_status==="Expired").length,pending:users.filter(x=>x.access_status==="Pending approval"||x.access_status==="invited").length}});
 }catch(error){console.error("Navstar platform access list failed",String(error?.message||error));return json({ok:false,error:"School-user access records could not be loaded."},500)}
}
export async function onRequestPatch({request,env}){
 const actor=await getSuperAdminSession(request,env);if(!actor)return json({ok:false,error:"Only Super Admin can change school-user access."},403);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid access update."},400)}
 const userId=String(body.userId||""),schoolId=String(body.schoolId||""),status=String(body.status||"");
 if(!userId||!schoolId||!["active","suspended","locked","disabled"].includes(status))return json({ok:false,error:"Choose a valid school user and access status."},400);
 try{
  const row=await env.DB.prepare("SELECT u.id,u.status,m.membership_status,r.role_key FROM users u JOIN school_memberships m ON m.user_id=u.id AND m.school_id=? LEFT JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=m.school_id LEFT JOIN roles r ON r.id=a.role_id WHERE u.id=?").bind(schoolId,userId).first();
  if(!row)return json({ok:false,error:"That user is not a member of the selected school."},404);
  if(row.role_key==="super_admin")return json({ok:false,error:"Platform Super Admin access cannot be changed from the school-user directory."},403);
  const membership=status==="active"?"active":status==="disabled"?"ended":"suspended";
  await env.DB.batch([
   env.DB.prepare("UPDATE users SET status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(status,userId),
   env.DB.prepare("UPDATE school_memberships SET membership_status=? WHERE school_id=? AND user_id=?").bind(membership,schoolId,userId),
   ...(status==="active"?[]:[env.DB.prepare("UPDATE auth_sessions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=? AND revoked_at IS NULL").bind(userId)]),
   env.DB.prepare("INSERT INTO audit_logs(id,actor_user_id,action,resource_type,resource_id,outcome,details_json) VALUES(?,?, 'platform.school_user.access_changed','school-user',?,'success',?)").bind(crypto.randomUUID(),actor.id,userId,JSON.stringify({schoolId,status,membershipStatus:membership}))
  ]);
  const verify=await env.DB.prepare("SELECT u.status,m.membership_status FROM users u JOIN school_memberships m ON m.user_id=u.id AND m.school_id=? WHERE u.id=?").bind(schoolId,userId).first();
  if(!verify||verify.status!==status||verify.membership_status!==membership)throw new Error("Access status read-back verification failed.");
  return json({ok:true,message:"School-user access updated and verified.",status,membershipStatus:membership});
 }catch(error){console.error("Navstar school-user access update failed",String(error?.message||error));return json({ok:false,error:"The access change could not be saved and verified."},500)}
}
