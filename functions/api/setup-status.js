export async function onRequestGet({ env }) {
  try {
    if (!env.DB) {
      return Response.json({ ok: false, error: "D1 binding DB is not configured" }, {
        status: 503, headers: { "Cache-Control": "no-store" }
      });
    }
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM super_admin_profiles"
    ).first();
    return Response.json({
      ok: true,
      setupRequired: Number(row?.total || 0) === 0
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({
      ok: false,
      error: "Database schema is not ready. Apply migration 0001_initial_schema.sql."
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
