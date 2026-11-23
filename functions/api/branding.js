import { getSuperAdminSession } from "./auth.js";
const json=(d,s=200)=>Response.json(d,{status:s,headers:{"Cache-Control":"no-store"}});
const LOGO_KEY="platform-logo";
const MAX_LOGO_BYTES=1800*1024;
const CREATE_LOGO_TABLE=`CREATE TABLE IF NOT EXISTS platform_branding_assets (
 asset_key TEXT PRIMARY KEY,
 content_type TEXT NOT NULL,
 image_data BLOB NOT NULL,
 updated_by TEXT,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`;
async function ensureLogoTable(db){await db.prepare(CREATE_LOGO_TABLE).run()}
export async function onRequestGet({env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 try{
  const rows=await env.DB.prepare("SELECT setting_key,setting_value FROM platform_settings WHERE setting_key IN ('platform_name','platform_tagline')").all();
  const settings=Object.fromEntries((rows.results||[]).map(x=>[x.setting_key,x.setting_value]));
  const logo=await env.DB.prepare("SELECT 1 AS present FROM platform_branding_assets WHERE asset_key=?").bind(LOGO_KEY).first();
  return json({ok:true,branding:{logoUrl:logo?"/api/branding/logo":"",name:settings.platform_name||"NAVSTAR Analytics",tagline:settings.platform_tagline||"Education management platform"}});
 }catch{return json({ok:true,branding:{logoUrl:"",name:"NAVSTAR Analytics",tagline:"Education management platform"}})}
}
export async function onRequestGetLogo({env}){
 if(!env.DB)return new Response("Database unavailable.",{status:503});
 try{
  await ensureLogoTable(env.DB);
  const row=await env.DB.prepare("SELECT content_type,image_data FROM platform_branding_assets WHERE asset_key=?").bind(LOGO_KEY).first();
  if(!row)return new Response("Logo not found.",{status:404});
  const bytes=row.image_data instanceof Uint8Array?row.image_data:new Uint8Array(row.image_data);
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
 const allowed={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"};
 if(!allowed[file.type])return json({ok:false,error:"Use a PNG, JPG or WebP image."},400);
 if(file.size<1||file.size>MAX_LOGO_BYTES)return json({ok:false,error:"Logo image must be 1.8 MB or smaller."},400);
 try{
  const bytes=new Uint8Array(await file.arrayBuffer());
  await ensureLogoTable(env.DB);
  await env.DB.prepare("INSERT INTO platform_branding_assets(asset_key,content_type,image_data,updated_by,updated_at) VALUES(?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(asset_key) DO UPDATE SET content_type=excluded.content_type,image_data=excluded.image_data,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(LOGO_KEY,file.type,bytes,actor.id).run();
  return json({ok:true,logoUrl:"/api/branding/logo",message:"Logo uploaded and stored centrally in D1."});
 }catch{return json({ok:false,error:"Logo upload failed. Please try again."},500)}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const actor=await getSuperAdminSession(request,env);if(!actor)return json({ok:false,error:"Only Super Admin can change platform branding."},401);
 let b;try{b=await request.json()}catch{return json({ok:false,error:"Invalid branding details."},400)}
 const name=String(b.name||"").trim(),tagline=String(b.tagline||"").trim();
 if(!name||name.length>100||tagline.length>160)return json({ok:false,error:"Enter a valid platform name and tagline."},400);
 try{
  await env.DB.batch([
   env.DB.prepare("INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES('platform_name',?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(name,actor.id),
   env.DB.prepare("INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES('platform_tagline',?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(tagline,actor.id)
  ]);
  return json({ok:true,message:"Platform branding saved centrally."});
 }catch{return json({ok:false,error:"Could not save platform branding."},500)}
}
