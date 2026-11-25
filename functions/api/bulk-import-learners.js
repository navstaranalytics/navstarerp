import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const id=()=>crypto.randomUUID();
const MAX_ROWS=5000,MAX_BYTES=10_000_000,WRITE_CHUNK=40;
const admissionTable="CREATE TABLE IF NOT EXISTS school_admission_settings (school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,prefix TEXT NOT NULL DEFAULT '',separator TEXT NOT NULL DEFAULT '-',next_number INTEGER NOT NULL DEFAULT 1,padding INTEGER NOT NULL DEFAULT 4,include_year INTEGER NOT NULL DEFAULT 0,updated_by TEXT,updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))";
function makeAdmission(s,n){const number=String(n).padStart(Math.max(1,Math.min(10,Number(s.padding)||4)),"0"),year=Number(s.include_year)?String(new Date().getFullYear()):"";return [String(s.prefix||"").trim(),year,number].filter(Boolean).join(s.separator===undefined?"-":String(s.separator))}
async function allocateAdmission(db,schoolId,actorId){await db.prepare(admissionTable).run();await db.prepare("INSERT OR IGNORE INTO school_admission_settings(school_id,prefix,separator,next_number,padding,include_year,updated_by) VALUES(?,'','-',1,4,0,?)").bind(schoolId,actorId).run();for(let n=0;n<25;n++){const s=await db.prepare("UPDATE school_admission_settings SET next_number=next_number+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE school_id=? RETURNING prefix,separator,next_number-1 AS issued,padding,include_year").bind(actorId,schoolId).first();if(!s)break;const number=makeAdmission(s,Number(s.issued)||1);const exists=await db.prepare("SELECT 1 FROM learners WHERE school_id=? AND lower(admission_number)=lower(?)").bind(schoolId,number).first();if(!exists)return number;}throw new Error("Could not issue a unique admission number. Check the school admission-number settings.")}
async function ensureLearnerIdentifierColumns(db){
 const info=await db.prepare("PRAGMA table_info(learners)").all();
 const columns=new Set((info.results||[]).map(x=>x.name));
 if(!columns.has("assessment_number"))await db.prepare("ALTER TABLE learners ADD COLUMN assessment_number TEXT").run();
 if(!columns.has("upi_number"))await db.prepare("ALTER TABLE learners ADD COLUMN upi_number TEXT").run();
 if(!columns.has("nemis_number"))await db.prepare("ALTER TABLE learners ADD COLUMN nemis_number TEXT").run();
}
function parseCsv(text){
 const rows=[];let row=[],field="",quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1];
  if(quoted){if(ch==='"'&&next==='"'){field+='"';i++}else if(ch==='"')quoted=false;else field+=ch}
  else if(ch==='"')quoted=true;
  else if(ch===","){row.push(field.trim());field=""}
  else if(ch==="\n"){row.push(field.trim());if(row.some(x=>x!==""))rows.push(row);row=[];field=""}
  else if(ch!=="\r")field+=ch;
 }
 if(quoted)throw new Error("The CSV contains an unclosed quotation mark.");
 if(field!==""||row.length){row.push(field.trim());if(row.some(x=>x!==""))rows.push(row)}
 if(!rows.length)return [];
 const headers=rows.shift().map(x=>x.replace(/^\uFEFF/,"").trim().toLowerCase());
 if(new Set(headers).size!==headers.length)throw new Error("The CSV contains duplicate column headings.");
 return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,String(values[i]??"").trim()])));
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const actor=await getAuthenticatedSession(request,env);
 if(!actor)return json({ok:false,error:"Sign in to continue."},401);
 if(!actor.is_super_admin&&!(actor.permissions||[]).includes("learners.manage"))return json({ok:false,error:"Your role cannot bulk register learners."},403);
 const schoolId=actor.school_id||new URL(request.url).searchParams.get("schoolId");
 try{await ensureLearnerIdentifierColumns(env.DB)}catch(error){console.error("Learner identifier schema",error);return json({ok:false,error:"Learner registration fields are not ready. Please contact support."},500)}
 if(!schoolId)return json({ok:false,error:"School workspace is required."},400);
 const raw=await request.text();
 if(raw.length>MAX_BYTES)return json({ok:false,error:"CSV file exceeds the 10 MB import limit."},413);
 let rows;try{rows=parseCsv(raw)}catch(e){return json({ok:false,error:e.message},400)}
 if(!rows.length)return json({ok:false,error:"The CSV file has no learner rows."},400);
 if(rows.length>MAX_ROWS)return json({ok:false,error:"Import up to 5,000 learners per file. Split larger lists into separate files."},413);
 const required=["first_name","last_name","academic_year","grade"];
 const missing=required.filter(k=>!Object.keys(rows[0]).includes(k));
 if(missing.length)return json({ok:false,error:"Missing required columns: "+missing.join(", ")},400);
 let years,grades,streams,existing,areas;
 try{
  [years,grades,streams,existing]=await Promise.all([
   env.DB.prepare("SELECT id,name FROM academic_years WHERE school_id=?").bind(schoolId).all(),
   env.DB.prepare("SELECT id,stage_name,stage_code,curriculum,school_level FROM grade_levels WHERE school_id=? AND is_active=1").bind(schoolId).all(),
   env.DB.prepare("SELECT id,grade_level_id,name FROM streams WHERE school_id=? AND status='active'").bind(schoolId).all(),
   env.DB.prepare("SELECT lower(admission_number) AS admission_number,lower(COALESCE(assessment_number,'')) AS assessment_number,lower(COALESCE(upi_number,'')) AS upi_number FROM learners WHERE school_id=?").bind(schoolId).all(),
   env.DB.prepare("SELECT id,name,stage_code,curriculum,pathway,is_mandatory FROM learning_areas WHERE school_id=? AND is_active=1").bind(schoolId).all()
  ]);
 }catch(e){console.error("Bulk learner import lookup",e);return json({ok:false,error:"School reference data could not be loaded. No learners were imported."},500)}
 const yearMap=new Map((years.results||[]).map(x=>[String(x.name).toLowerCase(),x]));
 const gradeRows=grades.results||[];
 const streamMap=new Map((streams.results||[]).map(x=>[x.grade_level_id+":"+String(x.name).toLowerCase(),x]));
 const existingAdmissions=new Set((existing.results||[]).map(x=>x.admission_number));
 const existingAssessment=new Set((existing.results||[]).map(x=>x.assessment_number).filter(Boolean));
 const existingUpi=new Set((existing.results||[]).map(x=>x.upi_number).filter(Boolean));
 const problems=[],prepared=[],seen=new Set(),seenAssessment=new Set(),seenUpi=new Set();
 for(let i=0;i<rows.length;i++){
  const r=rows[i],line=i+2,admission=(r.admission_number||"").trim(),first=(r.first_name||"").trim(),last=(r.last_name||"").trim();
  if(!first||!last){problems.push({row:line,error:"First name and last name are required. Admission numbers are generated by the school system."});continue}
  const assessment=(r.assessment_number||"").trim(),upi=(r.upi_number||"").trim(),nemis=(r.nemis_number||"").trim();
  const duplicate=admission.toLowerCase();if(admission&&seen.has(duplicate)){problems.push({row:line,error:"Duplicate admission number in this CSV."});continue}if(admission)seen.add(duplicate);
  if(admission&&existingAdmissions.has(duplicate)){problems.push({row:line,error:"Admission number already exists in this school. Leave this field blank to have one generated."});continue}
  if(assessment){const key=assessment.toLowerCase();if(seenAssessment.has(key)||existingAssessment.has(key)){problems.push({row:line,error:"Assessment number already exists in this school or is duplicated in this CSV."});continue}seenAssessment.add(key)}
  if(upi){const key=upi.toLowerCase();if(seenUpi.has(key)||existingUpi.has(key)){problems.push({row:line,error:"UPI number already exists in this school or is duplicated in this CSV."});continue}seenUpi.add(key)}
  if(!["","male","female","other"].includes((r.gender||"").toLowerCase())){problems.push({row:line,error:"Gender must be Male, Female, Other or blank."});continue}
  if(r.status&&!["applicant","active","transferred","graduated","withdrawn","inactive"].includes(r.status.toLowerCase())){problems.push({row:line,error:"Status must be applicant, active, transferred, graduated, withdrawn or inactive."});continue}
  if(r.pathway&&!["STEM","Social Sciences","Arts & Sports Science"].includes(r.pathway)){problems.push({row:line,error:"Pathway must be STEM, Social Sciences or Arts & Sports Science."});continue}
  const year=yearMap.get((r.academic_year||"").toLowerCase());
  const className=String(r.grade||"").trim().toLowerCase(),curriculumName=String(r.curriculum||"").trim().toLowerCase();
  const matches=gradeRows.filter(x=>(String(x.stage_name||"").trim().toLowerCase()===className||String(x.stage_code||"").trim().toLowerCase()===className)&&(!curriculumName||String(x.curriculum||"").trim().toLowerCase()===curriculumName));
  if(!year){problems.push({row:line,error:"Academic year '"+r.academic_year+"' was not found."});continue}
  if(!matches.length){problems.push({row:line,error:"Class '"+r.grade+"'"+(r.curriculum?" in curriculum '"+r.curriculum+"'":"")+" was not found or is inactive. Download a fresh school-generated template to get the correct class and curriculum values."});continue}
  if(matches.length>1){const curricula=[...new Set(matches.map(x=>x.curriculum).filter(Boolean))];problems.push({row:line,error:"Class '"+r.grade+"' is ambiguous because it exists under more than one curriculum ("+curricula.join(", ")+"). Add the curriculum column or download the latest school-generated template, which includes it."});continue}
  const grade=matches[0],curriculumKey=String(grade.curriculum||"").toLowerCase(),stageKey=String(grade.stage_code||"").toUpperCase(),schoolLevel=String(grade.school_level||"").toLowerCase(),senior=/senior|secondary/.test(schoolLevel)||/^G1[0-2]$/.test(stageKey),cbe=curriculumKey.includes("cbe")||curriculumKey.includes("cbc")||curriculumKey.includes("competency"),usesPathways=senior&&cbe;
  if(usesPathways&&!r.pathway){problems.push({row:line,error:"This is a CBE Senior School class. Select the learner’s STEM, Social Sciences or Arts & Sports Science pathway."});continue}
  if(!usesPathways&&r.pathway){problems.push({row:line,error:"Pathways apply only to CBE Senior School. Leave the pathway column blank for Primary, Junior and other curricula."});continue}
  let streamId=null;
  if(r.stream){const stream=streamMap.get(grade.id+":"+r.stream.toLowerCase());if(!stream){const available=(streams.results||[]).filter(s=>s.grade_level_id===grade.id).map(s=>s.name);const detail=available.length?"Available streams in this class: "+available.join(", ")+".":"This class has no active streams; leave the stream column blank or create a stream for this class first.";problems.push({row:line,error:"Stream '"+r.stream+"' was not found in class '"+(grade.stage_name||r.grade)+"'. "+detail+" Download a fresh school-generated learner CSV template to use the correct class/stream pairs."});continue}streamId=stream.id}
  if(r.date_of_birth&&!/^\d{4}-\d{2}-\d{2}$/.test(r.date_of_birth)){problems.push({row:line,error:"Date of birth must use YYYY-MM-DD."});continue}
  const norm=v=>String(v||"").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g," ").trim(),path=norm(r.pathway),gradeAreas=(areas.results||[]).filter(a=>a.stage_code===grade.stage_code&&a.curriculum===grade.curriculum),compulsoryAreas=gradeAreas.filter(a=>Number(a.is_mandatory)===1&&(!norm(a.pathway)||["all","all pathways"].includes(norm(a.pathway))||norm(a.pathway)===path)).map(a=>a.id),electiveNames=String(r.elective_learning_areas||"").split(/[;|]/).map(x=>x.trim()).filter(Boolean),electiveAreas=[];for(const name of electiveNames){const match=gradeAreas.find(a=>Number(a.is_mandatory)!==1&&String(a.name||"").toLowerCase()===name.toLowerCase()&&(!norm(a.pathway)||["all","all pathways"].includes(norm(a.pathway))||norm(a.pathway)===path));if(!match){problems.push({row:line,error:"Elective learning area '"+name+"' is not configured as an active elective for this class and pathway."});break}electiveAreas.push(match.id)}if(problems.some(p=>p.row===line))continue;prepared.push({learnerId:id(),enrollmentId:id(),admission:"",assessment,upi,nemis,first,middle:r.middle_name||null,last,gender:r.gender||null,dob:r.date_of_birth||null,status:(r.status||"active").toLowerCase(),pathway:r.pathway||null,yearId:year.id,gradeId:grade.id,streamId,compulsoryAreas,electiveAreas});
 }
 if(problems.length)return json({ok:false,imported:0,failed:problems.length,problems,message:"No records were imported. Correct the listed rows and upload the CSV again."},422);
 let imported=0;
 try{
  for(let start=0;start<prepared.length;start+=WRITE_CHUNK){
   const chunk=prepared.slice(start,start+WRITE_CHUNK),statements=[];
   for(const x of chunk){
    x.admission=await allocateAdmission(env.DB,schoolId,actor.id);
    statements.push(env.DB.prepare("INSERT INTO learners(id,school_id,admission_number,assessment_number,upi_number,nemis_number,first_name,middle_name,last_name,gender,date_of_birth,status,pathway,profile_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?, '{}')").bind(x.learnerId,schoolId,x.admission,x.assessment||null,x.upi||null,x.nemis||null,x.first,x.middle,x.last,x.gender,x.dob,x.status,x.pathway));
    statements.push(env.DB.prepare("INSERT INTO learner_enrollments(id,school_id,learner_id,academic_year_id,grade_level_id,stream_id,status) VALUES(?,?,?,?,?,?, 'active')").bind(x.enrollmentId,schoolId,x.learnerId,x.yearId,x.gradeId,x.streamId));
    for(const areaId of [...x.compulsoryAreas,...x.electiveAreas])statements.push(env.DB.prepare("INSERT OR IGNORE INTO learner_learning_areas(id,school_id,enrollment_id,learner_id,learning_area_id,selection_type,selected_by,status) VALUES(?,?,?,?,?,?,?,'active')").bind(id(),schoolId,x.enrollmentId,x.learnerId,areaId,x.compulsoryAreas.includes(areaId)?"mandatory":"elective",x.compulsoryAreas.includes(areaId)?actor.id:actor.id));
   }
   await env.DB.batch(statements);
   const placeholders=chunk.map(()=>"?").join(",");
   const verify=await env.DB.prepare("SELECT COUNT(*) AS total FROM learners WHERE school_id=? AND id IN ("+placeholders+")").bind(schoolId,...chunk.map(x=>x.learnerId)).first();
   if(Number(verify?.total)!==chunk.length)throw new Error("Learner database read-back verification failed for import batch starting at row "+(start+2)+".");
   const enrollmentVerify=await env.DB.prepare("SELECT COUNT(*) AS total FROM learner_enrollments WHERE school_id=? AND id IN ("+chunk.map(()=>"?").join(",")+")").bind(schoolId,...chunk.map(x=>x.enrollmentId)).first();
   if(Number(enrollmentVerify?.total)!==chunk.length)throw new Error("Enrolment database read-back verification failed for import batch starting at row "+(start+2)+".");
   imported+=chunk.length;
  }
  return json({ok:true,imported,failed:0,admissionNumbers:prepared.map(x=>({admission_number:x.admission,first_name:x.first,last_name:x.last})),message:imported+" learners registered and enrolled successfully. Admission numbers were generated by the school system."},201);
 }catch(e){console.error("Bulk learner import",e);return json({ok:false,imported,failed:prepared.length-imported,error:imported?imported+" learners were saved before an error. Check the learner list before retrying; do not upload the same file again yet.":"The import could not be saved. No success was reported; check for duplicate admission numbers and retry."},500)}
}
