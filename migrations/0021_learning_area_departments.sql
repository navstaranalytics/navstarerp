-- Link each school learning area to the department responsible for it.
ALTER TABLE learning_areas ADD COLUMN department_id TEXT REFERENCES school_departments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_learning_areas_department ON learning_areas(school_id,department_id);
