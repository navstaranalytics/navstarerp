const DEFAULT_FROM = "Navstar Analytics <no-reply@mail.navstardigitalhub.co.ke>";

/**
 * Single outbound email transport for every Navstar module.
 * MAIL_FROM is the Cloudflare Worker variable; the verified Navstar sender
 * is used only when that variable has not been supplied.
 */
export async function sendNavstarEmail(env, requestInit = {}) {
  if (!env?.RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "Email delivery is not configured." }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }

  let payload;
  try {
    payload = JSON.parse(String(requestInit.body || "{}"));
  } catch {
    return new Response(JSON.stringify({ error: "Invalid email payload." }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }

  payload.from = String(env.MAIL_FROM || DEFAULT_FROM).trim();
  return fetch("https://api.resend.com/emails", {
    ...requestInit,
    method: "POST",
    headers: {
      ...(requestInit.headers || {}),
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
