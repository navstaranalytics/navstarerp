import { getAuthenticatedSession } from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const uid=()=>crypto.randomUUID();
const can=(u,p)=>!!u.is_super_admin||!!u.permissions?.includes("*")||!!u.permissions?.includes(p);
export async function onRequestGet({request,env}){
 const user=await getAuthenticatedSession(request,env);
 if(!user)return json({ok:false,error:"Sign in to view fee receipts."},401);
 if(!can(user,"finance.view")&&!can(user,"finance.manage"))return json({ok:false,error:"You do not have permission to view fee receipts."},403);
 const schoolId=user.is_super_admin?new URL(request.url).searchParams.get("schoolId"):user.school_id;
 if(!schoolId)return json({ok:false,error:"School workspace is required."},400);
 try{
  const rows=await env.DB.prepare("SELECT r.*,a.learner_id,l.admission_number,l.first_name,l.last_name FROM fee_receipts r JOIN learner_fee_accounts a ON a.id=r.learner_fee_account_id AND a.school_id=r.school_id JOIN learners l ON l.id=a.learner_id AND l.school_id=a.school_id WHERE r.school_id=? ORDER BY r.received_at DESC,r.created_at DESC LIMIT 500").bind(schoolId).all();
  return json({ok:true,receipts:rows.results||[]});
 }catch(e){console.error("Fee receipts read failed",e);return json({ok:false,error:"Fee receipts are not installed. Apply the fee receipts database migration first."},503)}
}
export async function onRequestPost({request,env}){
 const user=await getAuthenticatedSession(request,env);
 if(!user)return json({ok:false,error:"Sign in before recording a fee receipt."},401);
 if(!can(user,"finance.manage"))return json({ok:false,error:"You do not have permission to record fee receipts."},403);
 let b;try{b=await request.json()}catch{return json({ok:false,error:"Invalid receipt details."},400)}
 const schoolId=user.is_super_admin?String(b.school_id||""):user.school_id;
 const accountId=String(b.learner_fee_account_id||"").trim();
 const amount=Number(b.amount);
 const method=String(b.payment_method||"").trim();
 const receivedAt=String(b.received_at||new Date().toISOString().slice(0,10)).slice(0,30);
 const reference=String(b.reference||"").trim().slice(0,100)||null;
 if(!schoolId||!accountId)return json({ok:false,error:"Select a learner fee account."},400);
 if(!Number.isFinite(amount)||amount<=0||!Number.isFinite(Math.round(amount*100)/100)||Math.round(amount*100)/100<=0)return json({ok:false,error:"Receipt amount must be at least KES 0.01."},400);
 if(!["Cash","Bank transfer","Mobile money","Cheque","Card","Other"].includes(method))return json({ok:false,error:"Select a valid payment method."},400);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)||!Number.isFinite(Date.parse(receivedAt+"T00:00:00Z"))||new Date(Date.parse(receivedAt+"T00:00:00Z")).toISOString().slice(0,10)!==receivedAt)return json({ok:false,error:"Enter a valid receipt date."},400);
 if(receivedAt>new Date().toISOString().slice(0,10))return json({ok:false,error:"A fee receipt cannot be dated in the future."},400);
 const amountRounded=Math.round(amount*100)/100,receiptId=uid(),receiptNumber="NVR-"+new Date().toISOString().slice(0,10).replaceAll("-","")+"-"+crypto.randomUUID().slice(0,8).toUpperCase();
 try{
  const beforeAccount=await env.DB.prepare("SELECT amount_due,amount_paid,balance FROM learner_fee_accounts WHERE id=? AND school_id=?").bind(accountId,schoolId).first();
  if(!beforeAccount)return json({ok:false,error:"Learner fee account was not found in this school."},404);
  if(Number(beforeAccount.balance||0)+0.001<amountRounded)return json({ok:false,error:"The receipt is greater than the outstanding balance. Refresh the account and enter an amount within the balance."},409);
  const statements=[
   env.DB.prepare("INSERT INTO fee_receipts(id,school_id,learner_fee_account_id,receipt_number,amount,payment_method,reference,received_at,recorded_by) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM learner_fee_accounts WHERE id=? AND school_id=?)").bind(receiptId,schoolId,accountId,receiptNumber,amountRounded,method,reference,receivedAt,user.id,accountId,schoolId),
   env.DB.prepare("INSERT INTO audit_logs(id,actor_user_id,school_id,action,resource_type,resource_id,outcome,details_json) VALUES(?,?,?,?,?,?,'success',?)").bind(uid(),user.id,schoolId,"fee.receipt.recorded","fee_receipt",receiptId,JSON.stringify({learner_fee_account_id:accountId,amount:amountRounded,payment_method:method,receipt_number:receiptNumber}))
  ];
  const results=await env.DB.batch(statements);
  if(!results[0]?.meta?.changes)return json({ok:false,error:"Learner fee account was not found in this school."},404);
  const [receipt,account]=await Promise.all([
   env.DB.prepare("SELECT id,receipt_number,amount,payment_method,reference,received_at,learner_fee_account_id FROM fee_receipts WHERE id=? AND school_id=?").bind(receiptId,schoolId).first(),
   env.DB.prepare("SELECT amount_due,amount_paid,balance,status FROM learner_fee_accounts WHERE id=? AND school_id=?").bind(accountId,schoolId).first()
  ]);
  if(!receipt||receipt.learner_fee_account_id!==accountId||Number(receipt.amount)!==amountRounded||!account||Number(account.amount_paid||0)+0.001<Number(beforeAccount.amount_paid||0)+amountRounded||Math.abs(Number(account.balance||0)-Math.max(0,Number(account.amount_due||0)-Number(account.amount_paid||0)))>0.01)return json({ok:false,error:"The receipt was recorded but its balance reconciliation could not be verified. Contact the school administrator before retrying."},500);
  return json({ok:true,receipt,account,message:"Receipt saved, audited and fee balance reconciled."},201);
 }catch(e){
  const msg=String(e?.message||"");
  if(msg.includes("Receipt exceeds"))return json({ok:false,error:"The receipt is greater than the outstanding balance. Refresh the account and enter an amount within the balance."},409);
  console.error("Fee receipt write failed",e);return json({ok:false,error:"Receipt could not be saved. Confirm that the fee receipts migration has been applied."},503);
 }
}
