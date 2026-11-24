const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function onRequestPost({request,env}){
 const url=new URL(request.url);if(!env.MPESA_CALLBACK_TOKEN||url.searchParams.get("token")!==env.MPESA_CALLBACK_TOKEN)return json({ResultCode:1,ResultDesc:"Invalid callback token."},403);
 let body;try{body=await request.json()}catch{return json({ResultCode:1,ResultDesc:"Invalid validation payload."},400)}
 const ref=String(body.BillRefNumber||"").trim(),amount=Number(body.TransAmount||0);
 if(!ref||!Number.isFinite(amount)||amount<=0)return json({ResultCode:1,ResultDesc:"Invoice reference and payment amount are required."});
 try{const invoice=await env.DB.prepare("SELECT i.id,i.total,i.amount_paid,i.status FROM invoices i WHERE i.invoice_number=? AND i.status NOT IN ('paid','void')").bind(ref).first();
 if(!invoice)return json({ResultCode:1,ResultDesc:"Invoice number not recognised."});
 const balance=Number(invoice.total)-Number(invoice.amount_paid||0);if(amount>balance+0.01)return json({ResultCode:1,ResultDesc:"Payment exceeds the outstanding invoice balance."});
 return json({ResultCode:0,ResultDesc:"Accepted"});
 }catch(error){console.error("Navstar Paybill validation",error);return json({ResultCode:1,ResultDesc:"Unable to validate invoice."},500)}
}
