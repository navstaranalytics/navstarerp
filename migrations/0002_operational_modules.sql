-- NAVSTAR ERP operational modules extension. Safe to apply repeatedly.
CREATE TABLE IF NOT EXISTS assessments (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
 term_id TEXT REFERENCES terms(id) ON DELETE SET NULL,
 grade_level_id TEXT NOT NULL REFERENCES grade_levels(id) ON DELETE CASCADE,
 stream_id TEXT REFERENCES streams(id) ON DELETE SET NULL,
 learning_area_id TEXT NOT NULL REFERENCES learning_areas(id) ON DELETE CASCADE,
 title TEXT NOT NULL, assessment_type TEXT NOT NULL DEFAULT 'formative',
 max_score REAL NOT NULL DEFAULT 100, weight REAL NOT NULL DEFAULT 1,
 pathway TEXT, due_date TEXT, status TEXT NOT NULL DEFAULT 'draft',
 created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_assessments_scope ON assessments(school_id,academic_year_id,term_id,grade_level_id,stream_id);
CREATE TABLE IF NOT EXISTS assessment_results (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
 learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
 score REAL, grade TEXT, feedback TEXT, status TEXT NOT NULL DEFAULT 'draft',
 entered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(assessment_id,learner_id)
);
CREATE INDEX IF NOT EXISTS ix_assessment_results_learner ON assessment_results(school_id,learner_id);
CREATE TABLE IF NOT EXISTS grading_schemes (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 curriculum TEXT NOT NULL DEFAULT 'CBC', stage_code TEXT, name TEXT NOT NULL,
 description TEXT, is_active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS grade_boundaries (
 id TEXT PRIMARY KEY, scheme_id TEXT NOT NULL REFERENCES grading_schemes(id) ON DELETE CASCADE,
 label TEXT NOT NULL, min_score REAL NOT NULL, max_score REAL NOT NULL,
 points REAL, descriptor TEXT, UNIQUE(scheme_id,label)
);
CREATE TABLE IF NOT EXISTS attendance_sessions (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
 term_id TEXT REFERENCES terms(id) ON DELETE SET NULL,
 grade_level_id TEXT NOT NULL REFERENCES grade_levels(id) ON DELETE CASCADE,
 stream_id TEXT REFERENCES streams(id) ON DELETE SET NULL,
 attendance_date TEXT NOT NULL, session_name TEXT NOT NULL DEFAULT 'Morning',
 status TEXT NOT NULL DEFAULT 'open', taken_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(school_id,grade_level_id,stream_id,attendance_date,session_name)
);
CREATE TABLE IF NOT EXISTS attendance_records (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
 learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
 attendance_status TEXT NOT NULL CHECK(attendance_status IN ('present','absent','late','excused')),
 notes TEXT, marked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(session_id,learner_id)
);
CREATE TABLE IF NOT EXISTS timetable_entries (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
 term_id TEXT REFERENCES terms(id) ON DELETE SET NULL,
 grade_level_id TEXT NOT NULL REFERENCES grade_levels(id) ON DELETE CASCADE,
 stream_id TEXT REFERENCES streams(id) ON DELETE SET NULL,
 learning_area_id TEXT NOT NULL REFERENCES learning_areas(id) ON DELETE CASCADE,
 staff_id TEXT REFERENCES staff_profiles(id) ON DELETE SET NULL,
 weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),
 start_time TEXT NOT NULL, end_time TEXT NOT NULL, room TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS fee_structures (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 name TEXT NOT NULL, grade_level_id TEXT REFERENCES grade_levels(id) ON DELETE SET NULL,
 amount REAL NOT NULL CHECK(amount>=0), currency TEXT NOT NULL DEFAULT 'KES',
 frequency TEXT NOT NULL DEFAULT 'term', due_date TEXT, is_active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS learner_fee_accounts (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
 fee_structure_id TEXT NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
 academic_year_id TEXT REFERENCES academic_years(id) ON DELETE SET NULL,
 amount_due REAL NOT NULL DEFAULT 0, amount_paid REAL NOT NULL DEFAULT 0,
 balance REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open',
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(learner_id,fee_structure_id,academic_year_id)
);
CREATE TABLE IF NOT EXISTS finance_transactions (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 transaction_type TEXT NOT NULL CHECK(transaction_type IN ('income','expense')),
 category TEXT NOT NULL, description TEXT, amount REAL NOT NULL CHECK(amount>=0),
 transaction_date TEXT NOT NULL, payment_method TEXT, reference TEXT,
 recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS inventory_items (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 sku TEXT, name TEXT NOT NULL, category TEXT, unit TEXT,
 quantity REAL NOT NULL DEFAULT 0, reorder_level REAL NOT NULL DEFAULT 0,
 unit_cost REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(school_id,sku)
);
CREATE TABLE IF NOT EXISTS inventory_movements (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
 movement_type TEXT NOT NULL CHECK(movement_type IN ('stock_in','stock_out','adjustment')),
 quantity REAL NOT NULL, reason TEXT, reference TEXT,
 recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS library_books (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 isbn TEXT, accession_number TEXT, title TEXT NOT NULL, author TEXT, publisher TEXT,
 category TEXT, copies_total INTEGER NOT NULL DEFAULT 1, copies_available INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'available',
 UNIQUE(school_id,accession_number)
);
CREATE TABLE IF NOT EXISTS library_loans (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 book_id TEXT NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
 learner_id TEXT REFERENCES learners(id) ON DELETE SET NULL,
 staff_id TEXT REFERENCES staff_profiles(id) ON DELETE SET NULL,
 issued_at TEXT NOT NULL, due_at TEXT NOT NULL, returned_at TEXT,
 status TEXT NOT NULL DEFAULT 'issued', fine_amount REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transport_routes (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 route_name TEXT NOT NULL, vehicle_registration TEXT, driver_name TEXT, driver_phone TEXT,
 capacity INTEGER, pickup_points_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS transport_assignments (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 route_id TEXT NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
 learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
 pickup_point TEXT, effective_from TEXT, effective_to TEXT,
 UNIQUE(route_id,learner_id)
);
CREATE TABLE IF NOT EXISTS boarding_houses (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 name TEXT NOT NULL, house_type TEXT, capacity INTEGER, supervisor_staff_id TEXT REFERENCES staff_profiles(id) ON DELETE SET NULL,
 status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS boarding_allocations (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 house_id TEXT NOT NULL REFERENCES boarding_houses(id) ON DELETE CASCADE,
 learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
 room_number TEXT, bed_number TEXT, start_date TEXT, end_date TEXT,
 status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS payroll_records (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 staff_id TEXT NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
 pay_period TEXT NOT NULL, basic_pay REAL NOT NULL DEFAULT 0, allowances REAL NOT NULL DEFAULT 0,
 deductions REAL NOT NULL DEFAULT 0, net_pay REAL NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'draft', paid_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(staff_id,pay_period)
);
CREATE TABLE IF NOT EXISTS platform_regions (
 id TEXT PRIMARY KEY, region_name TEXT NOT NULL UNIQUE, counties_json TEXT NOT NULL DEFAULT '[]',
 is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS ai_usage_ledger (
 id TEXT PRIMARY KEY, school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
 user_id TEXT REFERENCES users(id) ON DELETE SET NULL, service TEXT NOT NULL,
 credits_used INTEGER NOT NULL DEFAULT 0, usage_details_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS integration_connections (
 id TEXT PRIMARY KEY, school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
 provider TEXT NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'disconnected',
 config_json TEXT NOT NULL DEFAULT '{}', last_sync_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(school_id,provider)
);
CREATE TABLE IF NOT EXISTS report_cards (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
 academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
 term_id TEXT REFERENCES terms(id) ON DELETE SET NULL,
 report_data_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft',
 published_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(learner_id,academic_year_id,term_id)
);
CREATE TABLE IF NOT EXISTS learner_discipline_records (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
 incident_date TEXT NOT NULL, category TEXT, description TEXT NOT NULL,
 action_taken TEXT, recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES('0002_operational_modules','Assessment, attendance, finance, timetable, inventory, library, transport, boarding, HR and reporting modules');