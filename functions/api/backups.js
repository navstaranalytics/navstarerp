import {getSuperAdminSession} from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function onRequestGet({request,env}){
 const actor=await getSuperAdminSession(request,env);
 if(!actor)return json({ok:false,error:"Super Admin access required."},401);
 if(!env.DB||!env.R2)return json({ok:false,error:"D1 or R2 backup storage is unavailable."},503);
 const parts=new URL(request.url).pathname.split("/").filter(Boolean),id=parts.length>2?decodeURIComponent(parts[2]):"";
 try{
  if(!id){
   const rows=await env.DB.prepare("SELECT id,backup_type,object_key,byte_count,sha256,status,source,created_at FROM platform_backups ORDER BY created_at DESC LIMIT 100").all();
   return json({ok:true,records:rows.results||[]});
  }
  const row=await env.DB.prepare("SELECT id,object_key,byte_count,sha256,status FROM platform_backups WHERE id=?").bind(id).first();
  if(!row||row.status!=="verified")return json({ok:false,error:"Verified backup was not found."},404);
  const object=await env.R2.get(row.object_key);
  if(!object)return json({ok:false,error:"The backup object is not available in R2."},404);
  if(Number(object.size)!==Number(row.byte_count))return json({ok:false,error:"Backup size verification failed. Do not use this backup for restore."},409);
  // Re-check the stored object against the registered digest at download time;
  // size alone cannot detect same-length object corruption or replacement.
  const backupBytes=await object.arrayBuffer();
  const digest=await crypto.subtle.digest("SHA-256",backupBytes);
  const actualSha256=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  if(actualSha256.toLowerCase()!==String(row.sha256||"").toLowerCase())return json({ok:false,error:"Backup SHA-256 verification failed. Do not use this backup for restore."},409);
  const headers=new Headers({"Content-Type":"application/sql","Content-Disposition":'attachment; filename="navstar-d1-backup-'+row.id+'.sql"',"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"});
  headers.set("Content-Length",String(object.size));
  return new Response(backupBytes,{headers});
 }catch(error){console.error("NAVSTAR backup read",error);return json({ok:false,error:"Verified backups could not be loaded."},500)}
}
