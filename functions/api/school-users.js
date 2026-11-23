import { sendNavstarEmail } from "../lib/email.js";
import { getAuthenticatedSession, hashPassword } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const id=()=>crypto.randomUUID();
const norm=v=>String(v||"").trim().toLowerCase();
const clean=v=>String(v||"").trim();
const allowedRoles=new Set(["school_owner","principal","deputy_principal","director_of_studies","deputy_director_of_studies","senior_teacher","head_of_department","examinations_officer","class_teacher","teacher","bursar_accountant","hr_administrator","admissions_registrar","librarian","parent","student"]);
const ensureLearnerLinkTable=db=>db.prepare("CREATE TABLE IF NOT EXISTS learner_user_links (id TEXT PRIMARY KEY,school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_by TEXT REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(school_id,learner_id),UNIQUE(school_id,user_id))").run();
const staffRoles=new Set(["school_owner","principal","deputy_principal","director_of_studies","deputy_director_of_studies","head_of_department","examinations_officer","class_teacher","teacher","bursar_accountant","hr_administrator","admissions_registrar","librarian"]);
export async function onRequestGet({request,env}) {
 if(!env.DB)return json({ok:false,error:"Database connection is unavailable."},503);
 const actor=await getAuthenticatedSession(request,env);
 if(!actor)return json({ok:false,error:"Sign in to continue."},401);
 const schoolId=decodeURIComponent(new URL(request.url).pathname.split("/").slice(-2,-1)[0]||"");
 if(!actor.is_super_admin&&actor.school_id!==schoolId)return json({ok:false,error:"You cannot view users in another school's workspace."},403);
 if(!actor.is_super_admin&&!actor.permissions.includes("school.users.manage"))return json({ok:false,error:"You do not have permission to manage school users."},403);
 const rows=await env.DB.prepare(`SELECT u.id,u.full_name,u.username,u.email,u.phone,u.status,m.job_title,m.membership_status,GROUP_CONCAT(DISTINCT r.role_key) AS role_keys,GROUP_CONCAT(DISTINCT r.role_name) AS role_names
  FROM school_memberships m JOIN users u ON u.id=m.user_id
  LEFT JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=m.school_id
  LEFT JOIN roles r ON r.id=a.role_id
  WHERE m.school_id=? GROUP BY u.id,u.full_name,u.username,u.email,u.phone,u.status,m.job_title,m.membership_status ORDER BY u.full_name`).bind(schoolId).all();
 return json({ok:true,users:rows.results||[]});
}
export async function onRequestPost({request,env}) {
 if(!env.DB)return json({ok:false,error:"Database connection is unavailable."},503);
 const actor=await getAuthenticatedSession(request,env);
 if(!actor)return json({ok:false,error:"Sign in to continue."},401);
 const schoolId=decodeURIComponent(new URL(request.url).pathname.split("/").slice(-2,-1)[0]||"");
 if(!schoolId||(!actor.is_super_admin&&actor.school_id!==schoolId))return json({ok:false,error:"You cannot create accounts in another school's workspace."},403);
 if(!actor.is_super_admin&&!actor.permissions.includes("school.users.manage"))return json({ok:false,error:"You do not have permission to manage school users."},403);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Enter valid account details."},400)}
 const fullName=clean(body.fullName),username=norm(body.username),email=norm(body.email),phone=clean(body.phone);
 const requestedRoles=Array.isArray(body.roleKeys)?body.roleKeys.map(norm):[norm(body.roleKey)];
 const roleKeys=[...new Set(requestedRoles.filter(Boolean))];
 const roleKey=roleKeys[0]||"";
 if(!fullName||fullName.length>120||!/^[a-z0-9._-]{3,32}$/.test(username)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>190||!roleKeys.length||roleKeys.some(k=>!allowedRoles.has(k)))
  return json({ok:false,error:"Enter a valid name, username, email and at least one valid role."},400);
 try {
  const usernameTaken=await env.DB.prepare("SELECT 1 AS found FROM users WHERE username_normalized=? LIMIT 1").bind(username).first();
  if(usernameTaken)return json({ok:false,error:"That username is already taken across Navstar. Please choose a different username."},409);
  const emailTaken=await env.DB.prepare("SELECT 1 AS found FROM users WHERE email_normalized=? LIMIT 1").bind(email).first();
  if(emailTaken)return json({ok:false,error:"That email address is already registered. Use a different email address."},409);
  const school=await env.DB.prepare("SELECT id,status FROM schools WHERE id=?").bind(schoolId).first();
  if(!school||school.status!=="active")return json({ok:false,error:"The school workspace is not active."},409);
  const databaseRoleKeys=roleKeys.map(k=>k==="parent"?"parent_guardian":k==="student"?"student_learner":k);
  const roleRows=[];
  for(const key of databaseRoleKeys){const role=await env.DB.prepare("SELECT id,role_key,role_name FROM roles WHERE role_key=? AND school_id IS NULL").bind(key).first();if(!role)return json({ok:false,error:"The role "+key+" is not installed. Apply the latest role-access migration."},503);roleRows.push(role);}
  const primaryRole=roleRows[0];
  if(roleKeys.includes("student"))await ensureLearnerLinkTable(env.DB);
  const learnerNumbers=Array.isArray(body.learnerAdmissionNumbers)?body.learnerAdmissionNumbers.map(clean).filter(Boolean):String(body.learnerAdmissionNumbers||"").split(",").map(clean).filter(Boolean);
  if(roleKeys.some(k=>["parent","student"].includes(k))&&!learnerNumbers.length)return json({ok:false,error:"Enter at least one linked learner admission number for a parent or learner role."},400);
  if(roleKeys.includes("student")&&learnerNumbers.length!==1)return json({ok:false,error:"A learner account must be linked to exactly one learner."},400);
  const linkedLearners=[];
  for(const admission of learnerNumbers){const learner=await env.DB.prepare("SELECT id FROM learners WHERE school_id=? AND admission_number=?").bind(schoolId,admission).first();if(!learner)return json({ok:false,error:"Learner admission number "+admission+" was not found in this school."},404);linkedLearners.push(learner.id);}
  const userId=id(),membershipId=id(),assignmentId=id();
  const bootstrapPassword=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
  const passwordHash=await hashPassword(bootstrapPassword);
  const statements=[
   env.DB.prepare("INSERT INTO users(id,email,email_normalized,username,username_normalized,phone,full_name,password_hash,status,password_changed_at) VALUES(?,?,?,?,?,?,?,?,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(userId,email,email,username,username,phone||null,fullName,passwordHash),
   env.DB.prepare("INSERT INTO school_memberships(id,school_id,user_id,membership_status,job_title,joined_at) VALUES(?,?,?,'active',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(membershipId,schoolId,userId,roleRows.map(r=>r.role_name).join(" / ")),
  ];
  for(const role of roleRows)statements.push(env.DB.prepare("INSERT INTO user_role_assignments(id,user_id,role_id,school_id,scope_json,assigned_by) VALUES(?,?,?,?,?,?)").bind(id(),userId,role.id,schoolId,JSON.stringify({scope:"school",level:"all"}),actor.id));
  if(roleKeys.some(k=>staffRoles.has(k)))statements.push(env.DB.prepare("INSERT INTO staff_profiles(id,school_id,user_id,staff_number,department,employment_status) VALUES(?,?,?,?,?,'active')").bind(id(),schoolId,userId,clean(body.staffNumber)||null,clean(body.department)||null));
  if(roleKeys.includes("parent")){
   const guardianId=id();
   statements.push(env.DB.prepare("INSERT INTO guardians(id,school_id,user_id,full_name,phone,email,relationship) VALUES(?,?,?,?,?,?,?)").bind(guardianId,schoolId,userId,fullName,phone||null,email,clean(body.relationship)||"Parent/Guardian"));
   for(const learnerId of linkedLearners)statements.push(env.DB.prepare("INSERT INTO learner_guardians(learner_id,guardian_id,is_primary,receives_communications) VALUES(?,?,0,1)").bind(learnerId,guardianId));
  }
  if(roleKeys.includes("student"))statements.push(env.DB.prepare("INSERT INTO learner_user_links(id,school_id,learner_id,user_id,created_by) VALUES(?,?,?,?,?)").bind(id(),schoolId,linkedLearners[0],userId,actor.id));
  statements.push(env.DB.prepare("INSERT INTO audit_logs(id,actor_user_id,school_id,action,resource_type,resource_id,outcome,details_json) VALUES(?,?,?,'school.user.created','user',?,'success',?)").bind(id(),actor.id,schoolId,userId,JSON.stringify({username,roles:roleKeys,linkedLearners:linkedLearners.length})));
  await env.DB.batch(statements);
  let emailDelivery="not_configured";
  if(env.RESEND_API_KEY){
   const schoolInfo=await env.DB.prepare("SELECT name,school_code,contact_email,contact_phone,county FROM schools WHERE id=?").bind(schoolId).first();
   const from=env.MAIL_FROM||"Navstar Analytics <no-reply@mail.navstardigitalhub.co.ke>";
   const loginUrl=new URL("/login.html",new URL(request.url).origin).toString();
   const safe=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
   const schoolName=schoolInfo?.name||"your school",roleName=roleRows.map(r=>r.role_name).join(" + ")||roleKey;
   const html="<div style='font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#17233b'><div style='background:#10213c;color:white;padding:24px'><b style='font-size:22px'>Navstar Analytics</b><div>School management and education analytics</div></div><div style='padding:26px;border:1px solid #e5eaf2'><p>Hello "+safe(fullName)+",</p><h2>Your school account is ready</h2><p>Your account was created by the School Administrator of <b>"+safe(schoolName)+"</b>.</p><div style='background:#f3f6fb;padding:16px;border-radius:9px'><p><b>School:</b> "+safe(schoolName)+"</p><p><b>School code:</b> "+safe(schoolInfo?.school_code||"—")+"</p><p><b>School email:</b> "+safe(schoolInfo?.contact_email||"—")+"</p><p><b>School phone:</b> "+safe(schoolInfo?.contact_phone||"—")+"</p><p><b>County:</b> "+safe(schoolInfo?.county||"—")+"</p><p><b>Your name:</b> "+safe(fullName)+"</p><p><b>Username:</b> "+safe(username)+"</p><p><b>Your email:</b> "+safe(email)+"</p><p><b>Phone:</b> "+safe(phone||"—")+"</p><p><b>Role:</b> "+safe(roleName)+"</p></div><p>Sign in using your username. For security, your password is not included in this email. Select <b>Forgot password</b> and follow the one-time email code instructions to set your password.</p><p><a href='"+loginUrl+"'>Open Navstar login</a></p><p>Welcome,<br><b>Navstar Analytics</b></p></div></div>";
   try{
    const sent=await sendNavstarEmail(env,{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from,to:[email],subject:"Your "+roleName+" account · "+schoolName,html,text:"Hello "+fullName+",\\nSchool: "+schoolName+"\\nSchool code: "+(schoolInfo?.school_code||"—")+"\\nSchool email: "+(schoolInfo?.contact_email||"—")+"\\nSchool phone: "+(schoolInfo?.contact_phone||"—")+"\\nYour name: "+fullName+"\\nUsername: "+username+"\\nEmail: "+email+"\\nPhone: "+(phone||"—")+"\\nRole: "+roleName+"\\n\\nSign in at "+loginUrl+" using your username. Use Forgot password to receive an OTP and set your password.\\n\\nNavstar Analytics."})});
    emailDelivery=sent.ok?"sent":"failed";if(!sent.ok)console.error("Navstar school user email failed:",sent.status,await sent.text());
   }catch(error){emailDelivery="failed";console.error("Navstar school user email error:",String(error?.message||error));}
  }
  return json({ok:true,emailDelivery,message:"School account created. Account setup email sent where email delivery is configured.",user:{id:userId,fullName,username,email,role:roleRows.map(r=>r.role_name).join(" + "),roleKeys,schoolId}},201);
 }catch(error){
  const message=String(error?.message||"");console.error("School user creation failed:",message);
  const usernameNow=await env.DB.prepare("SELECT 1 AS found FROM users WHERE username_normalized=? LIMIT 1").bind(username).first().catch(()=>null);const emailNow=await env.DB.prepare("SELECT 1 AS found FROM users WHERE email_normalized=? LIMIT 1").bind(email).first().catch(()=>null);const conflict=/UNIQUE constraint/i.test(message);return json({ok:false,error:usernameNow?"That username is already taken across Navstar. Please choose a different username.":emailNow?"That email address is already registered. Use a different email address.":conflict?"These account details are already registered. Please review the username and email.":"The school account could not be created. Check the account details and try again."},conflict?409:500);
 }
}
