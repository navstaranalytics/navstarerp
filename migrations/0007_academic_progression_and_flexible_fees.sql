-- Navstar academic progression, fee flexibility and catalogue refinements.
-- Additive only: preserve all existing marks, enrolments, fee accounts and payments.
ALTER TABLE grading_schemes ADD COLUMN level_key TEXT;
ALTER TABLE fee_structures ADD COLUMN learner_category TEXT NOT NULL DEFAULT 'both';
ALTER TABLE fee_structures ADD COLUMN payment_timing TEXT NOT NULL DEFAULT 'upfront';
ALTER TABLE fee_structures ADD COLUMN allow_partial_payments INTEGER NOT NULL DEFAULT 1;
ALTER TABLE learner_fee_accounts ADD COLUMN adjustment_total REAL NOT NULL DEFAULT 0;
ALTER TABLE learner_fee_accounts ADD COLUMN adjustment_note TEXT;
ALTER TABLE learner_fee_accounts ADD COLUMN last_adjusted_by TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS learner_promotion_policies (
 id TEXT PRIMARY KEY,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 from_grade_id TEXT NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
 to_grade_id TEXT NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
 minimum_average REAL NOT NULL DEFAULT 0 CHECK(minimum_average>=0 AND minimum_average<=100),
 require_all_subjects_passed INTEGER NOT NULL DEFAULT 0 CHECK(require_all_subjects_passed IN (0,1)),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(school_id,from_grade_id)
);
CREATE TABLE IF NOT EXISTS learner_promotion_history (
 id TEXT PRIMARY KEY,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
 from_enrollment_id TEXT NOT NULL REFERENCES learner_enrollments(id) ON DELETE RESTRICT,
 to_enrollment_id TEXT NOT NULL REFERENCES learner_enrollments(id) ON DELETE RESTRICT,
 from_grade_id TEXT NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
 to_grade_id TEXT NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
 academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
 average_score REAL,
 decision TEXT NOT NULL DEFAULT 'promoted',
 note TEXT,
 promoted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(from_enrollment_id)
);
CREATE TABLE IF NOT EXISTS fee_adjustments (
 id TEXT PRIMARY KEY,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 learner_fee_account_id TEXT NOT NULL REFERENCES learner_fee_accounts(id) ON DELETE RESTRICT,
 adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('charge','discount','waiver','correction')),
 amount REAL NOT NULL CHECK(amount>0),
 reason TEXT NOT NULL,
 adjusted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_promotion_history_learner ON learner_promotion_history(school_id,learner_id,created_at);
CREATE INDEX IF NOT EXISTS ix_fee_adjustments_account ON fee_adjustments(school_id,learner_fee_account_id,created_at);
