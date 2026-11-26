import {getAuthenticatedSession} from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function onRequestPost({request,env}){
 const user=await getAuthenticatedSession(request,env);
 if(!user)return json({ok:false,error:"An active sign-in is required."},401);
 const roles=Array.isArray(user.role_keys)?user.role_keys:[],permissions=Array.isArray(user.permissions)?user.permissions:[],modules=Array.isArray(user.modules)?user.modules:[];
 if(!user.is_super_admin&&!roles.includes("school_admin")&&!permissions.includes("school.settings.manage"))return json({ok:false,error:"Your role cannot manage boarding allocations."},403);
 if(!user.is_super_admin&&!["boarding","both"].includes(String(user.boardingType||"day").toLowerCase())&&!modules.some(x=>String(x).toLowerCase()==="boarding"))return json({ok:false,error:"Boarding is not enabled for this school."},403);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid boarding transfer request."},400)}
 const schoolId=user.is_super_admin?String(body.school_id||""):user.school_id,allocationId=String(body.allocation_id||""),houseId=String(body.house_id||""),room=String(body.room_number||"").trim(),bed=String(body.bed_number||"").trim(),start=String(body.start_date||"");
 if(!schoolId||!allocationId||!houseId||!room||!bed||!/^\d{4}-\d{2}-\d{2}$/.test(start))return json({ok:false,error:"Select the existing placement, destination dormitory, room, bed and a valid transfer date."},400);
 const parsedDate=Date.parse(start+"T00:00:00Z");if(!Number.isFinite(parsedDate)||new Date(parsedDate).toISOString().slice(0,10)!==start)return json({ok:false,error:"Enter a valid transfer date."},400);
 const today=new Date().toISOString().slice(0,10);if(start>today)return json({ok:false,error:"Future-dated transfers are not supported yet. Choose today or an earlier effective date."},400);
 if(!user.is_super_admin&&body.school_id&&body.school_id!==schoolId)return json({ok:false,error:"You cannot transfer a learner in another school."},403);
 try{
  const current=await env.DB.prepare("SELECT id,learner_id,house_id,start_date FROM boarding_allocations WHERE id=? AND school_id=? AND status='active' AND (end_date IS NULL OR end_date='')").bind(allocationId,schoolId).first();
  if(!current)return json({ok:false,error:"The learner's current active boarding placement was not found."},404);
  if(current.start_date&&start<current.start_date)return json({ok:false,error:"The transfer date cannot be earlier than the current boarding placement."},400);
  const target=await env.DB.prepare("SELECT id,capacity,status FROM boarding_houses WHERE id=? AND school_id=?").bind(houseId,schoolId).first();
  if(!target||String(target.status||"active")!=="active")return json({ok:false,error:"Choose an active destination dormitory belonging to this school."},400);
  const roomRow=await env.DB.prepare("SELECT id,room_number,capacity,status FROM boarding_rooms WHERE school_id=? AND house_id=? AND room_number=?").bind(schoolId,target.id,room).first();
  const bedNumber=Number(bed);
  const normalizedBed=String(bedNumber);
  if(!roomRow||String(roomRow.status||"active")!=="active")return json({ok:false,error:"Choose an active room configured under the destination dormitory."},400);
  if(!Number.isInteger(bedNumber)||bedNumber<1||bedNumber>Number(roomRow.capacity||0))return json({ok:false,error:"Bed number must be between 1 and the destination room's configured capacity."},400);
  const roomOccupied=await env.DB.prepare("SELECT COUNT(*) AS total FROM boarding_allocations WHERE school_id=? AND house_id=? AND room_number=? AND status='active' AND (end_date IS NULL OR end_date='')").bind(schoolId,target.id,roomRow.room_number).first();
  const roomAfterTransfer=Number(roomOccupied?.total||0)-(current.house_id===target.id&&String(room)===String(current.room_number)?1:0);
  if(roomAfterTransfer>=Number(roomRow.capacity||0))return json({ok:false,error:"The destination room has reached its configured bed capacity."},409);

  const existingPlacement=await env.DB.prepare("SELECT id FROM boarding_allocations WHERE school_id=? AND learner_id=? AND id<>? AND status='active' AND (end_date IS NULL OR end_date='') LIMIT 1").bind(schoolId,current.learner_id,current.id).first();
  if(existingPlacement)return json({ok:false,error:"This learner already has another active boarding placement."},409);
  const occupied=await env.DB.prepare("SELECT COUNT(*) AS total FROM boarding_allocations WHERE school_id=? AND house_id=? AND status='active' AND (end_date IS NULL OR end_date='')").bind(schoolId,target.id).first();
  const afterTransfer=Number(occupied?.total||0)-(current.house_id===target.id?1:0);
  if(afterTransfer>=Number(target.capacity||0))return json({ok:false,error:"The destination dormitory has reached its configured bed capacity."},409);
  const bedOccupied=await env.DB.prepare("SELECT id FROM boarding_allocations WHERE school_id=? AND house_id=? AND id<>? AND lower(trim(COALESCE(room_number,'')))=lower(trim(?)) AND lower(trim(COALESCE(bed_number,'')))=lower(trim(?)) AND status='active' AND (end_date IS NULL OR end_date='') LIMIT 1").bind(schoolId,target.id,current.id,room,normalizedBed).first();
  if(bedOccupied)return json({ok:false,error:"The selected destination room and bed are already occupied."},409);
  const newId=crypto.randomUUID(),endDate=start;
  await env.DB.batch([
   env.DB.prepare("UPDATE boarding_allocations SET status='transferred',end_date=? WHERE id=? AND school_id=? AND status='active' AND (end_date IS NULL OR end_date='')").bind(endDate,current.id,schoolId),
   env.DB.prepare("INSERT INTO boarding_allocations(id,school_id,house_id,learner_id,room_number,bed_number,start_date,status) SELECT ?,?,?,?,?,?,?,'active' WHERE EXISTS (SELECT 1 FROM boarding_allocations WHERE id=? AND school_id=? AND status='transferred' AND end_date=?)").bind(newId,schoolId,target.id,current.learner_id,room,normalizedBed,start,current.id,schoolId,endDate)
  ]);
  const [oldRow,newRow]=await Promise.all([
   env.DB.prepare("SELECT id,status,end_date FROM boarding_allocations WHERE id=? AND school_id=?").bind(current.id,schoolId).first(),
   env.DB.prepare("SELECT * FROM boarding_allocations WHERE id=? AND school_id=?").bind(newId,schoolId).first()
  ]);
  if(oldRow?.status!=="transferred"||!newRow)throw new Error("The transfer could not be verified after saving.");
  return json({ok:true,previous:oldRow,record:newRow,message:"Learner transferred successfully. The previous bed was vacated and the new placement was saved."},201);
 }catch(error){console.error("NAVSTAR boarding transfer",error);return json({ok:false,error:"The learner transfer could not be completed. Refresh the boarding register and verify the current placement."},500)}
}
