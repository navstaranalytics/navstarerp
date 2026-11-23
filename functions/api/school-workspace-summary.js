import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function onRequestGet({request,env}){
 const user=await getAuthenticatedSession(request,env);
 if(!user||!user.school_id)return json({ok:false,error:"A school account is required."},401);
 const schoolId=user.school_id;
 try{
  const now=new Date().toISOString().slice(0,10);
  const [year,term,subscription,counts]=await Promise.all([
   env.DB.prepare("SELECT id,name,start_date,end_date,status FROM academic_years WHERE school_id=? AND (status='active' OR (start_date<=? AND end_date>=?)) ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END,start_date DESC LIMIT 1").bind(schoolId,now,now).first(),
   env.DB.prepare("SELECT t.id,t.name,t.start_date,t.end_date,t.status,y.name AS academic_year FROM terms t JOIN academic_years y ON y.id=t.academic_year_id AND y.school_id=t.school_id WHERE t.school_id=? AND (t.status='active' OR (t.start_date<=? AND t.end_date>=?)) ORDER BY CASE WHEN t.status='active' THEN 0 ELSE 1 END,t.start_date DESC LIMIT 1").bind(schoolId,now,now).first(),
   env.DB.prepare("SELECT ss.status,ss.next_due_date,ss.estimated_amount_kes,ss.preferred_payment_method,p.name AS plan_name,p.grace_period_days FROM school_subscriptions ss LEFT JOIN subscription_plans p ON p.id=ss.plan_id WHERE ss.school_id=? ORDER BY ss.updated_at DESC LIMIT 1").bind(schoolId).first(),
   Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM learners WHERE school_id=?").bind(schoolId).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM staff WHERE school_id=?").bind(schoolId).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM classes WHERE school_id=?").bind(schoolId).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM attendance_sessions WHERE school_id=?").bind(schoolId).first()
   ])
  ]);
  const due=subscription?.next_due_date||null;
  const daysRemaining=due?Math.ceil((new Date(due+"T00:00:00Z").getTime()-new Date(now+"T00:00:00Z").getTime())/86400000):null;
  return json({ok:true,academicYear:year||null,currentTerm:term||null,subscription:subscription?{...subscription,daysRemaining}:null,counts:{learners:Number(counts[0]?.total||0),staff:Number(counts[1]?.total||0),classes:Number(counts[2]?.total||0),attendance:Number(counts[3]?.total||0)},asOf:now});
 }catch(error){console.error("NAVSTAR school workspace summary",error);return json({ok:false,error:"Could not load the school calendar and subscription status."},500)}
}
