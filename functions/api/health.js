export async function onRequestGet({ env }) {
  try {
    if (!env.DB) {
      return Response.json(
        { ok: false, service: "NAVSTAR ERP API", error: "D1 binding DB is not configured" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    await env.DB.prepare("SELECT 1 AS ok").first();
    return Response.json(
      { ok: true, service: "NAVSTAR ERP API", database: "connected" },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { ok: false, service: "NAVSTAR ERP API", error: "Database health check failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
