import {getAuthenticatedSession} from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function onRequestGet({request,env}){
 const user=await getAuthenticatedSession(request,env);
 if(!user?.school_id)return json({ok:false,error:"School sign-in is required."},401);
 if(!user.permissions?.includes("*")&&!user.permissions?.includes("learners.view"))return json({ok:false,error:"You do not have permission to view learner guardians."},403);
 const learnerId=new URL(request.url).searchParams.get("learner_id")||"";
 const row=await env.DB.prepare("SELECT g.id,g.title,g.full_name,g.phone,g.email,g.relationship,g.national_id,g.occupation,g.postal_address FROM learner_guardians lg JOIN guardians g ON g.id=lg.guardian_id WHERE lg.learner_id=? AND g.school_id=? ORDER BY lg.is_primary DESC LIMIT 1").bind(learnerId,user.school_id).first();
 return json({ok:true,guardian:row||{}});
}
export async function onRequestPatch({request,env}){
 const user=await getAuthenticatedSession(request,env);
 if(!user?.school_id)return json({ok:false,error:"School sign-in is required."},401);
 if(!user.permissions?.includes("*")&&!user.permissions?.includes("learners.manage"))return json({ok:false,error:"You do not have permission to manage learner guardians."},403);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid guardian details."},400)}
 const learnerId=String(body.learner_id||"").trim(),fullName=String(body.full_name||"").trim();
 if(!learnerId)return json({ok:false,error:"Learner is required."},400);
 const learner=await env.DB.prepare("SELECT id FROM learners WHERE id=? AND school_id=?").bind(learnerId,user.school_id).first();
 if(!learner)return json({ok:false,error:"Learner was not found in this school."},404);
 const existing=await env.DB.prepare("SELECT g.id FROM learner_guardians lg JOIN guardians g ON g.id=lg.guardian_id WHERE lg.learner_id=? AND g.school_id=? ORDER BY lg.is_primary DESC LIMIT 1").bind(learnerId,user.school_id).first();
 if(!existing){if(!fullName)return json({ok:true,message:"No parent/contact person details to update."});return onRequestPost({request:new Request(request.url,{method:"POST",headers:request.headers,body:JSON.stringify({...body,full_name:fullName})}),env});}
 if(!fullName)return json({ok:false,error:"Parent/contact person full name is required."},400);
 await env.DB.prepare("UPDATE guardians SET title=?,full_name=?,phone=?,email=?,relationship=?,national_id=?,occupation=?,postal_address=? WHERE id=? AND school_id=?").bind(String(body.title||"").trim()||null,fullName,String(body.phone||"").trim()||null,String(body.email||"").trim()||null,String(body.relationship||"").trim()||null,String(body.national_id||"").trim()||null,String(body.occupation||"").trim()||null,String(body.postal_address||"").trim()||null,existing.id,user.school_id).run();
 return json({ok:true,message:"Parent/contact person details updated."});
}
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
