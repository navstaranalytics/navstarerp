import { sendNavstarEmail } from "../lib/email.js";
const id=()=>crypto.randomUUID();
async function logRun(db,key,status,summary,error){const now=new Date().toISOString();await db.prepare("INSERT INTO platform_automation_runs(id,task_key,status,started_at,finished_at,summary_json,error_message) VALUES(?,?,?,?,?,?,?)").bind(id(),key,status,now,now,JSON.stringify(summary||{}),error||null).run();}
export async function runScheduledAutomations(env,scheduledTime=new Date()){
 if(!env?.DB)throw new Error("D1 binding DB is unavailable.");
 const setting=await env.DB.prepare("SELECT setting_value FROM platform_settings WHERE setting_key='scheduled_automations'").first();
 let config={tasks:[]};try{config=JSON.parse(setting?.setting_value||'{"tasks":[]}')}catch{}
 const enabled=new Set((config.tasks||[]).filter(t=>t.enabled===true&&t.frequency==="daily").map(t=>t.key));
 const policyRow=await env.DB.prepare("SELECT setting_value FROM platform_settings WHERE setting_key='subscription_policy'").first();let policy={};try{policy=JSON.parse(policyRow?.setting_value||"{}")}catch{}
 const today=new Date(scheduledTime).toISOString().slice(0,10),warningDays=Number(policy.warning_days??7),graceDays=Number(policy.grace_period_days??7);
 const result={date:today,tasks:[]};
 if(enabled.has("subscription_scan")){
  try{const q=await env.DB.prepare("UPDATE school_subscriptions SET status='past_due',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE next_due_date<? AND status IN ('active','trial')").bind(today).run();const changed=Number(q.meta?.changes||0);await logRun(env.DB,"subscription_scan","success",{subscriptionsMarkedPastDue:changed});result.tasks.push({key:"subscription_scan",status:"success",changed})}
  catch(e){await logRun(env.DB,"subscription_scan","failed",{},String(e?.message||e));result.tasks.push({key:"subscription_scan",status:"failed"})}
 }
 if(enabled.has("expiry_warnings")){
  try{
   const rows=await env.DB.prepare("SELECT ss.id,ss.school_id,ss.next_due_date,s.name,s.contact_email FROM school_subscriptions ss JOIN schools s ON s.id=ss.school_id WHERE ss.next_due_date>=? AND ss.next_due_date<=date(?,'+'||?||' days') AND ss.status IN ('active','trial','past_due') AND s.status='active'").bind(today,today,warningDays).all();
   let sent=0,skipped=0;
   for(const row of rows.results||[]){
    if(!row.contact_email||!env.RESEND_API_KEY){skipped++;continue}
    const exists=await env.DB.prepare("SELECT 1 AS found FROM platform_automation_notifications WHERE school_id=? AND task_key='expiry_warning' AND reference_date=?").bind(row.school_id,row.next_due_date).first();if(exists){skipped++;continue}
    const days=Math.max(0,Math.ceil((Date.parse(row.next_due_date+"T00:00:00Z")-Date.parse(today+"T00:00:00Z"))/86400000));
    const resp=await sendNavstarEmail(env,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:[row.contact_email],subject:"Navstar Analytics subscription renewal reminder",text:"Dear "+row.name+" team, your Navstar subscription is due on "+row.next_due_date+" ("+days+" day(s) remaining). Please review your billing details in the school workspace to avoid interruption."})});
    if(resp.ok){await env.DB.prepare("INSERT OR IGNORE INTO platform_automation_notifications(id,school_id,task_key,reference_date) VALUES(?,?,'expiry_warning',?)").bind(id(),row.school_id,row.next_due_date).run();sent++}else skipped++;
   }
   await logRun(env.DB,"expiry_warnings","success",{sent,skipped,eligible:(rows.results||[]).length});result.tasks.push({key:"expiry_warnings",status:"success",sent,skipped})
  }catch(e){await logRun(env.DB,"expiry_warnings","failed",{},String(e?.message||e));result.tasks.push({key:"expiry_warnings",status:"failed"})}
 }
 if(enabled.has("grace_transition")||enabled.has("suspension_enforcement")){
  const key=enabled.has("grace_transition")?"grace_transition":"suspension_enforcement";
  try{
   const rows=await env.DB.prepare("SELECT ss.id,ss.school_id,ss.next_due_date,p.grace_period_days FROM school_subscriptions ss JOIN schools s ON s.id=ss.school_id AND s.status='active' LEFT JOIN subscription_plans p ON p.id=ss.plan_id WHERE ss.next_due_date IS NOT NULL AND ss.next_due_date<? AND ss.status IN ('active','trial','past_due')").bind(today).all();
   let suspended=0,kept=0;
   for(const row of rows.results||[]){
    const late=Math.floor((Date.parse(today+"T00:00:00Z")-Date.parse(row.next_due_date+"T00:00:00Z"))/86400000),grace=graceDays??Number(row.grace_period_days||7);
    if(late>grace&&(policy.expiry_action||"suspend")==="suspend"){await env.DB.batch([env.DB.prepare("UPDATE school_subscriptions SET status='suspended',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(row.id),env.DB.prepare("UPDATE schools SET status='suspended',suspension_reason='subscription_overdue',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(row.school_id)]);suspended++}else kept++;
   }
   await logRun(env.DB,key,"success",{suspended,stillInGraceOrAlternativePolicy:kept});result.tasks.push({key,status:"success",suspended,kept})
  }catch(e){await logRun(env.DB,key,"failed",{},String(e?.message||e));result.tasks.push({key,status:"failed"})}
 }
 return result;
}
