-- CBE competency-based assessment and configurable rubric storage.
-- Additive only: existing examination marks and report data remain unchanged.

CREATE TABLE IF NOT EXISTS competency_frameworks (
 id TEXT PRIMARY KEY,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 curriculum TEXT NOT NULL,
 grade_level_id TEXT REFERENCES grade_levels(id) ON DELETE RESTRICT,
 learning_area_id TEXT REFERENCES learning_areas(id) ON DELETE RESTRICT,
 name TEXT NOT NULL,
 description TEXT,
 levels_json TEXT NOT NULL DEFAULT '[{"label":"Emerging","description":"Beginning to demonstrate the competency."},{"label":"Approaching","description":"Demonstrates the competency with support."},{"label":"Meeting","description":"Demonstrates the expected competency independently."},{"label":"Exceeding","description":"Demonstrates the competency beyond the expected level."}]',
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','archived')),
 created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_competency_frameworks_scope ON competency_frameworks(school_id,curriculum,grade_level_id,learning_area_id,status);

CREATE TABLE IF NOT EXISTS rubric_criteria (
 id TEXT PRIMARY KEY,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 framework_id TEXT NOT NULL REFERENCES competency_frameworks(id) ON DELETE CASCADE,
 criterion TEXT NOT NULL,
 description TEXT,
 weight REAL NOT NULL DEFAULT 1 CHECK(weight>0),
 sort_order INTEGER NOT NULL DEFAULT 0,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(framework_id,criterion)
);
CREATE INDEX IF NOT EXISTS ix_rubric_criteria_framework ON rubric_criteria(school_id,framework_id,sort_order);

CREATE TABLE IF NOT EXISTS competency_assessments (
 id TEXT PRIMARY KEY,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
 term_id TEXT REFERENCES terms(id) ON DELETE SET NULL,
 grade_level_id TEXT NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
 stream_id TEXT REFERENCES streams(id) ON DELETE SET NULL,
 learning_area_id TEXT NOT NULL REFERENCES learning_areas(id) ON DELETE RESTRICT,
 framework_id TEXT NOT NULL REFERENCES competency_frameworks(id) ON DELETE RESTRICT,
 title TEXT NOT NULL,
 assessment_date TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_progress','completed','published')),
 created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_competency_assessments_class ON competency_assessments(school_id,academic_year_id,term_id,grade_level_id,stream_id,learning_area_id);

CREATE TABLE IF NOT EXISTS competency_observations (
 id TEXT PRIMARY KEY,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 competency_assessment_id TEXT NOT NULL REFERENCES competency_assessments(id) ON DELETE CASCADE,
 learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
 criterion_id TEXT NOT NULL REFERENCES rubric_criteria(id) ON DELETE RESTRICT,
 achievement_level TEXT NOT NULL,
 evidence TEXT,
 next_steps TEXT,
 status TEXT NOT NULL DEFAULT 'observed' CHECK(status IN ('observed','not_observed','needs_follow_up')),
 assessed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 assessed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(competency_assessment_id,learner_id,criterion_id)
);
CREATE INDEX IF NOT EXISTS ix_competency_observations_learner ON competency_observations(school_id,learner_id,competency_assessment_id);
