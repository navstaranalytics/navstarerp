import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});

export async function onRequestPostMotto({request,env}){
 const user=await getAuthenticatedSession(request,env);
 if(!user?.school_id)return json({ok:false,error:"A school account is required."},401);
 if(!user.permissions?.includes("school.settings.manage"))return json({ok:false,error:"School settings permission is required."},403);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid school motto."},400)}
 const motto=String(body.motto||"").trim();
 if(motto.length>120)return json({ok:false,error:"The school motto must be 120 characters or fewer."},400);
 try{
  const row=await env.DB.prepare("SELECT settings_json FROM school_settings WHERE school_id=?").bind(user.school_id).first();
  let settings={};try{settings=JSON.parse(row?.settings_json||"{}")}catch{}
  if(motto)settings.school_motto=motto;else delete settings.school_motto;
  await env.DB.prepare("INSERT INTO school_settings(school_id,timezone,currency,settings_json) VALUES(?,'Africa/Nairobi','KES',?) ON CONFLICT(school_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(user.school_id,JSON.stringify(settings)).run();
  return json({ok:true,schoolMotto:motto,message:"School motto saved."});
 }catch(error){console.error("NAVSTAR school motto update",error);return json({ok:false,error:"Could not save the school motto."},500)}
}

export async function onRequestGet({request,env}){
 const user=await getAuthenticatedSession(request,env);
 if(!user||!user.school_id)return json({ok:false,error:"A school account is required."},401);
 const schoolId=user.school_id;
 try{
  const now=new Date().toISOString().slice(0,10);
  const monthStart=now.slice(0,7)+"-01";
  const settled=await Promise.allSettled([
    env.DB.prepare("SELECT id,name,start_date,end_date,status FROM academic_years WHERE school_id=? AND (status='active' OR (start_date<=? AND end_date>=?)) ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END,start_date DESC LIMIT 1").bind(schoolId,now,now).first(),
    env.DB.prepare("SELECT t.id,t.name,t.start_date,t.end_date,t.status,y.name AS academic_year FROM terms t JOIN academic_years y ON y.id=t.academic_year_id AND y.school_id=t.school_id WHERE t.school_id=? AND (t.status='active' OR (t.start_date<=? AND t.end_date>=?)) ORDER BY CASE WHEN t.status='active' THEN 0 ELSE 1 END,t.start_date DESC LIMIT 1").bind(schoolId,now,now).first(),
    env.DB.prepare("SELECT ss.status,ss.next_due_date,ss.estimated_amount_kes,ss.preferred_payment_method,p.name AS plan_name,p.grace_period_days FROM school_subscriptions ss LEFT JOIN subscription_plans p ON p.id=ss.plan_id WHERE ss.school_id=? ORDER BY ss.updated_at DESC LIMIT 1").bind(schoolId).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM learners WHERE school_id=? AND status='active'").bind(schoolId).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM staff_profiles WHERE school_id=? AND employment_status='active'").bind(schoolId).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM classes WHERE school_id=? AND status='active'").bind(schoolId).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM attendance_sessions WHERE school_id=? AND attendance_date>=?").bind(schoolId,monthStart).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM attendance_records WHERE school_id=? AND session_id IN (SELECT id FROM attendance_sessions WHERE school_id=? AND attendance_date=?)").bind(schoolId,schoolId,now).first(),
    env.DB.prepare("SELECT SUM(CASE WHEN attendance_status='present' THEN 1 ELSE 0 END) AS present,SUM(CASE WHEN attendance_status='absent' THEN 1 ELSE 0 END) AS absent,SUM(CASE WHEN attendance_status='late' THEN 1 ELSE 0 END) AS late,SUM(CASE WHEN attendance_status='excused' THEN 1 ELSE 0 END) AS excused FROM attendance_records WHERE school_id=? AND session_id IN (SELECT id FROM attendance_sessions WHERE school_id=? AND attendance_date=?)").bind(schoolId,schoolId,now).first(),
    env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN transaction_type='income' THEN amount ELSE 0 END),0) AS income,COALESCE(SUM(CASE WHEN transaction_type='expense' THEN amount ELSE 0 END),0) AS expenses,COUNT(*) AS transactions FROM finance_transactions WHERE school_id=? AND transaction_date>=? AND transaction_date<=?").bind(schoolId,monthStart,now).first(),
    env.DB.prepare("SELECT COALESCE(SUM(amount_due),0) AS due,COALESCE(SUM(amount_paid),0) AS paid,COALESCE(SUM(balance),0) AS balance,COUNT(*) AS accounts FROM learner_fee_accounts WHERE school_id=?").bind(schoolId).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM assessments WHERE school_id=?").bind(schoolId).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM assessment_results WHERE school_id=?").bind(schoolId).first(),
    env.DB.prepare("SELECT json_extract(settings_json,'$.school_motto') AS motto FROM school_settings WHERE school_id=?").bind(schoolId).first()
  ]);
  const value=i=>settled[i].status==="fulfilled"?settled[i].value:null;
  const year=value(0),term=value(1),subscription=value(2);
  const number=(i,key="total")=>value(i)?.[key]==null?null:Number(value(i)[key]);
  const counts={learners:number(3),staff:number(4),classes:number(5),attendance:number(6)};
  const todayAttendance=value(8)||{};
  const finance=value(9)||{};
  const fees=value(10)||{};
  const insights={
   attendanceToday:{sessions:counts.attendance===null?null:number(7),present:Number(todayAttendance.present||0),absent:Number(todayAttendance.absent||0),late:Number(todayAttendance.late||0),excused:Number(todayAttendance.excused||0)},
   financeThisMonth:{income:Number(finance.income||0),expenses:Number(finance.expenses||0),transactions:Number(finance.transactions||0)},
   feeAccounts:{due:Number(fees.due||0),paid:Number(fees.paid||0),balance:Number(fees.balance||0),accounts:Number(fees.accounts||0)},
   assessments:{created:number(11),resultsEntered:number(12)}
  };
  const unavailable=settled.map((x,i)=>x.status==="rejected"?["academicYear","currentTerm","subscription","learners","staff","classes","attendanceSessions","attendanceToday","attendanceBreakdown","financeThisMonth","feeAccounts","assessments","assessmentResults"][i]:null).filter(Boolean);
  const due=subscription?.next_due_date||null;
  const daysRemaining=due?Math.ceil((new Date(due+"T00:00:00Z").getTime()-new Date(now+"T00:00:00Z").getTime())/86400000):null;
  return json({ok:true,academicYear:year||null,currentTerm:term||null,subscription:subscription?{...subscription,daysRemaining}:null,schoolMotto:value(13)?.motto||"",counts,insights,unavailable,asOf:now});
 }catch(error){console.error("NAVSTAR school workspace summary",error);return json({ok:false,error:"Could not load the school calendar and subscription status."},500)}
}
