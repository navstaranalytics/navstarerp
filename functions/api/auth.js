const COOKIE = "__Host-navstar_session";
const SESSION_HOURS = 8;
const PBKDF2_ITERATIONS = 310000;

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
const cookieValue = (request, name) => {
  const header = request.headers.get("Cookie") || "";
  const item = header.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
};
const sessionCookie = (token, maxAge = SESSION_HOURS * 3600) =>
  `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const clearCookie = () => sessionCookie("", 0);

async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hex(salt)}$${hex(bits)}`;
}
async function verifyPassword(password, stored) {
  try {
    const [scheme, rounds, saltHex, hashHex] = String(stored || "").split("$");
    if (scheme !== "pbkdf2" || Number(rounds) < 100000 || !saltHex || !hashHex) return false;
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
  if (!env?.DB) return null;
  const token = cookieValue(request, COOKIE);
  if (!token || token.length < 40) return null;
  const tokenHash = await digest(token);
  const row = await env.DB.prepare(`
    SELECT u.id, u.full_name, u.username, u.email, u.phone, u.status,
           p.designation, p.organisation_name, p.country, p.timezone, p.currency,
           s.id AS session_id, s.expires_at
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    JOIN user_role_assignments a ON a.user_id = u.id AND a.school_id IS NULL
    JOIN roles r ON r.id = a.role_id AND r.role_key = 'super_admin'
    LEFT JOIN super_admin_profiles p ON p.user_id = u.id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL
      AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND u.status = 'active'
    LIMIT 1
  `).bind(tokenHash).first();
  return row || null;
}
async function issueSession(env, request, userId, remember = false) {
  const token = randomHex(32);
  const maxAge = remember ? 30 * 24 * 3600 : SESSION_HOURS * 3600;
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
  if (password.length < 6 || password.length > 128 ||
      !/[A-Z]/.test(password) || !/[a-z]/.test(password) ||
      !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return json({ ok: false, error: "Password must be at least 6 characters and include an uppercase letter, a lowercase letter, a number and a special character." }, 400);
  }
  if (password !== confirmPassword) return json({ ok: false, error: "The passwords do not match." }, 400);

  try {
    if (!(await setupState(env))) return json({ ok: false, setupRequired: false, error: "Initial Super Admin setup has already been completed. Please sign in." }, 409);
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
    return json({ ok: true, setupRequired: false, message: "Your NAVSTAR Super Admin account has been created. Please sign in using your username or email and password." }, 201);
  } catch (error) {
    const message = String(error?.message || "");
    if (/super_admin_initialized|UNIQUE constraint/i.test(message)) {
      return json({ ok: false, setupRequired: false, error: "Initial setup has already been claimed or these details are already in use. Please sign in." }, 409);
    }
    return json({ ok: false, error: "The account could not be created. Check the details and try again." }, 500);
  }
}

export async function onRequestPostLogin({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "Database connection is unavailable." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Enter your username/email and password." }, 400); }
  const identifier = normalize(body.identifier);
  const password = String(body.password || "");
  if (!identifier || !password || identifier.length > 190 || password.length > 128) {
    return json({ ok: false, error: "Enter your username/email and password." }, 400);
  }
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS auth_login_attempts (
      identifier TEXT PRIMARY KEY, failed_count INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`).run();
    const attempt = await env.DB.prepare("SELECT failed_count, locked_until FROM auth_login_attempts WHERE identifier = ?").bind(identifier).first();
    if (attempt?.locked_until && attempt.locked_until > new Date().toISOString()) {
      return json({ ok: false, error: "Too many unsuccessful attempts. Please wait 15 minutes before trying again." }, 429);
    }
    const user = await env.DB.prepare(`
      SELECT u.id, u.password_hash, u.status
      FROM users u
      JOIN user_role_assignments a ON a.user_id = u.id AND a.school_id IS NULL
      JOIN roles r ON r.id = a.role_id AND r.role_key = 'super_admin'
      WHERE (u.username_normalized = ? OR u.email_normalized = ?)
      LIMIT 1
    `).bind(identifier, identifier).first();
    const valid = user && user.status === "active" && await verifyPassword(password, user.password_hash);
    if (!valid) {
      const failures = Number(attempt?.failed_count || 0) + 1;
      const lockedUntil = failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      await env.DB.prepare(`INSERT INTO auth_login_attempts (identifier, failed_count, locked_until, updated_at)
        VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ON CONFLICT(identifier) DO UPDATE SET failed_count = excluded.failed_count,
        locked_until = excluded.locked_until, updated_at = excluded.updated_at`)
        .bind(identifier, failures >= 5 ? 0 : failures, lockedUntil).run();
      await audit(env, user?.id, "auth.login", "denied", { reason: "invalid_credentials" });
      return json({ ok: false, error: "The username/email or password is incorrect, or the account is not active." }, 401);
    }
    await env.DB.prepare("DELETE FROM auth_login_attempts WHERE identifier = ?").bind(identifier).run();
    const issued = await issueSession(env, request, user.id, body.remember === true);
    const token = issued.token;
    await env.DB.prepare("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(user.id).run();
    await audit(env, user.id, "auth.login", "success");
    return json({ ok: true, message: "Signed in successfully.", redirect: "/super-admin.html" }, 200, {
      "Set-Cookie": sessionCookie(token, issued.maxAge)
    });
  } catch {
    return json({ ok: false, error: "Sign-in is temporarily unavailable. Please try again." }, 503);
  }
}

export async function onRequestGetMe({ request, env }) {
  const user = await getSuperAdminSession(request, env);
  if (!user) return json({ ok: false, authenticated: false }, 401);
  return json({ ok: true, authenticated: true, user: {
    id: user.id, fullName: user.full_name, username: user.username, email: user.email,
    phone: user.phone, designation: user.designation, organisationName: user.organisation_name,
    country: user.country, timezone: user.timezone, currency: user.currency
  } });
}
export async function onRequestPostLogout({ request, env }) {
  const token = cookieValue(request, COOKIE);
  if (token && env.DB) {
    try {
      await env.DB.prepare("UPDATE auth_sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash = ? AND revoked_at IS NULL")
        .bind(await digest(token)).run();
    } catch {}
  }
  return json({ ok: true, message: "Signed out." }, 200, { "Set-Cookie": clearCookie() });
}


export async function onRequestPostProfile({ request, env }) {
  const current = await getSuperAdminSession(request, env);
  if (!current) return json({ ok: false, error: "Your session has expired. Please sign in again." }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid profile details." }, 400); }
  const fullName = safeText(body.fullName);
  const email = normalize(body.email);
  const phone = safeText(body.phone);
  const designation = safeText(body.designation);
  const organisationName = safeText(body.organisationName);
  if (!fullName || fullName.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 190 || !phone || phone.length > 40 || !designation || designation.length > 100 ||
      !organisationName || organisationName.length > 140) {
    return json({ ok: false, error: "Complete all profile fields with valid details." }, 400);
  }
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET full_name = ?, email = ?, email_normalized = ?, phone = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .bind(fullName, email, email, phone, current.id),
      env.DB.prepare("UPDATE super_admin_profiles SET designation = ?, organisation_name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?")
        .bind(designation, organisationName, current.id)
    ]);
    await audit(env, current.id, "auth.profile.updated", "success");
    return json({ ok: true, message: "Profile updated." });
  } catch {
    return json({ ok: false, error: "The email may already be in use. Please check it and try again." }, 409);
  }
}

export async function onRequestPostChangePassword({ request, env }) {
  const current = await getSuperAdminSession(request, env);
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
  if (newPassword.length < 6 || newPassword.length > 128 ||
      !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
    return json({ ok: false, error: "Password must be at least 6 characters and include an uppercase letter, a lowercase letter, a number and a special character." }, 400);
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
