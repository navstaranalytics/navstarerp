import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const user=await getAuthenticatedSession(request,env);
 if(!user)return json({ok:false,error:"Sign in to continue."},401);
 try{
  const rows=user.is_super_admin?await env.DB.prepare("SELECT template_key,name,category,description,version,template_json,is_active,updated_at FROM platform_output_templates ORDER BY category,name").all():await env.DB.prepare("SELECT template_key,name,category,description,version,template_json,is_active,updated_at FROM platform_output_templates WHERE is_active=1 ORDER BY category,name").all();
  return json({ok:true,templates:rows.results||[]});
 }catch(e){console.error("Output template read",e);return json({ok:false,error:"Output template catalogue is unavailable. Apply migrations/0003_roles_and_output_templates.sql to the navstar-erp-db D1 database after the earlier migrations."},503)}
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const user=await getAuthenticatedSession(request,env);
 if(!user)return json({ok:false,error:"Sign in to continue."},401);
 if(!user.is_super_admin)return json({ok:false,error:"Only Super Admin can change platform output formats."},403);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid output template."},400)}
 const key=String(body.templateKey||"").trim(),raw=body.templateJson;
 if(!key||typeof raw!=="object"||raw===null||Array.isArray(raw))return json({ok:false,error:"Choose a template and provide a valid JSON object."},400);
 const templateJson=JSON.stringify(raw);
 if(templateJson.length>20000)return json({ok:false,error:"Template configuration is too large."},413);
 try{
  const result=await env.DB.prepare("UPDATE platform_output_templates SET template_json=?,version=version+1,is_active=?,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE template_key=?").bind(templateJson,body.isActive===false?0:1,user.id,key).run();
  if(!result.meta?.changes)return json({ok:false,error:"Output template was not found."},404);
  return json({ok:true,message:"Output format saved centrally.",templateKey:key});
 }catch(e){console.error("Output template save",e);return json({ok:false,error:"Could not save the output format."},500)}
}
