import { getAuthenticatedSession } from "./auth.js";

const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const id=()=>crypto.randomUUID();

export async function onRequestPost({request,env}){
  if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
  const actor=await getAuthenticatedSession(request,env);
  if(!actor)return json({ok:false,error:"Sign in to continue."},401);
  if(!actor.is_super_admin&&!actor.permissions.includes("academics.manage"))return json({ok:false,error:"Your role cannot publish report cards."},403);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid report-card publishing request."},400)}
  const schoolId=actor.is_super_admin?String(body.school_id||""):actor.school_id;
  const ids=[...new Set((Array.isArray(body.report_card_ids)?body.report_card_ids:[]).map(x=>String(x||"").trim()).filter(Boolean))];
  if(!schoolId||(!actor.is_super_admin&&body.school_id&&body.school_id!==schoolId)||!ids.length||ids.length>500)return json({ok:false,error:"Select between 1 and 500 report cards from this school."},400);
  try{
    const rows=await env.DB.prepare("SELECT id,learner_id,academic_year_id,term_id,report_data_json,status FROM report_cards WHERE school_id=? AND id IN ("+ids.map(()=>"?").join(",")+")").bind(schoolId,...ids).all();
    const records=rows.results||[];
    if(records.length!==ids.length)return json({ok:false,error:"One or more report cards were not found in this school. Refresh the list and try again."},404);
    for(const row of records){
      if(!["draft","approved"].includes(String(row.status||"draft")))return json({ok:false,error:"Only draft or approved report cards can be published. Already published or archived records were left unchanged."},409);
      let report;try{report=JSON.parse(row.report_data_json||"{}")}catch{return json({ok:false,error:"A selected report card contains invalid report data. Correct it before publishing."},409)}
      if(!report.learner?.id||!Array.isArray(report.learningAreas)||report.learningAreas.length===0)return json({ok:false,error:"Every selected report card must contain learner details and at least one assessed learning area before publishing."},409);
      const learner=await env.DB.prepare("SELECT id FROM learners WHERE id=? AND school_id=? AND status='active'").bind(row.learner_id,schoolId).first();
      if(!learner)return json({ok:false,error:"A selected report belongs to a learner who is no longer active in this school. Review the report before publishing."},409);
    }
    const publishedAt=new Date().toISOString();
    const statements=records.map(row=>env.DB.prepare("UPDATE report_cards SET status='published',published_at=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND school_id=? AND status IN ('draft','approved')").bind(publishedAt,row.id,schoolId));
    await env.DB.batch(statements);
    const verify=await env.DB.prepare("SELECT id,status,published_at FROM report_cards WHERE school_id=? AND id IN ("+ids.map(()=>"?").join(",")+") AND status='published'").bind(schoolId,...ids).all();
    if((verify.results||[]).length!==ids.length)throw new Error("Report publication read-back verification failed.");
    for(const row of records){
      try{await env.DB.prepare("INSERT INTO audit_logs(id,actor_user_id,school_id,action,resource_type,resource_id,outcome,details_json) VALUES(?,?,?,?,?,?,'success',?)").bind(id(),actor.id,schoolId,"report_card.published","report_card",row.id,JSON.stringify({academic_year_id:row.academic_year_id,term_id:row.term_id})).run()}catch(error){console.warn("Report-card publication audit entry was not written",String(error?.message||error))}
    }
    return json({ok:true,published:ids.length,records:verify.results||[],message:ids.length+" report card(s) published and verified. Parents and learners can now view them."});
  }catch(error){
    console.error("NAVSTAR report-card publish",error);
    return json({ok:false,error:"Report cards could not be published and verified. Refresh the report list before retrying."},500);
  }
}
