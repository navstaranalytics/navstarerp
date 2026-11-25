-- Keep legacy Forms 1–4 strictly inside the Kenyan 8-4-4 curriculum.
-- This repairs only records whose school is configured to offer 8-4-4.
-- It does not delete classes, learners, enrolments, grading boundaries or history.

UPDATE grade_levels
SET curriculum='Kenyan 8-4-4',
    school_level='Secondary'
WHERE upper(replace(stage_code,' ','')) IN ('FORM1','FORM2','FORM3','FORM4','F1','F2','F3','F4')
  AND lower(curriculum) NOT LIKE '%8-4-4%'
  AND lower(curriculum) NOT LIKE '%844%'
  AND NOT EXISTS (
    SELECT 1 FROM grade_levels target
    WHERE target.school_id=grade_levels.school_id
      AND target.curriculum='Kenyan 8-4-4'
      AND upper(replace(target.stage_code,' ',''))=upper(replace(grade_levels.stage_code,' ',''))
  )
  AND EXISTS (
    SELECT 1 FROM schools s
    WHERE s.id=grade_levels.school_id
      AND (
        lower(COALESCE(s.curricula_json,'')) LIKE '%kenyan 8-4-4%'
        OR lower(COALESCE(s.curriculum,'')) LIKE '%8-4-4%'
        OR lower(COALESCE(s.curriculum,'')) LIKE '%multiple curricula%'
      )
  );

-- Move the corresponding school-owned learning-area records to the corrected
-- 8-4-4 curriculum only when an equivalent 8-4-4 row does not already exist.
UPDATE learning_areas
SET curriculum='Kenyan 8-4-4'
WHERE upper(replace(stage_code,' ','')) IN ('FORM1','FORM2','FORM3','FORM4','F1','F2','F3','F4')
  AND lower(curriculum) NOT LIKE '%8-4-4%'
  AND lower(curriculum) NOT LIKE '%844%'
  AND EXISTS (
    SELECT 1 FROM grade_levels g
    WHERE g.school_id=learning_areas.school_id
      AND g.curriculum='Kenyan 8-4-4'
      AND g.stage_code=learning_areas.stage_code
      AND g.is_active=1
  )
  AND NOT EXISTS (
    SELECT 1 FROM learning_areas target
    WHERE target.school_id=learning_areas.school_id
      AND target.curriculum='Kenyan 8-4-4'
      AND target.stage_code=learning_areas.stage_code
      AND upper(target.code)=upper(learning_areas.code)
      AND COALESCE(target.pathway,'')=COALESCE(learning_areas.pathway,'')
  );

-- Keep grading schemes attached to a Form class on the 8-4-4 framework.
UPDATE grading_schemes
SET curriculum='Kenyan 8-4-4'
WHERE lower(curriculum) NOT LIKE '%8-4-4%'
  AND lower(curriculum) NOT LIKE '%844%'
  AND (
    upper(replace(COALESCE(stage_code,''),' ','')) IN ('FORM1','FORM2','FORM3','FORM4','F1','F2','F3','F4')
    OR level_key IN (
      SELECT id FROM grade_levels
      WHERE curriculum='Kenyan 8-4-4'
        AND upper(replace(stage_code,' ','')) IN ('FORM1','FORM2','FORM3','FORM4','F1','F2','F3','F4')
    )
  );
