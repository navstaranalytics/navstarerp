-- School-specific teacher subject combinations and the first-class allocation workflow.
CREATE TABLE IF NOT EXISTS staff_learning_areas (
 id TEXT PRIMARY KEY,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 staff_id TEXT NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
 curriculum TEXT NOT NULL,
 learning_area_code TEXT NOT NULL,
 learning_area_name TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(school_id,staff_id,curriculum,learning_area_code)
);
CREATE INDEX IF NOT EXISTS ix_staff_learning_areas_scope ON staff_learning_areas(school_id,staff_id,status);
CREATE INDEX IF NOT EXISTS ix_staff_learning_areas_subject ON staff_learning_areas(school_id,curriculum,learning_area_code,status);
