import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const clean=v=>String(v??"").trim();
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Database connection is unavailable."},503);
 const actor=await getAuthenticatedSession(request,env);
 if(!actor?.is_super_admin)return json({ok:false,error:"Only Super Admin can write platform audit events."},403);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid audit event."},400)}
 const action=clean(body.action),detail=clean(body.detail);
 if(!action||action.length>120||detail.length>1500)return json({ok:false,error:"Audit action and details are invalid."},400);
 try{
  await env.DB.prepare("INSERT INTO audit_logs(id,actor_user_id,school_id,action,resource_type,outcome,details_json) VALUES(?,?,NULL,?,'platform','success',?)")
   .bind(crypto.randomUUID(),actor.id,action,JSON.stringify({detail})).run();
  return json({ok:true});
 }catch(error){console.error("Navstar platform audit write failed:",String(error?.message||error));return json({ok:false,error:"Audit event could not be saved."},500)}
}
