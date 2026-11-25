export async function onRequestGet({env}){
 try{
  const row=await env.DB.prepare("SELECT setting_value FROM platform_settings WHERE setting_key='maintenance_mode'").first();
  const maintenance=JSON.parse(row?.setting_value||"{}");
  return Response.json({ok:true,enabled:maintenance.enabled===true,message:String(maintenance.message||"Navstar is temporarily undergoing scheduled maintenance. Please try again shortly.")},{headers:{"Cache-Control":"no-store"}});
 }catch(error){console.error("Maintenance status lookup failed",String(error?.message||error));return Response.json({ok:false,error:"Maintenance status is temporarily unavailable."},{status:503,headers:{"Cache-Control":"no-store"}})}
}
