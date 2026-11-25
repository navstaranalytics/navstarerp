import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const id=()=>crypto.randomUUID();
async function ensureReportTables(db){
 const boundaryCols=await db.prepare("PRAGMA table_info(grade_boundaries)").all();
 if(!(boundaryCols.results||[]).some(x=>x.name==="school_id"))await db.prepare("ALTER TABLE grade_boundaries ADD COLUMN school_id TEXT REFERENCES schools(id) ON DELETE CASCADE").run();
 await db.prepare("UPDATE grade_boundaries SET school_id=(SELECT school_id FROM grading_schemes WHERE grading_schemes.id=grade_boundaries.scheme_id) WHERE school_id IS NULL").run();
 const reportCols=await db.prepare("PRAGMA table_info(report_cards)").all(),names=new Set((reportCols.results||[]).map(x=>x.name));
 if(!names.has("created_by"))await db.prepare("ALTER TABLE report_cards ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL").run();
 if(!names.has("updated_at"))await db.prepare("ALTER TABLE report_cards ADD COLUMN updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const actor=await getAuthenticatedSession(request,env);if(!actor)return json({ok:false,error:"Sign in to continue."},401);
 if(!actor.is_super_admin&&!actor.permissions.includes("academics.manage"))return json({ok:false,error:"Your role cannot generate report cards."},403);
 let b;try{b=await request.json()}catch{return json({ok:false,error:"Invalid report-card generation request."},400)}
 await ensureReportTables(env.DB);
 const schoolId=actor.is_super_admin?String(b.schoolId||""):actor.school_id;
 const yearId=String(b.academic_year_id||""),termId=String(b.term_id||"")||null,gradeId=String(b.grade_level_id||""),streamId=String(b.stream_id||"")||null,schemeId=String(b.scheme_id||"");
 if(!schoolId||!yearId||!gradeId||!schemeId)return json({ok:false,error:"Select an academic year, class and grading scheme."},400);
 try{
  const [year,grade,scheme]=await Promise.all([
   env.DB.prepare("SELECT id,name FROM academic_years WHERE id=? AND school_id=?").bind(yearId,schoolId).first(),
   env.DB.prepare("SELECT id,stage_name,stage_code,curriculum,school_level FROM grade_levels WHERE id=? AND school_id=?").bind(gradeId,schoolId).first(),
   env.DB.prepare("SELECT id,name,curriculum,level_key,stage_code FROM grading_schemes WHERE id=? AND school_id=? AND is_active=1").bind(schemeId,schoolId).first()
  ]);
  if(!year||!grade||!scheme)return json({ok:false,error:"The selected academic year, class or grading scheme is invalid for this school."},400);
  if(scheme.curriculum!==grade.curriculum)return json({ok:false,error:"The grading scheme curriculum does not match this learner class."},400);
  if(scheme.level_key&&scheme.level_key!==grade.id)return json({ok:false,error:"This grading scheme is configured for a different class."},400);
  if(String(scheme.stage_code||"").startsWith("LEVEL:")&&String(scheme.stage_code).slice(6)!==String(grade.school_level||""))return json({ok:false,error:"This grading scheme is configured for a different school level."},400);
  const schoolInfo=await env.DB.prepare("SELECT * FROM schools WHERE id=?").bind(schoolId).first();
  const termInfo=termId?await env.DB.prepare("SELECT name FROM terms WHERE id=? AND academic_year_id=? AND school_id=?").bind(termId,yearId,schoolId).first():null;
  if(termId&&!termInfo)return json({ok:false,error:"The selected term does not belong to the academic year."},400);
  const boundaries=await env.DB.prepare("SELECT label,min_score,max_score,points,descriptor,rubric,remark FROM grade_boundaries WHERE school_id=? AND scheme_id=? ORDER BY min_score DESC").bind(schoolId,schemeId).all();
  if(!(boundaries.results||[]).length)return json({ok:false,error:"Add grading boundaries to this grading scheme before generating report cards."},409);
  const learners=await env.DB.prepare("SELECT l.id,l.admission_number,l.first_name,l.middle_name,l.last_name,l.gender,l.pathway,le.grade_level_id,le.stream_id,gl.stage_name,st.name AS stream_name FROM learner_enrollments le JOIN learners l ON l.id=le.learner_id AND l.school_id=le.school_id JOIN grade_levels gl ON gl.id=le.grade_level_id AND gl.school_id=le.school_id LEFT JOIN streams st ON st.id=le.stream_id AND st.school_id=le.school_id WHERE le.school_id=? AND le.academic_year_id=? AND le.grade_level_id=? AND (? IS NULL OR le.stream_id=?) AND le.status='active' AND l.status='active' ORDER BY l.last_name,l.first_name").bind(schoolId,yearId,gradeId,streamId,streamId).all();
  const cohort=learners.results||[];if(!cohort.length)return json({ok:false,error:"No active learners are enrolled in the selected class."},409);
  const marks=await env.DB.prepare("SELECT ar.learner_id,la.id AS learning_area_id,la.name AS learning_area,a.title AS assessment_title,a.max_score,a.weight,ar.score,ar.feedback FROM assessment_results ar JOIN assessments a ON a.id=ar.assessment_id AND a.school_id=ar.school_id JOIN learning_areas la ON la.id=a.learning_area_id AND la.school_id=a.school_id WHERE ar.school_id=? AND a.academic_year_id=? AND (a.term_id IS ? OR a.term_id IS NULL) AND a.grade_level_id=? AND (a.stream_id IS NULL OR a.stream_id IS ?) ORDER BY la.name,a.title").bind(schoolId,yearId,termId,gradeId,streamId).all();
  const byLearner=new Map();for(const row of marks.results||[]){if(!byLearner.has(row.learner_id))byLearner.set(row.learner_id,[]);byLearner.get(row.learner_id).push(row)}
  const gradeFor=score=>(boundaries.results||[]).find(x=>score>=Number(x.min_score)&&score<=Number(x.max_score))||null;
  const teacherRows=await env.DB.prepare("SELECT ta.learning_area_id,ta.pathway,COALESCE(u.full_name,sp.staff_number,'') AS teacher_name FROM teacher_allocations ta JOIN staff_profiles sp ON sp.id=ta.staff_id AND sp.school_id=ta.school_id LEFT JOIN users u ON u.id=sp.user_id WHERE ta.school_id=? AND ta.academic_year_id=? AND ta.grade_level_id=? AND (ta.stream_id IS NULL OR ta.stream_id=?) AND (ta.term_id IS NULL OR ta.term_id IS ?)").bind(schoolId,yearId,gradeId,streamId,termId).all();
  const teacherByArea=new Map((teacherRows.results||[]).map(x=>[x.learning_area_id+":"+(x.pathway||""),x.teacher_name]));
  const updates=[];
  for(const learner of cohort){
   const rows=byLearner.get(learner.id)||[],groups=new Map();
   for(const r of rows){const key=r.learning_area;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}
   const learningAreas=[];
   for(const [name,assessments] of groups){let weighted=0,totalWeight=0;for(const a of assessments){const max=Number(a.max_score)||0,w=Number(a.weight)||1;if(max>0&&a.score!==null){weighted+=(Number(a.score)/max*100)*w;totalWeight+=w}}if(totalWeight){const score=Math.round(weighted/totalWeight*100)/100,g=gradeFor(score);const areaId=assessments[0]?.learning_area_id,teacherName=teacherByArea.get(areaId+":"+(learner.pathway||""))||teacherByArea.get(areaId+":")||"";learningAreas.push({name,score,grade:g?.rubric||g?.label||"—",points:g?.points??null,descriptor:g?.descriptor||"",remark:g?.remark||"",assessments:assessments.length,teacherName,teacherInitials:teacherName.split(/\s+/).filter(Boolean).slice(0,3).map(x=>x[0]).join("").toUpperCase(),teacherComment:assessments.map(x=>x.feedback).filter(Boolean).slice(0,2).join(" · ")})}}
   const overall=learningAreas.length?Math.round(learningAreas.reduce((sum,x)=>sum+x.score,0)/learningAreas.length*100)/100:null,overallGrade=overall===null?null:gradeFor(overall);
   const data={school:{name:schoolInfo?.name||"",phone:schoolInfo?.phone||schoolInfo?.telephone||"",email:schoolInfo?.email||"",website:schoolInfo?.website||"",address:schoolInfo?.address||schoolInfo?.postal_address||"",county:schoolInfo?.county||"",subCounty:schoolInfo?.sub_county||schoolInfo?.subcounty||""},learner:{id:learner.id,admissionNumber:learner.admission_number,name:[learner.first_name,learner.middle_name,learner.last_name].filter(Boolean).join(" "),grade:(String(grade.curriculum||'').toLowerCase().includes('cbe')||String(grade.curriculum||'').toLowerCase().includes('cbc')||String(grade.curriculum||'').toLowerCase().includes('competency'))?String(learner.stage_name||grade.stage_name||'').replace(/^Grade\s+/i,'Class '):(learner.stage_name||grade.stage_name),stream:learner.stream_name||"",gender:learner.gender||"",profilePhotoUrl:"/api/learner-photos/"+encodeURIComponent(learner.id)+"?schoolId="+encodeURIComponent(schoolId)},academicYear:year.name,term:termInfo?.name||"All terms",termId,gradingScheme:scheme.name,learningAreas,overallScore:overall,overallGrade:overallGrade?.label||"—",overallPoints:overallGrade?.points??null,comments:{classTeacher:"",dos:"",principal:""},generatedAt:new Date().toISOString()};
   const existing=await env.DB.prepare("SELECT id FROM report_cards WHERE school_id=? AND learner_id=? AND academic_year_id=? AND term_id IS ? LIMIT 1").bind(schoolId,learner.id,yearId,termId).first();
   if(existing)updates.push(env.DB.prepare("UPDATE report_cards SET report_data_json=?,status='draft',published_at=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND school_id=?").bind(JSON.stringify(data),existing.id,schoolId));
   else updates.push(env.DB.prepare("INSERT INTO report_cards(id,school_id,learner_id,academic_year_id,term_id,report_data_json,status,created_by) VALUES(?,?,?,?,?,?,'draft',?)").bind(id(),schoolId,learner.id,yearId,termId,JSON.stringify(data),actor.id));
  }
  await env.DB.batch(updates);
  return json({ok:true,generated:cohort.length,withMarks:cohort.filter(x=>(byLearner.get(x.id)||[]).length>0).length,message:"Generated "+cohort.length+" draft report cards using "+scheme.name+"."},201);
 }catch(e){console.error("Report card generation",e);return json({ok:false,error:"Report cards could not be generated. Check that the grading and assessment tables are installed."},500)}
}
