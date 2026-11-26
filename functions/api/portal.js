import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
async function getAcademicPeriod(db,schoolId){
 const today=new Date(Date.now()+3*60*60*1000).toISOString().slice(0,10);
 const year=await db.prepare("SELECT id,name,start_date,end_date FROM academic_years WHERE school_id=? AND start_date<=? AND end_date>=? ORDER BY start_date DESC LIMIT 1").bind(schoolId,today,today).first();
 if(!year)return {date:today,academicYear:null,term:null,weekNumber:null,weekLabel:"No current week"};
 const term=await db.prepare("SELECT id,name,start_date,end_date FROM terms WHERE school_id=? AND academic_year_id=? AND start_date<=? AND end_date>=? ORDER BY start_date DESC LIMIT 1").bind(schoolId,year.id,today,today).first();
 const anchor=term?.start_date||year.start_date;
 const days=Math.max(0,Math.floor((Date.parse(today+"T00:00:00Z")-Date.parse(anchor+"T00:00:00Z"))/86400000));
 const weekNumber=Math.floor(days/7)+1;
 return {date:today,academicYear:year,term:term||null,weekNumber,weekLabel:"Week "+weekNumber};
}
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:"Database connection is unavailable."},503);
 const user=await getAuthenticatedSession(request,env);
 if(!user)return json({ok:false,error:"Sign in to continue."},401);
 if(!["parent","student"].includes(user.role_key))return json({ok:false,error:"This portal endpoint is for parent and learner accounts."},403);
 try{
  // learner_user_links is provisioned by migration 0004; keep portal reads read-only.
  let links;
  if(user.role_key==="parent"){
   links=await env.DB.prepare(`SELECT l.id,l.admission_number,l.first_name,l.middle_name,l.last_name,l.status,l.pathway
    FROM guardians g JOIN learner_guardians lg ON lg.guardian_id=g.id
    JOIN learners l ON l.id=lg.learner_id AND l.school_id=g.school_id
    WHERE g.user_id=? AND g.school_id=? ORDER BY l.first_name,l.last_name`).bind(user.id,user.school_id).all();
  }else{
   links=await env.DB.prepare(`SELECT l.id,l.admission_number,l.first_name,l.middle_name,l.last_name,l.status,l.pathway
    FROM learner_user_links x JOIN learners l ON l.id=x.learner_id AND l.school_id=x.school_id
    WHERE x.user_id=? AND x.school_id=? LIMIT 1`).bind(user.id,user.school_id).all();
  }
  // Resolve each learner's current enrolment first, then fetch the independent
  // attendance, report and timetable datasets concurrently. All reads retain the
  // authenticated tenant ID; no client-supplied school identifier is trusted.
  const [learners,academicPeriod]=await Promise.all([
   Promise.all((links.results||[]).map(async learner=>{
    const enrollment=await env.DB.prepare(`SELECT e.academic_year_id,e.grade_level_id,e.stream_id,CASE WHEN lower(COALESCE(g.curriculum,'')) LIKE '%cbe%' OR lower(COALESCE(g.curriculum,'')) LIKE '%cbc%' OR lower(COALESCE(g.curriculum,'')) LIKE '%competency%' THEN replace(g.stage_name,'Grade ','Class ') ELSE g.stage_name END AS grade_name,st.name AS stream_name,y.name AS academic_year
     FROM learner_enrollments e LEFT JOIN grade_levels g ON g.id=e.grade_level_id
     LEFT JOIN streams st ON st.id=e.stream_id LEFT JOIN academic_years y ON y.id=e.academic_year_id
     WHERE e.learner_id=? AND e.school_id=? AND e.status='active' ORDER BY e.enrolled_at DESC LIMIT 1`).bind(learner.id,user.school_id).first();
    const [attendance,reports,timetable]=await Promise.all([
     env.DB.prepare(`SELECT
      SUM(CASE WHEN ar.attendance_status IN ('present','absent','late') THEN 1 ELSE 0 END) AS total,
      SUM(CASE WHEN ar.attendance_status='present' THEN 1 ELSE 0 END) AS present,
      SUM(CASE WHEN ar.attendance_status='absent' THEN 1 ELSE 0 END) AS absent,
      SUM(CASE WHEN ar.attendance_status='late' THEN 1 ELSE 0 END) AS late,
      SUM(CASE WHEN ar.attendance_status='excused' THEN 1 ELSE 0 END) AS excused
      FROM attendance_records ar JOIN attendance_sessions ats ON ats.id=ar.session_id AND ats.school_id=ar.school_id
      WHERE ar.learner_id=? AND ar.school_id=? AND ats.academic_year_id IS ?`).bind(learner.id,user.school_id,enrollment?.academic_year_id||null).first(),
     env.DB.prepare(`SELECT id,academic_year_id,term_id,status,published_at,report_data_json FROM report_cards
      WHERE learner_id=? AND school_id=? AND status='published' ORDER BY published_at DESC LIMIT 8`).bind(learner.id,user.school_id).all(),
     enrollment?env.DB.prepare(`SELECT t.weekday,t.start_time,t.end_time,t.room,la.name AS learning_area
      FROM timetable_entries t JOIN learning_areas la ON la.id=t.learning_area_id
      WHERE t.school_id=? AND t.academic_year_id=? AND t.grade_level_id=? AND (t.stream_id IS ? OR t.stream_id=?)
      ORDER BY t.weekday,t.start_time LIMIT 100`).bind(user.school_id,enrollment.academic_year_id,enrollment.grade_level_id,enrollment.stream_id,enrollment.stream_id).all():Promise.resolve({results:[]})
    ]);
    return {...learner,enrollment:enrollment||null,attendance:attendance||{total:0,present:0,absent:0,late:0},reports:reports.results||[],timetable:timetable.results||[]};
   })),
   getAcademicPeriod(env.DB,user.school_id)
  ]);
  return json({ok:true,role:user.role_key,school:{id:user.school_id,name:user.school_name},academicPeriod,learners});
 }catch(error){console.error("Parent/learner portal read failed:",String(error?.message||error));return json({ok:false,error:"Your linked learner information could not be loaded."},500)}
}
