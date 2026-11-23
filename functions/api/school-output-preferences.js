import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const defaults={accent_color:"#173d70",show_teacher_initials:true,show_learner_photo:true,school_tagline:"",footer_note:""};
async function ensure(db){await db.prepare("CREATE TABLE IF NOT EXISTS school_output_preferences (school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE, preferences_json TEXT NOT NULL DEFAULT '{}', updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))").run()}
export async function onRequestGet({request,env}){
 const user=await getAuthenticatedSession(request,env);if(!user?.school_id)return json({ok:false,error:"School sign-in is required."},401);
 try{await ensure(env.DB);const row=await env.DB.prepare("SELECT preferences_json FROM school_output_preferences WHERE school_id=?").bind(user.school_id).first();let preferences={};try{preferences=JSON.parse(row?.preferences_json||"{}")}catch{}return json({ok:true,preferences:{...defaults,...preferences}})}catch(e){console.error("School output preferences",e);return json({ok:false,error:"Could not load report card design settings."},500)}
}
export async function onRequestPost({request,env}){
 const user=await getAuthenticatedSession(request,env);if(!user?.school_id)return json({ok:false,error:"School sign-in is required."},401);
 if(!["school_admin","super_admin"].includes(user.role_key))return json({ok:false,error:"Only the School Administrator can customise school document layouts."},403);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid design settings."},400)}
 const color=String(body.accent_color||defaults.accent_color);if(!/^#[0-9a-fA-F]{6}$/.test(color))return json({ok:false,error:"Choose a valid six-digit colour."},400);
 const preferences={accent_color:color,show_teacher_initials:body.show_teacher_initials!==false,show_learner_photo:body.show_learner_photo!==false,school_tagline:String(body.school_tagline||"").trim().slice(0,160),footer_note:String(body.footer_note||"").trim().slice(0,240)};
 try{await ensure(env.DB);await env.DB.prepare("INSERT INTO school_output_preferences(school_id,preferences_json,updated_by,updated_at) VALUES(?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(school_id) DO UPDATE SET preferences_json=excluded.preferences_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(user.school_id,JSON.stringify(preferences),user.id).run();return json({ok:true,preferences,message:"Your school's report card design has been saved."})}catch(e){console.error("School output preferences save",e);return json({ok:false,error:"Could not save report card design settings."},500)}
}