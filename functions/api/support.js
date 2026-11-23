import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const uid=()=>crypto.randomUUID();
export async function onRequestGet({request,env}){
 const user=await getAuthenticatedSession(request,env);if(!user)return json({ok:false,error:"Sign in to view support requests."},401);
 try{
  const rows=user.is_super_admin
   ?await env.DB.prepare("SELECT t.*,s.name AS school_name,u.full_name AS opened_by_name FROM support_tickets t LEFT JOIN schools s ON s.id=t.school_id JOIN users u ON u.id=t.opened_by ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,t.updated_at DESC LIMIT 250").all()
   :await env.DB.prepare("SELECT t.*,s.name AS school_name,u.full_name AS opened_by_name FROM support_tickets t LEFT JOIN schools s ON s.id=t.school_id JOIN users u ON u.id=t.opened_by WHERE t.school_id=? ORDER BY t.updated_at DESC LIMIT 100").bind(user.school_id).all();
  const tickets=rows.results||[];
  const marks=tickets.map(()=>"?").join(",");
  const messages=tickets.length?await env.DB.prepare("SELECT m.*,u.full_name AS author_name FROM support_ticket_messages m JOIN users u ON u.id=m.user_id WHERE m.ticket_id IN ("+marks+") ORDER BY m.created_at ASC").bind(...tickets.map(t=>t.id)).all():{results:[]};
  return json({ok:true,tickets,messages:messages.results||[],isSuperAdmin:!!user.is_super_admin});
 }catch(e){return json({ok:false,error:"Support service is not installed yet. Ask Super Admin to complete the support upgrade."},503)}
}
export async function onRequestPost({request,env}){
 const user=await getAuthenticatedSession(request,env);if(!user)return json({ok:false,error:"Sign in before submitting a support request."},401);
 let b;try{b=await request.json()}catch{return json({ok:false,error:"Invalid request."},400)}
 const action=String(b.action||"create"),ticketId=String(b.ticket_id||"");
 try{
  if(action==="create"){
   if(user.is_super_admin||!user.school_id)return json({ok:false,error:"Only a school workspace account can open a school support ticket."},403);
   const subject=String(b.subject||"").trim().slice(0,160),description=String(b.description||"").trim().slice(0,8000),category=String(b.category||"general").slice(0,40),priority=["low","normal","high","urgent"].includes(b.priority)?b.priority:"normal";
   if(subject.length<4||description.length<10)return json({ok:false,error:"Enter a clear subject and at least 10 characters describing the issue."},400);
   const id=uid();await env.DB.prepare("INSERT INTO support_tickets(id,school_id,opened_by,subject,category,priority,status) VALUES(?,?,?,?,?,?,'open')").bind(id,user.school_id,user.id,subject,category,priority).run();
   await env.DB.prepare("INSERT INTO support_ticket_messages(id,ticket_id,user_id,body,is_internal) VALUES(?,?,?,?,0)").bind(uid(),id,user.id,description).run();
   return json({ok:true,ticket_id:id,message:"Your support request has been sent to Navstar Super Admin."},201);
  }
  if(!ticketId)return json({ok:false,error:"Ticket reference is required."},400);
  const ticket=await env.DB.prepare("SELECT * FROM support_tickets WHERE id=?").bind(ticketId).first();if(!ticket)return json({ok:false,error:"Support ticket not found."},404);
  if(!user.is_super_admin&&ticket.school_id!==user.school_id)return json({ok:false,error:"You cannot access another school's ticket."},403);
  if(action==="reply"){
   const body=String(b.body||"").trim().slice(0,8000);if(body.length<2)return json({ok:false,error:"Write a reply before sending."},400);
   await env.DB.prepare("INSERT INTO support_ticket_messages(id,ticket_id,user_id,body,is_internal) VALUES(?,?,?,?,0)").bind(uid(),ticketId,user.id,body).run();
   await env.DB.prepare("UPDATE support_tickets SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(ticketId).run();return json({ok:true,message:"Reply sent."});
  }
  if(action==="status"&&user.is_super_admin){
   const status=["open","in_progress","resolved","closed"].includes(b.status)?b.status:null;if(!status)return json({ok:false,error:"Invalid ticket status."},400);
   await env.DB.prepare("UPDATE support_tickets SET status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(status,ticketId).run();return json({ok:true,message:"Ticket status updated."});
  }
  return json({ok:false,error:"Unsupported support action."},400);
 }catch(e){console.error("Navstar support operation failed",e);return json({ok:false,error:"Support request could not be saved. Check the support database upgrade."},503)}
}