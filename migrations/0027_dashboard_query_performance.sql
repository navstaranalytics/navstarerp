-- NAVSTAR ERP: tenant-scoped dashboard and portal query indexes.
-- These indexes support the most frequent school-scoped summary, class-register,
-- parent-portal and directory reads. They do not change or rewrite existing data.

CREATE INDEX IF NOT EXISTS ix_school_memberships_school_status_created
  ON school_memberships(school_id,membership_status,created_at);

CREATE INDEX IF NOT EXISTS ix_staff_profiles_school_employment
  ON staff_profiles(school_id,employment_status);

CREATE INDEX IF NOT EXISTS ix_learner_enrollments_school_learner_status_date
  ON learner_enrollments(school_id,learner_id,status,enrolled_at DESC);

CREATE INDEX IF NOT EXISTS ix_learner_enrollments_school_class_status
  ON learner_enrollments(school_id,academic_year_id,grade_level_id,stream_id,status);

CREATE INDEX IF NOT EXISTS ix_attendance_sessions_school_date
  ON attendance_sessions(school_id,attendance_date);

CREATE INDEX IF NOT EXISTS ix_attendance_records_school_session_learner
  ON attendance_records(school_id,session_id,learner_id,attendance_status);

CREATE INDEX IF NOT EXISTS ix_report_cards_school_learner_published
  ON report_cards(school_id,learner_id,status,published_at DESC);

CREATE INDEX IF NOT EXISTS ix_timetable_entries_school_class_day
  ON timetable_entries(school_id,academic_year_id,grade_level_id,stream_id,weekday,start_time);

CREATE INDEX IF NOT EXISTS ix_finance_transactions_school_date
  ON finance_transactions(school_id,transaction_date);

CREATE INDEX IF NOT EXISTS ix_learner_fee_accounts_school
  ON learner_fee_accounts(school_id);

INSERT OR IGNORE INTO schema_migrations(version,description)
VALUES('0027_dashboard_query_performance','Tenant-scoped dashboard, class register and parent portal query indexes');
