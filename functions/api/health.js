const REQUIRED_TABLES=[
  "users","schools","school_memberships","roles","permissions","role_permissions",
  "subscription_plans","school_subscriptions","invoices","payments",
  "academic_years","terms","grade_levels","streams","classes","learners","learner_enrollments",
  "learning_areas","learner_learning_areas","guardians","learner_guardians",
  "staff_profiles","staff_learning_areas","school_departments","teacher_allocations",
  "audit_logs","platform_settings","announcements","learner_user_links","school_documents","platform_backups",
  "assessments","assessment_results","grading_schemes","grade_boundaries","report_cards",
  "attendance_sessions","attendance_records","timetable_entries",
  "fee_structures","learner_fee_accounts","finance_transactions",
  "inventory_items","inventory_movements","library_books","library_loans",
  "transport_routes","transport_assignments","boarding_houses","boarding_rooms","boarding_allocations",
  "payroll_records","platform_regions","ai_usage_ledger","integration_connections","learner_discipline_records"
];
export async function onRequestGet({ env }) {
  try {
    if (!env.DB) {
      return Response.json(
        { ok:false, service:"Navstar Analytics API", error:"D1 binding DB is not configured" },
        { status:503, headers:{ "Cache-Control":"no-store" } }
      );
    }
    await env.DB.prepare("SELECT 1 AS ok").first();
    const placeholders=REQUIRED_TABLES.map(()=>"?").join(",");
    const result=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ("+placeholders+")").bind(...REQUIRED_TABLES).all();
    const present=new Set((result.results||[]).map(x=>x.name));
    const missing=REQUIRED_TABLES.filter(name=>!present.has(name));
    if(missing.length){
      return Response.json(
        { ok:false, service:"Navstar Analytics API", database:"connected", schema:"incomplete", missingTableCount:missing.length, error:"The database is reachable, but the required Navstar schema is incomplete." },
        { status:503, headers:{ "Cache-Control":"no-store" } }
      );
    }
    return Response.json(
      { ok:true, service:"Navstar Analytics API", database:"connected", schema:"ready" },
      { headers:{ "Cache-Control":"no-store" } }
    );
  } catch (error) {
    return Response.json(
      { ok:false, service:"Navstar Analytics API", error:"Database health check failed" },
      { status:503, headers:{ "Cache-Control":"no-store" } }
    );
  }
}
