import { getAuthenticatedSession, hashPassword, passwordPolicy } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const id=()=>crypto.randomUUID();
const norm=v=>String(v||"").trim().toLowerCase();
const clean=v=>String(v||"").trim();
const allowedRoles=new Set(["school_owner","principal","deputy_principal","director_of_studies","deputy_director_of_studies","head_of_department","examinations_officer","class_teacher","teacher","bursar_accountant","hr_administrator","admissions_registrar","librarian","parent","student"]);
const staffRoles=new Set(["school_owner","principal","deputy_principal","director_of_studies","deputy_director_of_studies","head_of_department","examinations_officer","class_teacher","teacher","bursar_accountant","hr_administrator","admissions_registrar","librarian"]);
export async function onRequestGet({request,env}) {
 if(!env.DB)return json({ok:false,error:"Database connection is unavailable."},503);
 const actor=await getAuthenticatedSession(request,env);
 if(!actor)return json({ok:false,error:"Sign in to continue."},401);
 const schoolId=decodeURIComponent(new URL(request.url).pathname.split("/").slice(-2,-1)[0]||"");
 if(!actor.is_super_admin&&actor.school_id!==schoolId)return json({ok:false,error:"You cannot view users in another school's workspace."},403);
 if(!actor.is_super_admin&&!actor.permissions.includes("school.users.manage"))return json({ok:false,error:"You do not have permission to manage school users."},403);
 const rows=await env.DB.prepare(`SELECT u.id,u.full_name,u.username,u.email,u.phone,u.status,m.job_title,m.membership_status,r.role_key,r.role_name
  FROM school_memberships m JOIN users u ON u.id=m.user_id
  LEFT JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=m.school_id
  LEFT JOIN roles r ON r.id=a.role_id
  WHERE m.school_id=? ORDER BY u.full_name`).bind(schoolId).all();
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
 const fullName=clean(body.fullName),username=norm(body.username),email=norm(body.email),phone=clean(body.phone),roleKey=norm(body.roleKey),password=String(body.password||"");
 if(!fullName||fullName.length>120||!/^[a-z0-9._-]{3,32}$/.test(username)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>190||!allowedRoles.has(roleKey)||!passwordPolicy(password))
  return json({ok:false,error:"Enter a valid name, username, email, role and a password meeting the platform password rules."},400);
 try {
  const school=await env.DB.prepare("SELECT id,status FROM schools WHERE id=?").bind(schoolId).first();
  if(!school||school.status!=="active")return json({ok:false,error:"The school workspace is not active."},409);
  const role=await env.DB.prepare("SELECT id,role_name FROM roles WHERE role_key=? AND school_id IS NULL").bind(roleKey).first();
  if(!role)return json({ok:false,error:"The selected role is not installed. Run the latest access-control upgrade."},503);
  const learnerNumbers=Array.isArray(body.learnerAdmissionNumbers)?body.learnerAdmissionNumbers.map(clean).filter(Boolean):String(body.learnerAdmissionNumbers||"").split(",").map(clean).filter(Boolean);
  if(["parent","student"].includes(roleKey)&&!learnerNumbers.length)return json({ok:false,error:"Enter at least one linked learner admission number."},400);
  if(roleKey==="student"&&learnerNumbers.length!==1)return json({ok:false,error:"A learner account must be linked to exactly one learner."},400);
  const linkedLearners=[];
  for(const admission of learnerNumbers){const learner=await env.DB.prepare("SELECT id FROM learners WHERE school_id=? AND admission_number=?").bind(schoolId,admission).first();if(!learner)return json({ok:false,error:"Learner admission number "+admission+" was not found in this school."},404);linkedLearners.push(learner.id);}
  const userId=id(),membershipId=id(),assignmentId=id(),passwordHash=await hashPassword(password);
  const statements=[
   env.DB.prepare("INSERT INTO users(id,email,email_normalized,username,username_normalized,phone,full_name,password_hash,status,password_changed_at) VALUES(?,?,?,?,?,?,?,?,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(userId,email,email,username,username,phone||null,fullName,passwordHash),
   env.DB.prepare("INSERT INTO school_memberships(id,school_id,user_id,membership_status,job_title,joined_at) VALUES(?,?,?,'active',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(membershipId,schoolId,userId,role.role_name),
   env.DB.prepare("INSERT INTO user_role_assignments(id,user_id,role_id,school_id,scope_json,assigned_by) VALUES(?,?,?,?,?,?)").bind(assignmentId,userId,role.id,schoolId,JSON.stringify({scope:"school",level:"all"}),actor.id)
  ];
  if(staffRoles.has(roleKey))statements.push(env.DB.prepare("INSERT INTO staff_profiles(id,school_id,user_id,staff_number,department,employment_status) VALUES(?,?,?,? ,?,'active')").bind(id(),schoolId,userId,clean(body.staffNumber)||null,clean(body.department)||null));
  if(roleKey==="parent"){
   const guardianId=id();
   statements.push(env.DB.prepare("INSERT INTO guardians(id,school_id,user_id,full_name,phone,email,relationship) VALUES(?,?,?,?,?,?,?)").bind(guardianId,schoolId,userId,fullName,phone||null,email,clean(body.relationship)||"Parent/Guardian"));
   for(const learnerId of linkedLearners)statements.push(env.DB.prepare("INSERT INTO learner_guardians(learner_id,guardian_id,is_primary,receives_communications) VALUES(?,?,0,1)").bind(learnerId,guardianId));
  }
  if(roleKey==="student")statements.push(env.DB.prepare("INSERT INTO learner_user_links(id,school_id,learner_id,user_id,created_by) VALUES(?,?,?,?,?)").bind(id(),schoolId,linkedLearners[0],userId,actor.id));
  statements.push(env.DB.prepare("INSERT INTO audit_logs(id,actor_user_id,school_id,action,resource_type,resource_id,outcome,details_json) VALUES(?,?,?,'school.user.created','user',?,'success',?)").bind(id(),actor.id,schoolId,userId,JSON.stringify({username,role:roleKey,linkedLearners:linkedLearners.length})));
  await env.DB.batch(statements);
  return json({ok:true,message:"School account created successfully.",user:{id:userId,fullName,username,email,role:role.role_name,roleKey,schoolId}},201);
 }catch(error){
  const message=String(error?.message||"");console.error("School user creation failed:",message);
  return json({ok:false,error:/UNIQUE constraint/i.test(message)?"That username or email is already registered.":"The school account could not be created. Check the account details and try again."},/UNIQUE constraint/i.test(message)?409:500);
 }
}
