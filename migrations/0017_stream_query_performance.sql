-- Improve school-scoped stream reads for Academic Setup across all tenants.
-- Composite indexes avoid scanning/sorting unrelated schools' stream rows.
CREATE INDEX IF NOT EXISTS ix_streams_school_grade_name ON streams(school_id,grade_level_id,name);
CREATE INDEX IF NOT EXISTS ix_streams_school_status_grade ON streams(school_id,status,grade_level_id);
