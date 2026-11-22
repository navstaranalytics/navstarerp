import { getSuperAdminSession } from "./auth.js";
const json=(d,s=200)=>Response.json(d,{status:s,headers:{"Cache-Control":"no-store"}});
const LOGO_KEY="platform/logo";
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 try{
  const rows=await env.DB.prepare("SELECT setting_key,setting_value FROM platform_settings WHERE setting_key IN ('platform_logo_key','platform_name','platform_tagline')").all();
  const settings=Object.fromEntries((rows.results||[]).map(x=>[x.setting_key,x.setting_value]));
  return json({ok:true,branding:{logoUrl:settings.platform_logo_key?"/api/branding/logo":"",name:settings.platform_name||"NAVSTAR Analytics",tagline:settings.platform_tagline||"Education management platform"}});
 }catch{return json({ok:true,branding:{logoUrl:"",name:"NAVSTAR Analytics",tagline:"Education management platform"}})}
}
export async function onRequestGetLogo({env}){
 if(!env.R2)return new Response("Logo storage is not configured.",{status:503});
 try{
  const object=await env.R2.get(LOGO_KEY);
  if(!object)return new Response("Logo not found.",{status:404});
  const headers=new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag",object.httpEtag);
  headers.set("Cache-Control","public, max-age=300");
  headers.set("X-Content-Type-Options","nosniff");
  return new Response(object.body,{headers});
 }catch{return new Response("Could not load logo.",{status:500})}
}
export async function onRequestPostLogo({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const actor=await getSuperAdminSession(request,env);
 if(!actor)return json({ok:false,error:"Only Super Admin can upload the platform logo."},401);
 if(!env.R2)return json({ok:false,error:"Logo storage is not configured yet. Add the Cloudflare R2 binding named R2."},503);
 let form;try{form=await request.formData()}catch{return json({ok:false,error:"Choose an image file to upload."},400)}
 const file=form.get("logo");
 if(!file||typeof file.stream!=="function")return json({ok:false,error:"Choose a logo image."},400);
 const allowed={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"};
 if(!allowed[file.type])return json({ok:false,error:"Use a PNG, JPG or WebP image."},400);
 if(file.size<1||file.size>2*1024*1024)return json({ok:false,error:"Logo image must be 2 MB or smaller."},400);
 try{
  await env.R2.put(LOGO_KEY,file.stream(),{httpMetadata:{contentType:file.type,cacheControl:"public, max-age=300"}});
  await env.DB.prepare("INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES('platform_logo_key',?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(LOGO_KEY,actor.id).run();
  return json({ok:true,logoUrl:"/api/branding/logo",message:"Logo uploaded and stored centrally."});
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
