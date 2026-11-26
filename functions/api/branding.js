import { getSuperAdminSession, getAuthenticatedSession } from "./auth.js";
const json=(d,s=200)=>Response.json(d,{status:s,headers:{"Cache-Control":"no-store"}});
const LOGO_KEY="platform-logo";
const R2_LOGO_KEY="platform/logo";
const MAX_LOGO_BYTES=1800*1024;
const CREATE_LOGO_TABLE=`CREATE TABLE IF NOT EXISTS platform_branding_assets (
 asset_key TEXT PRIMARY KEY,
 content_type TEXT NOT NULL,
 image_data BLOB NOT NULL DEFAULT X'',
 storage_provider TEXT NOT NULL DEFAULT 'd1',
 object_key TEXT,
 updated_by TEXT,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`;
async function ensureLogoTable(db){
 await db.prepare(CREATE_LOGO_TABLE).run();
 const info=await db.prepare("PRAGMA table_info(platform_branding_assets)").all();
 const cols=new Set((info.results||[]).map(x=>x.name));
 if(!cols.has("storage_provider"))await db.prepare("ALTER TABLE platform_branding_assets ADD COLUMN storage_provider TEXT NOT NULL DEFAULT 'd1'").run();
 if(!cols.has("object_key"))await db.prepare("ALTER TABLE platform_branding_assets ADD COLUMN object_key TEXT").run();
}
export async function onRequestGet({env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 try{
  await ensureLogoTable(env.DB);
  const rows=await env.DB.prepare("SELECT setting_key,setting_value FROM platform_settings WHERE setting_key IN ('platform_name','platform_tagline','platform_address','platform_city','platform_county','platform_phone','platform_website','platform_support_email','platform_registered_domain')").all();
  const settings=Object.fromEntries((rows.results||[]).map(x=>[x.setting_key,x.setting_value]));
  const logo=await env.DB.prepare("SELECT 1 AS present FROM platform_branding_assets WHERE asset_key=?").bind(LOGO_KEY).first();
  return json({ok:true,branding:{logoUrl:logo?"/api/branding/logo":"",name:settings.platform_name||"Navstar Analytics",tagline:settings.platform_tagline||"Education management platform",address:settings.platform_address||"",city:settings.platform_city||"",county:settings.platform_county||"",phone:settings.platform_phone||"",website:settings.platform_website||"",supportEmail:settings.platform_support_email||"",registeredDomain:settings.platform_registered_domain||""}});
 }catch{return json({ok:true,branding:{logoUrl:"",name:"Navstar Analytics",tagline:"Education management platform"}})}
}
export async function onRequestGetStorageStatus({request,env}){
 const actor=await getSuperAdminSession(request,env);
 if(!actor)return json({ok:false,error:"Super Admin access required."},401);
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 try{
  await ensureLogoTable(env.DB);
  await env.DB.prepare("SELECT 1 AS ok").first();
  const row=await env.DB.prepare("SELECT storage_provider FROM platform_branding_assets WHERE asset_key=?").bind(LOGO_KEY).first();
  let r2Check={configured:!!env.R2,writeReadDelete:"not tested"};
  if(env.R2){
   const key="health-checks/storage-"+crypto.randomUUID();
   const probe=new TextEncoder().encode("navstar-r2-health-check");
   try{
    await env.R2.put(key,probe,{httpMetadata:{contentType:"text/plain",cacheControl:"no-store"}});
    const object=await env.R2.get(key);
    if(!object)throw new Error("R2 object could not be read after upload.");
    const received=new Uint8Array(await object.arrayBuffer());
    if(received.length!==probe.length||received.some((value,index)=>value!==probe[index]))throw new Error("R2 read-back did not match the uploaded test object.");
    r2Check={configured:true,writeReadDelete:"passed"};
   }catch(error){
    r2Check={configured:true,writeReadDelete:"failed",error:String(error?.message||error).slice(0,240)};
   }finally{
    try{await env.R2.delete(key)}catch(error){r2Check.cleanup="failed"}
   }
  }
  return json({ok:true,storage:{database:"D1",databaseCheck:"passed",fileStorage:env.R2?"R2":"D1",r2Available:!!env.R2,r2Check,logoStoredIn:row?.storage_provider||"not uploaded",mode:env.R2?"D1 + R2 (automatic)":"D1 only",message:env.R2?(r2Check.writeReadDelete==="passed"?"D1 and R2 are connected; a temporary R2 upload, read-back and delete test passed.":"R2 is bound but its live write/read/delete test needs attention."):"R2 is not bound; file uploads are using the D1 fallback."}});
 }catch(error){console.error("Storage status check failed",String(error?.message||error));return json({ok:false,error:"Could not complete the storage health check."},500)}
}
export async function onRequestGetLogo({env}){
 if(!env.DB)return new Response("Database unavailable.",{status:503});
 try{
  await ensureLogoTable(env.DB);
  const row=await env.DB.prepare("SELECT content_type,image_data,storage_provider,object_key FROM platform_branding_assets WHERE asset_key=?").bind(LOGO_KEY).first();
  if(!row)return new Response("Logo not found.",{status:404});
  if(row.storage_provider==="r2"){
   if(!env.R2||!row.object_key)return new Response("Logo storage is not currently available.",{status:503});
   const object=await env.R2.get(row.object_key);
   if(!object)return new Response("Logo not found in file storage.",{status:404});
   return new Response(object.body,{headers:{"Content-Type":row.content_type,"Cache-Control":"public, max-age=60","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
  }
  const bytes=row.image_data instanceof Uint8Array?row.image_data:new Uint8Array(row.image_data||[]);
  return new Response(bytes,{headers:{"Content-Type":row.content_type,"Content-Length":String(bytes.byteLength),"Cache-Control":"public, max-age=60","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
 }catch{return new Response("Could not load logo.",{status:500})}
}
export async function onRequestPostLogo({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const actor=await getSuperAdminSession(request,env);
 if(!actor)return json({ok:false,error:"Only Super Admin can upload the platform logo."},401);
 let form;try{form=await request.formData()}catch{return json({ok:false,error:"Choose an image file to upload."},400)}
 const file=form.get("logo");
 if(!file||typeof file.arrayBuffer!=="function")return json({ok:false,error:"Choose a logo image."},400);
 if(!{"image/png":1,"image/jpeg":1,"image/webp":1}[file.type])return json({ok:false,error:"Use a PNG, JPG or WebP image."},400);
 if(file.size<1||file.size>MAX_LOGO_BYTES)return json({ok:false,error:"Logo image must be 1.8 MB or smaller."},400);
 try{
  const bytes=new Uint8Array(await file.arrayBuffer());
  await ensureLogoTable(env.DB);
  if(env.R2){
   await env.R2.put(R2_LOGO_KEY,bytes,{httpMetadata:{contentType:file.type,cacheControl:"public, max-age=60"}});
   await env.DB.prepare("INSERT INTO platform_branding_assets(asset_key,content_type,image_data,storage_provider,object_key,updated_by,updated_at) VALUES(?,?,X'', 'r2',?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(asset_key) DO UPDATE SET content_type=excluded.content_type,image_data=X'',storage_provider='r2',object_key=excluded.object_key,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(LOGO_KEY,file.type,R2_LOGO_KEY,actor.id).run();
   return json({ok:true,logoUrl:"/api/branding/logo",storage:"R2",message:"Logo uploaded to R2; D1 stores its reference."});
  }
  await env.DB.prepare("INSERT INTO platform_branding_assets(asset_key,content_type,image_data,storage_provider,object_key,updated_by,updated_at) VALUES(?,?,?,'d1',NULL,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(asset_key) DO UPDATE SET content_type=excluded.content_type,image_data=excluded.image_data,storage_provider='d1',object_key=NULL,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(LOGO_KEY,file.type,bytes,actor.id).run();
  return json({ok:true,logoUrl:"/api/branding/logo",storage:"D1",message:"Logo uploaded and stored centrally in D1."});
 }catch{return json({ok:false,error:"Logo upload failed. Please try again."},500)}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const actor=await getSuperAdminSession(request,env);if(!actor)return json({ok:false,error:"Only Super Admin can change platform branding."},401);
 let b;try{b=await request.json()}catch{return json({ok:false,error:"Invalid branding details."},400)}
 const name=String(b.name||"").trim(),tagline=String(b.tagline||"").trim();
 const details={platform_address:String(b.address||"").trim(),platform_city:String(b.city||"").trim(),platform_county:String(b.county||"").trim(),platform_phone:String(b.phone||"").trim(),platform_website:String(b.website||"").trim(),platform_support_email:String(b.supportEmail||"").trim(),platform_registered_domain:String(b.registeredDomain||"").trim()};
 if(Object.values(details).some(v=>v.length>240))return json({ok:false,error:"One or more platform details are too long."},400);
 if(details.platform_support_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.platform_support_email))return json({ok:false,error:"Enter a valid support email."},400);
 if(details.platform_website&&!/^https?:\/\//i.test(details.platform_website))return json({ok:false,error:"Website must start with https:// or http://."},400);
 if(!name||name.length>100||tagline.length>160)return json({ok:false,error:"Enter a valid platform name and tagline."},400);
 try{
  await env.DB.batch([
   env.DB.prepare("INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES('platform_name',?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(name,actor.id),
   env.DB.prepare("INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES('platform_tagline',?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(tagline,actor.id),
   ...Object.entries(details).map(([key,value])=>env.DB.prepare("INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(key,value,actor.id))
  ]);
  return json({ok:true,message:"Platform branding saved centrally."});
 }catch{return json({ok:false,error:"Could not save platform branding."},500)}
}


const LOGIN_BACKGROUND_KEY="login-background";
const R2_LOGIN_BACKGROUND_KEY="platform/login-background";
const MAX_LOGIN_BACKGROUND_BYTES=1800*1024;
export async function onRequestGetLoginBackground({env}){
 if(!env.DB)return new Response("Database unavailable.",{status:503});
 try{
  await ensureLogoTable(env.DB);
  const row=await env.DB.prepare("SELECT content_type,image_data,storage_provider,object_key FROM platform_branding_assets WHERE asset_key=?").bind(LOGIN_BACKGROUND_KEY).first();
  if(!row)return new Response("Login background not configured.",{status:404,headers:{"Cache-Control":"no-store"}});
  if(row.storage_provider==="r2"){
   if(!env.R2||!row.object_key)return new Response("Background storage unavailable.",{status:503});
   const object=await env.R2.get(row.object_key);if(!object)return new Response("Background not found.",{status:404});
   return new Response(object.body,{headers:{"Content-Type":row.content_type,"Cache-Control":"public, max-age=300","X-Content-Type-Options":"nosniff"}});
  }
  const bytes=row.image_data instanceof Uint8Array?row.image_data:new Uint8Array(row.image_data||[]);
  return new Response(bytes,{headers:{"Content-Type":row.content_type,"Content-Length":String(bytes.byteLength),"Cache-Control":"public, max-age=300","X-Content-Type-Options":"nosniff"}});
 }catch{return new Response("Could not load login background.",{status:500})}
}
export async function onRequestPostLoginBackground({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const actor=await getSuperAdminSession(request,env);if(!actor)return json({ok:false,error:"Only Super Admin can upload the login background."},401);
 let form;try{form=await request.formData()}catch{return json({ok:false,error:"Choose an image to upload."},400)}
 const file=form.get("background");
 if(!file||typeof file.arrayBuffer!=="function")return json({ok:false,error:"Choose a background image."},400);
 if(!{"image/png":1,"image/jpeg":1,"image/webp":1}[file.type])return json({ok:false,error:"Use a PNG, JPG or WebP image."},400);
 if(file.size<1||file.size>MAX_LOGIN_BACKGROUND_BYTES)return json({ok:false,error:"Background image must be 4 MB or smaller."},400);
 try{
  const bytes=new Uint8Array(await file.arrayBuffer());await ensureLogoTable(env.DB);
  if(env.R2){
   await env.R2.put(R2_LOGIN_BACKGROUND_KEY,bytes,{httpMetadata:{contentType:file.type,cacheControl:"public, max-age=300"}});
   await env.DB.prepare("INSERT INTO platform_branding_assets(asset_key,content_type,image_data,storage_provider,object_key,updated_by,updated_at) VALUES(?,?,X'', 'r2',?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(asset_key) DO UPDATE SET content_type=excluded.content_type,image_data=X'',storage_provider='r2',object_key=excluded.object_key,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(LOGIN_BACKGROUND_KEY,file.type,R2_LOGIN_BACKGROUND_KEY,actor.id).run();
   return json({ok:true,backgroundUrl:"/api/branding/login-background",storage:"R2",message:"Login background saved to R2."});
  }
  await env.DB.prepare("INSERT INTO platform_branding_assets(asset_key,content_type,image_data,storage_provider,object_key,updated_by,updated_at) VALUES(?,?,?,'d1',NULL,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(asset_key) DO UPDATE SET content_type=excluded.content_type,image_data=excluded.image_data,storage_provider='d1',object_key=NULL,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(LOGIN_BACKGROUND_KEY,file.type,bytes,actor.id).run();
  return json({ok:true,backgroundUrl:"/api/branding/login-background",storage:"D1",message:"Login background saved centrally in D1."});
 }catch{return json({ok:false,error:"Background upload failed. Please try again."},500)}
}

const MAX_PROFILE_PHOTO_BYTES=1800*1024;
export async function onRequestPostProfilePhoto({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const actor=await getAuthenticatedSession(request,env);
 if(!actor)return json({ok:false,error:"Sign in to upload your profile picture."},401);
 let form;try{form=await request.formData()}catch{return json({ok:false,error:"Choose a profile picture."},400)}
 const file=form.get("photo");
 if(!file||typeof file.arrayBuffer!=="function")return json({ok:false,error:"Choose a profile picture."},400);
 if(!{"image/png":1,"image/jpeg":1,"image/webp":1}[file.type])return json({ok:false,error:"Use a PNG, JPG or WebP image."},400);
 if(file.size<1||file.size>MAX_PROFILE_PHOTO_BYTES)return json({ok:false,error:"Profile picture must be 1.8 MB or smaller."},400);
 try{
  await ensureLogoTable(env.DB);
  const key="profile-"+actor.id,r2Key="profiles/"+actor.id,bytes=new Uint8Array(await file.arrayBuffer());
  if(env.R2){
   await env.R2.put(r2Key,bytes,{httpMetadata:{contentType:file.type,cacheControl:"private, no-store"}});
   const storedObject=await env.R2.get(r2Key);
   if(!storedObject)throw new Error("Profile photo R2 read-back verification failed.");
   const storedBytes=new Uint8Array(await storedObject.arrayBuffer());
   if(storedBytes.byteLength!==bytes.byteLength)throw new Error("Profile photo R2 size verification failed.");
   await env.DB.prepare("INSERT INTO platform_branding_assets(asset_key,content_type,image_data,storage_provider,object_key,updated_by,updated_at) VALUES(?,?,X'','r2',?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(asset_key) DO UPDATE SET content_type=excluded.content_type,image_data=X'',storage_provider='r2',object_key=excluded.object_key,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(key,file.type,r2Key,actor.id).run();
  }else{
   await env.DB.prepare("INSERT INTO platform_branding_assets(asset_key,content_type,image_data,storage_provider,object_key,updated_by,updated_at) VALUES(?,?,?,'d1',NULL,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(asset_key) DO UPDATE SET content_type=excluded.content_type,image_data=excluded.image_data,storage_provider='d1',object_key=NULL,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(key,file.type,bytes,actor.id).run();
  }
  const asset=await env.DB.prepare("SELECT storage_provider,object_key,content_type FROM platform_branding_assets WHERE asset_key=?").bind(key).first();
  if(!asset||asset.storage_provider!==(env.R2?"r2":"d1")||(env.R2&&asset.object_key!==r2Key))throw new Error("Profile photo metadata verification failed.");
  const photoUrl="/api/auth/profile-photo";
  const updated=await env.DB.prepare("UPDATE users SET profile_photo_url=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(photoUrl,actor.id).run();
  if(!Number(updated.meta?.changes||0))throw new Error("Profile photo account reference could not be saved.");
  const user=await env.DB.prepare("SELECT profile_photo_url FROM users WHERE id=?").bind(actor.id).first();
  if(user?.profile_photo_url!==photoUrl)throw new Error("Profile photo account reference verification failed.");
  return json({ok:true,profilePhotoUrl:photoUrl,storage:env.R2?"R2":"D1",message:"Profile picture saved and verified."});
 }catch(error){console.error("Navstar profile photo upload failed:",String(error?.message||error));return json({ok:false,error:"Profile picture upload failed. Please try again."},500)}
}
export async function onRequestGetProfilePhoto({request,env}){
 if(!env.DB)return new Response("Database unavailable.",{status:503});
 const actor=await getAuthenticatedSession(request,env);
 if(!actor)return new Response("Sign in required.",{status:401,headers:{"Cache-Control":"no-store"}});
 try{
  await ensureLogoTable(env.DB);
  const row=await env.DB.prepare("SELECT content_type,image_data,storage_provider,object_key FROM platform_branding_assets WHERE asset_key=?").bind("profile-"+actor.id).first();
  if(!row)return new Response("Profile picture not found.",{status:404,headers:{"Cache-Control":"no-store"}});
  if(row.storage_provider==="r2"){
   if(!env.R2||!row.object_key)return new Response("Profile picture storage unavailable.",{status:503});
   const object=await env.R2.get(row.object_key);if(!object)return new Response("Profile picture not found.",{status:404});
   return new Response(object.body,{headers:{"Content-Type":row.content_type,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
  }
  const bytes=row.image_data instanceof Uint8Array?row.image_data:new Uint8Array(row.image_data||[]);
  return new Response(bytes,{headers:{"Content-Type":row.content_type,"Content-Length":String(bytes.byteLength),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
 }catch{return new Response("Could not load profile picture.",{status:500})}
}
