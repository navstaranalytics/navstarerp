-- Navstar curriculum metadata and learner subject assignments
ALTER TABLE learning_areas ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'optional';
ALTER TABLE learning_areas ADD COLUMN is_mandatory INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learning_areas ADD COLUMN source_template TEXT;

CREATE TABLE IF NOT EXISTS learner_learning_areas (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  enrollment_id TEXT NOT NULL REFERENCES learner_enrollments(id) ON DELETE CASCADE,
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  learning_area_id TEXT NOT NULL REFERENCES learning_areas(id) ON DELETE RESTRICT,
  selection_type TEXT NOT NULL DEFAULT 'elective' CHECK (selection_type IN ('mandatory','elective')),
  selected_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','completed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(enrollment_id, learning_area_id)
);
CREATE INDEX IF NOT EXISTS ix_learner_learning_areas_scope ON learner_learning_areas(school_id, enrollment_id, learner_id);
