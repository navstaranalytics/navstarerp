import {getAuthenticatedSession} from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const MAX_BYTES=25*1024*1024;
const ALLOWED_TYPES=new Set([
 "application/pdf","image/jpeg","image/png","image/webp",
 "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
 "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
 "application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation",
 "text/csv","text/plain"
]);
const safeName=value=>String(value||"document").replace(/[\\/\\r\\n\\0]/g,"_").replace(/[^\\p{L}\\p{N}._() -]/gu,"_").slice(0,180)||"document";
async function context(request,env){
 const user=await getAuthenticatedSession(request,env);
 if(!user)return {response:json({ok:false,error:"An active sign-in is required."},401)};
 const roles=Array.isArray(user.role_keys)?user.role_keys:[];
 const permissions=Array.isArray(user.permissions)?user.permissions:[];
 const canManage=!!user.is_super_admin||roles.includes("school_admin")||permissions.includes("school.settings.manage")||permissions.includes("documents.manage");
 if(!canManage)return {response:json({ok:false,error:"Your role does not have permission to manage school documents."},403)};
 const url=new URL(request.url),requested=url.searchParams.get("schoolId")||"";
 const schoolId=user.is_super_admin?requested:user.school_id;
 if(!schoolId)return {response:json({ok:false,error:"School context is required."},400)};
 if(!user.is_super_admin&&requested&&requested!==user.school_id)return {response:json({ok:false,error:"You cannot access documents from another school."},403)};
 if(!env.DB||!env.R2)return {response:json({ok:false,error:"D1 or R2 storage is unavailable."},503)};
 return {user,schoolId};
}
export async function onRequestGet({request,env}){
 const c=await context(request,env);if(c.response)return c.response;
 const parts=new URL(request.url).pathname.split("/").filter(Boolean),documentId=parts.length>2?decodeURIComponent(parts[2]):"";
 try{
  if(!documentId){
   const rows=await env.DB.prepare("SELECT id,title,category,original_filename,content_type,size_bytes,uploaded_by,status,created_at FROM school_documents WHERE school_id=? ORDER BY created_at DESC LIMIT 500").bind(c.schoolId).all();
   return json({ok:true,records:rows.results||[]});
  }
  const row=await env.DB.prepare("SELECT id,school_id,original_filename,content_type,r2_key,status FROM school_documents WHERE id=? AND school_id=?").bind(documentId,c.schoolId).first();
  if(!row||row.status!=="active")return json({ok:false,error:"Document was not found in this school."},404);
  const object=await env.R2.get(row.r2_key);if(!object)return json({ok:false,error:"The document file is temporarily unavailable in R2."},404);
  const filename=safeName(row.original_filename),headers=new Headers();
  headers.set("Content-Type",row.content_type||"application/octet-stream");
  headers.set("Content-Disposition","attachment; filename*=UTF-8''"+encodeURIComponent(filename));
  headers.set("Cache-Control","private, no-store");
  headers.set("X-Content-Type-Options","nosniff");
  if(object.size)headers.set("Content-Length",String(object.size));
  return new Response(object.body,{headers});
 }catch(error){console.error("NAVSTAR school document read",error);return json({ok:false,error:"School documents could not be loaded."},500)}
}
export async function onRequestPost({request,env}){
 const c=await context(request,env);if(c.response)return c.response;
 let form;try{form=await request.formData()}catch{return json({ok:false,error:"Upload form is invalid."},400)}
 const file=form.get("file"),title=String(form.get("title")||"").trim(),category=String(form.get("category")||"General").trim().slice(0,80)||"General";
 if(!(file instanceof File)||!file.size)return json({ok:false,error:"Choose a file to upload."},400);
 if(file.size>MAX_BYTES)return json({ok:false,error:"Each document must be 25 MB or smaller."},413);
 if(!ALLOWED_TYPES.has(file.type))return json({ok:false,error:"Unsupported file type. Upload PDF, image, Word, Excel, PowerPoint, CSV or text files."},415);
 const original=safeName(file.name),displayTitle=(title||original).slice(0,160);
 const id=crypto.randomUUID(),key="schools/"+c.schoolId+"/documents/"+id+"/"+original;
 try{
  const bytes=new Uint8Array(await file.arrayBuffer());
  await env.R2.put(key,bytes,{httpMetadata:{contentType:file.type,contentDisposition:"attachment; filename*=UTF-8''"+encodeURIComponent(original)}});
  const stored=await env.R2.get(key);
  if(!stored||Number(stored.size)!==bytes.byteLength){
   try{await env.R2.delete(key)}catch{}
   return json({ok:false,error:"R2 upload verification failed. The document was not registered."},502);
  }
  await env.DB.prepare("INSERT INTO school_documents(id,school_id,title,category,original_filename,content_type,size_bytes,r2_key,uploaded_by,status) VALUES(?,?,?,?,?,?,?,?,?,'active')").bind(id,c.schoolId,displayTitle,category,original,file.type,bytes.byteLength,key,c.user.id).run();
  const record=await env.DB.prepare("SELECT id,title,category,original_filename,content_type,size_bytes,status,created_at FROM school_documents WHERE id=? AND school_id=?").bind(id,c.schoolId).first();
  if(!record)throw new Error("D1 read-back did not confirm the document metadata.");
  return json({ok:true,record,message:"Document uploaded, verified in R2 and registered in D1."},201);
 }catch(error){
  try{await env.R2.delete(key)}catch(cleanupError){console.error("NAVSTAR document R2 cleanup pending",cleanupError)}
  console.error("NAVSTAR school document upload",error);
  return json({ok:false,error:"The document could not be safely uploaded and registered. Please retry."},500);
 }
}
export async function onRequestDelete({request,env}){
 const c=await context(request,env);if(c.response)return c.response;
 const parts=new URL(request.url).pathname.split("/").filter(Boolean),documentId=parts.length>2?decodeURIComponent(parts[2]):"";
 if(!documentId)return json({ok:false,error:"Document ID is required."},400);
 try{
  const row=await env.DB.prepare("SELECT id,r2_key,status FROM school_documents WHERE id=? AND school_id=?").bind(documentId,c.schoolId).first();
  if(!row)return json({ok:false,error:"Document was not found in this school."},404);
  await env.DB.prepare("UPDATE school_documents SET status='deleting' WHERE id=? AND school_id=?").bind(documentId,c.schoolId).run();
  try{await env.R2.delete(row.r2_key)}catch(error){
   await env.DB.prepare("UPDATE school_documents SET status='active' WHERE id=? AND school_id=?").bind(documentId,c.schoolId).run();
   console.error("NAVSTAR school document R2 delete",error);
   return json({ok:false,error:"R2 could not confirm document deletion. The document remains listed; try again."},502);
  }
  await env.DB.prepare("DELETE FROM school_documents WHERE id=? AND school_id=?").bind(documentId,c.schoolId).run();
  return json({ok:true,message:"Document deleted from R2 and D1."});
 }catch(error){console.error("NAVSTAR school document delete",error);return json({ok:false,error:"The document could not be fully deleted. Retry the operation."},500)}
}
