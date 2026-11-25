-- Allow up to two School Administrator accounts per school and distinguish archived classes from inactive classes.
DROP INDEX IF EXISTS one_school_admin_per_school;
ALTER TABLE grade_levels ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
