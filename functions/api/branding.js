import { getSuperAdminSession } from "./auth.js";
const json=(d,s=200)=>Response.json(d,{status:s,headers:{"Cache-Control":"no-store"}});
const safeUrl=v=>{try{const u=new URL(String(v||""));return u.protocol==="https:"&&u.hostname.length>3&&String(v).length<=2048?u.toString():""}catch{return ""}};
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 try{
  const rows=await env.DB.prepare("SELECT setting_key,setting_value FROM platform_settings WHERE setting_key IN ('platform_logo_url','platform_name','platform_tagline')").all();
  const settings=Object.fromEntries((rows.results||[]).map(x=>[x.setting_key,x.setting_value]));
  return json({ok:true,branding:{logoUrl:safeUrl(settings.platform_logo_url),name:settings.platform_name||"NAVSTAR Analytics",tagline:settings.platform_tagline||"Education management platform"}});
 }catch{return json({ok:true,branding:{logoUrl:"",name:"NAVSTAR Analytics",tagline:"Education management platform"}})}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const actor=await getSuperAdminSession(request,env);if(!actor)return json({ok:false,error:"Only Super Admin can change platform branding."},401);
 let b;try{b=await request.json()}catch{return json({ok:false,error:"Invalid branding details."},400)}
 const logo=safeUrl(b.logoUrl),name=String(b.name||"").trim(),tagline=String(b.tagline||"").trim();
 if(b.logoUrl&&!logo)return json({ok:false,error:"Logo must be a valid HTTPS image URL."},400);
 if(!name||name.length>100||tagline.length>160)return json({ok:false,error:"Enter a valid platform name and tagline."},400);
 try{
  await env.DB.batch([
   env.DB.prepare("INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES('platform_logo_url',?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(logo,actor.id),
   env.DB.prepare("INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES('platform_name',?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(name,actor.id),
   env.DB.prepare("INSERT INTO platform_settings(setting_key,setting_value,updated_by) VALUES('platform_tagline',?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(tagline,actor.id)
  ]);
  return json({ok:true,message:"Platform branding saved centrally."});
 }catch{return json({ok:false,error:"Could not save platform branding."},500)}
}
