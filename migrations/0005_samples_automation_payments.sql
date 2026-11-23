ALTER TABLE schools ADD COLUMN suspension_reason TEXT;
-- Navstar platform automation, sample-data tracking and payment callback ledger.
CREATE TABLE IF NOT EXISTS sample_data_records (
 id TEXT PRIMARY KEY,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 table_name TEXT NOT NULL CHECK(table_name IN ('learner_enrollments','learners','classes','streams','grade_levels','learning_areas','terms','academic_years')),
 record_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(school_id,table_name,record_id)
);
CREATE INDEX IF NOT EXISTS ix_sample_data_school ON sample_data_records(school_id);
CREATE TABLE IF NOT EXISTS platform_automation_runs (
 id TEXT PRIMARY KEY,
 task_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('success','failed','skipped')),
 started_at TEXT NOT NULL,
 finished_at TEXT,
 summary_json TEXT NOT NULL DEFAULT '{}',
 error_message TEXT
);
CREATE INDEX IF NOT EXISTS ix_automation_runs_task ON platform_automation_runs(task_key,started_at);
CREATE TABLE IF NOT EXISTS payment_provider_events (
 id TEXT PRIMARY KEY,
 provider TEXT NOT NULL,
 provider_event_id TEXT NOT NULL,
 payment_id TEXT,
 school_id TEXT,
 status TEXT NOT NULL,
 payload_json TEXT NOT NULL DEFAULT '{}',
 received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(provider,provider_event_id)
);
CREATE INDEX IF NOT EXISTS ix_payment_events_payment ON payment_provider_events(payment_id);
CREATE TABLE IF NOT EXISTS platform_automation_notifications (
 id TEXT PRIMARY KEY,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 task_key TEXT NOT NULL,
 reference_date TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(school_id,task_key,reference_date)
);
