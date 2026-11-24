import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function onRequestGet({request,env}){
 if(!env.DB)return json({ok:false,error:"Database unavailable."},503);
 const user=await getAuthenticatedSession(request,env);
 if(!user)return json({ok:false,error:"Sign in to continue."},401);
 const schoolId=user.school_id;
 if(!schoolId)return json({ok:false,error:"This account has no school workspace."},403);
 try{
  const today=new Date(Date.now()+3*60*60*1000).toISOString().slice(0,10);
  const academicYear=await env.DB.prepare("SELECT id,name,start_date,end_date,status FROM academic_years WHERE school_id=? AND start_date<=? AND end_date>=? ORDER BY start_date DESC LIMIT 1").bind(schoolId,today,today).first();
  const term=academicYear?await env.DB.prepare("SELECT id,name,start_date,end_date,status FROM terms WHERE school_id=? AND academic_year_id=? AND start_date<=? AND end_date>=? ORDER BY start_date DESC LIMIT 1").bind(schoolId,academicYear.id,today,today).first():null;
  const anchor=term?.start_date||academicYear?.start_date||null;
  const weekNumber=anchor?Math.floor((Date.parse(today+"T00:00:00Z")-Date.parse(anchor+"T00:00:00Z"))/604800000)+1:null;
  return json({ok:true,date:today,academicYear:academicYear||null,term:term||null,weekNumber,weekLabel:weekNumber?"Week "+weekNumber:"No current week"});
 }catch(error){console.error("NAVSTAR academic period",error);return json({ok:false,error:"The current academic period could not be loaded."},500)}
}
