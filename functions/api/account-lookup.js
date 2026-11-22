const norm=v=>String(v||"").trim().toLowerCase();
const json=(d,s=200)=>Response.json(d,{status:s,headers:{"Cache-Control":"no-store"}});
const maskEmail=v=>{const [a,b]=String(v||"").split("@");return a&&b?a.slice(0,1)+"•••@"+b:""};
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Account lookup is temporarily unavailable."},503);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Enter your username."},400)}
 const username=norm(body.username);
 if(!/^[a-z0-9._@+-]{3,190}$/.test(username))return json({ok:false,error:"Enter a valid username."},400);
 try{
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS auth_lookup_attempts(identifier TEXT PRIMARY KEY,attempt_count INTEGER NOT NULL DEFAULT 0,window_started TEXT NOT NULL)").run();
  const key=username;
  const row=await env.DB.prepare("SELECT attempt_count,window_started FROM auth_lookup_attempts WHERE identifier=?").bind(key).first();
  if(row&&row.window_started>new Date(Date.now()-60*60*1000).toISOString()&&Number(row.attempt_count)>=12)return json({ok:false,error:"Too many account lookups. Wait before trying again."},429);
  await env.DB.prepare("INSERT INTO auth_lookup_attempts(identifier,attempt_count,window_started) VALUES(?,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(identifier) DO UPDATE SET attempt_count=CASE WHEN window_started < datetime('now','-1 hour') THEN 1 ELSE attempt_count+1 END,window_started=CASE WHEN window_started < datetime('now','-1 hour') THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE window_started END").bind(key).run();
  const user=await env.DB.prepare(`SELECT u.id,u.full_name,u.email,u.username,u.status,r.role_name,s.name AS school_name
    FROM users u JOIN user_role_assignments a ON a.user_id=u.id
    JOIN roles r ON r.id=a.role_id LEFT JOIN schools s ON s.id=a.school_id
    WHERE u.username_normalized=? OR u.email_normalized=? ORDER BY CASE WHEN a.school_id IS NULL THEN 0 ELSE 1 END LIMIT 1`).bind(username,username).first();
  if(!user||user.status!=="active")return json({ok:false,error:"We couldn't verify that account. Check the username and try again."},404);
  return json({ok:true,account:{fullName:user.full_name,username:user.username,maskedEmail:maskEmail(user.email),role:user.role_name,workspace:user.school_name||"NAVSTAR Platform"}});
 }catch(error){console.error("NAVSTAR username lookup",error);return json({ok:false,error:"Account lookup is temporarily unavailable."},503)}
}
