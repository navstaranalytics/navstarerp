const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
const uid=()=>crypto.randomUUID();
async function extendIfSettled(db,invoiceId,schoolId){
 const invoice=await db.prepare("SELECT i.total,i.subscription_id FROM invoices i WHERE i.id=? AND i.school_id=?").bind(invoiceId,schoolId).first();if(!invoice?.subscription_id)return;
 const paid=await db.prepare("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE invoice_id=? AND status='confirmed'").bind(invoiceId).first();
 const total=Number(paid?.total||0),fully=total+0.001>=Number(invoice.total);await db.prepare("UPDATE invoices SET amount_paid=?,status=? WHERE id=? AND school_id=?").bind(Math.min(total,Number(invoice.total)),fully?"paid":"part_paid",invoiceId,schoolId).run();if(!fully)return;
 const sub=await db.prepare("SELECT ss.id,ss.next_due_date,p.billing_model FROM school_subscriptions ss LEFT JOIN subscription_plans p ON p.id=ss.plan_id WHERE ss.id=? AND ss.school_id=?").bind(invoice.subscription_id,schoolId).first();if(!sub)return;
 let date=sub.next_due_date?new Date(sub.next_due_date+"T00:00:00Z"):new Date();if(Number.isNaN(date.getTime()))date=new Date();const model=sub.billing_model||"flat_school_year";
 if(model.includes("year"))date.setUTCFullYear(date.getUTCFullYear()+1);else if(model.includes("term"))date.setUTCMonth(date.getUTCMonth()+4);else date.setUTCMonth(date.getUTCMonth()+1);
 const due=date.toISOString().slice(0,10);await db.batch([db.prepare("UPDATE school_subscriptions SET status='active',next_due_date=?,last_payment_confirmed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND school_id=?").bind(due,sub.id,schoolId),db.prepare("UPDATE schools SET status='active',suspension_reason=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND suspension_reason='subscription_overdue'").bind(schoolId)]);
}
export async function onRequestPost({request,env}){
 const url=new URL(request.url);if(!env.MPESA_CALLBACK_TOKEN||url.searchParams.get("token")!==env.MPESA_CALLBACK_TOKEN)return json({ResultCode:1,ResultDesc:"Invalid callback token."},403);
 let body;try{body=await request.json()}catch{return json({ResultCode:1,ResultDesc:"Invalid confirmation payload."},400)}
 const receipt=String(body.TransID||"").trim(),ref=String(body.BillRefNumber||"").trim(),amount=Number(body.TransAmount||0);
 if(!receipt||!ref||!Number.isFinite(amount)||amount<=0)return json({ResultCode:1,ResultDesc:"Missing Paybill transaction details."},400);
 try{
  const invoice=await env.DB.prepare("SELECT id,school_id,total,amount_paid,subscription_id FROM invoices WHERE invoice_number=? AND status NOT IN ('paid','void')").bind(ref).first();
  if(!invoice)return json({ResultCode:0,ResultDesc:"Acknowledged; invoice reference was not matched."});
  const duplicate=await env.DB.prepare("SELECT id FROM payment_provider_events WHERE provider='mpesa_paybill' AND provider_event_id=?").bind(receipt).first();if(duplicate)return json({ResultCode:0,ResultDesc:"Duplicate transaction already processed."});
  const balance=Number(invoice.total)-Number(invoice.amount_paid||0);if(amount>balance+0.01)return json({ResultCode:0,ResultDesc:"Payment received but exceeds the invoice balance; manual reconciliation required."});
  const paymentId=uid();await env.DB.batch([
   env.DB.prepare("INSERT INTO payments(id,school_id,invoice_id,amount,currency,method,provider_reference,status,received_at) VALUES(?,?,?,?,'KES','mpesa_paybill',?,'confirmed',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(paymentId,invoice.school_id,invoice.id,amount,receipt),
   env.DB.prepare("INSERT INTO payment_provider_events(id,provider,provider_event_id,payment_id,school_id,status,payload_json) VALUES(?,'mpesa_paybill',?,?,?,'confirmed',?)").bind(uid(),receipt,paymentId,invoice.school_id,JSON.stringify(body))
  ]);
  await extendIfSettled(env.DB,invoice.id,invoice.school_id);
  return json({ResultCode:0,ResultDesc:"Paybill payment recorded and invoice reconciled."});
 }catch(error){console.error("Navstar Paybill confirmation",error);return json({ResultCode:1,ResultDesc:"Confirmation processing failed."},500)}
}
