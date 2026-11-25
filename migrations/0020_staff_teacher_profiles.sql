-- Explicitly distinguish teaching staff and require their subject combination in the school dashboard.
ALTER TABLE staff_profiles ADD COLUMN is_teacher INTEGER NOT NULL DEFAULT 0 CHECK(is_teacher IN (0,1));
UPDATE staff_profiles SET is_teacher=1 WHERE id IN (
 SELECT sp.id FROM staff_profiles sp
 JOIN user_role_assignments ura ON ura.user_id=sp.user_id AND ura.school_id=sp.school_id
 JOIN roles r ON r.id=ura.role_id
 WHERE r.role_key IN ('teacher','class_teacher','principal','school_admin','school_administrator')
);
