import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const clean=v=>String(v??"").trim();
const id=()=>crypto.randomUUID();
async function ensure(db){await db.prepare(`CREATE TABLE IF NOT EXISTS school_name_change_requests(id TEXT PRIMARY KEY,school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,requested_by TEXT NOT NULL REFERENCES users(id),current_name TEXT NOT NULL,requested_name TEXT NOT NULL,reason TEXT,status TEXT NOT NULL DEFAULT 'pending',reviewed_by TEXT REFERENCES users(id),review_note TEXT,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),reviewed_at TEXT)`).run()}
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:"Database connection is unavailable."},503);
 const actor=await getAuthenticatedSession(request,env);if(!actor)return json({ok:false,error:"Sign in to continue."},401);
 await ensure(env.DB);
 if(actor.is_super_admin){const rows=await env.DB.prepare("SELECT q.*,s.school_code,u.full_name AS requester_name FROM school_name_change_requests q JOIN schools s ON s.id=q.school_id JOIN users u ON u.id=q.requested_by ORDER BY q.created_at DESC LIMIT 300").all();return json({ok:true,requests:rows.results||[]})}
 if(actor.role_key!=="school_admin"||!actor.school_id)return json({ok:false,error:"Only the School Administrator can request a school name change."},403);
 const rows=await env.DB.prepare("SELECT * FROM school_name_change_requests WHERE school_id=? ORDER BY created_at DESC LIMIT 30").bind(actor.school_id).all();return json({ok:true,requests:rows.results||[]});
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Database connection is unavailable."},503);
 const actor=await getAuthenticatedSession(request,env);if(!actor)return json({ok:false,error:"Sign in to continue."},401);
 if(actor.is_super_admin||actor.role_key!=="school_admin"||!actor.school_id)return json({ok:false,error:"Only the assigned School Administrator can submit this request."},403);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Enter the proposed school name."},400)}
 const requestedName=clean(body.requestedName),reason=clean(body.reason);
 if(requestedName.length<3||requestedName.length>180)return json({ok:false,error:"The proposed school name must be between 3 and 180 characters."},400);
 await ensure(env.DB);
 const school=await env.DB.prepare("SELECT name FROM schools WHERE id=?").bind(actor.school_id).first();if(!school)return json({ok:false,error:"School not found."},404);
 if(school.name.toLowerCase()===requestedName.toLowerCase())return json({ok:false,error:"The proposed name is the same as the current school name."},400);
 const pending=await env.DB.prepare("SELECT id FROM school_name_change_requests WHERE school_id=? AND status='pending' LIMIT 1").bind(actor.school_id).first();
 if(pending)return json({ok:false,error:"A school name change request is already awaiting Super Admin review."},409);
 const requestId=id();
 await env.DB.prepare("INSERT INTO school_name_change_requests(id,school_id,requested_by,current_name,requested_name,reason) VALUES(?,?,?,?,?,?)").bind(requestId,actor.school_id,actor.id,school.name,requestedName,reason||null).run();
 return json({ok:true,message:"Your school name change request has been submitted for Super Admin review.",request:{id:requestId,currentName:school.name,requestedName,status:"pending"}},201);
}
export async function onRequestPatch({request,env}){
 if(!env.DB)return json({ok:false,error:"Database connection is unavailable."},503);
 const actor=await getAuthenticatedSession(request,env);if(!actor?.is_super_admin)return json({ok:false,error:"Only Super Admin can review school name requests."},403);
 const requestId=decodeURIComponent(new URL(request.url).pathname.split("/").pop()||"");
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Choose approve or decline."},400)}
 const decision=clean(body.decision),note=clean(body.note);if(!["approve","decline"].includes(decision))return json({ok:false,error:"Decision must be approve or decline."},400);
 await ensure(env.DB);
 const row=await env.DB.prepare("SELECT * FROM school_name_change_requests WHERE id=? AND status='pending'").bind(requestId).first();if(!row)return json({ok:false,error:"Pending school name request not found."},404);
 if(decision==="approve"){
  await env.DB.batch([
   env.DB.prepare("UPDATE schools SET name=? WHERE id=?").bind(row.requested_name,row.school_id),
   env.DB.prepare("UPDATE school_name_change_requests SET status='approved',reviewed_by=?,review_note=?,reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending'").bind(actor.id,note||null,requestId)
  ]);
 }else await env.DB.prepare("UPDATE school_name_change_requests SET status='declined',reviewed_by=?,review_note=?,reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending'").bind(actor.id,note||null,requestId).run();
 return json({ok:true,message:decision==="approve"?"School name updated and approved.":"School name request declined."});
}
