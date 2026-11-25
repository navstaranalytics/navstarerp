import { sendNavstarEmail } from "../lib/email.js";
const COOKIE = "__Host-navstar_session";
const SESSION_HOURS = 8;
const PBKDF2_ITERATIONS = 100000;

const json = (data, status = 200, extra = {}) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store", ...extra }
});
const id = () => crypto.randomUUID();
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
const fromHex = value => new Uint8Array((value.match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));
const randomHex = (length = 32) => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return hex(bytes);
};
const digest = async value => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
const normalize = value => String(value || "").trim().toLowerCase();
const safeText = value => String(value || "").trim();
async function getInlineBrandLogo(env) {
 try {
  const row=await env.DB.prepare("SELECT content_type,image_data,storage_provider,object_key FROM platform_branding_assets WHERE asset_key='platform-logo'").first();
  if(!row)return null;let bytes;
  if(row.storage_provider==="r2"&&env.R2&&row.object_key){const o=await env.R2.get(row.object_key);if(!o)return null;bytes=new Uint8Array(await o.arrayBuffer())}
  else bytes=row.image_data instanceof Uint8Array?row.image_data:new Uint8Array(row.image_data||[]);
  if(!bytes.length)return null;let binary="";
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  const mime=["image/png","image/jpeg","image/webp"].includes(row.content_type)?row.content_type:"image/png";
  const ext={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"}[mime];
  return {attachment:{filename:"navstar-platform-logo."+ext,content:btoa(binary),content_type:mime,content_id:"navstar-platform-logo"}};
 }catch(e){console.error("Could not attach platform logo:",String(e?.message||e));return null}
}

export const passwordPolicy = value => {
  if (value.length < 6 || value.length > 128) return false;
  const types = [/[A-Z]/.test(value), /[a-z]/.test(value), /[0-9]/.test(value), /[^A-Za-z0-9]/.test(value)];
  return types.filter(Boolean).length >= 3;
};
const cookieValue = (request, name) => {
  const header = request.headers.get("Cookie") || "";
  const item = header.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
};
const sessionCookie = (token, maxAge = SESSION_HOURS * 3600) =>
  `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const clearCookie = () => sessionCookie("", 0);

export async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hex(salt)}$${hex(bits)}`;
}
async function verifyPassword(password, stored) {
  try {
    const [scheme, rounds, saltHex, hashHex] = String(stored || "").split("$");
    if (scheme !== "pbkdf2" || !Number.isInteger(Number(rounds)) || Number(rounds) < 1 || Number(rounds) > 100000 || !saltHex || !hashHex) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({
      name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations: Number(rounds)
    }, key, 256));
    const expected = fromHex(hashHex);
    if (bits.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
    return diff === 0;
  } catch { return false; }
}
async function audit(env, actor, action, outcome, details = {}) {
  try {
    await env.DB.prepare(
      "INSERT INTO audit_logs (id, actor_user_id, action, resource_type, outcome, details_json) VALUES (?, ?, ?, 'authentication', ?, ?)"
    ).bind(id(), actor || null, action, outcome, JSON.stringify(details)).run();
  } catch {}
}
async function setupState(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM super_admin_profiles").first();
  return Number(row?.total || 0) === 0;
}
export async function getSuperAdminSession(request, env) {
  const user = await getAuthenticatedSession(request, env);
  return user?.is_super_admin ? user : null;
}
let profilePhotoColumnReady=false;
let profilePhotoColumnCheck=null;
async function ensureUserProfilePhotoColumn(db){
  if(profilePhotoColumnReady)return;
  if(!profilePhotoColumnCheck)profilePhotoColumnCheck=(async()=>{const info=await db.prepare("PRAGMA table_info(users)").all();if(!(info.results||[]).some(x=>x.name==="profile_photo_url"))await db.prepare("ALTER TABLE users ADD COLUMN profile_photo_url TEXT").run();profilePhotoColumnReady=true})().catch(error=>{profilePhotoColumnCheck=null;throw error});
  await profilePhotoColumnCheck;
}
export async function getAuthenticatedSession(request, env) {
  if (!env?.DB) return null;
  try{await ensureUserProfilePhotoColumn(env.DB)}catch(error){console.error("Profile photo column setup failed:",String(error?.message||error));return null;}
  // Navstar browser sessions are tab-scoped. Never fall back to a shared
  // browser cookie, which could silently reopen a session in a newly opened tab.
  const token=String(request.headers.get("X-Navstar-Session")||"").trim();
  if(!token||token.length<40)return null;
  const tokenHash=await digest(token);
  const row=await env.DB.prepare(`
    SELECT u.id,u.full_name,u.username,u.email,u.phone,u.status,
      s.created_at,s.last_seen_at,
      p.designation,p.organisation_name,COALESCE(u.profile_photo_url,p.profile_photo_url) AS profile_photo_url,p.country,p.timezone,p.currency,
      r.id AS role_id,r.role_key,r.role_name,a.school_id,a.scope_json,
      sc.name AS school_name,sc.status AS school_status,
      sm.membership_status
    FROM auth_sessions s
    JOIN users u ON u.id=s.user_id
    LEFT JOIN super_admin_profiles p ON p.user_id=u.id
    JOIN user_role_assignments a ON a.user_id=u.id
    JOIN roles r ON r.id=a.role_id
    LEFT JOIN school_memberships sm ON sm.user_id=u.id AND sm.school_id=a.school_id
    LEFT JOIN schools sc ON sc.id=a.school_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL
      AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND u.status='active'
      AND ((a.school_id IS NULL AND r.role_key='super_admin')
        OR (a.school_id IS NOT NULL AND sm.membership_status='active' AND sc.status IN ('active','suspended')))
    ORDER BY CASE WHEN r.role_key='super_admin' THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(tokenHash).first();
  if(!row)return null;
  try{
    const maintenance=await env.DB.prepare("SELECT setting_value FROM platform_settings WHERE setting_key='maintenance_mode'").first();
    const mode=JSON.parse(maintenance?.setting_value||"{}");
    if(mode.enabled&&row.role_key!=="super_admin"){
      await env.DB.prepare("UPDATE auth_sessions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash=? AND revoked_at IS NULL").bind(tokenHash).run();
      return null;
    }
  }catch(error){console.error("Maintenance mode check failed:",String(error?.message||error));if(row.role_key!=="super_admin")return null;}
  let sessionPolicy={idle_timeout_minutes:30};
  try{const setting=await env.DB.prepare("SELECT setting_value FROM platform_settings WHERE setting_key='session_policy'").first();if(setting?.setting_value){const parsed=JSON.parse(setting.setting_value);const minutes=Number(parsed.idle_timeout_minutes);if(Number.isInteger(minutes)&&minutes>=5&&minutes<=480)sessionPolicy={idle_timeout_minutes:minutes};}}catch(error){console.error("Session policy lookup failed:",String(error?.message||error));}
  const lastActivity=Date.parse(row.last_seen_at||row.created_at||"");
  if(Number.isFinite(lastActivity)&&Date.now()-lastActivity>sessionPolicy.idle_timeout_minutes*60000){
    await env.DB.prepare("UPDATE auth_sessions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash=? AND revoked_at IS NULL").bind(tokenHash).run();
    return null;
  }
  await env.DB.prepare("UPDATE auth_sessions SET last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash=? AND revoked_at IS NULL AND (last_seen_at IS NULL OR last_seen_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))").bind(tokenHash).run();
  const roleRows=await env.DB.prepare("SELECT r.id,r.role_key,r.role_name FROM user_role_assignments a JOIN roles r ON r.id=a.role_id WHERE a.user_id=? AND a.school_id IS ? ORDER BY CASE r.role_key WHEN 'school_admin' THEN 0 WHEN 'principal' THEN 1 WHEN 'school_owner' THEN 2 WHEN 'deputy_principal' THEN 3 WHEN 'director_of_studies' THEN 4 WHEN 'deputy_director_of_studies' THEN 5 WHEN 'senior_teacher' THEN 6 WHEN 'head_of_department' THEN 7 WHEN 'teacher' THEN 8 WHEN 'class_teacher' THEN 9 WHEN 'parent_guardian' THEN 20 WHEN 'student_learner' THEN 21 ELSE 10 END").bind(row.id,row.school_id??null).all();
  const roleKeysRaw=(roleRows.results||[]).map(x=>x.role_key);
  let accessMode="full",accessNotice="",subscriptionStatus=null;
  if(row.school_id){
    try{
      const sub=await env.DB.prepare("SELECT ss.status,ss.next_due_date,p.grace_period_days FROM school_subscriptions ss LEFT JOIN subscription_plans p ON p.id=ss.plan_id WHERE ss.school_id=? ORDER BY ss.updated_at DESC LIMIT 1").bind(row.school_id).first();
      let policy={};const setting=await env.DB.prepare("SELECT setting_value FROM platform_settings WHERE setting_key='subscription_policy'").first();try{policy=JSON.parse(setting?.setting_value||"{}")}catch{}
      subscriptionStatus=sub?.status||null;
      if(row.school_status==="suspended"||sub?.status==="suspended"){
        accessMode=policy.suspended_access||"billing_only";accessNotice="This school workspace is suspended under its subscription policy.";
      }else if(sub?.next_due_date){
        const today=new Date().toISOString().slice(0,10),daysLate=Math.floor((Date.parse(today+"T00:00:00Z")-Date.parse(sub.next_due_date+"T00:00:00Z"))/86400000);
        const grace=Number(policy.grace_period_days??sub.grace_period_days??7);
        if(daysLate>0){accessNotice="Subscription payment is overdue by "+daysLate+" day(s).";if(daysLate>grace){const action=policy.expiry_action||"suspend";if(action==="suspend")accessMode=policy.suspended_access||"billing_only";else if(action==="read_only"||action==="billing_only")accessMode=action;}}
      }
      if(sub?.status==="expired"||sub?.status==="cancelled"){const action=policy.expiry_action||"suspend";accessMode=action==="suspend"?(policy.suspended_access||"billing_only"):action==="warning_only"?"full":action;accessNotice="The school subscription is "+sub.status+".";}
    }catch(error){console.error("Subscription access policy lookup failed",error)}
  }

  const roleNames=(roleRows.results||[]).map(x=>x.role_name);
  const roleKeys=roleKeysRaw.map(k=>k==='parent_guardian'?'parent':k==='student_learner'?'student':k);
  let permissions=[];
  if(roleKeysRaw.includes('super_admin'))permissions=['*'];
  else {
    const roleIds=(roleRows.results||[]).map(x=>x.id);
    if(roleIds.length){
      const marks=roleIds.map(()=>'?').join(',');
      const p=await env.DB.prepare("SELECT DISTINCT p.permission_key FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id IN ("+marks+")").bind(...roleIds).all();
      permissions=(p.results||[]).map(x=>x.permission_key);
    }
    if(roleKeysRaw.includes('school_admin')){
      // School Administrators receive the complete school-level permission catalogue,
      // even when an older database has not yet populated role_permissions correctly.
      // Platform-wide controls remain excluded and every request is still scoped to row.school_id.
      const schoolPermissions=await env.DB.prepare("SELECT permission_key FROM permissions WHERE permission_key NOT IN ('platform.manage','schools.manage','billing.manage')").all();
      permissions.push(...(schoolPermissions.results||[]).map(x=>x.permission_key),'school.users.manage','school.settings.manage');
    }
    permissions=[...new Set(permissions)];
  }
  let scope={};try{scope=JSON.parse(row.scope_json||'{}')}catch{}
  const primaryRoleKey=roleKeysRaw[0]||row.role_key,primaryRoleName=roleNames[0]||row.role_name,primaryRoleId=(roleRows.results||[])[0]?.id||row.role_id;
  const normalizedRoleKey=primaryRoleKey==='parent_guardian'?'parent':primaryRoleKey==='student_learner'?'student':primaryRoleKey;
  return {...row,role_id:primaryRoleId,role_name:primaryRoleName,role_key:normalizedRoleKey,role_keys:roleKeys,role_names:roleNames,permissions,scope,is_super_admin:roleKeysRaw.includes('super_admin'),access_mode:accessMode,access_notice:accessNotice,subscription_status:subscriptionStatus,session_idle_timeout_minutes:sessionPolicy.idle_timeout_minutes};
}
async function issueSession(env, request, userId, remember = false) {
  const token = randomHex(32);
  const maxAge = SESSION_HOURS * 3600;
  const expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)"
  ).bind(id(), userId, await digest(token), expiresAt, request.headers.get("User-Agent") || "").run();
  return { token, maxAge };
}

export async function onRequestPostSetupAdmin({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "Database connection is unavailable." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Please submit the setup form again." }, 400); }

  const fullName = safeText(body.fullName);
  const username = normalize(body.username);
  const email = normalize(body.email);
  const phone = safeText(body.phone);
  const designation = safeText(body.designation);
  const organisationName = safeText(body.organisationName);
  const password = String(body.password || "");
  const confirmPassword = String(body.confirmPassword || "");

  if (!fullName || fullName.length > 120 || !/^[a-z0-9._-]{3,32}$/.test(username) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190 ||
      !phone || phone.length > 40 || !designation || designation.length > 100 ||
      !organisationName || organisationName.length > 140) {
    return json({ ok: false, error: "Please complete all required fields with valid details. Username must be 3–32 characters and use letters, numbers, dots, underscores or hyphens." }, 400);
  }
  if (!passwordPolicy(password)) {
    return json({ ok: false, error: "Password must be at least 6 characters and contain at least 3 of these 4 types: uppercase, lowercase, number and special character." }, 400);
  }
  if (password !== confirmPassword) return json({ ok: false, error: "The passwords do not match." }, 400);

  try {
    if (!(await setupState(env))) return json({ ok: false, setupRequired: false, error: "Initial Super Admin setup has already been completed. Please sign in." }, 409);
    const usernameTaken=await env.DB.prepare("SELECT 1 AS found FROM users WHERE username_normalized=? LIMIT 1").bind(username).first();
    if(usernameTaken)return json({ok:false,setupRequired:true,error:"That username is already taken across Navstar. Please choose a different username."},409);
    const emailTaken=await env.DB.prepare("SELECT 1 AS found FROM users WHERE email_normalized=? LIMIT 1").bind(email).first();
    if(emailTaken)return json({ok:false,setupRequired:true,error:"That email address is already registered. Use a different email address."},409);
    const userId = id();
    const passwordHash = await hashPassword(password);
    const statements = [
      env.DB.prepare("INSERT INTO platform_settings (setting_key, setting_value) VALUES ('super_admin_initialized', ?)").bind(userId),
      env.DB.prepare(`INSERT INTO users (id, email, email_normalized, username, username_normalized, phone, full_name, password_hash, status, password_changed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
        .bind(userId, email, email, username, username, phone, fullName, passwordHash),
      env.DB.prepare(`INSERT INTO super_admin_profiles (user_id, designation, organisation_name, country, timezone, currency, is_primary_owner)
        VALUES (?, ?, ?, 'Kenya', 'Africa/Nairobi', 'KES', 1)`).bind(userId, designation, organisationName),
      env.DB.prepare("INSERT INTO user_role_assignments (id, user_id, role_id, school_id, scope_json) VALUES (?, ?, 'role_super_admin', NULL, '{\"scope\":\"platform\"}')").bind(id(), userId),
      env.DB.prepare("INSERT INTO audit_logs (id, actor_user_id, action, resource_type, resource_id, outcome, details_json) VALUES (?, ?, 'super_admin.initial_setup', 'user', ?, 'success', ?)").bind(id(), userId, userId, JSON.stringify({ username, email }))
    ];
    await env.DB.batch(statements);
    return json({ ok: true, setupRequired: false, message: "Your Navstar Super Admin account has been created. Please sign in using your username and password." }, 201);
  } catch (error) {
    const message = String(error?.message || "Unknown database error");
    console.error("Navstar initial Super Admin setup failed:", message);
    if (/super_admin_initialized|UNIQUE constraint/i.test(message)) {
      return json({ ok: false, setupRequired: false, error: "Initial setup has already been claimed or these details are already in use. Please sign in." }, 409);
    }
    if (/FOREIGN KEY constraint/i.test(message)) {
      return json({ ok: false, error: "The Super Admin role is missing from the database seed data. Please run the database repair step, then retry." }, 500);
    }
    return json({ ok: false, error: "Account creation failed at the database stage: " + message.slice(0, 240) }, 500);
  }
}


export async function onRequestPostLogin({ request, env }) {
  if (!env.DB) return json({ ok:false,error:"Database connection is unavailable." },503);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Enter your username and password."},400)}
  const username=normalize(body.identifier),password=String(body.password||"");
  if(!/^[a-z0-9._-]{3,32}$/.test(username)||!password||password.length>128)
    return json({ok:false,error:"Enter your username and password."},400);
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS auth_login_attempts (
      identifier TEXT PRIMARY KEY,failed_count INTEGER NOT NULL DEFAULT 0,locked_until TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`).run();
    const attempt=await env.DB.prepare("SELECT failed_count,locked_until FROM auth_login_attempts WHERE identifier=?").bind(username).first();
    if(attempt?.locked_until&&attempt.locked_until>new Date().toISOString())
      return json({ok:false,error:"Too many unsuccessful attempts. Please wait 15 minutes before trying again."},429);
    const user=await env.DB.prepare(`
      SELECT u.id,u.full_name,u.password_hash,u.status,r.role_key,r.role_name,a.school_id,sc.name AS school_name,sm.membership_status,sc.status AS school_status
      FROM users u JOIN user_role_assignments a ON a.user_id=u.id
      JOIN roles r ON r.id=a.role_id
      LEFT JOIN school_memberships sm ON sm.user_id=u.id AND sm.school_id=a.school_id
      LEFT JOIN schools sc ON sc.id=a.school_id
      WHERE u.username_normalized=? AND
        ((a.school_id IS NULL AND r.role_key='super_admin') OR a.school_id IS NOT NULL)
      ORDER BY CASE WHEN r.role_key='super_admin' THEN 0 ELSE 1 END LIMIT 1
    `).bind(username).first();
    const valid=user&&await verifyPassword(password,user.password_hash);
    if(!valid){
      const failures=Number(attempt?.failed_count||0)+1,lockedUntil=failures>=5?new Date(Date.now()+15*60*1000).toISOString():null;
      await env.DB.prepare(`INSERT INTO auth_login_attempts(identifier,failed_count,locked_until,updated_at)
        VALUES(?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(identifier) DO UPDATE SET
        failed_count=excluded.failed_count,locked_until=excluded.locked_until,updated_at=excluded.updated_at`)
        .bind(username,failures>=5?0:failures,lockedUntil).run();
      await audit(env,user?.id,"auth.login","denied",{reason:"invalid_credentials"});
      return json({ok:false,error:"The username or password is incorrect, or the account is not active."},401);
    }
    let maintenanceMode={};try{const setting=await env.DB.prepare("SELECT setting_value FROM platform_settings WHERE setting_key='maintenance_mode'").first();maintenanceMode=JSON.parse(setting?.setting_value||"{}")}catch(error){console.error("Maintenance mode login check failed:",String(error?.message||error));if(user.role_key!=="super_admin")return json({ok:false,error:"The system availability check failed. Please try again shortly."},503)}
    if(maintenanceMode.enabled&&user.role_key!=="super_admin"){
      await audit(env,user.id,"auth.login","denied",{reason:"platform_maintenance"});
      return json({ok:false,maintenance:true,error:maintenanceMode.message||"Navstar is temporarily undergoing scheduled maintenance. Please try again shortly."},503);
    }
    if(user.status!=="active")return json({ok:false,error:"Your Navstar account is "+String(user.status||"inactive").replace(/_/g," ")+". Please contact your school administrator to resolve this access status."},403);
    if(user.role_key!=="super_admin"&&user.membership_status!=="active")return json({ok:false,error:"Your school membership is "+String(user.membership_status||"not active").replace(/_/g," ")+". Please contact your school administrator."},403);
    if(user.role_key!=="super_admin"&&user.school_status==="suspended")return json({ok:false,error:"Your school dashboard has been suspended. Please contact Navstar support or your school administrator."},403);
    if(user.role_key!=="super_admin"&&user.school_status!=="active")return json({ok:false,error:"Your school is "+String(user.school_status||"not active").replace(/_/g," ")+". Access will be available after the school status is resolved."},403);
    await env.DB.prepare("DELETE FROM auth_login_attempts WHERE identifier=?").bind(username).run();
    const issued=await issueSession(env,request,user.id,body.remember===true);
    await env.DB.prepare("UPDATE users SET last_login_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(user.id).run();
    await audit(env,user.id,"auth.login","success",{role:user.role_key,schoolId:user.school_id||null});
    const redirect=user.role_key==='super_admin'?'/super-admin':'/school-portal';
    return json({ok:true,message:"Signed in successfully.",redirect,sessionToken:issued.token,user:{fullName:user.full_name,username,role:user.role_name,roleKey:user.role_key,schoolId:user.school_id||null,schoolName:user.school_name||null}});
  }catch(error){console.error("Navstar login failure:",String(error?.message||error));return json({ok:false,error:"Sign-in is temporarily unavailable. Please try again."},503)}
}


export async function onRequestGetMe({request,env}) {
 const user=await getAuthenticatedSession(request,env);
 if(!user)return json({ok:false,authenticated:false},401);
 return json({ok:true,authenticated:true,user:{id:user.id,fullName:user.full_name,username:user.username,email:user.email,phone:user.phone,role:user.role_name,roleKey:user.role_key,roleKeys:user.role_keys||[user.role_key],roleNames:user.role_names||[user.role_name],schoolId:user.school_id||null,schoolName:user.school_name||null,permissions:user.permissions,scope:user.scope,designation:user.designation,organisationName:user.organisation_name,profilePhotoUrl:user.profile_photo_url,country:user.country,timezone:user.timezone,currency:user.currency,accessMode:user.access_mode||"full",accessNotice:user.access_notice||"",subscriptionStatus:user.subscription_status||null,sessionIdleTimeoutMinutes:user.session_idle_timeout_minutes||30}});
}
export async function onRequestPostLogout({ request, env }) {
  const token = String(request.headers.get("X-Navstar-Session")||cookieValue(request, COOKIE)).trim();
  if (token && env.DB) {
    try {
      await env.DB.prepare("UPDATE auth_sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash = ? AND revoked_at IS NULL")
        .bind(await digest(token)).run();
    } catch {}
  }
  return json({ ok: true, message: "Signed out." }, 200, { "Set-Cookie": clearCookie() });
}


export async function onRequestPostProfile({ request, env }) {
  const current = await getAuthenticatedSession(request, env);
  if (!current) return json({ ok: false, error: "Your session has expired. Please sign in again." }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid profile details." }, 400); }
  const fullName = safeText(body.fullName);
  const email = normalize(body.email);
  const phone = safeText(body.phone);
  const designation = safeText(body.designation);
  const organisationName = safeText(body.organisationName);
  const profilePhotoUrl = safeText(body.profilePhotoUrl);
  if (profilePhotoUrl && (!/^https:\/\//i.test(profilePhotoUrl) || profilePhotoUrl.length > 2048)) return json({ ok: false, error: 'Profile photo must be a valid HTTPS image URL.' }, 400);
  if (!fullName || fullName.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 190 || !phone || phone.length > 40 ||
      (current.is_super_admin && (!designation || designation.length > 100 || !organisationName || organisationName.length > 140))) {
    return json({ ok: false, error: "Complete all profile fields with valid details." }, 400);
  }
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET full_name = ?, email = ?, email_normalized = ?, phone = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .bind(fullName, email, email, phone, current.id),
      ...(current.is_super_admin?[env.DB.prepare("UPDATE super_admin_profiles SET designation = ?, organisation_name = ?, profile_photo_url = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?")
        .bind(designation, organisationName, profilePhotoUrl || null, current.id)]:[])
    ]);
    await audit(env, current.id, "auth.profile.updated", "success");
    return json({ ok: true, message: "Profile updated." });
  } catch {
    return json({ ok: false, error: "The email may already be in use. Please check it and try again." }, 409);
  }
}

export async function onRequestPostChangePassword({ request, env }) {
  const current = await getAuthenticatedSession(request, env);
  if (!current) return json({ ok: false, error: "Your session has expired. Please sign in again." }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid password request." }, 400); }
  const oldPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  const confirmPassword = String(body.confirmPassword || "");
  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(current.id).first();
  if (!row || !(await verifyPassword(oldPassword, row.password_hash))) {
    return json({ ok: false, error: "Your current password is incorrect." }, 401);
  }
  if (!passwordPolicy(newPassword)) {
    return json({ ok: false, error: "Password must be at least 6 characters and contain at least 3 of these 4 types: uppercase, lowercase, number and special character." }, 400);
  }
  if (newPassword !== confirmPassword) return json({ ok: false, error: "The new passwords do not match." }, 400);
  if (newPassword === oldPassword) return json({ ok: false, error: "Choose a password different from your current one." }, 400);
  try {
    const token = cookieValue(request, COOKIE);
    const tokenHash = await digest(token);
    const passwordHash = await hashPassword(newPassword);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash = ?, password_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(passwordHash, current.id),
      env.DB.prepare("UPDATE auth_sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL").bind(current.id, tokenHash)
    ]);
    await audit(env, current.id, "auth.password.changed", "success");
    return json({ ok: true, message: "Password changed. Other active sessions have been signed out." });
  } catch {
    return json({ ok: false, error: "The password could not be changed. Please try again." }, 500);
  }
}


const RESET_OTP_TTL_MINUTES = 10;
async function ensurePasswordResetTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS auth_password_resets (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    used_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`).run();
}
export async function onRequestPostPasswordResetRequest({ request, env }) {
  if (!env.DB) return json({ ok:false, error:"Database connection is unavailable." },503);
  if (!env.RESEND_API_KEY) return json({ ok:false, error:"Email delivery is not configured yet. The platform administrator must configure the email service before password resets can be used." },503);
  let body; try { body=await request.json(); } catch { return json({ok:false,error:"Enter your username."},400); }
  const identifier=normalize(body.identifier);
  if (!/^[a-z0-9._-]{3,32}$/.test(identifier)) return json({ok:false,error:"Enter your username (not your email address)."},400);
  try {
    await ensurePasswordResetTable(env.DB);
    const user=await env.DB.prepare(`SELECT u.id,u.email,u.full_name FROM users u
      WHERE u.username_normalized=? AND u.status='active' LIMIT 1`).bind(identifier).first();
    if (!user || !user.email) return json({ok:true,message:"If the account exists and has a registered email, a verification code will be sent."});
    const recent=await env.DB.prepare("SELECT COUNT(*) AS total FROM auth_password_resets WHERE user_id=? AND created_at > datetime('now','-1 hour')").bind(user.id).first();
    if (Number(recent?.total||0)>=3) return json({ok:false,error:"Too many reset requests. Please wait before requesting another code."},429);
    const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0");
    const resetId=id(), expiresAt=new Date(Date.now()+RESET_OTP_TTL_MINUTES*60*1000).toISOString();
    await env.DB.prepare("UPDATE auth_password_resets SET used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=? AND used_at IS NULL").bind(user.id).run();
    await env.DB.prepare("INSERT INTO auth_password_resets(id,user_id,code_hash,expires_at) VALUES(?,?,?,?)").bind(resetId,user.id,await digest(code),expiresAt).run();
    const brandRows=await env.DB.prepare("SELECT setting_key,setting_value FROM platform_settings WHERE setting_key IN ('platform_name','platform_tagline','platform_address','platform_city','platform_county','platform_phone','platform_website','platform_support_email')").all();
    const brand=Object.fromEntries((brandRows.results||[]).map(x=>[x.setting_key,x.setting_value]));
    const brandName=brand.platform_name||"Navstar Analytics",tagline=brand.platform_tagline||"Empowering Schools with Smart Data";
    const inlineLogo=await getInlineBrandLogo(env),logoUrl=inlineLogo?"cid:navstar-platform-logo":new URL(request.url).origin+"/api/branding/logo";
    const details=[brand.platform_address,brand.platform_city,brand.platform_county,brand.platform_phone,brand.platform_support_email,brand.platform_website].filter(Boolean).join(" · ");
    const safe=v=>String(v||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
    const html="<div style='margin:0;background:#f2f6fc;padding:32px 12px;font-family:Arial,sans-serif;color:#102b5c'><div style='max-width:560px;margin:auto;background:#fff;border:1px solid #dce6f5;border-radius:16px;overflow:hidden'><div style='background:#082b70;padding:24px;text-align:center'><img src='"+logoUrl+"' alt='"+safe(brandName)+"' style='max-width:190px;max-height:76px;object-fit:contain;background:#fff;border-radius:8px;padding:5px'><div style='color:#fff;font-size:12px;margin-top:10px'>"+safe(tagline)+"</div></div><div style='padding:30px'><p>Hello "+safe(user.full_name)+",</p><h2 style='color:#082b70'>Password reset verification</h2><p>Use the code below to verify your identity and create a new password.</p><div style='margin:24px 0;padding:18px;background:#edf4ff;border:1px solid #d6e5ff;border-radius:12px;text-align:center;font-size:32px;font-weight:800;letter-spacing:8px;color:#075be8'>"+code+"</div><p>This code expires in <b>10 minutes</b>. You have a limited number of attempts. If you did not request this reset, ignore this email.</p><p style='margin-top:28px'>Regards,<br><b>"+safe(brandName)+"</b></p></div><div style='background:#f6f8fc;padding:16px 22px;color:#718096;font-size:11px;text-align:center'>"+safe(details)+"</div></div></div>";
    const from=env.MAIL_FROM||"Navstar Analytics <no-reply@mail.navstardigitalhub.co.ke>";
    const response=await sendNavstarEmail(env,{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from,to:[user.email],subject:brandName+" password reset code",...(inlineLogo?{attachments:[inlineLogo.attachment]}:{}),html,text:"Hello "+user.full_name+",\n\nYour password reset verification code is "+code+". It expires in 10 minutes. If you did not request this, ignore this email.\n\n"+brandName})});
    if(!response.ok){await env.DB.prepare("UPDATE auth_password_resets SET used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(resetId).run();console.error("Password reset email delivery failed:",response.status,await response.text());return json({ok:false,error:"We could not deliver the email. Please contact the Help Desk or try again later."},502);}
    await audit(env,user.id,"auth.password_reset.requested","success");
    return json({ok:true,message:"A 6-digit verification code has been sent to your registered email address. It expires in 10 minutes."});
  } catch(error) { console.error("Password reset request failed:",String(error?.message||error)); return json({ok:false,error:"Password reset is temporarily unavailable. Please try again."},503); }
}
export async function onRequestPostPasswordResetConfirm({ request, env }) {
  if (!env.DB) return json({ok:false,error:"Database connection is unavailable."},503);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Enter the verification code and your new password."},400)}
  const identifier=normalize(body.identifier),code=String(body.code||"").trim(),password=String(body.newPassword||""),confirm=String(body.confirmPassword||"");
  if(!/^[a-z0-9._-]{3,32}$/.test(identifier)||!/^[0-9]{6}$/.test(code))return json({ok:false,error:"Enter your username and the 6-digit email verification code."},400);
  if(!passwordPolicy(password))return json({ok:false,error:"Password must be at least 6 characters and contain at least 3 of these 4 types: uppercase, lowercase, number and special character."},400);
  if(password!==confirm)return json({ok:false,error:"The new passwords do not match."},400);
  try{
    await ensurePasswordResetTable(env.DB);
    const user=await env.DB.prepare(`SELECT u.id FROM users u WHERE u.username_normalized=? AND u.status='active' LIMIT 1`).bind(identifier).first();
    if(!user)return json({ok:false,error:"The verification code is invalid or expired. Request a new code."},400);
    const reset=await env.DB.prepare("SELECT id,code_hash,expires_at,attempts FROM auth_password_resets WHERE user_id=? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1").bind(user.id).first();
    if(!reset||reset.expires_at<=new Date().toISOString()||Number(reset.attempts)>=5)return json({ok:false,error:"The verification code is invalid or expired. Request a new code."},400);
    if(await digest(code)!==reset.code_hash){await env.DB.prepare("UPDATE auth_password_resets SET attempts=attempts+1 WHERE id=?").bind(reset.id).run();return json({ok:false,error:"That verification code is incorrect. Please check the email and try again."},400);}
    const passwordHash=await hashPassword(password);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash=?,password_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(passwordHash,user.id),
      env.DB.prepare("UPDATE auth_password_resets SET used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(reset.id),
      env.DB.prepare("UPDATE auth_sessions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=? AND revoked_at IS NULL").bind(user.id)
    ]);
    await audit(env,user.id,"auth.password_reset.completed","success");
    return json({ok:true,message:"Your password has been reset. Please log in using your new password."});
  }catch(error){console.error("Password reset confirmation failed:",String(error?.message||error));return json({ok:false,error:"Password reset could not be completed. Please try again."},503);}
}


const USERNAME_OTP_TTL_MINUTES = 10;
async function ensureUsernameRecoveryTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS auth_username_resets (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    used_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`).run();
}
export async function onRequestPostUsernameRecoveryRequest({ request, env }) {
  if (!env.DB) return json({ok:false,error:"Database connection is unavailable."},503);
  if (!env.RESEND_API_KEY) return json({ok:false,error:"Email delivery is not configured yet. Please contact the platform administrator."},503);
  let body; try { body=await request.json(); } catch { return json({ok:false,error:"Enter the email address registered to your account."},400); }
  const email=normalize(body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>190) return json({ok:false,error:"Enter a valid registered email address."},400);
  try {
    await ensureUsernameRecoveryTable(env.DB);
    const user=await env.DB.prepare(`SELECT u.id,u.email,u.full_name FROM users u
      WHERE u.email_normalized=? AND u.status='active' LIMIT 1`).bind(email).first();
    if (!user) return json({ok:true,message:"If that email belongs to an active account, a verification code will be sent."});
    const recent=await env.DB.prepare("SELECT COUNT(*) AS total FROM auth_username_resets WHERE user_id=? AND created_at > datetime('now','-1 hour')").bind(user.id).first();
    if (Number(recent?.total||0)>=3) return json({ok:false,error:"Too many recovery requests. Please wait before requesting another code."},429);
    const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0");
    const resetId=id(), expiresAt=new Date(Date.now()+USERNAME_OTP_TTL_MINUTES*60*1000).toISOString();
    await env.DB.prepare("UPDATE auth_username_resets SET used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=? AND used_at IS NULL").bind(user.id).run();
    await env.DB.prepare("INSERT INTO auth_username_resets(id,user_id,code_hash,expires_at) VALUES(?,?,?,?)").bind(resetId,user.id,await digest(code),expiresAt).run();
    const rows=await env.DB.prepare("SELECT setting_key,setting_value FROM platform_settings WHERE setting_key IN ('platform_name','platform_tagline','platform_address','platform_city','platform_county','platform_phone','platform_website','platform_support_email')").all();
    const brand=Object.fromEntries((rows.results||[]).map(x=>[x.setting_key,x.setting_value]));
    const name=brand.platform_name||"Navstar Analytics", tagline=brand.platform_tagline||"Empowering Schools with Smart Data";
    const inlineLogo=await getInlineBrandLogo(env),logoUrl=inlineLogo?"cid:navstar-platform-logo":new URL(request.url).origin+"/api/branding/logo";
    const details=[brand.platform_address,brand.platform_city,brand.platform_county,brand.platform_phone,brand.platform_support_email,brand.platform_website].filter(Boolean).join(" · ");
    const safe=v=>String(v||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
    const html="<div style='margin:0;background:#f2f6fc;padding:32px 12px;font-family:Arial,sans-serif;color:#102b5c'><div style='max-width:560px;margin:auto;background:#fff;border:1px solid #dce6f5;border-radius:16px;overflow:hidden'><div style='background:#082b70;padding:24px;text-align:center'><img src='"+logoUrl+"' alt='"+safe(name)+"' style='max-width:190px;max-height:76px;object-fit:contain;background:#fff;border-radius:8px;padding:5px'><div style='color:#fff;font-size:12px;margin-top:10px'>"+safe(tagline)+"</div></div><div style='padding:30px'><p>Hello "+safe(user.full_name)+",</p><h2 style='color:#082b70'>Username recovery verification</h2><p>Use this code to verify your email and choose a new username for your Navstar Analytics account.</p><div style='margin:24px 0;padding:18px;background:#edf4ff;border:1px solid #d6e5ff;border-radius:12px;text-align:center;font-size:32px;font-weight:800;letter-spacing:8px;color:#075be8'>"+code+"</div><p>This code expires in <b>10 minutes</b>. If you did not request this, ignore this email.</p><p style='margin-top:28px'>Regards,<br><b>"+safe(name)+"</b></p></div><div style='background:#f6f8fc;padding:16px 22px;color:#718096;font-size:11px;text-align:center'>"+safe(details)+"</div></div></div>";
    const from=env.MAIL_FROM||"Navstar Analytics <no-reply@mail.navstardigitalhub.co.ke>";
    const response=await sendNavstarEmail(env,{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from,to:[user.email],subject:name+" username recovery code",...(inlineLogo?{attachments:[inlineLogo.attachment]}:{}),html,text:"Hello "+user.full_name+",\\n\\nYour username recovery verification code is "+code+". It expires in 10 minutes. If you did not request this, ignore this email.\\n\\n"+name})});
    if(!response.ok){await env.DB.prepare("UPDATE auth_username_resets SET used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(resetId).run();console.error("Username recovery email failed:",response.status,await response.text());return json({ok:false,error:"We could not deliver the email. Please try again later."},502);}
    await audit(env,user.id,"auth.username_recovery.requested","success");
    return json({ok:true,message:"A 6-digit verification code has been sent to your registered email. It expires in 10 minutes."});
  } catch(error) { console.error("Username recovery request failed:",String(error?.message||error)); return json({ok:false,error:"Username recovery is temporarily unavailable."},503); }
}
export async function onRequestPostUsernameRecoveryConfirm({ request, env }) {
  if (!env.DB) return json({ok:false,error:"Database connection is unavailable."},503);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Enter your email, verification code and new username."},400)}
  const email=normalize(body.email),code=String(body.code||"").trim(),username=normalize(body.newUsername);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^[0-9]{6}$/.test(code)||!/^[a-z0-9._-]{3,32}$/.test(username))return json({ok:false,error:"Enter a valid email, 6-digit code and username (3–32 letters, numbers, dots, underscores or hyphens)."},400);
  try {
    await ensureUsernameRecoveryTable(env.DB);
    const user=await env.DB.prepare(`SELECT u.id FROM users u WHERE u.email_normalized=? AND u.status='active' LIMIT 1`).bind(email).first();
    if(!user)return json({ok:false,error:"The verification code is invalid or expired. Request a new code."},400);
    const reset=await env.DB.prepare("SELECT id,code_hash,expires_at,attempts FROM auth_username_resets WHERE user_id=? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1").bind(user.id).first();
    if(!reset||reset.expires_at<=new Date().toISOString()||Number(reset.attempts)>=5)return json({ok:false,error:"The verification code is invalid or expired. Request a new code."},400);
    if(await digest(code)!==reset.code_hash){await env.DB.prepare("UPDATE auth_username_resets SET attempts=attempts+1 WHERE id=?").bind(reset.id).run();return json({ok:false,error:"That verification code is incorrect. Please check the email and try again."},400);}
    const duplicate=await env.DB.prepare("SELECT id FROM users WHERE username_normalized=? AND id<>? LIMIT 1").bind(username,user.id).first();
    if(duplicate)return json({ok:false,error:"That username is already in use. Please choose another one."},409);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET username=?,username_normalized=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(username,username,user.id),
      env.DB.prepare("UPDATE auth_username_resets SET used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(reset.id),
      env.DB.prepare("UPDATE auth_sessions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=? AND revoked_at IS NULL").bind(user.id)
    ]);
    await audit(env,user.id,"auth.username_recovery.completed","success",{username});
    return json({ok:true,username,message:"Your username has been updated. Use your new username and existing password to sign in."});
  } catch(error) { const message=String(error?.message||error);console.error("Username recovery confirmation failed:",message);if(/UNIQUE constraint/i.test(message))return json({ok:false,error:"That username has just been taken. Please choose another username."},409);return json({ok:false,error:"Your username could not be updated. Please try again."},503); }
}
