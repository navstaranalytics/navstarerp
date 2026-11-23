import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:"Database connection is unavailable."},503);
 const user=await getAuthenticatedSession(request,env);
 if(!user)return json({ok:false,error:"Sign in to continue."},401);
 if(!["parent","student"].includes(user.role_key))return json({ok:false,error:"This portal endpoint is for parent and learner accounts."},403);
 try{
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
  const learners=[];
  for(const learner of links.results||[]){
   const enrollment=await env.DB.prepare(`SELECT e.academic_year_id,e.grade_level_id,e.stream_id,g.stage_name AS grade_name,st.name AS stream_name,y.name AS academic_year
    FROM learner_enrollments e LEFT JOIN grade_levels g ON g.id=e.grade_level_id
    LEFT JOIN streams st ON st.id=e.stream_id LEFT JOIN academic_years y ON y.id=e.academic_year_id
    WHERE e.learner_id=? AND e.school_id=? AND e.status='active' ORDER BY e.enrolled_at DESC LIMIT 1`).bind(learner.id,user.school_id).first();
   const attendance=await env.DB.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN ar.attendance_status='present' THEN 1 ELSE 0 END) AS present,
    SUM(CASE WHEN ar.attendance_status='absent' THEN 1 ELSE 0 END) AS absent,
    SUM(CASE WHEN ar.attendance_status='late' THEN 1 ELSE 0 END) AS late
    FROM attendance_records ar WHERE ar.learner_id=? AND ar.school_id=?`).bind(learner.id,user.school_id).first();
   const reports=await env.DB.prepare(`SELECT id,academic_year_id,term_id,status,published_at,report_data_json FROM report_cards
    WHERE learner_id=? AND school_id=? AND status='published' ORDER BY published_at DESC LIMIT 8`).bind(learner.id,user.school_id).all();
   const timetable=enrollment?await env.DB.prepare(`SELECT t.weekday,t.start_time,t.end_time,t.room,la.name AS learning_area
    FROM timetable_entries t JOIN learning_areas la ON la.id=t.learning_area_id
    WHERE t.school_id=? AND t.academic_year_id=? AND t.grade_level_id=? AND (t.stream_id IS ? OR t.stream_id=?)
    ORDER BY t.weekday,t.start_time LIMIT 100`).bind(user.school_id,enrollment.academic_year_id,enrollment.grade_level_id,enrollment.stream_id,enrollment.stream_id).all():{results:[]};
   learners.push({...learner,enrollment:enrollment||null,attendance:attendance||{total:0,present:0,absent:0,late:0},reports:reports.results||[],timetable:timetable.results||[]});
  }
  return json({ok:true,role:user.role_key,school:{id:user.school_id,name:user.school_name},learners});
 }catch(error){console.error("Parent/learner portal read failed:",String(error?.message||error));return json({ok:false,error:"Your linked learner information could not be loaded."},500)}
}
