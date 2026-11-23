import { getSuperAdminSession } from "./auth.js";
export async function onRequestPost({request,env}){
 const user=await getSuperAdminSession(request,env);if(!user)return Response.json({ok:false,error:"Super Admin sign-in required."},{status:403});
 const sql=[
 "CREATE TABLE IF NOT EXISTS support_tickets(id TEXT PRIMARY KEY,school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,opened_by TEXT NOT NULL REFERENCES users(id),subject TEXT NOT NULL,category TEXT NOT NULL DEFAULT 'general',priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
 "CREATE INDEX IF NOT EXISTS ix_support_tickets_school ON support_tickets(school_id,status,updated_at)",
 "CREATE TABLE IF NOT EXISTS support_ticket_messages(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,is_internal INTEGER NOT NULL DEFAULT 0 CHECK(is_internal IN (0,1)),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
 "CREATE INDEX IF NOT EXISTS ix_support_messages_ticket ON support_ticket_messages(ticket_id,created_at)",
 "INSERT OR IGNORE INTO schema_migrations(version,description) VALUES('0004_support_desk','School to Super Admin support tickets and threaded replies')"
 ];
 for(let i=0;i<sql.length;i++)try{await env.DB.prepare(sql[i]).run()}catch(e){return Response.json({ok:false,failedStatement:i+1,error:String(e?.message||e).slice(0,200)},{status:500})}
 return Response.json({ok:true,executed:sql.length,message:"Navstar support desk is ready."},{headers:{"Cache-Control":"no-store"}});
}