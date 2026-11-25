import {getAuthenticatedSession} from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const uid=()=>crypto.randomUUID();
export async function onRequestPost({request,env}){
 const user=await getAuthenticatedSession(request,env);
 if(!user)return json({ok:false,error:"An active sign-in is required."},401);
 let body={};try{body=await request.json()}catch{}
 const schoolId=user.is_super_admin?String(body.school_id||""):schoolId;
 if(!schoolId)return json({ok:false,error:"School workspace is required."},400);
 if(!user.is_super_admin&&!user.role_keys?.includes("school_admin")&&!user.permissions?.includes("finance.view")&&!user.permissions?.includes("school.settings.manage"))return json({ok:false,error:"You do not have permission to view subscription billing."},403);
 if(!user.is_super_admin&&body.school_id&&body.school_id!==user.school_id)return json({ok:false,error:"You cannot access another school."},403);
 try{
  const sub=await env.DB.prepare("SELECT ss.id,ss.school_id,ss.estimated_amount_kes,ss.next_due_date,ss.status,ss.plan_id,ss.rate_override_kes,p.rate_kes,p.name AS plan_name FROM school_subscriptions ss LEFT JOIN subscription_plans p ON p.id=ss.plan_id WHERE ss.school_id=? ORDER BY ss.updated_at DESC LIMIT 1").bind(schoolId).first();
  if(!sub)return json({ok:true,created:false,message:"No subscription has been assigned yet."});
  const open=await env.DB.prepare("SELECT id,invoice_number,total,amount_paid,status FROM invoices WHERE school_id=? AND subscription_id=? AND status NOT IN ('paid','void') ORDER BY created_at DESC LIMIT 1").bind(schoolId,sub.id).first();
  if(open)return json({ok:true,created:false,invoice:open});
  const latest=await env.DB.prepare("SELECT id,invoice_number,status,due_date FROM invoices WHERE school_id=? AND subscription_id=? ORDER BY created_at DESC LIMIT 1").bind(schoolId,sub.id).first();
  const today=new Date().toISOString().slice(0,10);
  if(latest?.status==="paid"&&sub.next_due_date&&today<sub.next_due_date)return json({ok:true,created:false,message:"The next renewal invoice is not due yet."});
  const amount=Number(sub.estimated_amount_kes||0);
  if(!Number.isFinite(amount)||amount<=0)return json({ok:false,error:"The assigned subscription does not yet have a valid invoice amount. Please contact Navstar support."},409);
  const date=today.replace(/-/g,""),suffix=crypto.randomUUID().replace(/-/g,"").slice(0,6).toUpperCase(),invoiceNumber="NAV-"+date+"-"+suffix,invoiceId=uid(),due=sub.next_due_date||today;
  await env.DB.prepare("INSERT INTO invoices(id,school_id,subscription_id,invoice_number,currency,subtotal,discount,tax,total,amount_paid,status,issue_date,due_date) SELECT ?,?,?,?,'KES',?,0,0,?,0,'issued',?,? WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE school_id=? AND subscription_id=? AND status NOT IN ('paid','void'))").bind(invoiceId,user.school_id,sub.id,invoiceNumber,amount,amount,today,due,user.school_id,sub.id).run();
  const invoice=await env.DB.prepare("SELECT id,invoice_number,total,amount_paid,status,issue_date,due_date FROM invoices WHERE school_id=? AND subscription_id=? AND status NOT IN ('paid','void') ORDER BY created_at DESC LIMIT 1").bind(schoolId,sub.id).first();
  if(!invoice)return json({ok:false,error:"The invoice could not be created. Refresh billing and try again."},500);
  return json({ok:true,created:invoice.id===invoiceId,invoice,message:"Your subscription invoice is ready."},201);
 }catch(error){console.error("Navstar automatic subscription invoice",error);return json({ok:false,error:"The subscription invoice could not be generated. Please refresh billing."},500)}
}
