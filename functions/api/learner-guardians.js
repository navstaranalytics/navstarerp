import {getAuthenticatedSession} from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function onRequestPost({request,env}){
 const user=await getAuthenticatedSession(request,env);
 if(!user?.school_id)return json({ok:false,error:"School sign-in is required."},401);
 if(!user.permissions?.includes("*")&&!user.permissions?.includes("learners.manage"))return json({ok:false,error:"You do not have permission to manage learner guardians."},403);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid guardian details."},400)}
 const learnerId=String(body.learner_id||"").trim(),fullName=String(body.full_name||"").trim();
 if(!learnerId||!fullName)return json({ok:false,error:"Learner and parent/guardian full name are required."},400);
 const learner=await env.DB.prepare("SELECT id FROM learners WHERE id=? AND school_id=?").bind(learnerId,user.school_id).first();
 if(!learner)return json({ok:false,error:"Learner was not found in this school."},404);
 const id=crypto.randomUUID(),title=String(body.title||"").trim()||null;
 try{
  await env.DB.batch([
   env.DB.prepare("INSERT INTO guardians(id,school_id,title,full_name,phone,email,relationship,national_id,occupation,postal_address,is_primary) VALUES(?,?,?,?,?,?,?,?,?,?,1)").bind(id,user.school_id,title,fullName,String(body.phone||"").trim()||null,String(body.email||"").trim()||null,String(body.relationship||"").trim()||null,String(body.national_id||"").trim()||null,String(body.occupation||"").trim()||null,String(body.postal_address||"").trim()||null),
   env.DB.prepare("INSERT INTO learner_guardians(learner_id,guardian_id,is_primary,receives_communications) VALUES(?,?,1,1)").bind(learnerId,id)
  ]);
  return json({ok:true,guardian_id:id},201);
 }catch(error){console.error("Navstar learner guardian save",error);return json({ok:false,error:"Could not save the parent/guardian record."},500)}
}
