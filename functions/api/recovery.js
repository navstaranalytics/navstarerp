import { getSuperAdminSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const CREATE_TABLE=`CREATE TABLE IF NOT EXISTS platform_recovery_archives (
 id TEXT PRIMARY KEY, source TEXT NOT NULL, record_count INTEGER NOT NULL DEFAULT 0,
 byte_count INTEGER NOT NULL DEFAULT 0, archive_json TEXT NOT NULL, created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`;
async function authorize(request,env){
 if(!env.DB)return {error:json({ok:false,error:"Central D1 database is unavailable."},503)};
 const actor=await getSuperAdminSession(request,env);
 return actor?{actor}:{error:json({ok:false,error:"Super Admin access is required for recovery archives."},403)};
}
async function ensureTable(db){await db.prepare(CREATE_TABLE).run();}
export async function onRequestGet({request,env}){
 const access=await authorize(request,env);if(access.error)return access.error;
 try{
  await ensureTable(env.DB);
  const id=decodeURIComponent(new URL(request.url).pathname.split("/").pop()||"");
  if(id&&id!=="recovery"){
   const row=await env.DB.prepare("SELECT id,source,record_count,byte_count,archive_json,created_at FROM platform_recovery_archives WHERE id=?").bind(id).first();
   if(!row)return json({ok:false,error:"Recovery archive not found."},404);
   let archive;try{archive=JSON.parse(row.archive_json)}catch{return json({ok:false,error:"Recovery archive is unreadable."},500)}
   return json({ok:true,archive:{id:row.id,source:row.source,recordCount:row.record_count,byteCount:row.byte_count,createdAt:row.created_at,data:archive}});
  }
  const rows=await env.DB.prepare("SELECT id,source,record_count,byte_count,created_at FROM platform_recovery_archives ORDER BY created_at DESC LIMIT 50").all();
  return json({ok:true,archives:rows.results||[]});
 }catch(error){console.error("Navstar recovery list failed",String(error?.message||error));return json({ok:false,error:"Could not read recovery archives from D1."},500)}
}
export async function onRequestPost({request,env}){
 const access=await authorize(request,env);if(access.error)return access.error;
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Recovery archive must be valid JSON."},400)}
 const source=String(body.source||"browser-local-storage").slice(0,80),records=body.records;
 if(!Array.isArray(records)||!records.length)return json({ok:false,error:"No recoverable browser records were supplied."},400);
 if(records.length>500)return json({ok:false,error:"This recovery batch is too large. Export it as a file and split it into smaller batches."},413);
 const archive={format:"navstar-recovery-v1",capturedAt:new Date().toISOString(),source,records};
 const serialized=JSON.stringify(archive),bytes=new TextEncoder().encode(serialized).byteLength;
 if(bytes>3500000)return json({ok:false,error:"This recovery archive exceeds 3.5 MB. Download the browser backup first and archive smaller batches."},413);
 const archiveId=crypto.randomUUID();
 try{
  await ensureTable(env.DB);
  await env.DB.prepare("INSERT INTO platform_recovery_archives(id,source,record_count,byte_count,archive_json,created_by) VALUES(?,?,?,?,?,?)").bind(archiveId,source,records.length,bytes,serialized,access.actor.id).run();
  return json({ok:true,archive:{id:archiveId,source,recordCount:records.length,byteCount:bytes},message:"Recovery snapshot saved centrally in Cloudflare D1. Original browser records were not changed."},201);
 }catch(error){console.error("Navstar recovery archive save failed",String(error?.message||error));return json({ok:false,error:"The recovery snapshot could not be saved to D1."},500)}
}
