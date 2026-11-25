import { sendNavstarEmail } from "../lib/email.js";
import { getAuthenticatedSession, hashPassword } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const id=()=>crypto.randomUUID();
const norm=v=>String(v||"").trim().toLowerCase();
const clean=v=>String(v||"").trim();
const allowedRoles=new Set(["school_owner","principal","deputy_principal","director_of_studies","deputy_director_of_studies","senior_teacher","head_of_department","examinations_officer","class_teacher","teacher","bursar_accountant","hr_administrator","admissions_registrar","librarian","parent","student"]);
const ensureLearnerLinkTable=db=>db.prepare("CREATE TABLE IF NOT EXISTS learner_user_links (id TEXT PRIMARY KEY,school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_by TEXT REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(school_id,learner_id),UNIQUE(school_id,user_id))").run();
const staffRoles=new Set(["school_owner","principal","deputy_principal","director_of_studies","deputy_director_of_studies","senior_teacher","head_of_department","examinations_officer","class_teacher","teacher","bursar_accountant","hr_administrator","admissions_registrar","librarian"]);
export async function onRequestGet({request,env}) {
 if(!env.DB)return json({ok:false,error:"Database connection is unavailable."},503);
 const actor=await getAuthenticatedSession(request,env);
 if(!actor)return json({ok:false,error:"Sign in to continue."},401);
 const schoolId=decodeURIComponent(new URL(request.url).pathname.split("/").slice(-2,-1)[0]||"");
 if(actor.is_super_admin)return json({ok:false,error:"School user accounts are managed by the School Administrator inside that school workspace."},403);
 if(actor.school_id!==schoolId)return json({ok:false,error:"You cannot view users in another school workspace."},403);
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
 if(actor.is_super_admin)return json({ok:false,error:"School user accounts must be created by the School Administrator inside that school workspace."},403);
 if(!schoolId||actor.school_id!==schoolId)return json({ok:false,error:"You cannot create accounts in another school workspace."},403);
 if(!actor.is_super_admin&&!actor.permissions.includes("school.users.manage"))return json({ok:false,error:"You do not have permission to manage school users."},403);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Enter valid account details."},400)}
 if(body.createFamilyAccounts===true){
  const admission=clean(body.learnerAdmissionNumber),studentName=clean(body.learnerFullName),studentUsername=norm(body.learnerUsername),studentPassword=String(body.learnerPassword||""),parentName=clean(body.parentFullName),parentUsername=norm(body.parentUsername),parentEmail=norm(body.parentEmail),parentPhone=clean(body.parentPhone),parentPassword=String(body.parentPassword||""),relationship=clean(body.relationship)||"Parent/Guardian";
  if(!admission||!studentName||!parentName||!/^[a-z0-9._-]{3,32}$/.test(studentUsername)||!/^[a-z0-9._-]{3,32}$/.test(parentUsername)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)||studentPassword.length<10||parentPassword.length<10)return json({ok:false,error:"Enter valid usernames, a parent email and passwords of at least 10 characters."},400);
  try{
   const school=await env.DB.prepare("SELECT id,name,school_code,status FROM schools WHERE id=?").bind(schoolId).first();
   if(!school||school.status!=="active")return json({ok:false,error:"The school workspace is not active."},409);
   const learner=await env.DB.prepare("SELECT id,admission_number FROM learners WHERE school_id=? AND admission_number=?").bind(schoolId,admission).first();
   if(!learner)return json({ok:false,error:"The learner admission number was not found in this school."},404);
   await ensureLearnerLinkTable(env.DB);
   const roles=await Promise.all(["student_learner","parent_guardian"].map(key=>env.DB.prepare("SELECT id,role_key,role_name FROM roles WHERE role_key=? AND school_id IS NULL").bind(key).first()));
   if(!roles[0]||!roles[1])return json({ok:false,error:"Student and Parent roles are not installed. Apply the latest role-access migration."},503);
   let student=await env.DB.prepare("SELECT u.id,u.username FROM learner_user_links l JOIN users u ON u.id=l.user_id WHERE l.school_id=? AND l.learner_id=?").bind(schoolId,learner.id).first();
   let parent=await env.DB.prepare("SELECT u.id,u.username,u.full_name FROM users u WHERE u.email_normalized=? LIMIT 1").bind(parentEmail).first();
   const reservedUsernames=new Set();
   const uniqueUsername=async base=>{const root=String(base||"account").slice(0,26);for(let n=0;n<100;n++){const candidate=(n?root+"."+n:root).slice(0,32);if(reservedUsernames.has(candidate))continue;const used=await env.DB.prepare("SELECT 1 AS found FROM users WHERE username_normalized=? LIMIT 1").bind(candidate).first();if(!used){reservedUsernames.add(candidate);return candidate;}}throw new Error("Could not generate an available username.");};
   const finalStudentUsername=student?.username||await uniqueUsername(studentUsername);
   const finalParentUsername=parent?.username||await uniqueUsername(parentUsername);
   const finalStudentEmail=norm(schoolId+"."+learner.id.slice(0,8)+"."+finalStudentUsername+"@learner.navstar.local");
   const studentId=student?.id||id(),parentId=parent?.id||id(),statements=[];
   if(!student){
    const passwordHash=await hashPassword(studentPassword);
    statements.push(env.DB.prepare("INSERT INTO users(id,email,email_normalized,username,username_normalized,phone,full_name,password_hash,status,password_changed_at) VALUES(?,?,?,?,?,?,?,?,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(studentId,finalStudentEmail,finalStudentEmail,finalStudentUsername,finalStudentUsername,null,studentName,passwordHash));
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO school_memberships(id,school_id,user_id,membership_status,job_title,joined_at) VALUES(?,?,?,'active','Student',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(id(),schoolId,studentId));
    statements.push(env.DB.prepare("INSERT INTO user_role_assignments(id,user_id,role_id,school_id,scope_json,assigned_by) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM user_role_assignments WHERE user_id=? AND role_id=? AND school_id=?)").bind(id(),studentId,roles[0].id,schoolId,JSON.stringify({scope:"school",level:"learner"}),actor.id,studentId,roles[0].id,schoolId));
    statements.push(env.DB.prepare("INSERT INTO learner_user_links(id,school_id,learner_id,user_id,created_by) VALUES(?,?,?,?,?)").bind(id(),schoolId,learner.id,studentId,actor.id));
   }
   if(!parent){
    const passwordHash=await hashPassword(parentPassword);
    statements.push(env.DB.prepare("INSERT INTO users(id,email,email_normalized,username,username_normalized,phone,full_name,password_hash,status,password_changed_at) VALUES(?,?,?,?,?,?,?,?,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(parentId,parentEmail,parentEmail,finalParentUsername,finalParentUsername,parentPhone||null,parentName,passwordHash));
   }
   statements.push(env.DB.prepare("INSERT OR IGNORE INTO school_memberships(id,school_id,user_id,membership_status,job_title,joined_at) VALUES(?,?,?,'active','Parent / Guardian',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(id(),schoolId,parentId));
   statements.push(env.DB.prepare("INSERT INTO user_role_assignments(id,user_id,role_id,school_id,scope_json,assigned_by) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM user_role_assignments WHERE user_id=? AND role_id=? AND school_id=?)").bind(id(),parentId,roles[1].id,schoolId,JSON.stringify({scope:"school",level:"linked_learners"}),actor.id,parentId,roles[1].id,schoolId));
   const linkedGuardian=await env.DB.prepare("SELECT g.id FROM guardians g JOIN learner_guardians lg ON lg.guardian_id=g.id WHERE lg.learner_id=? AND g.school_id=? AND (g.user_id=? OR lower(COALESCE(g.email,''))=lower(?) OR (g.phone IS NOT NULL AND g.phone=?)) ORDER BY CASE WHEN g.user_id=? THEN 0 ELSE 1 END LIMIT 1").bind(learner.id,schoolId,parentId,parentEmail,parentPhone,parentId).first();
   if(linkedGuardian)statements.push(env.DB.prepare("UPDATE guardians SET user_id=?,full_name=CASE WHEN full_name IS NULL OR trim(full_name)='' THEN ? ELSE full_name END,phone=COALESCE(phone,?),email=COALESCE(email,?) WHERE id=? AND school_id=?").bind(parentId,parentName,parentPhone||null,parentEmail,linkedGuardian.id,schoolId));
   else{
    const guardianId=id();
    statements.push(env.DB.prepare("INSERT INTO guardians(id,school_id,user_id,full_name,phone,email,relationship) VALUES(?,?,?,?,?,?,?)").bind(guardianId,schoolId,parentId,parentName,parentPhone||null,parentEmail,relationship));
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO learner_guardians(learner_id,guardian_id,is_primary,receives_communications) VALUES(?,?,1,1)").bind(learner.id,guardianId));
   }
   statements.push(env.DB.prepare("INSERT INTO audit_logs(id,actor_user_id,school_id,action,resource_type,resource_id,outcome,details_json) VALUES(?,?,?,'learner.family.accounts.created','learner',?,'success',?)").bind(id(),actor.id,schoolId,learner.id,JSON.stringify({studentUsername:finalStudentUsername,parentUsername:finalParentUsername,studentExisting:!!student,parentExisting:!!parent})));
   await env.DB.batch(statements);
   const finalStudent=student||{id:studentId,username:finalStudentUsername},finalParent=parent||{id:parentId,username:finalParentUsername};
   let emailDelivery="not_configured";
   if(env.RESEND_API_KEY){
    const loginUrl=new URL("/login.html",new URL(request.url).origin).toString(),safe=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const html="<div style='font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#17233b'><div style='background:#10213c;color:#fff;padding:22px'><b style='font-size:20px'>Navstar Analytics</b><div>Parent and learner portal access</div></div><div style='padding:24px;border:1px solid #e5eaf2'><p>Hello "+safe(parentName)+",</p><h2>Portal accounts linked to "+safe(studentName)+"</h2><p>Your school has connected your Parent / Guardian portal account to this learner and created or confirmed the learner's own login.</p><div style='background:#f3f6fb;padding:15px;border-radius:9px'><p><b>Parent username:</b> "+safe(finalParent.username)+"</p><p><b>Learner name:</b> "+safe(studentName)+"</p><p><b>Learner admission number:</b> "+safe(admission)+"</p><p><b>Learner username:</b> "+safe(finalStudent.username)+"</p></div><p>Sign in at <a href='"+loginUrl+"'>Navstar</a>. For security, passwords are not sent by email. The school will provide the initial sign-in details securely. You can use Forgot password for the parent account to set or recover your password. Contact the school administrator if the learner password needs to be reset.</p><p>Kind regards,<br><b>"+safe(school.name)+"</b></p></div></div>";
    try{const sent=await sendNavstarEmail(env,{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.MAIL_FROM||"Navstar Analytics <no-reply@mail.navstardigitalhub.co.ke>",to:[parentEmail],subject:"Parent and learner portal access · "+school.name,html,text:"Hello "+parentName+",\n\nParent username: "+finalParent.username+"\nLearner: "+studentName+" ("+admission+")\nLearner username: "+finalStudent.username+"\n\nSign in at "+loginUrl+". Passwords are not sent by email. The school will provide initial sign-in details securely. Use Forgot password for the parent account to set or recover your password. Contact the school administrator if the learner password needs to be reset.\n\n"+school.name})});emailDelivery=sent.ok?"sent":"failed";if(!sent.ok)console.error("Navstar family account email failed:",sent.status,await sent.text())}catch(error){emailDelivery="failed";console.error("Navstar family account email error:",String(error?.message||error))}
   }
   return json({ok:true,emailDelivery,student:{id:finalStudent.id,username:finalStudent.username,existing:!!student},parent:{id:finalParent.id,username:finalParent.username,existing:!!parent},message:"Separate learner and parent portal accounts are ready and linked to this learner."},201);
  }catch(error){console.error("NAVSTAR learner and parent account creation",String(error?.message||error));return json({ok:false,error:"Learner and parent accounts could not be created. The learner record remains saved; retry account creation from the learner profile."},500)}
 }
 const fullName=clean(body.fullName),username=norm(body.username),email=norm(body.email),phone=clean(body.phone),chosenPassword=String(body.password||"");
 const requestedRoles=Array.isArray(body.roleKeys)?body.roleKeys.map(norm):[norm(body.roleKey)];
 const roleKeys=[...new Set(requestedRoles.filter(Boolean))];
 const roleKey=roleKeys[0]||"";
 if(!fullName||fullName.length>120||!/^[a-z0-9._-]{3,32}$/.test(username)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>190||!roleKeys.length||roleKeys.some(k=>!allowedRoles.has(k))||(chosenPassword&&chosenPassword.length<10))
  return json({ok:false,error:"Enter a valid name, available username, email and role. A password, when supplied, must be at least 10 characters."},400);
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
  const bootstrapPassword=chosenPassword||Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
  const passwordHash=await hashPassword(bootstrapPassword);
  const statements=[
   env.DB.prepare("INSERT INTO users(id,email,email_normalized,username,username_normalized,phone,full_name,password_hash,status,password_changed_at) VALUES(?,?,?,?,?,?,?,?,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(userId,email,email,username,username,phone||null,fullName,passwordHash),
   env.DB.prepare("INSERT INTO school_memberships(id,school_id,user_id,membership_status,job_title,joined_at) VALUES(?,?,?,'active',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(membershipId,schoolId,userId,roleRows.map(r=>r.role_name).join(" / ")),
  ];
  for(const role of roleRows)statements.push(env.DB.prepare("INSERT INTO user_role_assignments(id,user_id,role_id,school_id,scope_json,assigned_by) VALUES(?,?,?,?,?,?)").bind(id(),userId,role.id,schoolId,JSON.stringify({scope:"school",level:"all"}),actor.id));
  if(roleKeys.some(k=>staffRoles.has(k)))statements.push(env.DB.prepare("INSERT INTO staff_profiles(id,school_id,user_id,staff_number,department,employment_status,is_teacher) VALUES(?,?,?,?,?,'active',?)").bind(id(),schoolId,userId,clean(body.staffNumber)||null,clean(body.department)||null,roleKeys.some(k=>["teacher","class_teacher","principal"].includes(k))?1:0));
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
