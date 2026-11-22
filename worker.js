import { onRequestGet as healthGet } from "./functions/api/health.js";
import { onRequestGet as setupStatusGet } from "./functions/api/setup-status.js";
import { onRequestPost as setupDatabasePost } from "./functions/api/setup-database.js";

const jsonNotFound = () => Response.json(
  { ok: false, error: "API route not found." },
  { status: 404, headers: { "Cache-Control": "no-store" } }
);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = url.pathname.replace(/\\/+$/, "") || "/";

    // Route API requests to the existing Pages Function handlers.
    // Keeping these handlers as separate modules preserves one source of truth.
    if (route === "/api/health") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      return healthGet({ request, env, params: {}, data: {}, waitUntil: promise => ctx.waitUntil(promise) });
    }

    if (route === "/api/setup-status") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      return setupStatusGet({ request, env, params: {}, data: {}, waitUntil: promise => ctx.waitUntil(promise) });
    }

    if (route === "/api/setup-database") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return setupDatabasePost({ request, env, params: {}, data: {}, waitUntil: promise => ctx.waitUntil(promise) });
    }

    // All non-API requests are served from the versioned public asset directory.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return jsonNotFound();
  }
};
