import { getSuperAdminSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const allowed=new Set(["terminology","subscription_policy","scheduled_automations","system_guide","session_policy","learning_area_catalogue"]);
export async function onRequestGet({request,env}){
 const user=await getSuperAdminSession(request,env);if(!user)return json({ok:false,error:"Only Super Admin can manage platform terminology and access policies."},403);
 try{const rows=await env.DB.prepare("SELECT setting_key,setting_value,updated_at FROM platform_settings WHERE setting_key IN ('terminology','subscription_policy','scheduled_automations','system_guide','session_policy','learning_area_catalogue')").all();const settings={};for(const row of rows.results||[]){try{settings[row.setting_key]=JSON.parse(row.setting_value)}catch{settings[row.setting_key]=row.setting_value}}if(!Array.isArray(settings.learning_area_catalogue)){const catalogue=await env.DB.prepare("SELECT DISTINCT curriculum,stage_code AS level,code,name,pathway,is_mandatory AS mandatory FROM learning_areas ORDER BY curriculum,stage_code,name LIMIT 5000").all().catch(()=>({results:[]}));settings.learning_area_catalogue=(catalogue.results||[]).map(x=>({...x,mandatory:Number(x.mandatory)===1?1:0}));}const runs=await env.DB.prepare("SELECT task_key,status,started_at,finished_at,summary_json,error_message FROM platform_automation_runs ORDER BY started_at DESC LIMIT 12").all().catch(()=>({results:[]}));return json({ok:true,settings,automationRuns:runs.results||[]})}
 catch(error){console.error("NAVSTAR platform controls read",error);return json({ok:false,error:"Could not load platform controls."},500)}
}
export async function onRequestPost({request,env}){
 const user=await getSuperAdminSession(request,env);if(!user)return json({ok:false,error:"Only Super Admin can manage platform terminology and access policies."},403);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid settings payload."},400)}
 const key=String(body.key||"");if(!allowed.has(key))return json({ok:false,error:"Unsupported platform control."},400);
 let value=body.value;if(!value||typeof value!=="object"||Array.isArray(value))return json({ok:false,error:"Settings must be a JSON object."},400);
 if(key==="session_policy"){
  const minutes=Number(value.idle_timeout_minutes);
  if(!Number.isInteger(minutes)||minutes<5||minutes>480)return json({ok:false,error:"Inactive session timeout must be between 5 and 480 minutes."},400);
  value={idle_timeout_minutes:minutes};
 }
 if(key==="system_guide"){
  if(typeof value.title!=="string"||value.title.trim().length>140||typeof value.introduction!=="string"||value.introduction.length>3000||!Array.isArray(value.sections)||value.sections.length>20||value.sections.some(x=>!x||typeof x.heading!=="string"||x.heading.length>140||typeof x.body!=="string"||x.body.length>7000))return json({ok:false,error:"Guide title, introduction or section content is invalid."},400);
 }
 if(key==="subscription_policy"){
  const grace=Number(value.grace_period_days);const warning=Number(value.warning_days);
  if(!Number.isInteger(grace)||grace<0||grace>60||!Number.isInteger(warning)||warning<0||warning>30||!["read_only","billing_only","suspend","warning_only"].includes(value.expiry_action)||!["billing_only","block_all","read_only"].includes(value.suspended_access))return json({ok:false,error:"Choose valid grace, warning and access behaviour values."},400);
 }
 if(key==="terminology"){
  const entries=Object.entries(value);if(entries.length>40||entries.some(([k,v])=>!String(k).match(/^[a-z0-9_]{2,50}$/)||typeof v!=="string"||!v.trim()||v.length>80))return json({ok:false,error:"Terminology entries must have valid keys and labels (maximum 40)."},400);
 }
 if(key==="learning_area_catalogue"){
  if(!Array.isArray(value.areas)||value.areas.length>5000||value.areas.some(x=>!x||typeof x.name!=="string"||!x.name.trim()||x.name.length>120||typeof x.code!=="string"||!x.code.trim()||x.code.length>30||typeof x.curriculum!=="string"||!["Kenyan CBE","Kenyan 8-4-4","International / Cambridge","Custom"].includes(x.curriculum)||typeof x.level!=="string"||!x.level.trim()||x.level.length>40||![0,1,true,false].includes(x.mandatory)))return json({ok:false,error:"Each learning area needs a name, code, curriculum, level and compulsory/optional setting."},400);
  value={areas:value.areas.map(x=>({curriculum:x.curriculum,level:x.level.trim(),code:x.code.trim().toUpperCase(),name:x.name.trim(),pathway:String(x.pathway||"").trim()||null,mandatory:x.mandatory===true||Number(x.mandatory)===1?1:0}))};
 }
 if(key==="scheduled_automations"){
  if(!Array.isArray(value.tasks)||value.tasks.length>20||value.tasks.some(t=>!t||typeof t.key!=="string"||typeof t.enabled!=="boolean"||!["daily","weekly","monthly"].includes(t.frequency)))return json({ok:false,error:"Automation tasks have an invalid structure."},400);
 }
 try{
  await env.DB.prepare("INSERT INTO platform_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(key,JSON.stringify(value),user.id).run();
  return json({ok:true,message:"Platform control saved centrally."});
 }catch(error){console.error("NAVSTAR platform controls save",error);return json({ok:false,error:"Could not save platform control."},500)}
}
