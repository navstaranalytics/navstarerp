import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const id=()=>crypto.randomUUID();
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
 return rows.map((values,index)=>Object.fromEntries(headers.map((h,i)=>[h,String(values[i]??"").trim()])).map(([k,v])=>[k,v]));
}
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const actor=await getAuthenticatedSession(request,env);
 if(!actor)return json({ok:false,error:"Sign in to continue."},401);
 if(actor.is_super_admin===false&&!actor.permissions.includes("learners.manage"))return json({ok:false,error:"Your role cannot bulk register learners."},403);
 const schoolId=actor.school_id||new URL(request.url).searchParams.get("schoolId");
 if(!schoolId)return json({ok:false,error:"School workspace is required."},400);
 const raw=await request.text();if(raw.length>1_500_000)return json({ok:false,error:"CSV file exceeds the 1.5 MB import limit."},413);
 let rows;try{rows=parseCsv(raw)}catch(e){return json({ok:false,error:e.message},400)}
 if(!rows.length)return json({ok:false,error:"The CSV file has no learner rows."},400);
 if(rows.length>500)return json({ok:false,error:"Import up to 500 learners per file."},413);
 const required=["admission_number","first_name","last_name","academic_year","grade"];
 const missing=required.filter(k=>!Object.keys(rows[0]).includes(k));
 if(missing.length)return json({ok:false,error:"Missing required columns: "+missing.join(", ")},400);
 const problems=[],prepared=[],seen=new Set();
 for(let i=0;i<rows.length;i++){
  const r=rows[i],line=i+2,admission=r.admission_number.trim(),first=r.first_name.trim(),last=r.last_name.trim();
  if(!admission||!first||!last){problems.push({row:line,error:"Admission number, first name and last name are required."});continue}
  const duplicate=admission.toLowerCase();if(seen.has(duplicate)){problems.push({row:line,error:"Duplicate admission number in this CSV."});continue}seen.add(duplicate);
  if(!["","male","female","other"].includes((r.gender||"").toLowerCase())){problems.push({row:line,error:"Gender must be Male, Female, Other or blank."});continue}
  if(r.status&&!["applicant","active","transferred","graduated","withdrawn","inactive"].includes(r.status.toLowerCase())){problems.push({row:line,error:"Status must be applicant, active, transferred, graduated, withdrawn or inactive."});continue}
  if(r.pathway&&!["STEM","Social Sciences","Arts & Sports Science"].includes(r.pathway)){problems.push({row:line,error:"Pathway must be STEM, Social Sciences or Arts & Sports Science."});continue}
  const year=await env.DB.prepare("SELECT id FROM academic_years WHERE school_id=? AND lower(name)=lower(?)").bind(schoolId,r.academic_year).first();
  const grade=await env.DB.prepare("SELECT id FROM grade_levels WHERE school_id=? AND (lower(stage_name)=lower(?) OR lower(stage_code)=lower(?)) AND is_active=1").bind(schoolId,r.grade,r.grade).first();
  if(!year){problems.push({row:line,error:"Academic year '"+r.academic_year+"' was not found."});continue}
  if(!grade){problems.push({row:line,error:"Grade '"+r.grade+"' was not found or is inactive."});continue}
  let streamId=null;
  if(r.stream){const stream=await env.DB.prepare("SELECT id FROM streams WHERE school_id=? AND grade_level_id=? AND lower(name)=lower(?) AND status='active'").bind(schoolId,grade.id,r.stream).first();if(!stream){problems.push({row:line,error:"Stream '"+r.stream+"' was not found in the selected grade."});continue}streamId=stream.id}
  if(r.date_of_birth&&!/^\d{4}-\d{2}-\d{2}$/.test(r.date_of_birth)){problems.push({row:line,error:"Date of birth must use YYYY-MM-DD."});continue}
  const existing=await env.DB.prepare("SELECT 1 FROM learners WHERE school_id=? AND admission_number=?").bind(schoolId,admission).first();
  if(existing){problems.push({row:line,error:"Admission number already exists in this school."});continue}
  prepared.push({learnerId:id(),enrollmentId:id(),admission,first,middle:r.middle_name||null,last,gender:r.gender||null,dob:r.date_of_birth||null,status:r.status||"active",pathway:r.pathway||null,yearId:year.id,gradeId:grade.id,streamId,line});
 }
 if(problems.length)return json({ok:false,imported:0,failed:problems.length,problems,message:"No records were imported. Correct the listed rows and upload the CSV again."},422);
 try{
  const statements=[];
  for(const x of prepared){
   statements.push(env.DB.prepare("INSERT INTO learners(id,school_id,admission_number,first_name,middle_name,last_name,gender,date_of_birth,status,pathway,profile_json) VALUES(?,?,?,?,?,?,?,?,?,?, '{}')").bind(x.learnerId,schoolId,x.admission,x.first,x.middle,x.last,x.gender,x.dob,x.status,x.pathway));
   statements.push(env.DB.prepare("INSERT INTO learner_enrollments(id,school_id,learner_id,academic_year_id,grade_level_id,stream_id,status) VALUES(?,?,?,?,?,?, 'active')").bind(x.enrollmentId,schoolId,x.learnerId,x.yearId,x.gradeId,x.streamId));
  }
  await env.DB.batch(statements);
  return json({ok:true,imported:prepared.length,failed:0,message:prepared.length+" learners registered and enrolled successfully."},201);
 }catch(e){console.error("Bulk learner import",e);return json({ok:false,error:"The import could not be saved. No success was reported; check for duplicate admission numbers and retry."},500)}
}
