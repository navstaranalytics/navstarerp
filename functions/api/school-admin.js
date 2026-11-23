const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function onRequestPost(){
 return json({ok:false,error:"School Administrator accounts are created automatically when a school is registered. Super Admins can view the assigned administrator in the school profile but cannot create a second account manually."},410);
}
