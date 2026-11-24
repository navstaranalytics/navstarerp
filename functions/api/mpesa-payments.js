import { getAuthenticatedSession } from "./auth.js";
const json=(d,s=200)=>Response.json(d,{status:s,headers:{"Cache-Control":"no-store"}});
const uid=()=>crypto.randomUUID();
const safePhone=v=>{let n=String(v||"").replace(/[\s+()-]/g,"");if(n.startsWith("0"))n="254"+n.slice(1);if(n.startsWith("7")||n.startsWith("1"))n="254"+n;return /^254[17]\d{8}$/.test(n)?n:null};
async function accessToken(env){const base=env.MPESA_ENVIRONMENT==="sandbox"?"https://sandbox.safaricom.co.ke":"https://api.safaricom.co.ke";const auth=btoa(String(env.MPESA_CONSUMER_KEY)+":"+String(env.MPESA_CONSUMER_SECRET));const r=await fetch(base+"/oauth/v1/generate?grant_type=client_credentials",{headers:{Authorization:"Basic "+auth}});const d=await r.json();if(!r.ok||!d.access_token)throw new Error("Safaricom authentication failed. Check the M-Pesa API credentials.");return {token:d.access_token,base}}
export async function onRequestPostStk({request,env}){const user=await getAuthenticatedSession(request,env);if(!user?.school_id)return json({ok:false,error:"School sign-in is required."},401);if(user.access_mode==="block_all")return json({ok:false,error:"Online payment is unavailable under the current account access policy."},423);
 const required=["MPESA_CONSUMER_KEY","MPESA_CONSUMER_SECRET","MPESA_SHORTCODE","MPESA_PASSKEY","MPESA_CALLBACK_TOKEN"];if(required.some(k=>!env[k]))return json({ok:false,error:"M-Pesa is not configured yet. The platform administrator must add the Daraja credentials and callback token in Cloudflare Worker secrets."},503);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid payment request."},400)}const phone=safePhone(body.phone);if(!phone)return json({ok:false,error:"Enter a valid Kenyan Safaricom number, for example 07XXXXXXXX or 2547XXXXXXXX."},400);
 try{const invoice=await env.DB.prepare("SELECT i.*,ss.id AS subscription_id FROM invoices i JOIN school_subscriptions ss ON ss.id=i.subscription_id WHERE i.id=? AND i.school_id=?").bind(String(body.invoiceId||""),user.school_id).first();if(!invoice)return json({ok:false,error:"Choose a valid Navstar subscription invoice for this school."},404);if(["paid","void"].includes(invoice.status))return json({ok:false,error:"This invoice is already paid or void."},409);const amount=Math.ceil(Number(invoice.total)-Number(invoice.amount_paid||0));if(amount<1)return json({ok:false,error:"The invoice has no outstanding balance."},400);const pending=await env.DB.prepare("SELECT id FROM payments WHERE invoice_id=? AND method='mpesa' AND status='pending' LIMIT 1").bind(invoice.id).first();if(pending)return json({ok:false,error:"An M-Pesa payment request is already pending for this invoice. Complete it or wait for its callback before trying again."},409);
  const {token,base}=await accessToken(env),shortcode=String(env.MPESA_SHORTCODE),timestamp=new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14),password=btoa(shortcode+String(env.MPESA_PASSKEY)+timestamp),origin=new URL(request.url).origin,callback=origin+"/api/payments/mpesa/callback?token="+encodeURIComponent(env.MPESA_CALLBACK_TOKEN);
  const payload={BusinessShortCode:shortcode,Password:password,Timestamp:timestamp,TransactionType:env.MPESA_TRANSACTION_TYPE||"CustomerPayBillOnline",Amount:Math.ceil(amount),PartyA:phone,PartyB:shortcode,PhoneNumber:phone,CallBackURL:callback,AccountReference:String(invoice.invoice_number).slice(0,12),TransactionDesc:"Navstar subscription "+invoice.invoice_number};
  const response=await fetch(base+"/mpesa/stkpush/v1/processrequest",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok||result.ResponseCode!=="0")return json({ok:false,error:result.errorMessage||result.ResponseDescription||"Safaricom did not accept the payment request."},502);
  const paymentId=uid();await env.DB.prepare("INSERT INTO payments(id,school_id,invoice_id,amount,currency,method,provider_reference,status,recorded_by) VALUES(?,?,?,?,'KES','mpesa',?,'pending',?)").bind(paymentId,user.school_id,invoice.id,amount,result.CheckoutRequestID,user.id).run();
  return json({ok:true,paymentId,checkoutRequestId:result.CheckoutRequestID,customerMessage:result.CustomerMessage||"Check your phone and enter your M-Pesa PIN to complete the payment.",amount,invoiceNumber:invoice.invoice_number});
 }catch(e){console.error("Navstar M-Pesa STK request",e);return json({ok:false,error:e.message||"Could not start the M-Pesa payment."},502)}
}

export async function onRequestPostSoda({request,env}){
 const user=await getAuthenticatedSession(request,env);
 if(!user?.school_id)return json({ok:false,error:"School sign-in is required."},401);
 if(user.access_mode==="block_all")return json({ok:false,error:"Online payments are unavailable under the current account access policy."},423);
 const required=["MPESA_CONSUMER_KEY","MPESA_CONSUMER_SECRET","MPESA_SHORTCODE","MPESA_PASSKEY","MPESA_CALLBACK_TOKEN"];
 if(required.some(k=>!env[k]))return json({ok:false,error:"Daraja is not configured. Ask the Navstar platform administrator to configure the protected Cloudflare M-Pesa secrets."},503);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid soda contribution request."},400)}
 const phone=safePhone(body.phone),amount=Number(body.amount);
 if(!phone)return json({ok:false,error:"Enter a valid Kenyan Safaricom number, for example 07XXXXXXXX."},400);
 if(!Number.isSafeInteger(amount)||amount<10||amount>5000)return json({ok:false,error:"Choose an amount between KES 10 and KES 5,000."},400);
 try{
  const pending=await env.DB.prepare("SELECT id FROM school_contributions WHERE school_id=? AND status='pending' AND created_at>=datetime('now','-10 minutes') LIMIT 1").bind(user.school_id).first();
  if(pending)return json({ok:false,error:"A contribution request is already awaiting confirmation. Please verify it before starting another."},409);
  const {token,base}=await accessToken(env),shortcode=String(env.MPESA_SHORTCODE),timestamp=new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14),password=btoa(shortcode+String(env.MPESA_PASSKEY)+timestamp),origin=new URL(request.url).origin,callback=origin+"/api/payments/mpesa/callback?token="+encodeURIComponent(env.MPESA_CALLBACK_TOKEN);
  const payload={BusinessShortCode:shortcode,Password:password,Timestamp:timestamp,TransactionType:env.MPESA_TRANSACTION_TYPE||"CustomerPayBillOnline",Amount:amount,PartyA:phone,PartyB:shortcode,PhoneNumber:phone,CallBackURL:callback,AccountReference:"NAVSODA",TransactionDesc:"Voluntary Navstar soda appreciation"};
  const response=await fetch(base+"/mpesa/stkpush/v1/processrequest",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const result=await response.json();
  if(!response.ok||result.ResponseCode!=="0")return json({ok:false,error:result.errorMessage||result.ResponseDescription||"Safaricom did not accept the STK request."},502);
  const paymentId=uid(),contributionId=uid();
  await env.DB.batch([
   env.DB.prepare("INSERT INTO payments(id,school_id,invoice_id,amount,currency,method,provider_reference,status,recorded_by) VALUES(?,?,NULL,?,'KES','mpesa',?,'pending',?)").bind(paymentId,user.school_id,amount,result.CheckoutRequestID,user.id),
   env.DB.prepare("INSERT INTO school_contributions(id,school_id,payment_id,amount,phone_number,checkout_request_id,merchant_request_id,status) VALUES(?,?,?,?,?,?,?,'pending')").bind(contributionId,user.school_id,paymentId,amount,phone,result.CheckoutRequestID,result.MerchantRequestID||null)
  ]);
  return json({ok:true,contributionId,checkoutRequestId:result.CheckoutRequestID,amount,customerMessage:result.CustomerMessage||"Check your phone and enter your M-Pesa PIN to complete the voluntary contribution."});
 }catch(e){console.error("Navstar soda contribution STK request",e);return json({ok:false,error:e.message||"Could not start the M-Pesa request."},502)}
}
export async function onRequestGetSoda({request,env}){
 const user=await getAuthenticatedSession(request,env);
 if(!user?.school_id)return json({ok:false,error:"School sign-in is required."},401);
 const idValue=new URL(request.url).searchParams.get("id")||"";
 if(!idValue)return json({ok:false,error:"Contribution reference is required."},400);
 const row=await env.DB.prepare("SELECT id,amount,status,mpesa_receipt_number,transaction_date,result_description,created_at,confirmed_at,checkout_request_id FROM school_contributions WHERE id=? AND school_id=?").bind(idValue,user.school_id).first();
 if(!row)return json({ok:false,error:"Contribution record not found."},404);
 return json({ok:true,contribution:row});
}

export async function onRequestPostCallback({request,env}){if(!env.MPESA_CALLBACK_TOKEN||new URL(request.url).searchParams.get("token")!==env.MPESA_CALLBACK_TOKEN)return json({ok:false,error:"Invalid callback token."},403);let body;try{body=await request.json()}catch{return json({ResultCode:1,ResultDesc:"Invalid callback payload."},400)}
 const callback=body?.Body?.stkCallback;if(!callback?.CheckoutRequestID)return json({ResultCode:1,ResultDesc:"Missing checkout reference."},400);const ref=String(callback.CheckoutRequestID);
 try{const payment=await env.DB.prepare("SELECT p.*,i.id AS invoice_key,i.subscription_id FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id WHERE p.provider_reference=? AND p.method='mpesa'").bind(ref).first();if(!payment)return json({ResultCode:0,ResultDesc:"Callback acknowledged; no matching pending transaction."});if(payment.status!=="pending")return json({ResultCode:0,ResultDesc:"Payment was already processed."});
  const meta=callback.CallbackMetadata?.Item||[],get=k=>meta.find(x=>x.Name===k)?.Value;const receipt=get("MpesaReceiptNumber")||null,paidAmount=Number(get("Amount")||0),success=Number(callback.ResultCode)===0&&Math.abs(paidAmount-Number(payment.amount))<0.01;const eventId=ref+":"+(receipt||String(callback.ResultCode));const existing=await env.DB.prepare("SELECT id FROM payment_provider_events WHERE provider='mpesa' AND provider_event_id=?").bind(eventId).first();if(existing)return json({ResultCode:0,ResultDesc:"Duplicate callback already processed."});
  await env.DB.prepare("INSERT INTO payment_provider_events(id,provider,provider_event_id,payment_id,school_id,status,payload_json) VALUES(?,'mpesa',?,?,?,?,?)").bind(uid(),eventId,payment.id,payment.school_id,success?"confirmed":"failed",JSON.stringify(body)).run();
  const contribution=await env.DB.prepare("SELECT id FROM school_contributions WHERE payment_id=?").bind(payment.id).first();
  if(contribution){
   const rawDate=get("TransactionDate"),transactionDate=rawDate?String(rawDate).replace(/^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})$/,"$1-$2-$3T$4:$5:$6"):null;
   if(success)await env.DB.batch([
    env.DB.prepare("UPDATE payments SET status='confirmed',received_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending'").bind(payment.id),
    env.DB.prepare("UPDATE school_contributions SET status='confirmed',mpesa_receipt_number=?,transaction_date=?,result_code=?,result_description=?,confirmed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending'").bind(receipt,transactionDate,Number(callback.ResultCode),String(callback.ResultDesc||"Payment confirmed"),contribution.id)
   ]);
   else await env.DB.batch([
    env.DB.prepare("UPDATE payments SET status='failed' WHERE id=? AND status='pending'").bind(payment.id),
    env.DB.prepare("UPDATE school_contributions SET status='failed',result_code=?,result_description=? WHERE id=? AND status='pending'").bind(Number(callback.ResultCode),String(callback.ResultDesc||"Payment was not completed"),contribution.id)
   ]);
   return json({ResultCode:0,ResultDesc:"Contribution callback processed."});
  }
  if(success){
   await env.DB.prepare("UPDATE payments SET status='confirmed',received_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending'").bind(payment.id).run();
   const paid=await env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE invoice_id=? AND status='confirmed'").bind(payment.invoice_id).first();const total=Number(paid?.total||0);const invoice=await env.DB.prepare("SELECT total,subscription_id FROM invoices WHERE id=?").bind(payment.invoice_id).first();const amountApplied=Math.min(total,Number(invoice.total));const fullyPaid=total+0.001>=Number(invoice.total);
   await env.DB.prepare("UPDATE invoices SET amount_paid=?,status=? WHERE id=?").bind(amountApplied,fullyPaid?"paid":"part_paid",payment.invoice_id).run();
   if(fullyPaid&&payment.subscription_id){const sub=await env.DB.prepare("SELECT ss.id,ss.next_due_date,ss.contract_start_date,p.billing_model FROM school_subscriptions ss LEFT JOIN subscription_plans p ON p.id=ss.plan_id WHERE ss.id=?").bind(payment.subscription_id).first();let next=sub?.next_due_date||new Date().toISOString().slice(0,10);let baseDate=new Date(next+"T00:00:00Z");if(Number.isNaN(baseDate.getTime()))baseDate=new Date();const model=sub?.billing_model||"flat_school_month";if(model.includes("year"))baseDate.setUTCFullYear(baseDate.getUTCFullYear()+1);else if(model.includes("term"))baseDate.setUTCMonth(baseDate.getUTCMonth()+4);else if(model.includes("month"))baseDate.setUTCMonth(baseDate.getUTCMonth()+1);else baseDate.setUTCMonth(baseDate.getUTCMonth()+1);const due=baseDate.toISOString().slice(0,10);await env.DB.batch([env.DB.prepare("UPDATE school_subscriptions SET status='active',next_due_date=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(due,payment.subscription_id),env.DB.prepare("UPDATE schools SET status='active',suspension_reason=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND suspension_reason='subscription_overdue'").bind(payment.school_id)]);}
  }else{await env.DB.prepare("UPDATE payments SET status='failed' WHERE id=? AND status='pending'").bind(payment.id).run();}
  return json({ResultCode:0,ResultDesc:"Callback processed."});
 }catch(e){console.error("Navstar M-Pesa callback",e);return json({ResultCode:1,ResultDesc:"Callback processing failed."},500)}
}
