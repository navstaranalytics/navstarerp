-- Navstar integrated admissions, assessment numbering and school calendar.
-- Additive only: existing learner, guardian, assessment, subscription and payment records remain intact.
ALTER TABLE guardians ADD COLUMN title TEXT;
ALTER TABLE guardians ADD COLUMN national_id TEXT;
ALTER TABLE guardians ADD COLUMN occupation TEXT;
ALTER TABLE guardians ADD COLUMN postal_address TEXT;
ALTER TABLE guardians ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1));

ALTER TABLE assessments ADD COLUMN assessment_number TEXT;
ALTER TABLE assessments ADD COLUMN examination_session TEXT;
CREATE INDEX IF NOT EXISTS ix_assessments_school_number ON assessments(school_id,assessment_number);

ALTER TABLE school_subscriptions ADD COLUMN payment_plan TEXT;
ALTER TABLE school_subscriptions ADD COLUMN billing_cycle TEXT;
ALTER TABLE school_subscriptions ADD COLUMN last_payment_confirmed_at TEXT;

CREATE TABLE IF NOT EXISTS school_calendar_events (
 id TEXT PRIMARY KEY,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 description TEXT,
 event_type TEXT NOT NULL DEFAULT 'school_event',
 start_at TEXT NOT NULL,
 end_at TEXT,
 audience TEXT NOT NULL DEFAULT 'all',
 reminder_minutes INTEGER NOT NULL DEFAULT 0,
 reminder_sent_at TEXT,
 created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_school_calendar_events_date ON school_calendar_events(school_id,start_at,status);
