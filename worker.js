import { onRequestGet as supportGet, onRequestPost as supportPost } from "./functions/api/support.js";
import { onRequestPost as supportUpgradePost } from "./functions/api/support-upgrade.js";
import { onRequestPost as learnerGuardiansPost } from "./functions/api/learner-guardians.js";
import { onRequestPost as subscriptionPreferencePost } from "./functions/api/school-subscription-preference.js";
import { onRequestPost as paybillValidationPost } from "./functions/api/payments/mpesa/paybill/validation.js";
import { onRequestPost as paybillConfirmationPost } from "./functions/api/payments/mpesa/paybill/confirmation.js";
import { onRequestPost as aiDiagnosticsPost } from "./functions/api/ai-diagnostics.js";
import { onRequestGet as feeReceiptsGet, onRequestPost as feeReceiptsPost } from "./functions/api/fee-receipts.js";
import { onRequestGet as outputTemplatesGet, onRequestPost as outputTemplatesPost } from "./functions/api/output-templates.js";
import { onRequestPost as bulkLearnerImportPost } from "./functions/api/bulk-import-learners.js";
import { onRequestPost as bulkEnrollmentImportPost } from "./functions/api/bulk-import-enrollments.js";
import { onRequestPost as bulkLearnerAreasPost } from "./functions/api/bulk-learner-learning-areas.js";
import { onRequestPost as timetableGeneratePost } from "./functions/api/timetable-generate.js";
import { onRequestPost as reportCardGeneratePost } from "./functions/api/report-card-generate.js";
import { onRequestGet as schoolWorkspaceSummaryGet, onRequestPostMotto as schoolMottoPost } from "./functions/api/school-workspace-summary.js";
import { onRequestGet as platformControlsGet, onRequestPost as platformControlsPost } from "./functions/api/platform-controls.js";
import { onRequestGet as platformAccessGet, onRequestPatch as platformAccessPatch } from "./functions/api/platform-access.js";
import { onRequestGet as sampleDataGet, onRequestDelete as sampleDataDelete } from "./functions/api/sample-data.js";
import { onRequestGet as terminologyGet } from "./functions/api/terminology.js";
import { onRequestGet as systemGuideGet } from "./functions/api/system-guide.js";
import { runScheduledAutomations } from "./functions/api/scheduled-automations.js";
import { onRequestPostStk as mpesaStkPost, onRequestPostCallback as mpesaCallbackPost, onRequestPostSoda as mpesaSodaPost, onRequestGetSoda as mpesaSodaGet } from "./functions/api/mpesa-payments.js";
import { onRequestGet as paymentProviderStatusGet } from "./functions/api/payment-provider-status.js";
import { onRequestGet as schoolLogoGet, onRequestPost as schoolLogoPost } from "./functions/api/school-branding.js";
import { onRequestGetSettings as admissionSettingsGet, onRequestPostSettings as admissionSettingsPost, onRequestPostNextAdmissionNumber as nextAdmissionNumberPost, onRequestPostPhotos as learnerPhotosPost, onRequestGetPhoto as learnerPhotoGet } from "./functions/api/learner-photos.js";
import { onRequestGet as recoveryGet, onRequestPost as recoveryPost } from "./functions/api/recovery.js";
import { onRequestGet as academicPeriodGet } from "./functions/api/academic-period.js";
import { onRequestGet as schoolOutputPreferencesGet, onRequestPost as schoolOutputPreferencesPost } from "./functions/api/school-output-preferences.js";
import { onRequestGet as healthGet } from "./functions/api/health.js";
import { onRequestGet as setupStatusGet } from "./functions/api/setup-status.js";
import { onRequestPost as setupDatabasePost } from "./functions/api/setup-database.js";
import { onRequestGet as schoolsGet, onRequestPost as schoolsPost, onRequestPatch as schoolsPatch } from "./functions/api/schools.js";
import { onRequestGet as dataGet, onRequestPost as dataPost, onRequestPatch as dataPatch, onRequestDelete as dataDelete } from "./functions/api/data.js";
import { onRequestPost as upgradePost } from "./functions/api/upgrade.js";
import { onRequestPost as accessUpgradePost } from "./functions/api/access-upgrade.js";
import { onRequestPost as schoolAdminPost, onRequestPatch as schoolAdminPatch } from "./functions/api/school-admin.js";
import { onRequestGet as schoolUsersGet, onRequestPost as schoolUsersPost } from "./functions/api/school-users.js";
import { onRequestGet as schoolNameRequestsGet, onRequestPost as schoolNameRequestsPost, onRequestPatch as schoolNameRequestsPatch } from "./functions/api/school-name-requests.js";
import { onRequestPost as auditEventPost } from "./functions/api/audit-events.js";
import { onRequestGet as portalGet } from "./functions/api/portal.js";
import { onRequestGet as brandingGet, onRequestPost as brandingPost, onRequestGetLogo as brandingLogoGet, onRequestPostLogo as brandingLogoPost, onRequestGetStorageStatus as storageStatusGet, onRequestGetLoginBackground as loginBackgroundGet, onRequestPostLoginBackground as loginBackgroundPost } from "./functions/api/branding.js";
import { onRequestGet as profilePhotoGet, onRequestPost as profilePhotoPost } from "./functions/api/auth/profile-photo.js";
import { onRequestPost as accountLookupPost, onRequestPostUsernameAvailability } from "./functions/api/account-lookup.js";
import {
  onRequestPostSetupAdmin,
  onRequestPostLogin,
  onRequestGetMe,
  onRequestPostLogout,
  onRequestPostProfile,
  onRequestPostChangePassword,
  onRequestPostPasswordResetRequest,
  onRequestPostPasswordResetConfirm,
  onRequestPostUsernameRecoveryRequest,
  onRequestPostUsernameRecoveryConfirm,
  getAuthenticatedSession
} from "./functions/api/auth.js";

const jsonNotFound = () => Response.json(
  { ok: false, error: "API route not found." },
  { status: 404, headers: { "Cache-Control": "no-store" } }
);

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledAutomations(env, controller.scheduledTime));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Canonical public URLs never expose implementation filenames.
    const cleanPages={"/login":"/login.html","/setup-admin":"/setup-admin.html","/setup-database":"/setup-database.html","/school-portal":"/school-portal.html","/super-admin":"/super-admin.html"};
    const legacyToClean={"/login.html":"/login","/setup-admin.html":"/setup-admin","/setup-database.html":"/setup-database","/school-portal.html":"/school-portal","/super-admin.html":"/super-admin"};
    if(legacyToClean[url.pathname]&&!url.pathname.startsWith("/api/"))return Response.redirect(new URL(legacyToClean[url.pathname]+url.search,url),301);
    const route=url.pathname;
    if (route.startsWith("/api/") && !["/api/auth/login","/api/auth/me","/api/auth/logout","/api/health","/api/setup-status","/api/setup-database"].includes(route)) {
      const policySession = await getAuthenticatedSession(request, env);
      if (policySession && !policySession.is_super_admin) {
        const mode = policySession.access_mode || "full";
        const billingAllowed = ["/api/auth/me","/api/auth/logout","/api/school-workspace-summary","/api/terminology","/api/system-guide","/api/support","/api/payments/mpesa/stkpush","/api/payments/mpesa/soda","/api/school-subscription-preference"].includes(route) || /^\/api\/data\/(invoices|payments|subscriptions)$/.test(route);
        const readOnlyPaymentAllowed = route === "/api/payments/mpesa/stkpush" || route === "/api/payments/mpesa/soda" || route === "/api/support";
        const locked = mode === "block_all" || (mode === "billing_only" && !billingAllowed) || (mode === "read_only" && !["GET","HEAD","OPTIONS"].includes(request.method) && !readOnlyPaymentAllowed);
        if (locked) return Response.json({ ok:false, error: policySession.access_notice || "This school account is restricted by its subscription policy. Contact Navstar Analytics or open Billing & Support.", accessMode:mode }, { status:423, headers:{"Cache-Control":"no-store"} });
      }
    }
    if (route === "/api/platform-access") {
      if (request.method === "GET") return platformAccessGet({ request, env });
      if (request.method === "PATCH") return platformAccessPatch({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, PATCH" } });
    }
    if (route === "/api/platform-controls") {
      if (request.method === "GET") return platformControlsGet({ request, env });
      if (request.method === "POST") return platformControlsPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    if (route === "/api/payment-provider-status") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      return paymentProviderStatusGet({ request, env });
    }
    if (route === "/api/payments/mpesa/stkpush") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return mpesaStkPost({ request, env });
    }
    if (route === "/api/payments/mpesa/soda") { if(request.method==="POST")return mpesaSodaPost({request,env});if(request.method==="GET")return mpesaSodaGet({request,env});return new Response("Method not allowed",{status:405,headers:{Allow:"GET, POST"}}); }
    if(route==="/api/learner-guardians"){if(request.method!=="POST")return new Response("Method not allowed",{status:405,headers:{Allow:"POST"}});return learnerGuardiansPost({request,env});}
    if(route==="/api/school-subscription-preference"){if(request.method!=="POST")return new Response("Method not allowed",{status:405,headers:{Allow:"POST"}});return subscriptionPreferencePost({request,env});}
    if(route==="/api/payments/mpesa/paybill/validation"){if(request.method!=="POST")return new Response("Method not allowed",{status:405,headers:{Allow:"POST"}});return paybillValidationPost({request,env});}
    if(route==="/api/payments/mpesa/paybill/confirmation"){if(request.method!=="POST")return new Response("Method not allowed",{status:405,headers:{Allow:"POST"}});return paybillConfirmationPost({request,env});}
    if (route === "/api/payments/mpesa/callback") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return mpesaCallbackPost({ request, env });
    }
    if (route === "/api/system-guide") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      return systemGuideGet({ request, env });
    }
    if (route === "/api/terminology") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      return terminologyGet({ request, env });
    }
    if (route === "/api/sample-data") {
      if (request.method === "GET") return sampleDataGet({ request, env });
      if (request.method === "DELETE") return sampleDataDelete({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, DELETE" } });
    }
    if (route === "/api/school-motto") { if(request.method!=="POST")return new Response("Method not allowed",{status:405,headers:{Allow:"POST"}});return schoolMottoPost({request,env}); }
    if (route === "/api/school-workspace-summary") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      return schoolWorkspaceSummaryGet({ request, env });
    }
    if (route === "/api/academic-period") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      return academicPeriodGet({ request, env });
    }
    if (route === "/api/school-output-preferences") {
      if (request.method === "GET") return schoolOutputPreferencesGet({ request, env });
      if (request.method === "POST") return schoolOutputPreferencesPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
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
    if (route === "/api/admission-settings") {
      if (request.method === "GET") return admissionSettingsGet({ request, env });
      if (request.method === "POST") return admissionSettingsPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    if (route === "/api/admission-numbers/next") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return nextAdmissionNumberPost({ request, env });
    }
    if (route === "/api/learner-photos") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return learnerPhotosPost({ request, env });
    }
    if (route.startsWith("/api/learner-photos/") && request.method === "GET") return learnerPhotoGet({ request, env });
    if (route === "/api/school-branding/logo") {
      if (request.method === "GET") return schoolLogoGet({ request, env });
      if (request.method === "POST") return schoolLogoPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    if (route === "/api/report-cards/generate") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return reportCardGeneratePost({ request, env });
    }
    if (route === "/api/timetable/generate") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return timetableGeneratePost({ request, env });
    }
    if (route === "/api/bulk-learner-learning-areas") { if(request.method!=="POST")return new Response("Method not allowed",{status:405,headers:{Allow:"POST"}});return bulkLearnerAreasPost({request,env}); }
    if (route === "/api/bulk-import/enrollments") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return bulkEnrollmentImportPost({ request, env });
    }
    if (route === "/api/bulk-import/learners") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return bulkLearnerImportPost({ request, env });
    }
    if (route === "/api/output-templates") {
      if (request.method === "GET") return outputTemplatesGet({ request, env });
      if (request.method === "POST") return outputTemplatesPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    if (route === "/api/fee-receipts") {
      if (request.method === "GET") return feeReceiptsGet({ request, env });
      if (request.method === "POST") return feeReceiptsPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    if (route === "/api/support") {
      if (request.method === "GET") return supportGet({ request, env });
      if (request.method === "POST") return supportPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    if (route === "/api/system/support-upgrade") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return supportUpgradePost({ request, env });
    }
    if (route === "/api/ai/diagnostics") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return aiDiagnosticsPost({ request, env });
    }
    if (route === "/api/system/access-upgrade") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return accessUpgradePost({ request, env });
    }
    if (route === "/api/system/upgrade") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return upgradePost({ request, env });
    }
    if (route.startsWith("/api/data/")) {
      if (request.method === "GET") return dataGet({ request, env });
      if (request.method === "POST") return dataPost({ request, env });
      if (request.method === "PATCH") return dataPatch({ request, env });
      if (request.method === "DELETE") return dataDelete({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST, PATCH, DELETE" } });
    }
    if (route === "/api/recovery" || route.startsWith("/api/recovery/")) {
      if (request.method === "GET") return recoveryGet({ request, env });
      if (request.method === "POST" && route === "/api/recovery") return recoveryPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    if (route === "/api/audit-events") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return auditEventPost({ request, env });
    }
    if (route === "/api/school-name-requests") {
      if (request.method === "GET") return schoolNameRequestsGet({ request, env });
      if (request.method === "POST") return schoolNameRequestsPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    if (route.startsWith("/api/school-name-requests/") && request.method === "PATCH") return schoolNameRequestsPatch({ request, env });
    if (route === "/api/schools") {
      if (request.method === "GET") return schoolsGet({ request, env });
      if (request.method === "POST") return schoolsPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    // School profile PATCH requests are handled by the wildcard route below.
    if (route.startsWith("/api/schools/") && route.endsWith("/users")) {
      if (request.method === "GET") return schoolUsersGet({ request, env });
      if (request.method === "POST") return schoolUsersPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    if (route.startsWith("/api/schools/") && route.endsWith("/admin")) {
      if (request.method === "POST") return schoolAdminPost({ request, env });
      if (request.method === "PATCH") return schoolAdminPatch({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST, PATCH" } });
    }
    if (route.startsWith("/api/schools/")) {
      if (request.method === "PATCH") return schoolsPatch({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "PATCH" } });
    }
    if (route === "/api/setup-admin") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return onRequestPostSetupAdmin({ request, env });
    }
    if (route === "/api/storage/status") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      return storageStatusGet({ request, env });
    }
    if (route === "/api/branding/login-background") {
      if (request.method === "GET") return loginBackgroundGet({ request, env });
      if (request.method === "POST") return loginBackgroundPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    if (route === "/api/branding/logo") {
      if (request.method === "GET") return brandingLogoGet({ request, env });
      if (request.method === "POST") return brandingLogoPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    if (route === "/api/branding") {
      if (request.method === "GET") return brandingGet({ request, env });
      if (request.method === "POST") return brandingPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    if (route === "/api/portal/me") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      return portalGet({ request, env });
    }
    if (route === "/api/auth/username-availability") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return onRequestPostUsernameAvailability({ request, env });
    }
    if (route === "/api/auth/account-lookup") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return accountLookupPost({ request, env });
    }
    if (route === "/api/auth/username-recovery/request") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return onRequestPostUsernameRecoveryRequest({ request, env });
    }
    if (route === "/api/auth/username-recovery/confirm") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return onRequestPostUsernameRecoveryConfirm({ request, env });
    }
    if (route === "/api/auth/password-reset/request") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return onRequestPostPasswordResetRequest({ request, env });
    }
    if (route === "/api/auth/password-reset/confirm") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      return onRequestPostPasswordResetConfirm({ request, env });
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
    if (route === "/api/auth/profile-photo") {
      if (request.method === "GET") return profilePhotoGet({ request, env });
      if (request.method === "POST") return profilePhotoPost({ request, env });
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
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
        if (data.ok && data.setupRequired) return Response.redirect(new URL("/setup-admin", url), 302);
      } catch {}
    }
    const publicPages = ["/login", "/setup-admin", "/setup-database", "/school-portal", "/super-admin"];
    if (!publicPages.includes(route) && !route.startsWith("/api/") && !["/school-portal.html","/super-admin.html"].includes(route)) {
      const session = await getAuthenticatedSession(request, env);
      if (!session) {
        try {
          const state = await setupStatusGet({ request, env, params: {}, data: {} });
          const data = await state.json();
          const destination = data.ok && data.setupRequired ? "/setup-admin" : "/login";
          return Response.redirect(new URL(destination, url), 302);
        } catch {
          return Response.redirect(new URL("/login", url), 302);
        }
      }
      if (!session.is_super_admin && route !== "/school-portal")
        return Response.redirect(new URL("/school-portal", url), 302);
      if (route === "/school-portal" && session.is_super_admin)
        return Response.redirect(new URL("/super-admin", url), 302);
    }
    if (env.ASSETS) {
      const assetUrl=new URL(url);
      if(cleanPages[route])assetUrl.pathname=cleanPages[route];
      const assetRequest=assetUrl.href!==request.url?new Request(assetUrl.toString(),request):request;
      return env.ASSETS.fetch(assetRequest);
    }
    return jsonNotFound();
  }
};
