import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const id=()=>crypto.randomUUID();
const timeToMinutes=s=>{const [h,m]=String(s||"").split(":").map(Number);return h*60+m};
const toTime=n=>String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0");
async function ensure(db){
 await db.prepare("CREATE TABLE IF NOT EXISTS timetable_generation_runs(id TEXT PRIMARY KEY,school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,academic_year_id TEXT NOT NULL,term_id TEXT,config_json TEXT NOT NULL,created_by TEXT,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))").run();
 const cols=await db.prepare("PRAGMA table_info(timetable_entries)").all();
 if(!(cols.results||[]).some(x=>x.name==="generated_run_id"))await db.prepare("ALTER TABLE timetable_entries ADD COLUMN generated_run_id TEXT").run();
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const actor=await getAuthenticatedSession(request,env);if(!actor)return json({ok:false,error:"Sign in to continue."},401);
 if(!actor.is_super_admin&&!actor.permissions.includes("academics.manage"))return json({ok:false,error:"Your role cannot generate the timetable."},403);
 let b;try{b=await request.json()}catch{return json({ok:false,error:"Invalid timetable generation settings."},400)}
 const schoolId=actor.is_super_admin?String(b.schoolId||""):actor.school_id;
 const yearId=String(b.academic_year_id||""),termId=String(b.term_id||"")||null;
 const startTime=String(b.start_time||"08:00"),days=(Array.isArray(b.days)?b.days:[1,2,3,4,5]).map(Number).filter(x=>x>=1&&x<=7);
 const periods=Math.max(2,Math.min(12,Math.floor(Number(b.periods_per_day)||8)));
 const duration=Math.max(25,Math.min(120,Math.floor(Number(b.period_minutes)||40)));
 const breakAfter=Math.max(0,Math.min(periods-1,Math.floor(Number(b.break_after)||0)));
 const breakMinutes=Math.max(0,Math.min(90,Math.floor(Number(b.break_minutes)||0)));
 const lessons=Math.max(1,Math.min(8,Math.floor(Number(b.lessons_per_allocation)||3)));
 if(!schoolId||!yearId||!days.length||new Set(days).size!==days.length||!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime))return json({ok:false,error:"Select an academic year, at least one valid school day and a valid start time."},400);
 try{
  await ensure(env.DB);
  const year=await env.DB.prepare("SELECT id FROM academic_years WHERE id=? AND school_id=?").bind(yearId,schoolId).first();
  if(!year)return json({ok:false,error:"The selected academic year does not belong to this school."},404);
  if(termId&&!await env.DB.prepare("SELECT id FROM terms WHERE id=? AND academic_year_id=? AND school_id=?").bind(termId,yearId,schoolId).first())return json({ok:false,error:"The selected term does not belong to the academic year."},400);
  const allocationRows=await env.DB.prepare("SELECT ta.staff_id,ta.academic_year_id,ta.term_id,ta.grade_level_id,ta.stream_id,ta.learning_area_id,ta.pathway,sp.user_id,sp.employment_status,la.name AS area_name,gl.stage_name AS grade_name,st.name AS stream_name FROM teacher_allocations ta JOIN staff_profiles sp ON sp.id=ta.staff_id AND sp.school_id=ta.school_id JOIN learning_areas la ON la.id=ta.learning_area_id AND la.school_id=ta.school_id JOIN grade_levels gl ON gl.id=ta.grade_level_id AND gl.school_id=ta.school_id LEFT JOIN streams st ON st.id=ta.stream_id AND st.school_id=ta.school_id WHERE ta.school_id=? AND ta.academic_year_id=? AND (ta.term_id IS NULL OR ta.term_id IS ?) AND sp.employment_status='active' ORDER BY gl.stage_order,gl.stage_name,st.name,la.name").bind(schoolId,yearId,termId).all();
  const allocations=allocationRows.results||[];
  if(!allocations.length)return json({ok:false,error:"No active teacher allocations were found for this academic year and term. Set up teacher allocations first."},409);
  const existingRows=await env.DB.prepare("SELECT grade_level_id,stream_id,staff_id,weekday,start_time,end_time,room FROM timetable_entries WHERE school_id=? AND academic_year_id=? AND (term_id IS ? OR term_id IS NULL)").bind(schoolId,yearId,termId).all();
  const occupied=(existingRows.results||[]).map(x=>({...x,start:timeToMinutes(x.start_time),end:timeToMinutes(x.end_time)}));
  const slots=[];
  for(const day of days)for(let p=0;p<periods;p++){const mins=timeToMinutes(startTime)+p*duration+(p>=breakAfter&&breakAfter>0?breakMinutes:0);if(mins+duration>1439)return json({ok:false,error:"The selected school day extends beyond midnight. Reduce periods or adjust the start time."},400);slots.push({weekday:day,start_time:toTime(mins),end_time:toTime(mins+duration),start:mins,end:mins+duration,period:p+1})}
  const planned=[],unplaced=[];
  for(const allocation of allocations){
   const alreadyDays=new Set();
   for(let lesson=0;lesson<lessons;lesson++){
    let found=null;
    for(const slot of slots){
     if(alreadyDays.has(slot.weekday))continue;
     const clash=occupied.some(x=>{
      const overlap=slot.start<x.end&&slot.end>x.start;if(!overlap||Number(x.weekday)!==slot.weekday)return false;
      const sameClass=x.grade_level_id===allocation.grade_level_id&&(x.stream_id===allocation.stream_id||!x.stream_id||!allocation.stream_id);
      const sameTeacher=allocation.staff_id&&x.staff_id===allocation.staff_id;
      return sameClass||sameTeacher;
     });
     if(!clash){found=slot;break}
    }
    if(!found){unplaced.push({grade:allocation.grade_name,stream:allocation.stream_name||"All streams",learningArea:allocation.area_name,teacher:allocation.user_id||allocation.staff_id,lesson:lesson+1});continue}
    const item={...allocation,...found};planned.push(item);occupied.push({...item,weekday:item.weekday,start:item.start,end:item.end});alreadyDays.add(found.weekday);
   }
  }
  if(unplaced.length)return json({ok:false,generated:0,required:allocations.length*lessons,unplaced:unplaced.length,details:unplaced.slice(0,30),error:"The timetable could not fit every allocated lesson without a collision. No timetable entries were saved. Increase available periods/days or reduce lessons per allocation."},409);
  const runId=id(),config={days,periods_per_day:periods,period_minutes:duration,start_time:startTime,break_after:breakAfter,break_minutes:breakMinutes,lessons_per_allocation:lessons};
  const statements=[env.DB.prepare("INSERT INTO timetable_generation_runs(id,school_id,academic_year_id,term_id,config_json,created_by) VALUES(?,?,?,?,?,?)").bind(runId,schoolId,yearId,termId,JSON.stringify(config),actor.id)];
  for(const x of planned)statements.push(env.DB.prepare("INSERT INTO timetable_entries(id,school_id,academic_year_id,term_id,grade_level_id,stream_id,learning_area_id,staff_id,weekday,start_time,end_time,room,generated_run_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?)").bind(id(),schoolId,yearId,termId,x.grade_level_id,x.stream_id,x.learning_area_id,x.staff_id,x.weekday,x.start_time,x.end_time,runId));
  await env.DB.batch(statements);
  return json({ok:true,runId,generated:planned.length,classes:new Set(planned.map(x=>x.grade_level_id+":"+(x.stream_id||""))).size,teachers:new Set(planned.map(x=>x.staff_id)).size,message:planned.length+" lessons generated. Class and teacher collision checks passed."},201);
 }catch(e){console.error("Automatic timetable generation",e);return json({ok:false,error:"Automatic timetable generation failed. No success was confirmed."},500)}
}
