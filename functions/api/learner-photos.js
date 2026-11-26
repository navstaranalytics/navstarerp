import { getAuthenticatedSession } from "./auth.js";

const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const clean=v=>String(v??"").trim();
const normal=v=>clean(v).toLowerCase().replace(/[^a-z0-9]/g,"");
const photoTable=`CREATE TABLE IF NOT EXISTS learner_photos (
 learner_id TEXT PRIMARY KEY REFERENCES learners(id) ON DELETE CASCADE,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 content_type TEXT NOT NULL,
 image_data BLOB,
 storage_provider TEXT NOT NULL DEFAULT 'd1',
 object_key TEXT,
 original_filename TEXT,
 uploaded_by TEXT,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`;
const settingsTable=`CREATE TABLE IF NOT EXISTS school_admission_settings (
 school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
 prefix TEXT NOT NULL DEFAULT '',
 separator TEXT NOT NULL DEFAULT '-',
 next_number INTEGER NOT NULL DEFAULT 1,
 padding INTEGER NOT NULL DEFAULT 4,
 include_year INTEGER NOT NULL DEFAULT 0,
 updated_by TEXT,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`;
async function ensure(db){await db.prepare(photoTable).run();await db.prepare(settingsTable).run()}
async function actorFor(request,env,write=false){
 if(!env.DB)return {error:json({ok:false,error:"Database unavailable."},503)};
 const actor=await getAuthenticatedSession(request,env);
 if(!actor)return {error:json({ok:false,error:"Sign in to continue."},401)};
 if(!actor.is_super_admin&&!actor.permissions?.includes(write?"learners.manage":"learners.view"))return {error:json({ok:false,error:"Your role does not have permission for learner passport photos or admission settings."},403)};
 const requested=new URL(request.url).searchParams.get("schoolId")||"";
 const schoolId=actor.is_super_admin?requested:actor.school_id;
 if(!schoolId)return {error:json({ok:false,error:"School workspace is required."},400)};
 if(!actor.is_super_admin&&requested&&requested!==actor.school_id)return {error:json({ok:false,error:"You cannot access another school's learners."},403)};
 return {actor,schoolId};
}
function admissionLabel(s,sequence){
 const number=String(sequence).padStart(Math.max(1,Math.min(10,Number(s.padding)||4)),"0");
 const year=Number(s.include_year)?String(new Date().getFullYear()):"";
 const separator=s.separator===undefined?"-":String(s.separator);return [clean(s.prefix),year,number].filter(Boolean).join(separator);
}
export async function onRequestGetSettings({request,env}){
 const a=await actorFor(request,env,false);if(a.error)return a.error;
 try{
  await ensure(env.DB);
  const s=await env.DB.prepare("SELECT prefix,separator,next_number,padding,include_year FROM school_admission_settings WHERE school_id=?").bind(a.schoolId).first()||{prefix:"",separator:"-",next_number:1,padding:4,include_year:0};
  return json({ok:true,settings:s,preview:admissionLabel(s,Number(s.next_number)||1)});
 }catch(e){console.error("Admission settings read",e);return json({ok:false,error:"Could not load admission number settings."},500)}
}
export async function onRequestPostSettings({request,env}){
 const a=await actorFor(request,env,true);if(a.error)return a.error;
 let b;try{b=await request.json()}catch{return json({ok:false,error:"Invalid admission settings."},400)}
 const prefix=clean(b.prefix).replace(/[^a-zA-Z0-9_-]/g,"").slice(0,16),separator=["-","/","_",""].includes(b.separator)?b.separator:"-",next=Math.max(1,Math.floor(Number(b.next_number)||1)),padding=Math.max(1,Math.min(10,Math.floor(Number(b.padding)||4))),includeYear=b.include_year?1:0;
 try{
  await ensure(env.DB);
  await env.DB.prepare("INSERT INTO school_admission_settings(school_id,prefix,separator,next_number,padding,include_year,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(school_id) DO UPDATE SET prefix=excluded.prefix,separator=excluded.separator,next_number=excluded.next_number,padding=excluded.padding,include_year=excluded.include_year,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(a.schoolId,prefix,separator,next,padding,includeYear,a.actor.id).run();
  return json({ok:true,message:"Admission number format saved.",preview:admissionLabel({prefix,separator,padding,include_year:includeYear},next)});
 }catch(e){console.error("Admission settings save",e);return json({ok:false,error:"Could not save admission number settings."},500)}
}
export async function onRequestPostNextAdmissionNumber({request,env}){
 const a=await actorFor(request,env,true);if(a.error)return a.error;
 try{
  await ensure(env.DB);
  await env.DB.prepare("INSERT OR IGNORE INTO school_admission_settings(school_id,prefix,separator,next_number,padding,include_year,updated_by) VALUES(?,'','-',1,4,0,?)").bind(a.schoolId,a.actor.id).run();
  for(let attempt=0;attempt<20;attempt++){
   const allocated=await env.DB.prepare("UPDATE school_admission_settings SET next_number=next_number+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE school_id=? RETURNING prefix,separator,next_number-1 AS issued,padding,include_year").bind(a.actor.id,a.schoolId).first();
   if(!allocated)break;
   const number=admissionLabel(allocated,Number(allocated.issued)||1);
   const exists=await env.DB.prepare("SELECT 1 FROM learners WHERE school_id=? AND admission_number=?").bind(a.schoolId,number).first();
   if(!exists)return json({ok:true,admission_number:number});
  }
  return json({ok:false,error:"Could not generate a unique admission number. Check your format settings."},409);
 }catch(e){console.error("Admission number generation",e);return json({ok:false,error:"Could not generate an admission number."},500)}
}
export async function onRequestPostPhotos({request,env}){
 const a=await actorFor(request,env,true);if(a.error)return a.error;
 let form;try{form=await request.formData()}catch{return json({ok:false,error:"Select passport photos to upload."},400)}
 const files=form.getAll("photos").filter(x=>x&&typeof x.arrayBuffer==="function"&&x.size>0);
 if(!files.length)return json({ok:false,error:"Select one or more image files."},400);
 if(files.length>200)return json({ok:false,error:"Upload a maximum of 200 passport photos per batch."},400);
 const total=files.reduce((n,f)=>n+f.size,0);if(total>24*1024*1024)return json({ok:false,error:"This batch exceeds 24 MB. Split the folder into smaller batches."},413);
 try{
  await ensure(env.DB);
  const outcomes=[],seen=new Set();
  for(const file of files){
   if(!["image/jpeg","image/png","image/webp"].includes(file.type)){outcomes.push({file:file.name,status:"skipped",reason:"Use JPG, PNG or WebP."});continue}
   const max=env.R2?4*1024*1024:1200*1024;
   if(file.size>max){outcomes.push({file:file.name,status:"skipped",reason:env.R2?"Maximum 4 MB per photo.":"D1 fallback allows 1.2 MB per photo; enable R2 for larger photo files."});continue}
   const stem=file.name.replace(/\.[^.]+$/,""),key=normal(stem);
   if(!key){outcomes.push({file:file.name,status:"skipped",reason:"Filename must contain the learner admission number or camera code."});continue}
   const matches=await env.DB.prepare("SELECT id,admission_number,profile_json FROM learners WHERE school_id=? AND (lower(replace(replace(replace(admission_number,'-',''),'/',''),'_',''))=? OR lower(replace(replace(replace(json_extract(profile_json,'$.photoCode'),'-',''),'/',''),'_',''))=?)").bind(a.schoolId,key,key).all();
   if((matches.results||[]).length!==1){outcomes.push({file:file.name,status:"unmatched",reason:matches.results?.length?"Filename matches more than one learner.":"No learner has this admission number or camera photo code."});continue}
   const learner=matches.results[0];if(seen.has(learner.id)){outcomes.push({file:file.name,status:"skipped",reason:"More than one file targets the same learner in this batch."});continue}seen.add(learner.id);
   const bytes=new Uint8Array(await file.arrayBuffer());const valid=(file.type==="image/jpeg"&&bytes[0]===0xff&&bytes[1]===0xd8)||(file.type==="image/png"&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)||(file.type==="image/webp"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP");if(!valid){outcomes.push({file:file.name,status:"skipped",reason:"The file content does not match its image type."});continue}const prior=await env.DB.prepare("SELECT storage_provider,object_key FROM learner_photos WHERE learner_id=? AND school_id=?").bind(learner.id,a.schoolId).first();
   const objectKey="schools/"+a.schoolId+"/learners/"+learner.id+"/passport/"+crypto.randomUUID();
   if(env.R2){
    await env.R2.put(objectKey,bytes,{httpMetadata:{contentType:file.type,cacheControl:"private, no-store"}});
    const stored=await env.R2.get(objectKey);
    if(!stored) {try{await env.R2.delete(objectKey)}catch{};throw new Error("R2 passport photo could not be read back after upload.");}
    const storedBytes=new Uint8Array(await stored.arrayBuffer());
    if(storedBytes.length!==bytes.length||storedBytes.some((value,index)=>value!==bytes[index])){
     try{await env.R2.delete(objectKey)}catch{}
     throw new Error("R2 passport photo verification failed; the learner photo record was not updated.");
    }
    try{
     await env.DB.prepare("INSERT INTO learner_photos(learner_id,school_id,content_type,image_data,storage_provider,object_key,original_filename,uploaded_by,updated_at) VALUES(?,?,?,NULL,'r2',?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(learner_id) DO UPDATE SET content_type=excluded.content_type,image_data=NULL,storage_provider='r2',object_key=excluded.object_key,original_filename=excluded.original_filename,uploaded_by=excluded.uploaded_by,updated_at=excluded.updated_at").bind(learner.id,a.schoolId,file.type,objectKey,file.name,a.actor.id).run();
    }catch(error){try{await env.R2.delete(objectKey)}catch{};throw error}
    if(prior?.storage_provider==="r2"&&prior.object_key&&prior.object_key!==objectKey){try{await env.R2.delete(prior.object_key)}catch(error){console.error("Old learner passport cleanup failed",String(error?.message||error))}}
   }else{
    await env.DB.prepare("INSERT INTO learner_photos(learner_id,school_id,content_type,image_data,storage_provider,object_key,original_filename,uploaded_by,updated_at) VALUES(?,?,?,?,'d1',NULL,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(learner_id) DO UPDATE SET content_type=excluded.content_type,image_data=excluded.image_data,storage_provider='d1',object_key=NULL,original_filename=excluded.original_filename,uploaded_by=excluded.uploaded_by,updated_at=excluded.updated_at").bind(learner.id,a.schoolId,file.type,bytes,file.name,a.actor.id).run();
   }
   outcomes.push({file:file.name,status:"matched",admission_number:learner.admission_number,learner_id:learner.id});
  }
  const matched=outcomes.filter(x=>x.status==="matched").length;
  return json({ok:true,matched,skipped:outcomes.length-matched,results:outcomes,message:matched+" passport photo(s) matched and saved to the school database."});
 }catch(e){console.error("Bulk learner passport upload",e);return json({ok:false,error:"Passport photo upload failed. Please retry the batch."},500)}
}
export async function onRequestGetPhoto({request,env}){
 const a=await actorFor(request,env,false);if(a.error)return new Response("Access denied.",{status:a.error.status||403});
 const learnerId=decodeURIComponent(new URL(request.url).pathname.split("/").pop()||"");
 try{
  await ensure(env.DB);
  const row=await env.DB.prepare("SELECT content_type,image_data,storage_provider,object_key FROM learner_photos WHERE learner_id=? AND school_id=?").bind(learnerId,a.schoolId).first();
  if(!row)return new Response("Passport photo not found.",{status:404,headers:{"Cache-Control":"no-store"}});
  if(row.storage_provider==="r2"){
   if(!env.R2||!row.object_key)return new Response("Photo storage unavailable.",{status:503});
   const object=await env.R2.get(row.object_key);if(!object)return new Response("Passport photo not found.",{status:404});
   return new Response(object.body,{headers:{"Content-Type":row.content_type,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
  }
  const bytes=row.image_data instanceof Uint8Array?row.image_data:new Uint8Array(row.image_data||[]);
  return new Response(bytes,{headers:{"Content-Type":row.content_type,"Content-Length":String(bytes.byteLength),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
 }catch(e){console.error("Learner passport retrieval",e);return new Response("Could not load passport photo.",{status:500})}
}

export async function onRequestDeletePhoto({request,env}){
 const a=await actorFor(request,env,true);if(a.error)return a.error;
 const learnerId=decodeURIComponent(new URL(request.url).pathname.split("/").pop()||"");
 if(!learnerId)return json({ok:false,error:"Learner reference is required."},400);
 try{
  await ensure(env.DB);
  const row=await env.DB.prepare("SELECT storage_provider,object_key FROM learner_photos WHERE learner_id=? AND school_id=?").bind(learnerId,a.schoolId).first();
  if(!row)return json({ok:false,error:"This learner does not have a passport photo to remove."},404);
  await env.DB.prepare("DELETE FROM learner_photos WHERE learner_id=? AND school_id=?").bind(learnerId,a.schoolId).run();
  let cleanupPending=false;
  if(row.storage_provider==="r2"&&row.object_key&&env.R2){
   try{await env.R2.delete(row.object_key)}catch(error){cleanupPending=true;console.error("Learner passport R2 cleanup failed",String(error?.message||error))}
  }
  return json({ok:true,message:"Learner passport photo removed.",cleanupPending});
 }catch(error){console.error("Learner passport photo removal failed",String(error?.message||error));return json({ok:false,error:"Could not remove this learner's passport photo."},500)}
}
