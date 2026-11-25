-- Exam paper scheduling and mark-submission deadlines.
ALTER TABLE assessments ADD COLUMN assessment_date TEXT;
ALTER TABLE assessments ADD COLUMN start_time TEXT;
ALTER TABLE assessments ADD COLUMN end_time TEXT;
ALTER TABLE assessments ADD COLUMN mark_submission_deadline TEXT;
CREATE INDEX IF NOT EXISTS ix_assessments_exam_schedule
  ON assessments(school_id,academic_year_id,term_id,assessment_date,grade_level_id);
