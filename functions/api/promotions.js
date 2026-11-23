import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const id=()=>crypto.randomUUID();
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Database is unavailable."},503);
 const user=await getAuthenticatedSession(request,env);
 if(!user)return json({ok:false,error:"An active session is required."},401);
 if(!user.is_super_admin&&!user.permissions?.includes("learners.manage"))return json({ok:false,error:"You do not have permission to promote learners."},403);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid promotion request."},400)}
 const schoolId=user.school_id,fromId=String(body.fromEnrollmentId||""),yearId=String(body.nextAcademicYearId||""),streamId=body.streamId?String(body.streamId):null,note=String(body.note||"").trim().slice(0,500);
 if(!schoolId||!fromId||!yearId)return json({ok:false,error:"Current enrolment and next academic year are required."},400);
 try{
  const from=await env.DB.prepare("SELECT le.*,gl.stage_code,gl.stage_name FROM learner_enrollments le JOIN grade_levels gl ON gl.id=le.grade_level_id AND gl.school_id=le.school_id WHERE le.id=? AND le.school_id=? AND le.status='active'").bind(fromId,schoolId).first();
  if(!from)return json({ok:false,error:"The learner's current active enrolment was not found."},404);
  const policy=await env.DB.prepare("SELECT * FROM learner_promotion_policies WHERE school_id=? AND from_grade_id=? AND is_active=1").bind(schoolId,from.grade_level_id).first();
  if(!policy)return json({ok:false,error:"Set an active promotion policy for this current grade before promoting learners."},400);
  const target=await env.DB.prepare("SELECT id,stage_code,stage_name,is_active FROM grade_levels WHERE id=? AND school_id=?").bind(policy.to_grade_id,schoolId).first();
  if(!target||Number(target.is_active)!==1)return json({ok:false,error:"The next grade in the promotion policy is not active."},400);
  const year=await env.DB.prepare("SELECT id,status FROM academic_years WHERE id=? AND school_id=?").bind(yearId,schoolId).first();
  if(!year)return json({ok:false,error:"Choose an academic year belonging to this school."},400);
  const existing=await env.DB.prepare("SELECT id FROM learner_enrollments WHERE learner_id=? AND school_id=? AND academic_year_id=?").bind(from.learner_id,schoolId,yearId).first();
  if(existing)return json({ok:false,error:"This learner already has an enrolment in the selected academic year."},409);
  if(streamId){const stream=await env.DB.prepare("SELECT id FROM streams WHERE id=? AND school_id=? AND grade_level_id=? AND status='active'").bind(streamId,schoolId,target.id).first();if(!stream)return json({ok:false,error:"Choose an active stream belonging to the promoted grade."},400);}
  const scores=await env.DB.prepare("SELECT ar.score,a.max_score FROM assessment_results ar JOIN assessments a ON a.id=ar.assessment_id AND a.school_id=ar.school_id WHERE ar.school_id=? AND ar.learner_id=? AND a.academic_year_id=? AND a.grade_level_id=? AND ar.score IS NOT NULL").bind(schoolId,from.learner_id,from.academic_year_id,from.grade_level_id).all();
  const results=scores.results||[];
  if(!results.length)return json({ok:false,error:"No recorded assessment marks were found for this learner in the current grade. Promotion cannot be evaluated yet."},400);
  const average=results.reduce((sum,x)=>sum+(Number(x.score)/Math.max(1,Number(x.max_score)||100))*100,0)/results.length;
  if(average<Number(policy.minimum_average))return json({ok:false,error:"Learner average is "+average.toFixed(1)+"%, below the promotion minimum of "+Number(policy.minimum_average)+"%."},400);
  const nextId=id(),historyId=id();
  await env.DB.batch([
   env.DB.prepare("INSERT INTO learner_enrollments(id,school_id,learner_id,academic_year_id,grade_level_id,stream_id,status) VALUES(?,?,?,?,?,?,'active')").bind(nextId,schoolId,from.learner_id,yearId,target.id,streamId),
   env.DB.prepare("UPDATE learner_enrollments SET status='completed' WHERE id=? AND school_id=?").bind(fromId,schoolId),
   env.DB.prepare("INSERT INTO learner_promotion_history(id,school_id,learner_id,from_enrollment_id,to_enrollment_id,from_grade_id,to_grade_id,academic_year_id,average_score,decision,note,promoted_by) VALUES(?,?,?,?,?,?,?,?,?,'promoted',?,?)").bind(historyId,schoolId,from.learner_id,fromId,nextId,from.grade_level_id,target.id,yearId,average,note||null,user.id)
  ]);
  const mandatory=await env.DB.prepare("SELECT id FROM learning_areas WHERE school_id=? AND stage_code=? AND is_active=1 AND is_mandatory=1").bind(schoolId,target.stage_code).all();
  if(mandatory.results?.length)await env.DB.batch(mandatory.results.map(x=>env.DB.prepare("INSERT OR IGNORE INTO learner_learning_areas(id,school_id,enrollment_id,learner_id,learning_area_id,selection_type,status) VALUES(?,?,?,?,?,'mandatory','active')").bind(id(),schoolId,nextId,from.learner_id,x.id)));
  return json({ok:true,promotion:{id:historyId,learnerId:from.learner_id,fromGrade:from.stage_name,toGrade:target.stage_name,average:Number(average.toFixed(2)),newEnrollmentId:nextId},message:"Learner promoted. Previous assessment records remain attached to the completed enrolment and original academic year."},201);
 }catch(error){console.error("Navstar learner promotion",error);return json({ok:false,error:"Promotion could not be completed. No marks or historical assessment records have been deleted."},500)}
}
