import { getAuthenticatedSession } from "../auth.js";

const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const table=`CREATE TABLE IF NOT EXISTS user_profile_photos (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 content_type TEXT NOT NULL,
 image_data BLOB,
 storage_provider TEXT NOT NULL DEFAULT 'd1',
 object_key TEXT,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`;
async function ensure(db){await db.prepare(table).run();const cols=await db.prepare("PRAGMA table_info(users)").all();if(!(cols.results||[]).some(x=>x.name==="profile_photo_url"))await db.prepare("ALTER TABLE users ADD COLUMN profile_photo_url TEXT").run();}
function validImage(type,b){return type==="image/jpeg"&&b[0]===255&&b[1]===216||type==="image/png"&&b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71||type==="image/webp"&&String.fromCharCode(...b.slice(8,12))==="WEBP";}
export async function onRequestGet({request,env}){
 if(!env.DB)return new Response("Database unavailable.",{status:503});
 const user=await getAuthenticatedSession(request,env);if(!user)return new Response("Sign in to view this image.",{status:401});
 try{await ensure(env.DB);const row=await env.DB.prepare("SELECT content_type,image_data,storage_provider,object_key FROM user_profile_photos WHERE user_id=?").bind(user.id).first();if(!row)return new Response("Profile photo not found.",{status:404});
  if(row.storage_provider==="r2"){if(!env.R2||!row.object_key)return new Response("Photo storage unavailable.",{status:503});const object=await env.R2.get(row.object_key);if(!object)return new Response("Profile photo not found.",{status:404});return new Response(object.body,{headers:{"Content-Type":row.content_type,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Vary":"Cookie"}});}
  const bytes=row.image_data instanceof Uint8Array?row.image_data:new Uint8Array(row.image_data||[]);return new Response(bytes,{headers:{"Content-Type":row.content_type,"Content-Length":String(bytes.byteLength),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 }catch(error){console.error("Profile photo read failed",error);return new Response("Could not load profile photo.",{status:500});}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const user=await getAuthenticatedSession(request,env);if(!user)return json({ok:false,error:"Your session has expired. Sign in again."},401);
 let form;try{form=await request.formData()}catch{return json({ok:false,error:"Choose a profile picture."},400)}
 const file=form.get("photo");if(!file||typeof file.arrayBuffer!=="function")return json({ok:false,error:"Choose a profile picture."},400);
 if(!["image/jpeg","image/png","image/webp"].includes(file.type))return json({ok:false,error:"Use a JPG, PNG or WebP image."},400);
 if(file.size<1||file.size>4*1024*1024)return json({ok:false,error:"Profile picture must be 4 MB or smaller."},413);
 try{
  await ensure(env.DB);const bytes=new Uint8Array(await file.arrayBuffer());if(!validImage(file.type,bytes))return json({ok:false,error:"The file contents do not match the selected image type."},400);
  const objectKey="users/"+user.id+"/profile-photo";
  if(env.R2){
   await env.R2.put(objectKey,bytes,{httpMetadata:{contentType:file.type,cacheControl:"private, no-store"}});
   await env.DB.prepare("INSERT INTO user_profile_photos(user_id,content_type,image_data,storage_provider,object_key,updated_at) VALUES(?,?,NULL,'r2',?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(user_id) DO UPDATE SET content_type=excluded.content_type,image_data=NULL,storage_provider='r2',object_key=excluded.object_key,updated_at=excluded.updated_at").bind(user.id,file.type,objectKey).run();
  }else{
   await env.DB.prepare("INSERT INTO user_profile_photos(user_id,content_type,image_data,storage_provider,object_key,updated_at) VALUES(?,?,?,'d1',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(user_id) DO UPDATE SET content_type=excluded.content_type,image_data=excluded.image_data,storage_provider='d1',object_key=NULL,updated_at=excluded.updated_at").bind(user.id,file.type,bytes).run();
  }
  const saved=await env.DB.prepare("SELECT storage_provider FROM user_profile_photos WHERE user_id=?").bind(user.id).first();if(!saved)return json({ok:false,error:"The picture upload could not be verified. Please retry."},500);
  const url="/api/auth/profile-photo?v="+Date.now();await env.DB.prepare("UPDATE users SET profile_photo_url=? WHERE id=?").bind(url,user.id).run();
  return json({ok:true,profilePhotoUrl:url,message:"Profile picture saved successfully."});
 }catch(error){console.error("Profile photo upload failed",error);return json({ok:false,error:"Profile picture could not be saved. Please try again."},500);}
}
