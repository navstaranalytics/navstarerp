import { getSuperAdminSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function onRequestPost({request,env}){
 const user=await getSuperAdminSession(request,env);if(!user)return json({ok:false,error:"Only Super Admin can run platform diagnostics."},403);
 if(!env.AI)return json({ok:false,error:"Workers AI is not connected yet. Add the AI binding in Cloudflare Worker settings and deploy."},503);
 let body={};try{body=await request.json()}catch{}
 const question=String(body.question||"Analyse the current platform health and identify likely faults and safe corrective actions.").slice(0,3000);
 const tables=["schools","users","auth_sessions","subscription_plans","school_subscriptions","invoices","payments","platform_settings","support_tickets","support_ticket_messages"];
 const checks=await Promise.all(tables.map(async name=>{try{await env.DB.prepare("SELECT 1 FROM "+name+" LIMIT 1").first();return {table:name,status:"available"}}catch{return {table:name,status:"missing_or_unavailable"}}}));
 try{
  const result=await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast",{messages:[
   {role:"system",content:"You are Navstar Analytics platform operations assistant. Analyse only supplied health evidence. Distinguish confirmed findings from hypotheses. Give issue, impact, evidence, safe fix, and verification steps. Never claim you changed anything. Never request credentials, secrets, learner personal data, or financial records."},
   {role:"user",content:"Health evidence: "+JSON.stringify({database:"connected",tables:checks})+"\nAdmin question: "+question}
  ],max_tokens:900,temperature:0.2});
  const answer=typeof result==="string"?result:(result.response||result.output_text||JSON.stringify(result));
  try{await env.DB.prepare("INSERT INTO ai_usage_ledger(id,user_id,service,credits_used,usage_details_json) VALUES(?,?,?,1,?)").bind(crypto.randomUUID(),user.id,"platform_diagnostics",JSON.stringify({model:"@cf/meta/llama-3.1-8b-instruct-fast"})).run()}catch{}
  return json({ok:true,answer,health:{database:"connected",tables:checks},model:"@cf/meta/llama-3.1-8b-instruct-fast"});
 }catch(e){console.error("Workers AI diagnostic failed",e);return json({ok:false,error:"Workers AI request failed. Check the AI binding and Cloudflare AI availability."},502)}
}