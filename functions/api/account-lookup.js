const norm=v=>String(v||"").trim().toLowerCase();
const json=(d,s=200)=>Response.json(d,{status:s,headers:{"Cache-Control":"no-store"}});
const maskEmail=v=>{const [a,b]=String(v||"").split("@");return a&&b?a.slice(0,1)+"•••@"+b:""};
const maskPhone=v=>{const d=String(v||"").replace(/\D/g,"");return d.length>2?"••••••"+d.slice(-2):d?"•••"+d:""};
const safeImage=v=>{const x=String(v||"").trim();return x.startsWith("/")||/^https:\/\//i.test(x)?x:""};
export async function onRequestPost({request,env}){
 if(!env.DB)return json({ok:false,error:"Account lookup is temporarily unavailable."},503);
 let body;try{body=await request.json()}catch{return json({ok:false,error:"Enter your username."},400)}
 const username=norm(body.username);
 if(!/^[a-z0-9._-]{3,32}$/.test(username))return json({ok:false,error:"Enter your username (3–32 letters, numbers, dots, underscores or hyphens). Email addresses cannot be used to sign in."},400);
 try{
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS auth_lookup_attempts(identifier TEXT PRIMARY KEY,attempt_count INTEGER NOT NULL DEFAULT 0,window_started TEXT NOT NULL)").run();
  const key=username;
  const row=await env.DB.prepare("SELECT attempt_count,window_started FROM auth_lookup_attempts WHERE identifier=?").bind(key).first();
  if(row&&row.window_started>new Date(Date.now()-60*60*1000).toISOString()&&Number(row.attempt_count)>=12)return json({ok:false,error:"Too many account lookups. Wait before trying again."},429);
  await env.DB.prepare("INSERT INTO auth_lookup_attempts(identifier,attempt_count,window_started) VALUES(?,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(identifier) DO UPDATE SET attempt_count=CASE WHEN window_started < datetime('now','-1 hour') THEN 1 ELSE attempt_count+1 END,window_started=CASE WHEN window_started < datetime('now','-1 hour') THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE window_started END").bind(key).run();
  const columns=await env.DB.prepare("PRAGMA table_info(users)").all();if(!(columns.results||[]).some(x=>x.name==="profile_photo_url"))await env.DB.prepare("ALTER TABLE users ADD COLUMN profile_photo_url TEXT").run();
  const user=await env.DB.prepare(`SELECT u.id,u.full_name,u.email,u.phone,u.username,u.status,r.role_name,r.role_key,
      s.id AS school_id,s.name AS school_name,s.contact_email AS school_email,s.contact_phone AS school_phone,
      ss.settings_json,COALESCE(u.profile_photo_url,p.profile_photo_url) AS profile_photo_url
    FROM users u JOIN user_role_assignments a ON a.user_id=u.id
    JOIN roles r ON r.id=a.role_id LEFT JOIN schools s ON s.id=a.school_id
    LEFT JOIN school_settings ss ON ss.school_id=s.id
    LEFT JOIN super_admin_profiles p ON p.user_id=u.id
    LEFT JOIN school_memberships m ON m.user_id=u.id AND m.school_id=a.school_id
    WHERE u.username_normalized=? AND u.status='active'
      AND ((a.school_id IS NULL AND r.role_key='super_admin') OR (a.school_id IS NOT NULL AND m.membership_status='active' AND s.status='active'))
    ORDER BY CASE WHEN r.role_key='super_admin' THEN 0 ELSE 1 END LIMIT 1`).bind(username).first();
  if(!user||user.status!=="active")return json({ok:false,error:"We couldn't verify that account. Check the username and try again."},404);
  let settings={};try{settings=JSON.parse(user.settings_json||"{}")}catch{}
  const meta=settings.navstar_school_meta||{},branding=settings.branding||{};
  const schoolLogo=safeImage(meta.logoUrl||meta.logo_url||meta.schoolLogoUrl||branding.logoUrl||settings.school_logo_url||settings.logoUrl);
  const isSuperAdmin=user.role_key==="super_admin";
  return json({ok:true,account:{fullName:user.full_name,username:user.username,maskedEmail:maskEmail(user.email),maskedPhone:maskPhone(user.phone),
    role:user.role_name,workspace:user.school_name||"NAVSTAR Platform",schoolName:user.school_name||"NAVSTAR Analytics",
    maskedSchoolEmail:maskEmail(user.school_email),maskedSchoolPhone:maskPhone(user.school_phone),
    profilePhotoUrl:safeImage(user.profile_photo_url),schoolLogoUrl:isSuperAdmin?"":schoolLogo||"/api/branding/logo",
    identityType:isSuperAdmin?"platform":"school"}});
 }catch(error){console.error("NAVSTAR username lookup",error);return json({ok:false,error:"Account lookup is temporarily unavailable."},503)}
}
