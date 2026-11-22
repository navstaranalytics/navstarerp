import { onRequestGet as healthGet } from "./functions/api/health.js";
import { onRequestGet as setupStatusGet } from "./functions/api/setup-status.js";
import { onRequestPost as setupDatabasePost } from "./functions/api/setup-database.js";
import { onRequestGet as schoolsGet, onRequestPost as schoolsPost, onRequestPatch as schoolsPatch } from "./functions/api/schools.js";
import {
  onRequestPostSetupAdmin,
  onRequestPostLogin,
  onRequestGetMe,
  onRequestPostLogout,
  onRequestPostProfile,
  onRequestPostChangePassword,
  getSuperAdminSession
} from "./functions/api/auth.js";

const jsonNotFound = () => Response.json(
  { ok: false, error: "API route not found." },
  { status: 404, headers: { "Cache-Control": "no-store" } }
);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = url.pathname;
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
    if (route === "/api/schools") {
      if (request.method === "GET") return schoolsGet({ request, env });
      if (request.method === "POST") return schoolsPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    if (route.startsWith("/api/schools/")) {
      if (request.method === "PATCH") return schoolsPatch({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "PATCH" } });
    }
    if (route === "/api/setup-admin") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return onRequestPostSetupAdmin({ request, env });
    }
    if (route === "/api/auth/login") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return onRequestPostLogin({ request, env });
    }
    if (route === "/api/auth/me") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      return onRequestGetMe({ request, env });
    }
    if (route === "/api/auth/logout") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return onRequestPostLogout({ request, env });
    }
    if (route === "/api/auth/profile") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return onRequestPostProfile({ request, env });
    }
    if (route === "/api/auth/change-password") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return onRequestPostChangePassword({ request, env });
    }

    if (route === "/" || route === "/index.html") {
      try {
        const state = await setupStatusGet({ request, env, params: {}, data: {} });
        const data = await state.json();
        if (data.ok && data.setupRequired) return Response.redirect(new URL("/setup-admin.html", url), 302);
      } catch {}
    }
    const publicPages = ["/login.html", "/setup-admin.html", "/setup-database.html"];
    if (!publicPages.includes(route) && !route.startsWith("/api/")) {
      const session = await getSuperAdminSession(request, env);
      if (!session) {
        try {
          const state = await setupStatusGet({ request, env, params: {}, data: {} });
          const data = await state.json();
          const destination = data.ok && data.setupRequired ? "/setup-admin.html" : "/login.html";
          return Response.redirect(new URL(destination, url), 302);
        } catch {
          return Response.redirect(new URL("/login.html", url), 302);
        }
      }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return jsonNotFound();
  }
};
