import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const id=()=>crypto.randomUUID();
function parse(text){const rows=[];let row=[],field="",quoted=false;for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1];if(quoted){if(ch==='"'&&next==='"'){field+='"';i++}else if(ch==='"')quoted=false;else field+=ch}else if(ch==='"')quoted=true;else if(ch===","){row.push(field.trim());field=""}else if(ch==="\n"){row.push(field.trim());if(row.some(x=>x!==""))rows.push(row);row=[];field=""}else if(ch!=="\r")field+=ch}if(quoted)throw new Error("The CSV contains an unclosed quotation mark.");if(field!==""||row.length){row.push(field.trim());if(row.some(x=>x!==""))rows.push(row)}if(!rows.length)return[];const headers=rows.shift().map(x=>x.replace(/^\uFEFF/,"").trim().toLowerCase());if(new Set(headers).size!==headers.length)throw new Error("Duplicate CSV headings are not allowed.");return rows.map(v=>Object.fromEntries(headers.map((h,i)=>[h,String(v[i]??"").trim()])))}
const norm=v=>String(v||"").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g," ").trim();
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const actor=await getAuthenticatedSession(request,env);if(!actor)return json({ok:false,error:"Sign in to continue."},401);
 if(!actor.is_super_admin&&!(actor.permissions||[]).includes("learners.manage"))return json({ok:false,error:"Your role cannot bulk enrol learners."},403);
 const schoolId=actor.is_super_admin?new URL(request.url).searchParams.get("schoolId"):actor.school_id;if(!schoolId)return json({ok:false,error:"School workspace is required."},400);
 const raw=await request.text();if(raw.length>10_000_000)return json({ok:false,error:"CSV exceeds 10 MB."},413);
 let rows;try{rows=parse(raw)}catch(e){return json({ok:false,error:e.message},400)}
 if(!rows.length||rows.length>5000)return json({ok:false,error:"Upload between 1 and 5,000 enrolment rows."},400);
 const required=["admission_number","academic_year","grade"],missing=required.filter(x=>!Object.keys(rows[0]).includes(x));if(missing.length)return json({ok:false,error:"Missing columns: "+missing.join(", ")},400);
 let learners,years,grades,streams,areas;try{[learners,years,grades,streams,areas]=await Promise.all([
  env.DB.prepare("SELECT id,admission_number,pathway FROM learners WHERE school_id=?").bind(schoolId).all(),
  env.DB.prepare("SELECT id,name FROM academic_years WHERE school_id=?").bind(schoolId).all(),
  env.DB.prepare("SELECT id,stage_name,stage_code,curriculum,school_level FROM grade_levels WHERE school_id=? AND is_active=1").bind(schoolId).all(),
  env.DB.prepare("SELECT id,grade_level_id,name FROM streams WHERE school_id=? AND status='active'").bind(schoolId).all(),
  env.DB.prepare("SELECT id,name,stage_code,curriculum,pathway,is_mandatory FROM learning_areas WHERE school_id=? AND is_active=1").bind(schoolId).all()
 ])}catch(e){console.error("Bulk enrolment lookups",e);return json({ok:false,error:"School reference data could not be loaded. No enrolments were saved."},500)}
 const learnerMap=new Map((learners.results||[]).map(x=>[String(x.admission_number).toLowerCase(),x]));
 const yearMap=new Map((years.results||[]).map(x=>[String(x.name).toLowerCase(),x]));
 const streamRows=streams.results||[],gradeRows=grades.results||[],areaRows=areas.results||[];
 const problems=[],prepared=[],seen=new Set();
 for(let i=0;i<rows.length;i++){
  const r=rows[i],line=i+2,admission=String(r.admission_number||"").trim().toLowerCase(),year=yearMap.get(String(r.academic_year||"").trim().toLowerCase());
  if(!admission||!r.academic_year||!r.grade){problems.push({row:line,error:"Admission number, academic year and class are required."});continue}
  const learner=learnerMap.get(admission);if(!learner){problems.push({row:line,error:"Learner admission number was not found in this school."});continue}
  if(!year){problems.push({row:line,error:"Academic year '"+r.academic_year+"' was not found."});continue}
  const curriculum=norm(r.curriculum),className=norm(r.grade),matches=gradeRows.filter(g=>(norm(g.stage_name)===className||norm(g.stage_code)===className)&&(!curriculum||norm(g.curriculum)===curriculum));
  if(!matches.length){problems.push({row:line,error:"Class was not found or is inactive. Check the class and curriculum columns."});continue}
  if(matches.length>1){problems.push({row:line,error:"Class name is ambiguous across curricula. Supply the exact curriculum column."});continue}
  const grade=matches[0],schoolLevel=String(grade.school_level||"").toLowerCase(),stage=String(grade.stage_code||"").toUpperCase(),isSenior=/senior|secondary/.test(schoolLevel)||/^G1[0-2]$/.test(stage),isCbe=/cbe|cbc|competency/i.test(grade.curriculum||""),needsPath=isSenior&&isCbe,pathway=String(r.pathway||learner.pathway||"").trim();
  if(needsPath&&!["STEM","Social Sciences","Arts & Sports Science"].includes(pathway)){problems.push({row:line,error:"Select STEM, Social Sciences or Arts & Sports Science for this CBE Senior School class."});continue}
  if(!needsPath&&r.pathway){problems.push({row:line,error:"Pathways apply only to CBE Senior School. Leave this field blank."});continue}
  let streamId=null;if(r.stream){const stream=streamRows.find(s=>s.grade_level_id===grade.id&&norm(s.name)===norm(r.stream));if(!stream){problems.push({row:line,error:"Stream '"+r.stream+"' does not belong to the selected class."});continue}streamId=stream.id}
  const key=learner.id+":"+year.id;if(seen.has(key)){problems.push({row:line,error:"This learner and academic year are duplicated in the upload."});continue}seen.add(key);
  const existing=await env.DB.prepare("SELECT 1 FROM learner_enrollments WHERE school_id=? AND learner_id=? AND academic_year_id=? AND status='active'").bind(schoolId,learner.id,year.id).first();if(existing){problems.push({row:line,error:"Learner already has an active enrolment for this academic year."});continue}
  const pathNorm=norm(pathway),gradeAreas=areaRows.filter(a=>a.stage_code===grade.stage_code&&a.curriculum===grade.curriculum),compulsory=gradeAreas.filter(a=>Number(a.is_mandatory)===1&&(!norm(a.pathway)||["all","all pathways"].includes(norm(a.pathway))||norm(a.pathway)===pathNorm)).map(a=>a.id),requested=String(r.elective_learning_areas||"").split(/[;|]/).map(x=>x.trim()).filter(Boolean),electives=[];
  let invalid=false;for(const name of requested){const match=gradeAreas.find(a=>Number(a.is_mandatory)!==1&&norm(a.name)===norm(name)&&(!norm(a.pathway)||["all","all pathways"].includes(norm(a.pathway))||norm(a.pathway)===pathNorm));if(!match){problems.push({row:line,error:"Elective '"+name+"' is not configured for this class and pathway."});invalid=true;break}electives.push(match.id)}if(invalid)continue;
  prepared.push({id:id(),learnerId:learner.id,admission:learner.admission_number,yearId:year.id,gradeId:grade.id,streamId,pathway,compulsory,electives});
 }
 if(problems.length)return json({ok:false,imported:0,failed:problems.length,problems,message:"No enrolments were saved. Correct the highlighted rows and submit again."},422);
 let imported=0;try{for(let start=0;start<prepared.length;start+=40){const chunk=prepared.slice(start,start+40),statements=[];for(const x of chunk){statements.push(env.DB.prepare("INSERT INTO learner_enrollments(id,school_id,learner_id,academic_year_id,grade_level_id,stream_id,status) VALUES(?,?,?,?,?,?,'active')").bind(x.id,schoolId,x.learnerId,x.yearId,x.gradeId,x.streamId));for(const areaId of [...x.compulsory,...x.electives])statements.push(env.DB.prepare("INSERT OR IGNORE INTO learner_learning_areas(id,school_id,enrollment_id,learner_id,learning_area_id,selection_type,selected_by,status) VALUES(?,?,?,?,?,?,?,'active')").bind(id(),schoolId,x.id,x.learnerId,areaId,x.compulsory.includes(areaId)?"compulsory":"elective",x.compulsory.includes(areaId)?"system":"school"))}await env.DB.batch(statements);const check=await env.DB.prepare("SELECT COUNT(*) AS total FROM learner_enrollments WHERE school_id=? AND id IN ("+chunk.map(()=>"?").join(",")+")").bind(schoolId,...chunk.map(x=>x.id)).first();if(Number(check?.total)!==chunk.length)throw new Error("Enrolment verification failed.");imported+=chunk.length}return json({ok:true,imported,failed:0,enrolments:prepared.map(x=>({admission_number:x.admission,learner_id:x.learnerId})),message:imported+" existing learners enrolled successfully. Compulsory learning areas were assigned automatically."},201)}catch(e){console.error("Bulk learner enrolment",e);return json({ok:false,imported,failed:prepared.length-imported,error:imported?imported+" enrolments saved before an error. Check the enrolment list before retrying.":"Enrolments could not be saved. No success was confirmed."},500)}
}
