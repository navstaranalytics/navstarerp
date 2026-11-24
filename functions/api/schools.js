import { sendNavstarEmail } from "../lib/email.js";
import { getSuperAdminSession, hashPassword } from "./auth.js";

const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const clean=v=>String(v??"").trim();
const normStatus=v=>({Active:"active",Pending:"pending",Suspended:"suspended",Archived:"archived",active:"active",pending:"pending",suspended:"suspended",archived:"archived"}[v]||"pending");
const displayStatus=v=>({active:"Active",pending:"Pending",suspended:"Suspended",archived:"Archived"}[v]||"Pending");
const makeId=()=>crypto.randomUUID();
function modulesForLevels(levels){
  const selected=Array.isArray(levels)?levels:[];
  const modules=new Set(["Core","Learners","Staff & HR","Academics","Examinations","Reports","Parent Portal"]);
  if(selected.some(x=>/^Grade (7|8|9)$/.test(String(x))||/^Junior School$/i.test(String(x))))["Junior School","Pathway Planning"].forEach(x=>modules.add(x));
  if(selected.some(x=>/^Grade (10|11|12)$/.test(String(x))||/^Senior School$/i.test(String(x))))["Senior School","Pathway Planning","AI Analytics"].forEach(x=>modules.add(x));
  if(selected.some(x=>/^Form /.test(String(x))))modules.add("Secondary School");
  if(selected.length)modules.add("Attendance");
  return [...modules];
}
async function seedSchoolSampleData(db,schoolId,curriculum,levels){
 const year=new Date().getUTCFullYear(),yearId=makeId(),termIds=[makeId(),makeId(),makeId()];
 const gradeSpecs=[],selected=Array.isArray(levels)?levels:[];
 if(selected.some(x=>/^Pre-Primary$/i.test(x)))gradeSpecs.push(["PP1","PP1",0],["PP2","PP2",1]);
 if(selected.some(x=>/^Primary$/i.test(x)))gradeSpecs.push(...Array.from({length:6},(_,i)=>["G"+(i+1),"Grade "+(i+1),i+1]));
 if(selected.some(x=>/^Junior School$/i.test(x))||selected.some(x=>/^Grade (7|8|9)$/.test(x)))gradeSpecs.push(...[7,8,9].map(n=>["G"+n,"Grade "+n,n+1]));
 if(selected.some(x=>/^Senior School$/i.test(x))||selected.some(x=>/^Grade (10|11|12)$/.test(x)))gradeSpecs.push(...[10,11,12].map(n=>["G"+n,"Grade "+n,n+1]));
 if(selected.some(x=>/^8-4-4 Primary$/i.test(x)))gradeSpecs.push(...Array.from({length:8},(_,i)=>["STD"+(i+1),"Standard "+(i+1),i+1]));
 if(selected.some(x=>/^8-4-4 Secondary$/i.test(x))||selected.some(x=>/^Form [1-4]$/.test(x)))gradeSpecs.push(...[1,2,3,4].map(n=>["FORM"+n,"Form "+n,20+n]));
 for(const x of selected){const m=x.match(/^(Grade (?:[1-9]|1[0-2])|Form [1-4]|PP[12])$/i);if(m&&!gradeSpecs.some(g=>g[1].toLowerCase()===m[1].toLowerCase()))gradeSpecs.push([m[1].replace(/\s/g,"").toUpperCase(),m[1],gradeSpecs.length+1]);}
 if(!gradeSpecs.length)gradeSpecs.push(["G7","Grade 7",7]);
 const gradeRows=gradeSpecs.map(([code,name,order])=>({id:makeId(),code,name,order}));
 const first=gradeRows[0],streamId=makeId(),learnerIds=[makeId(),makeId()],enrollmentIds=[makeId(),makeId()];
 const terms=[{id:termIds[0],name:"Term 1",start:year+"-01-01",end:year+"-04-30",status:"completed"},{id:termIds[1],name:"Term 2",start:year+"-05-01",end:year+"-08-31",status:"completed"},{id:termIds[2],name:"Term 3",start:year+"-09-01",end:year+"-12-31",status:"active"}];
 const q=[],tracked=[["academic_years",yearId],...termIds.map(id=>["terms",id]),...gradeRows.map(g=>["grade_levels",g.id]),["streams",streamId],...learnerIds.map(id=>["learners",id]),...enrollmentIds.map(id=>["learner_enrollments",id])];
 q.push(db.prepare("INSERT INTO academic_years(id,school_id,name,start_date,end_date,status) VALUES(?,?,?,?,?,'active')").bind(yearId,schoolId,String(year),year+"-01-01",year+"-12-31"));
 for(const t of terms)q.push(db.prepare("INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date,status) VALUES(?,?,?,?,?,?,?)").bind(t.id,schoolId,yearId,t.name,t.start,t.end,t.status));
 for(const g of gradeRows)q.push(db.prepare("INSERT INTO grade_levels(id,school_id,curriculum,stage_code,stage_name,stage_order,school_level,is_active) VALUES(?,?,?,?,?,?,?,1)").bind(g.id,schoolId,curriculum,g.code,g.name,g.order,/^PP/.test(g.code)?"Pre-Primary":/^Grade [1-6]$/.test(g.name)?"Primary":/^Grade [7-9]$/.test(g.name)?"Junior School":/^Grade 1[0-2]$/.test(g.name)?"Senior School":/^STD/.test(g.code)?"Primary":"Secondary"));
 q.push(db.prepare("INSERT INTO streams(id,school_id,grade_level_id,name,capacity,status) VALUES(?,?,?,'Demo Stream',40,'active')").bind(streamId,schoolId,first.id));
  const areas=[["ENG","English"],["KIS","Kiswahili"],["MATH","Mathematics"],["SCI","Integrated Science"],["CRE","Christian Religious Education"]];
 for(const [code,name] of areas){const aid=makeId();tracked.push(["learning_areas",aid]);q.push(db.prepare("INSERT INTO learning_areas(id,school_id,curriculum,code,name,stage_code,is_active) VALUES(?,?,?,?,?,?,1)").bind(aid,schoolId,curriculum,code,name,first.code));}
 q.push(db.prepare("INSERT INTO learners(id,school_id,admission_number,first_name,last_name,gender,status,profile_json) VALUES(?,?,?,'Amina','Demo','Female','active',?)").bind(learnerIds[0],schoolId,"DEMO-"+year+"-001",JSON.stringify({sample_data:true})));
 q.push(db.prepare("INSERT INTO learners(id,school_id,admission_number,first_name,last_name,gender,status,profile_json) VALUES(?,?,?,'Brian','Sample','Male','active',?)").bind(learnerIds[1],schoolId,"DEMO-"+year+"-002",JSON.stringify({sample_data:true})));
 for(let i=0;i<2;i++)q.push(db.prepare("INSERT INTO learner_enrollments(id,school_id,learner_id,academic_year_id,grade_level_id,stream_id,status) VALUES(?,?,?,?,?,?,'active')").bind(enrollmentIds[i],schoolId,learnerIds[i],yearId,first.id,streamId));
 for(const [table,record] of tracked)q.push(db.prepare("INSERT INTO sample_data_records(id,school_id,table_name,record_id) VALUES(?,?,?,?)").bind(makeId(),schoolId,table,record));
 await db.batch(q);
 return {created:true,academicYear:String(year),terms:3,gradeLevels:gradeRows.length,streams:1,learningAreas:areas.length,sampleLearners:2};
}
function configuredGradeSpecs(levels){
 const selected=Array.isArray(levels)?levels:[];
 const specs=[];
 if(selected.some(x=>/pre[- ]?primary/i.test(x)))specs.push(["PP1","PP1",0,"Pre-Primary"],["PP2","PP2",1,"Pre-Primary"]);
 if(selected.some(x=>/^primary$/i.test(x)))specs.push(...Array.from({length:6},(_,i)=>["G"+(i+1),"Grade "+(i+1),i+1,"Primary"]));
 if(selected.some(x=>/junior/i.test(x))||selected.some(x=>/^Grade (7|8|9)$/.test(x)))specs.push(...[7,8,9].map(n=>["G"+n,"Grade "+n,n+1,"Junior School"]));
 if(selected.some(x=>/senior/i.test(x))||selected.some(x=>/^Grade (10|11|12)$/.test(x)))specs.push(...[10,11,12].map(n=>["G"+n,"Grade "+n,n+1,"Senior School"]));
 if(selected.some(x=>/8-4-4 primary/i.test(x)))specs.push(...Array.from({length:8},(_,i)=>["STD"+(i+1),"Standard "+(i+1),i+1,"Primary"]));
 if(selected.some(x=>/^8-4-4 secondary$/i.test(x)||/^secondary$/i.test(x)))specs.push(...[1,2,3,4].map(n=>["FORM"+n,"Form "+n,20+n,"Secondary"]));
 for(const value of selected){const m=String(value).match(/^(Grade (?:[1-9]|1[0-2])|Form [1-4]|PP[12])$/i);if(m&&!specs.some(x=>x[0].toLowerCase()===m[1].replace(/\s/g,"").toLowerCase())){const name=m[1],code=name.replace(/\s/g,"").toUpperCase(),level=/^PP/.test(code)?"Pre-Primary":/^Grade [1-6]$/i.test(name)?"Primary":/^Grade [7-9]$/i.test(name)?"Junior School":/^Grade 1[0-2]$/i.test(name)?"Senior School":"Secondary";specs.push([code,name,specs.length+1,level]);}}
 return specs;
}
async function syncSchoolGradeLevels(db,schoolId,curriculum,levels){
 const specs=configuredGradeSpecs(levels);
 const existing=await db.prepare("SELECT id,stage_code,is_active FROM grade_levels WHERE school_id=? AND curriculum=?").bind(schoolId,curriculum).all();
 const byCode=new Map((existing.results||[]).map(x=>[x.stage_code,x]));
 const wanted=new Set(specs.map(x=>x[0]));
 const statements=[];
 for(const [code,name,order,level] of specs){
  const current=byCode.get(code);
  if(current)statements.push(db.prepare("UPDATE grade_levels SET stage_name=?,stage_order=?,school_level=?,is_active=1 WHERE id=? AND school_id=?").bind(name,order,level,current.id,schoolId));
  else statements.push(db.prepare("INSERT INTO grade_levels(id,school_id,curriculum,stage_code,stage_name,stage_order,school_level,is_active) VALUES(?,?,?,?,?,?,?,1)").bind(makeId(),schoolId,curriculum,code,name,order,level));
 }
 for(const row of existing.results||[])if(!wanted.has(row.stage_code))statements.push(db.prepare("UPDATE grade_levels SET is_active=0 WHERE id=? AND school_id=?").bind(row.id,schoolId));
 if(statements.length)await db.batch(statements);
}
function normalizeCurricula(body, fallback) {
 const allowed=["Kenyan CBE","Kenyan 8-4-4","International / Cambridge","Custom"];
 const values=Array.isArray(body.curricula)?body.curricula:(Array.isArray(fallback)?fallback:(fallback?[fallback]:[]));
 return [...new Set(values.map(clean).filter(x=>allowed.includes(x)))];
}
function validateCurricula(curricula,levels) {
 if(!curricula.length)return "Select at least one curriculum framework.";
 if(levels.some(x=>/^8-4-4/i.test(x)||/^Form [1-4]$/i.test(x))&&!curricula.includes("Kenyan 8-4-4"))return "Select Kenyan 8-4-4 to offer Standards 1–8 or Forms 1–4.";
 if(levels.some(x=>/^(Pre-Primary|Primary|Junior School|Senior School|Grade (?:[1-9]|1[0-2])|PP[12])$/i.test(x))&&!curricula.includes("Kenyan CBE"))return "Select Kenyan CBE to offer CBE school classes.";
 return null;
}
async function syncSchoolCurricula(db,schoolId,curricula,levels) {
 for(const curriculum of curricula){
  const scoped=curriculum==="Kenyan 8-4-4"?levels.filter(x=>/^8-4-4/i.test(x)||/^Form [1-4]$/i.test(x)):curriculum==="Kenyan CBE"?levels.filter(x=>/^(Pre-Primary|Primary|Junior School|Senior School)$/i.test(x)||/^(Grade (?:[1-9]|1[0-2])|PP[12])$/i.test(x)):[];
  if(scoped.length){await syncSchoolGradeLevels(db,schoolId,curriculum,scoped);await syncSchoolLearningAreas(db,schoolId,curriculum,scoped);}
 }
}
function curriculumSelectionError(curriculum,levels){
 const is844=/8-4-4/i.test(String(curriculum||"")),isCbe=/cbe|cbc|competenc/i.test(String(curriculum||""));
 const legacy=(levels||[]).some(x=>/^8-4-4/i.test(String(x))||/^Form [1-4]$/i.test(String(x)));
 const modern=(levels||[]).some(x=>/^(Pre-Primary|Primary|Junior School|Senior School|Grade (?:[1-9]|1[0-2])|PP[12])$/i.test(String(x)));
 if(is844&&modern)return "For Kenyan 8-4-4, select 8-4-4 Primary and/or 8-4-4 Secondary divisions only.";
 if(isCbe&&legacy)return "For Kenyan CBE, select Pre-Primary, Primary, Junior School and/or Senior School divisions only.";
 if(!is844&&!isCbe&&legacy)return "8-4-4 divisions require the Kenyan 8-4-4 curriculum framework.";
 return null;
}
function curriculumLearningAreas(curriculum,levels){
 const cbe=/cbe|cbc|competenc/i.test(String(curriculum||""));
 const template=cbe?"Kenya CBE 2024-2025":"Kenya 8-4-4";
 const stages=configuredGradeSpecs(levels).map(x=>x[0]);
 const rows=[];
 const add=(stage,items)=>items.forEach((x,i)=>rows.push({stage,code:x[0],name:x[1],type:x[2]||"mandatory",pathway:x[3]||null,mandatory:(x[2]||"mandatory")==="mandatory"?1:0}));
 const areaCode=(name)=>{
  const key=String(name).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const codes={"mathematics":"MAT","core essential mathematics":"MAT","english":"ENG","english language activities":"ENG","kiswahili":"KIS","kiswahili language activities kenya sign language":"KIS","science and technology":"SCI","integrated science including health education":"SCI","biology":"BIO","chemistry":"CHE","physics":"PHY","geography":"GEO","history and government":"HIS","history and citizenship":"HIS","business studies":"BST","agriculture":"AGR","computer studies":"ICT","ict skills":"ICT","home science":"HSC","christian religious education":"CRE","islamic religious education":"IRE","hindu religious education":"HRE","physical education":"PHE","physical and health education":"PHE","creative arts":"CRA","social studies":"SST","community service learning":"CSL","literature in english":"LIT","music and dance":"MUS","theatre and film":"THF","fine arts":"FAR","french":"FRE","german":"GER","arabic":"ARB","mandarin chinese":"MAN","kenya sign language":"KSL","woodwork":"WWK","metalwork":"MTW","building construction":"BCN","power mechanics":"PME","electricity":"ELC","aviation technology":"AVI","environmental activities":"ENV","literacy":"LIT","indigenous language activities":"ILA","movement and creative activities":"MCA","language activities":"LAN","mathematical activities":"MAT","psychomotor and creative activities":"PCA","religious education activities":"REL","pre technical studies including business and computer studies":"PTS","creative arts and sports":"CAS","pastoral religious programme of instruction":"PRI"};
  if(codes[key])return codes[key];
  const words=key.split(" ").filter(Boolean);return (words.length===1?words[0].slice(0,3):words.map(x=>x[0]).join("").slice(0,3)).toUpperCase();
 };
 const core=(names)=>names.map(n=>[areaCode(n),n,"mandatory"]);
 const optional=(names)=>names.map(n=>[areaCode(n),n,"optional"]);
 for(const stage of stages){
  if(cbe){
   if(/^PP[12]$/.test(stage))add(stage,core(["Language Activities","Mathematical Activities","Environmental Activities","Psychomotor and Creative Activities","Religious Education Activities"]));
   else if(/^G[1-3]$/.test(stage))add(stage,core(["Literacy","Kiswahili Language Activities / Kenya Sign Language","English Language Activities","Indigenous Language Activities","Mathematical Activities","Environmental Activities","Hygiene and Nutrition Activities","Religious Education Activities","Movement and Creative Activities"]));
   else if(/^G[4-6]$/.test(stage))add(stage,[...core(["English","Kiswahili / Kenya Sign Language","Home Science","Agriculture","Science and Technology","Mathematics","Religious Education (CRE / IRE / HRE)","Creative Arts","Physical and Health Education","Social Studies"]),...optional(["Arabic","French","German","Mandarin"])]);
   else if(/^G[7-9]$/.test(stage))add(stage,[...core(["English","Kiswahili / Kenya Sign Language","Mathematics","Religious Education (CRE / IRE / HRE)","Social Studies (including Life Skills)","Integrated Science (including Health Education)","Pre-Technical Studies (including Business and Computer Studies)","Agriculture","Creative Arts and Sports"]),...optional(["Foreign Languages","Indigenous Languages","Home Science","Computer Science","Visual Arts","Performing Arts","Kenya Sign Language"])]);
   else if(/^G1[0-2]$/.test(stage)){
    add(stage,[...core(["English","Kiswahili / Kenya Sign Language","Core / Essential Mathematics","Community Service Learning","Physical Education","ICT Skills","Pastoral / Religious Programme of Instruction"]),
      ...["STEM","Social Sciences","Arts & Sports Science"].flatMap(path=> ({"STEM":["Biology","Chemistry","Physics","General Science","Agriculture","Computer Studies","Home Science","Aviation","Building Construction","Electricity","Metalwork","Power Mechanics","Woodwork","Media Technology","Marine and Fisheries Technology"],"Social Sciences":["Literature in English","Indigenous Languages","Fasihi ya Kiswahili","Sign Language","Arabic","French","German","Mandarin Chinese","Christian Religious Education","Islamic Religious Education","Hindu Religious Education","Business Studies","History and Citizenship","Geography"],"Arts & Sports Science":["Sports and Recreation","Music and Dance","Theatre and Film","Fine Arts"]}[path]||[]).map(n=>[n.toUpperCase().replace(/[^A-Z0-9]+/g,"_").slice(0,18),n,"optional",path]))]);
   }
  }else if(/^STD[1-8]$/.test(stage)){
   add(stage,[...core(["English","Kiswahili","Mathematics"]),...optional(["Science and Technology","Social Studies","Religious Education (CRE / IRE / HRE)","Agriculture","Home Science","Art and Craft","Music","Physical Education","Computer Studies"])]);
  }else if(/^FORM[1-4]$/.test(stage)){
   add(stage,[...core(["English","Kiswahili","Mathematics"]),...optional(["Biology","Chemistry","Physics","Geography","History and Government","Christian Religious Education","Islamic Religious Education","Hindu Religious Education","Business Studies","Agriculture","Computer Studies","Home Science","Art and Design","Music","French","German","Arabic","Kenya Sign Language","Woodwork","Metalwork","Building Construction","Power Mechanics","Electricity","Aviation Technology"])]);
  }
 }
 return {template,rows};
}
async function syncSchoolLearningAreas(db,schoolId,curriculum,levels){
 const {template,rows}=curriculumLearningAreas(curriculum,levels);
 // Apply the platform-wide learning-area catalogue to each school tenant.
 // Existing curriculum templates remain the fallback; Super Admin additions and
 // compulsory/optional changes are then synchronized into the school's D1 records.
 const central=await db.prepare("SELECT setting_value FROM platform_settings WHERE setting_key='learning_area_catalogue'").first().catch(()=>null);
 let catalogue=[];try{catalogue=JSON.parse(central?.setting_value||"{}").areas||[]}catch{}
 const stageSet=new Set(configuredGradeSpecs(levels).map(x=>x[0]));
 for(const item of catalogue){
  if(item.curriculum!==curriculum||!stageSet.has(String(item.level||"")))continue;
  const code=String(item.code||"").trim().toUpperCase(),name=String(item.name||"").trim();
  if(!code||!name)continue;
  const mandatory=Number(item.mandatory)===1?1:0;
  const found=rows.find(x=>x.stage===item.level&&(x.code===code||String(x.name).toLowerCase()===name.toLowerCase()));
  if(found){found.code=code;found.name=name;found.pathway=item.pathway||null;found.type=mandatory?"mandatory":"optional";found.mandatory=mandatory;}
  else rows.push({stage:item.level,code,name,pathway:item.pathway||null,type:mandatory?"mandatory":"optional",mandatory});
 }
 const wanted=new Set(rows.map(x=>x.stage));
 // Do not deactivate other curriculum rows; a school may offer CBE and 8-4-4 concurrently.
 const existing=await db.prepare("SELECT id,stage_code,code,name,catalogue_code,school_customized FROM learning_areas WHERE school_id=?").bind(schoolId).all();
 const byKey=new Map();
 for(const row of existing.results||[]){
  const stable=row.catalogue_code||row.code;
  byKey.set(String(row.stage_code||"")+"|"+String(stable||""),row);
  byKey.set(String(row.stage_code||"")+"|name:"+String(row.name||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),row);
 }
 const statements=[],matched=new Set();
 for(const x of rows){
  const nameKey=x.stage+"|name:"+String(x.name||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const found=byKey.get(x.stage+"|"+x.code)||byKey.get(nameKey);
  if(found){
   matched.add(found.id);
   statements.push(db.prepare("UPDATE learning_areas SET catalogue_code=COALESCE(catalogue_code,?),name=CASE WHEN school_customized=1 THEN name ELSE ? END,code=CASE WHEN school_customized=1 THEN code ELSE ? END,pathway=?,subject_type=?,is_mandatory=?,source_template=?,is_active=CASE WHEN ?=1 THEN 1 ELSE is_active END WHERE id=? AND school_id=?").bind(x.code,x.name,x.code,x.pathway,x.type,x.mandatory,template,x.mandatory,found.id,schoolId));
  }else{
   statements.push(db.prepare("INSERT INTO learning_areas(id,school_id,curriculum,code,catalogue_code,name,stage_code,pathway,is_active,subject_type,is_mandatory,source_template,school_customized) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0)").bind(makeId(),schoolId,curriculum,x.code,x.code,x.name,x.stage,x.pathway,x.mandatory,x.type,x.mandatory,template));
  }
 }
 for(const row of existing.results||[])if(!matched.has(row.id)&&!rows.some(x=>x.stage===row.stage_code&&(x.code===(row.catalogue_code||row.code)||String(x.name||"").toLowerCase()===String(row.name||"").toLowerCase())))statements.push(db.prepare("UPDATE learning_areas SET is_active=0 WHERE id=? AND school_id=?").bind(row.id,schoolId));
 if(statements.length)await db.batch(statements);
}
function mapSchool(row){
  let meta={};
  try{meta=JSON.parse(row.settings_json||"{}").navstar_school_meta||{}}catch{}
  let levels=[];try{levels=JSON.parse(row.school_levels_json||"[]")}catch{}
  let curricula=[];try{curricula=JSON.parse(row.curricula_json||"[]")}catch{} if(!curricula.length&&row.curriculum)curricula=[row.curriculum];
  if(Array.isArray(levels)&&levels.some(x=>/^Grade |^Form |^PP[12]$/i.test(String(x)))){
    const legacy=levels.map(String),groups=[];
    if(legacy.some(x=>/^PP[12]$/i.test(x)))groups.push("Pre-Primary");
    if(legacy.some(x=>/^Grade [1-6]$/i.test(x)))groups.push("Primary");
    if(legacy.some(x=>/^Grade [7-9]$/i.test(x)))groups.push("Junior School");
    if(legacy.some(x=>/^Grade 1[0-2]$/i.test(x)))groups.push("Senior School");
    if(legacy.some(x=>/^8-4-4 Primary$/i.test(x)))groups.push("8-4-4 Primary");
    if(legacy.some(x=>/^Form [1-4]$/i.test(x)))groups.push("8-4-4 Secondary");
    levels=groups;
  }
  return {id:row.id,name:row.name,code:row.school_code,registrationNumber:row.registration_number||"",emisCode:row.emis_code||"",
    category:meta.category||row.institution_type||"",level:meta.level||"",ownership:row.ownership||"",county:row.county||"",
    subCounty:row.sub_county||"",town:row.town||"",contact:row.contact_person||"",email:row.contact_email||"",
    phone:row.contact_phone||"",address:row.physical_address||"",curriculum:row.curriculum||"Kenyan CBE",curricula,
    curriculumLabel:meta.curriculumLabel||row.curriculum||"Kenyan CBE",levels,plan:meta.plan||"Starter",
    status:displayStatus(row.status),expiry:meta.expiry||"",modules:modulesForLevels(levels),
    learnerCount:Number(meta.learnerCount||0),teacherCount:Number(meta.teacherCount||0),created:row.created_at,schoolAdmin:row.admin_user_id?{id:row.admin_user_id,fullName:row.admin_full_name,username:row.admin_username,email:row.admin_email,phone:row.admin_phone,status:row.admin_status,role:"School Administrator"}:null};
}
async function requireAdmin(request,env){
  if(!env.DB)return {error:json({ok:false,error:"Database connection is unavailable."},503)};
  const user=await getSuperAdminSession(request,env);
  return user?{user}:{error:json({ok:false,error:"Your Super Admin session has expired. Please sign in again."},401)};
}

export async function onRequestGet({request,env}){
  const auth=await requireAdmin(request,env);if(auth.error)return auth.error;
  try{
    const rows=await env.DB.prepare(`SELECT s.*,ss.settings_json,
      (SELECT u.id FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_user_id,
      (SELECT u.full_name FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_full_name,
      (SELECT u.username FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_username,
      (SELECT u.email FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_email,
      (SELECT u.phone FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_phone,
      (SELECT u.status FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_status
      FROM schools s LEFT JOIN school_settings ss ON ss.school_id=s.id ORDER BY s.created_at DESC`).all();
    for(const row of rows.results||[]){
      let levels=[],curricula=[];try{levels=JSON.parse(row.school_levels_json||"[]")}catch{}try{curricula=JSON.parse(row.curricula_json||"[]")}catch{}
      if(!levels.length)continue;
      if(!curricula.length)curricula=[row.curriculum||"Kenyan CBE"];
      await syncSchoolCurricula(env.DB,row.id,curricula,levels);
    }
    return json({ok:true,schools:(rows.results||[]).map(mapSchool)});
  }catch{return json({ok:false,error:"School records could not be loaded from the database."},500)}
}
export async function onRequestPost({request,env}){
  const auth=await requireAdmin(request,env);if(auth.error)return auth.error;
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid school details."},400)}
  const name=clean(body.name),county=clean(body.county),contact=clean(body.contact),email=clean(body.email).toLowerCase(),phone=clean(body.phone);
  if(!name||name.length>180||!county||county.length>100)return json({ok:false,error:"Official school name and county are required."},400);
  if(!/^\S+@\S+\.\S+$/.test(email)||email.length>190)return json({ok:false,error:"Enter the school's official email address so Navstar can send its welcome information."},400);
  if(phone.length>40||contact.length>120)return json({ok:false,error:"Check the school contact name and phone number."},400);
  const id=makeId(),code=clean(body.code)||("NS-"+crypto.randomUUID().slice(0,8).toUpperCase());
  const status=normStatus(body.status),curricula=normalizeCurricula(body,clean(body.curriculum)||"Kenyan CBE");
  const curriculum=curricula.length>1?"Multiple curricula":(curricula[0]||"Kenyan CBE");
  const levels=Array.isArray(body.levels)?[...new Set(body.levels.map(clean).filter(Boolean))]:[];
  if(!levels.length)return json({ok:false,error:"Select at least one school level in Super Admin before registering this school."},400);
  const curriculumIssue=validateCurricula(curricula,levels);if(curriculumIssue)return json({ok:false,error:curriculumIssue},400);
  const meta={category:clean(body.category),level:clean(body.level),plan:clean(body.plan)||"Starter",expiry:clean(body.expiry),modules:modulesForLevels(levels),learnerCount:0,teacherCount:0};
  try{
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO schools (id,school_code,name,registration_number,emis_code,institution_type,ownership,county,sub_county,town,physical_address,contact_person,contact_email,contact_phone,curriculum,school_levels_json,status,created_by,activated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='active' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END)`)
        .bind(id,code,name,clean(body.registrationNumber)||null,clean(body.emisCode)||null,meta.category||null,clean(body.ownership)||null,county,clean(body.subCounty)||null,clean(body.town)||null,clean(body.address)||null,contact||null,email,phone||null,curriculum,JSON.stringify(levels),status,auth.user.id,status),
      env.DB.prepare("INSERT INTO school_settings (school_id,timezone,currency,settings_json) VALUES (?,'Africa/Nairobi','KES',?)").bind(id,JSON.stringify({navstar_school_meta:meta})),
      env.DB.prepare("UPDATE schools SET curricula_json=? WHERE id=?").bind(JSON.stringify(curricula),id),
      env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,school_id,action,resource_type,resource_id,outcome,details_json) VALUES (?,?,?,'school.created','school',?,'success',?)").bind(makeId(),auth.user.id,id,id,JSON.stringify({name,schoolCode:code,levels}))
    ]);
    let sampleData={created:false};
    if(body.includeSampleData!==false&&curricula.length===1){
      try{sampleData={created:true,...await seedSchoolSampleData(env.DB,id,curricula[0]||curriculum,levels)};}
      catch(error){console.error("Navstar sample data seed failed",error);sampleData={created:false,error:"Sample data could not be seeded. Confirm migration 0005 is applied before retrying."}}
    }else if(body.includeSampleData!==false&&curricula.length>1){
      sampleData={created:false,message:"Sample data is skipped for schools offering multiple curricula so each class and learning-area catalogue remains separate."};
    }
    await syncSchoolCurricula(env.DB,id,curricula,levels);
    let emailDelivery="not_configured";
    if(env.RESEND_API_KEY && body.suppressWelcomeEmail!==true){
      const from=env.MAIL_FROM||"Navstar Analytics <no-reply@mail.navstardigitalhub.co.ke>",loginUrl=new URL("/login.html",new URL(request.url).origin).toString();
      const safe=v=>String(v).replace(/[&<>"]/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[x]));
      const html="<div style='font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#17233b'><div style='background:#082b70;color:#fff;padding:26px;border-radius:14px 14px 0 0'><div style='font-size:20px;font-weight:800;letter-spacing:1px'>Navstar Analytics</div><div style='font-size:12px;opacity:.9'>Smart School Management & Education Analytics</div></div><div style='padding:28px;border:1px solid #e5eaf2;border-radius:0 0 14px 14px'><p>Hello "+safe(contact||name)+" team,</p><h2 style='color:#102b5c'>Welcome to Navstar Analytics</h2><p>We are delighted to welcome <b>"+safe(name)+"</b> to Navstar, a centralised school management platform designed to support school administration, teaching, learning and informed decision-making.</p><h3>Your school workspace</h3><p><b>School:</b> "+safe(name)+"<br><b>Institution code:</b> "+safe(code)+"<br><b>County:</b> "+safe(county)+"<br><b>Curriculum:</b> "+safe(curriculum)+"<br><b>Configured levels:</b> "+safe(levels.join(", ")||"To be configured")+"</p><h3>What Navstar helps your school manage</h3><ul><li>School administration, staff and user accounts with role-based access</li><li>Learner admissions, records and parent/learner portals</li><li>Academic years, terms, classes, streams and learning areas</li><li>Teacher allocations, attendance, assessments and performance reporting</li><li>Finance, communication, records and operational management</li><li>School dashboards and analytics with role-restricted access</li></ul><h3>Getting started</h3><ol><li>Your Navstar platform administrator will configure your School Administrator account separately.</li><li>The School Administrator will receive a username and instructions to set a password securely using the Forgot password OTP process.</li><li>After activation, the School Administrator can set up staff, teachers, learners and other authorised users.</li></ol><p><a href='"+loginUrl+"' style='display:inline-block;background:#1264e8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700'>Visit Navstar login</a></p><p>For assistance, contact the Navstar support team using the details supplied by your platform administrator.</p><p>We look forward to supporting your institution.</p><p>Kind regards,<br><b>Navstar Analytics Team</b></p></div></div>";
      try{const sent=await sendNavstarEmail(env,{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from,to:[email],subject:"Welcome to Navstar Analytics · "+name,html,text:"Welcome to Navstar Analytics, "+name+".\n\nYour school workspace has been registered. Institution code: "+code+". County: "+county+". Curriculum: "+curriculum+". Levels: "+(levels.join(", ")||"To be configured")+". Navstar supports school administration, staff and learner records, academics, teacher allocations, attendance, assessments, finance, communications, portals and analytics with role-based access. Your platform administrator will separately configure your School Administrator account. Once received, use the username and Forgot password OTP process to set a secure password. Login: "+loginUrl+".\n\nKind regards, Navstar Analytics Team."})});emailDelivery=sent.ok?"sent":"failed";if(!sent.ok)console.error("Navstar school welcome email failed:",sent.status,await sent.text());}
      catch(error){emailDelivery="failed";console.error("Navstar school welcome email error:",String(error?.message||error));}
    }
    const row=await env.DB.prepare("SELECT s.*,ss.settings_json FROM schools s LEFT JOIN school_settings ss ON ss.school_id=s.id WHERE s.id=?").bind(id).first();
    return json({ok:true,school:mapSchool(row),emailDelivery,sampleData,message:"School registered. Add its School Administrator from the school profile."},201);
  }catch(error){
    const msg=String(error?.message||"");console.error("Navstar school registration failed:",msg);
    if(/UNIQUE constraint/i.test(msg))return json({ok:false,error:"That school code is already registered. Use a different institution code."},409);
    return json({ok:false,error:"The school could not be saved. Please check the details and try again."},500);
  }
}
export async function onRequestPatch({request,env}){
  const auth=await requireAdmin(request,env);if(auth.error)return auth.error;
  const id=decodeURIComponent(new URL(request.url).pathname.split("/").pop()||"");
  if(!id||id.length>100)return json({ok:false,error:"A valid school ID is required."},400);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid school update."},400)}
  try{
    const existing=await env.DB.prepare("SELECT s.*,ss.settings_json FROM schools s LEFT JOIN school_settings ss ON ss.school_id=s.id WHERE s.id=?").bind(id).first();
    if(!existing)return json({ok:false,error:"School record was not found."},404);
    let current={};try{current=JSON.parse(existing.settings_json||"{}")}catch{}
    const meta={...(current.navstar_school_meta||{})};
    for(const key of ["category","level","plan","expiry","modules","learnerCount","teacherCount"])if(body[key]!==undefined)meta[key]=body[key];
    const name=body.name===undefined?existing.name:clean(body.name),code=body.code===undefined?existing.school_code:clean(body.code);
    if(!name||name.length>180||!code||code.length>80)return json({ok:false,error:"School name and institution code are required."},400);
    const status=body.status===undefined?existing.status:normStatus(body.status);
    let selectedLevels=[];
    try{selectedLevels=body.levels===undefined?JSON.parse(existing.school_levels_json||"[]"):(Array.isArray(body.levels)?body.levels:[])}catch{selectedLevels=[]}
    selectedLevels=[...new Set(selectedLevels.map(clean).filter(Boolean))];
    let previousCurricula=[];try{previousCurricula=JSON.parse(existing.curricula_json||"[]")}catch{}
    const curricula=normalizeCurricula(body,previousCurricula.length?previousCurricula:(existing.curriculum||"Kenyan CBE"));
    const curriculumIssue=validateCurricula(curricula,selectedLevels);if(curriculumIssue)return json({ok:false,error:curriculumIssue},400);
    const levels=JSON.stringify(selectedLevels);
    meta.modules=modulesForLevels(selectedLevels);
    const curriculum=curricula.length>1?"Multiple curricula":(curricula[0]||existing.curriculum);
    await env.DB.batch([
      env.DB.prepare(`UPDATE schools SET school_code=?,name=?,registration_number=?,institution_type=?,ownership=?,county=?,sub_county=?,town=?,physical_address=?,contact_person=?,contact_email=?,contact_phone=?,curriculum=?,curricula_json=?,school_levels_json=?,status=?,activated_at=CASE WHEN ?='active' THEN COALESCE(activated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE activated_at END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
        .bind(code,name,body.registrationNumber===undefined?existing.registration_number:clean(body.registrationNumber),meta.category||null,body.ownership===undefined?existing.ownership:clean(body.ownership),body.county===undefined?existing.county:clean(body.county),body.subCounty===undefined?existing.sub_county:clean(body.subCounty),body.town===undefined?existing.town:clean(body.town),body.address===undefined?existing.physical_address:clean(body.address),body.contact===undefined?existing.contact_person:clean(body.contact),body.email===undefined?existing.contact_email:clean(body.email),body.phone===undefined?existing.contact_phone:clean(body.phone),curriculum,JSON.stringify(curricula),levels,status,status,id),
      env.DB.prepare("INSERT INTO school_settings (school_id,settings_json) VALUES (?,?) ON CONFLICT(school_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
        .bind(id,JSON.stringify({...current,navstar_school_meta:meta}))
    ]);
    await syncSchoolCurricula(env.DB,id,curricula,selectedLevels);
    const row=await env.DB.prepare(`SELECT s.*,ss.settings_json,
      (SELECT u.id FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_user_id,
      (SELECT u.full_name FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_full_name,
      (SELECT u.username FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_username,
      (SELECT u.email FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_email,
      (SELECT u.phone FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_phone,
      (SELECT u.status FROM school_memberships m JOIN users u ON u.id=m.user_id JOIN user_role_assignments a ON a.user_id=u.id AND a.school_id=s.id JOIN roles r ON r.id=a.role_id AND r.role_key='school_admin' WHERE m.school_id=s.id AND m.membership_status IN ('active','invited') ORDER BY m.created_at LIMIT 1) AS admin_status
      FROM schools s LEFT JOIN school_settings ss ON ss.school_id=s.id WHERE s.id=?`).bind(id).first();
    await env.DB.prepare("INSERT INTO audit_logs (id,actor_user_id,school_id,action,resource_type,resource_id,outcome,details_json) VALUES (?,?,?,'school.updated','school',?,'success',?)")
      .bind(makeId(),auth.user.id,id,id,JSON.stringify({status})).run().catch(()=>{});
    return json({ok:true,school:mapSchool(row),message:"School changes saved to the central database."});
  }catch(error){
    if(/UNIQUE constraint/i.test(String(error?.message||"")))return json({ok:false,error:"That institution code is already assigned to another school."},409);
    return json({ok:false,error:"School changes could not be saved. Please try again."},500);
  }
}
