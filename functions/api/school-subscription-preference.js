import {getAuthenticatedSession} from "./auth.js";
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function onRequestPost({request,env}){
 const user=await getAuthenticatedSession(request,env);
 if(!user?.school_id)return json({ok:false,error:"School sign-in is required."},401);
 if(!user.permissions?.includes("*")&&!user.permissions?.includes("school.settings.manage"))return json({ok:false,error:"You do not have permission to update subscription preferences."},403);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid subscription preference."},400)}
 const paymentPlan=String(body.payment_plan||"").trim(),billingCycle=String(body.billing_cycle||"").trim(),method=String(body.preferred_payment_method||"").trim();
 const allowedPlans=["full","two_installments","three_installments","monthly"];
 const allowedCycles=["term","annual","monthly"];
 if(!allowedPlans.includes(paymentPlan)||!allowedCycles.includes(billingCycle)||!["mpesa","paybill"].includes(method))return json({ok:false,error:"Choose a supported payment plan, billing cycle and payment method."},400);
 const sub=await env.DB.prepare("SELECT id FROM school_subscriptions WHERE school_id=? ORDER BY updated_at DESC LIMIT 1").bind(user.school_id).first();
 if(!sub)return json({ok:false,error:"No subscription has been assigned to this school yet."},404);
 await env.DB.prepare("UPDATE school_subscriptions SET payment_plan=?,billing_cycle=?,preferred_payment_method=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND school_id=?").bind(paymentPlan,billingCycle,method,sub.id,user.school_id).run();
 return json({ok:true,message:"Payment preferences saved. The invoice amount and due dates remain governed by the assigned school plan."});
}
