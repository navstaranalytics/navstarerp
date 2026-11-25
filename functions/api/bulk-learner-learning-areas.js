import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const id=()=>crypto.randomUUID();
const norm=v=>String(v||"").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g," ").trim();
function parse(text){const rows=[];let row=[],field="",quoted=false;for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1];if(quoted){if(ch==='"'&&next==='"'){field+='"';i++}else if(ch==='"')quoted=false;else field+=ch}else if(ch==='"')quoted=true;else if(ch===","){row.push(field.trim());field=""}else if(ch==="\n"){row.push(field.trim());if(row.some(x=>x!==""))rows.push(row);row=[];field=""}else if(ch!=="\r")field+=ch}if(quoted)throw new Error("CSV has an unclosed quotation mark.");if(field!==""||row.length){row.push(field.trim());if(row.some(x=>x!==""))rows.push(row)}if(!rows.length)return[];const headers=rows.shift().map(x=>x.replace(/^\uFEFF/,"").trim().toLowerCase());if(new Set(headers).size!==headers.length)throw new Error("Duplicate CSV headings are not allowed.");return rows.map(v=>Object.fromEntries(headers.map((h,i)=>[h,String(v[i]??"").trim()])))}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const actor=await getAuthenticatedSession(request,env);if(!actor)return json({ok:false,error:"Sign in to continue."},401);
 if(!actor.is_super_admin&&!(actor.permissions||[]).some(x=>["academics.manage","allocations.manage","learners.manage"].includes(x)))return json({ok:false,error:"You cannot allocate learner learning areas."},403);
 const schoolId=actor.is_super_admin?new URL(request.url).searchParams.get("schoolId"):actor.school_id;if(!schoolId)return json({ok:false,error:"School workspace is required."},400);
 const raw=await request.text();if(raw.length>10_000_000)return json({ok:false,error:"CSV exceeds 10 MB."},413);
 let rows;try{rows=parse(raw)}catch(e){return json({ok:false,error:e.message},400)}
 if(!rows.length||rows.length>5000)return json({ok:false,error:"Upload between 1 and 5,000 rows."},400);
 const required=["admission_number","learner_name","academic_year","grade","learning_areas"],missing=required.filter(x=>!Object.keys(rows[0]).includes(x));if(missing.length)return json({ok:false,error:"Missing columns: "+missing.join(", ")},400);
 let learners,grades,years,areas,enrolments,streams;
 try{[learners,grades,years,areas,enrolments,streams]=await Promise.all([
  env.DB.prepare("SELECT id,admission_number,first_name,middle_name,last_name,pathway FROM learners WHERE school_id=?").bind(schoolId).all(),
  env.DB.prepare("SELECT id,curriculum,stage_code,stage_name,school_level FROM grade_levels WHERE school_id=? AND is_active=1").bind(schoolId).all(),
  env.DB.prepare("SELECT id,name FROM academic_years WHERE school_id=?").bind(schoolId).all(),
  env.DB.prepare("SELECT id,curriculum,stage_code,code,catalogue_code,name,pathway,is_mandatory,is_active FROM learning_areas WHERE school_id=? AND is_active=1").bind(schoolId).all(),
  env.DB.prepare("SELECT id,learner_id,academic_year_id,grade_level_id,stream_id FROM learner_enrollments WHERE school_id=? AND status='active'").bind(schoolId).all(),
  env.DB.prepare("SELECT id,grade_level_id,name,status FROM streams WHERE school_id=?").bind(schoolId).all()
 ])}catch(e){console.error("Learner learning-area allocation lookup",e);return json({ok:false,error:"School enrolment and learning-area data could not be loaded."},500)}
 const learnerMap=new Map((learners.results||[]).map(x=>[norm(x.admission_number),x])),gradeRows=grades.results||[],yearRows=years.results||[],areaRows=areas.results||[],enrollmentRows=enrolments.results||[],streamRows=streams.results||[];
 const problems=[],prepared=[],seen=new Set();
 for(let i=0;i<rows.length;i++){
  const r=rows[i],line=i+2,learner=learnerMap.get(norm(r.admission_number));
  if(!learner){problems.push({row:line,error:"Admission number does not match a learner in this school."});continue}
  const full=[learner.first_name,learner.middle_name,learner.last_name].filter(Boolean).join(" ");
  if(norm(full)!==norm(r.learner_name)){problems.push({row:line,error:"Learner name does not match admission number. Expected: "+full});continue}
  const year=yearRows.find(x=>norm(x.name)===norm(r.academic_year));if(!year){problems.push({row:line,error:"Academic year was not found."});continue}
  const matches=gradeRows.filter(g=>(norm(g.stage_name)===norm(r.grade)||norm(g.stage_code)===norm(r.grade))&&(!r.curriculum||norm(g.curriculum)===norm(r.curriculum)));
  if(matches.length!==1){problems.push({row:line,error:matches.length?"Class is ambiguous; specify curriculum.":"Active class was not found."});continue}
  const grade=matches[0],isCbe=/cbe|cbc|competency/i.test(grade.curriculum||""),senior=/senior|secondary/i.test(grade.school_level||"")||/^G1[0-2]$/i.test(grade.stage_code||""),usesPath=isCbe&&senior,pathway=String(r.pathway||learner.pathway||"").trim();
  if(usesPath&&!["STEM","Social Sciences","Arts & Sports Science"].includes(pathway)){problems.push({row:line,error:"A CBE Senior School pathway is required."});continue}
  if(!usesPath&&(r.pathway||learner.pathway)){problems.push({row:line,error:"Pathway must be blank for 8-4-4 and non-Senior CBE classes."});continue}
  const enrollment=enrollmentRows.find(x=>x.learner_id===learner.id&&x.academic_year_id===year.id&&x.grade_level_id===grade.id);
  if(!enrollment){problems.push({row:line,error:"This learner has no active enrolment in the selected academic year and class."});continue}
  if(r.stream){const stream=streamRows.find(x=>x.grade_level_id===grade.id&&norm(x.name)===norm(r.stream)&&x.status==="active");if(!stream||stream.id!==enrollment.stream_id){problems.push({row:line,error:"Stream does not match the learner's active class enrolment."});continue}}
  const key=enrollment.id;if(seen.has(key)){problems.push({row:line,error:"Duplicate learner enrolment in this upload."});continue}seen.add(key);
  const wanted=String(r.learning_areas||"").split(/[;|]/).map(x=>x.trim()).filter(Boolean);if(!wanted.length){problems.push({row:line,error:"Enter at least one learning area using the exact offered names."});continue}
  const pathNorm=norm(pathway),selected=[];
  let invalid=false;
  for(const name of wanted){const match=areaRows.find(a=>a.curriculum===grade.curriculum&&a.stage_code===grade.stage_code&&norm(a.name)===norm(name)&&(!norm(a.pathway)||["all","all pathways"].includes(norm(a.pathway))||norm(a.pathway)===pathNorm));
   if(!match){problems.push({row:line,error:"'"+name+"' is not an active learning area offered for this class and pathway."});invalid=true;break}selected.push(match)}
  if(invalid)continue;
  prepared.push({enrollmentId:enrollment.id,learnerId:learner.id,areas:selected});
 }
 if(problems.length)return json({ok:false,imported:0,failed:problems.length,problems,message:"No learner learning-area changes were saved. Correct the highlighted rows and upload again."},422);
 try{
  const statements=[];for(const x of prepared)for(const a of x.areas)statements.push(env.DB.prepare("INSERT INTO learner_learning_areas(id,school_id,enrollment_id,learner_id,learning_area_id,selection_type,status) VALUES(?,?,?,?,?,?, 'active') ON CONFLICT(enrollment_id,learning_area_id) DO UPDATE SET status='active',selection_type=excluded.selection_type").bind(id(),schoolId,x.enrollmentId,x.learnerId,a.id,Number(a.is_mandatory)===1?"mandatory":"elective"));
  for(let i=0;i<statements.length;i+=80)await env.DB.batch(statements.slice(i,i+80));
  return json({ok:true,imported:prepared.length,assignments:statements.length,failed:0,message:"Learning areas allocated to "+prepared.length+" learners. "+statements.length+" subject assignments saved."},201);
 }catch(e){console.error("Bulk learner learning-area allocation",e);return json({ok:false,error:"Learning-area assignments could not be saved. Check the allocation list before retrying."},500)}
}
