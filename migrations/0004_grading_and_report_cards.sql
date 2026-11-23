-- Navstar school grading, grade boundaries and report-card storage.
-- Apply once to navstar-erp-db after migration 0003.

CREATE TABLE IF NOT EXISTS grading_schemes (
 id TEXT PRIMARY KEY,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 curriculum TEXT NOT NULL DEFAULT 'CBC',
 stage_code TEXT,
 name TEXT NOT NULL,
 description TEXT,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(school_id,name)
);

CREATE TABLE IF NOT EXISTS grade_boundaries (
 id TEXT PRIMARY KEY,
 scheme_id TEXT NOT NULL REFERENCES grading_schemes(id) ON DELETE CASCADE,
 label TEXT NOT NULL,
 min_score REAL NOT NULL CHECK(min_score>=0 AND min_score<=100),
 max_score REAL NOT NULL CHECK(max_score>=0 AND max_score<=100),
 points REAL,
 descriptor TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(max_score>=min_score)
);

-- Older Navstar databases may already have grade_boundaries without school_id.
-- Create the table without that column above, then add it exactly once here so
-- both fresh and existing databases follow the same migration path.
ALTER TABLE grade_boundaries ADD COLUMN school_id TEXT REFERENCES schools(id) ON DELETE CASCADE;

-- Backfill the school scope from each boundary's parent grading scheme.
UPDATE grade_boundaries
SET school_id = (
 SELECT gs.school_id FROM grading_schemes gs
 WHERE gs.id = grade_boundaries.scheme_id
)
WHERE school_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_grade_boundaries_scheme ON grade_boundaries(school_id,scheme_id,min_score DESC);

CREATE TABLE IF NOT EXISTS report_cards (
 id TEXT PRIMARY KEY,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
 academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
 term_id TEXT REFERENCES terms(id) ON DELETE SET NULL,
 report_data_json TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','published','archived')),
 published_at TEXT,
 created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS ix_report_cards_scope ON report_cards(school_id,academic_year_id,term_id,learner_id);
