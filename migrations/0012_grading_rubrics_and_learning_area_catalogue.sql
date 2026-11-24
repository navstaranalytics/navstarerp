-- Add configurable rubric text and school-editable remarks to numeric grading bands.
ALTER TABLE grade_boundaries ADD COLUMN rubric TEXT;
ALTER TABLE grade_boundaries ADD COLUMN remark TEXT;

-- Populate the school-scoped learning-area catalogue for every currently configured
-- grade. Mandatory core areas are active; optional areas are visible for the school
-- to activate when selecting the subjects it actually offers.
WITH catalog(curriculum_key, stage_group, code, name, pathway, mandatory) AS (
 VALUES
 ('CBE','PP','ENG','English',NULL,1),
 ('CBE','PP','KIS','Kiswahili',NULL,1),
 ('CBE','PP','MAT','Mathematical Activities',NULL,1),
 ('CBE','PP','ENV','Environmental Activities',NULL,1),
 ('CBE','PP','CRE','Religious Education',NULL,1),
 ('CBE','PP','ART','Creative Activities',NULL,0),
 ('CBE','G1_3','ENG','English',NULL,1),
 ('CBE','G1_3','KIS','Kiswahili',NULL,1),
 ('CBE','G1_3','MAT','Mathematics',NULL,1),
 ('CBE','G1_3','ENV','Environmental Activities',NULL,1),
 ('CBE','G1_3','CRE','Religious Education',NULL,1),
 ('CBE','G1_3','IND','Indigenous Language',NULL,0),
 ('CBE','G1_3','ART','Creative Activities',NULL,0),
 ('CBE','G4_6','ENG','English',NULL,1),
 ('CBE','G4_6','KIS','Kiswahili',NULL,1),
 ('CBE','G4_6','MAT','Mathematics',NULL,1),
 ('CBE','G4_6','SCT','Science and Technology',NULL,1),
 ('CBE','G4_6','SST','Social Studies',NULL,1),
 ('CBE','G4_6','AGR','Agriculture',NULL,0),
 ('CBE','G4_6','CRE','Religious Education',NULL,1),
 ('CBE','G4_6','ART','Creative Arts',NULL,0),
 ('CBE','G4_6','IND','Indigenous Language',NULL,0),
 ('CBE','G7_9','ENG','English',NULL,1),
 ('CBE','G7_9','KIS','Kiswahili',NULL,1),
 ('CBE','G7_9','MAT','Mathematics',NULL,1),
 ('CBE','G7_9','INS','Integrated Science',NULL,1),
 ('CBE','G7_9','SST','Social Studies',NULL,1),
 ('CBE','G7_9','PTE','Pre-Technical Studies',NULL,1),
 ('CBE','G7_9','AGR','Agriculture',NULL,0),
 ('CBE','G7_9','CAS','Creative Arts and Sports',NULL,0),
 ('CBE','G7_9','CRE','Religious Education',NULL,0),
 ('CBE','G7_9','LST','Life Skills Education',NULL,0),
 ('CBE','G10_12','ENG','English',NULL,1),
 ('CBE','G10_12','KIS','Kiswahili',NULL,1),
 ('CBE','G10_12','MAT','Mathematics','STEM',0),
 ('CBE','G10_12','BIO','Biology','STEM',0),
 ('CBE','G10_12','CHE','Chemistry','STEM',0),
 ('CBE','G10_12','PHY','Physics','STEM',0),
 ('CBE','G10_12','ICT','Computer Studies','STEM',0),
 ('CBE','G10_12','GEO','Geography','Social Sciences',0),
 ('CBE','G10_12','HIS','History and Citizenship','Social Sciences',0),
 ('CBE','G10_12','BUS','Business Studies','Social Sciences',0),
 ('CBE','G10_12','CRE','Christian Religious Education','Social Sciences',0),
 ('CBE','G10_12','ART','Fine Arts','Arts & Sports Science',0),
 ('CBE','G10_12','MUS','Music and Dance','Arts & Sports Science',0),
 ('CBE','G10_12','SPT','Sports and Recreation','Arts & Sports Science',0),
 ('844','STD','ENG','English',NULL,1),
 ('844','STD','KIS','Kiswahili',NULL,1),
 ('844','STD','MAT','Mathematics',NULL,1),
 ('844','STD','SCI','Science',NULL,1),
 ('844','STD','SST','Social Studies',NULL,1),
 ('844','STD','CRE','Religious Education',NULL,0),
 ('844','STD','AGR','Agriculture',NULL,0),
 ('844','STD','ART','Art and Craft',NULL,0),
 ('844','FORM','ENG','English',NULL,1),
 ('844','FORM','KIS','Kiswahili',NULL,1),
 ('844','FORM','MAT','Mathematics',NULL,1),
 ('844','FORM','BIO','Biology',NULL,0),
 ('844','FORM','CHE','Chemistry',NULL,0),
 ('844','FORM','PHY','Physics',NULL,0),
 ('844','FORM','GEO','Geography',NULL,0),
 ('844','FORM','HIS','History',NULL,0),
 ('844','FORM','CRE','Christian Religious Education',NULL,0),
 ('844','FORM','IRE','Islamic Religious Education',NULL,0),
 ('844','FORM','BUS','Business Studies',NULL,0),
 ('844','FORM','AGR','Agriculture',NULL,0),
 ('844','FORM','ICT','Computer Studies',NULL,0),
 ('844','FORM','HSC','Home Science',NULL,0)
),
grade_catalog AS (
 SELECT gl.id AS grade_id, gl.school_id, gl.curriculum, gl.stage_code,
 CASE
  WHEN lower(gl.curriculum) LIKE '%cbe%' AND gl.stage_code IN ('PP1','PP2') THEN 'PP'
  WHEN lower(gl.curriculum) LIKE '%cbe%' AND gl.stage_code IN ('G1','G2','G3') THEN 'G1_3'
  WHEN lower(gl.curriculum) LIKE '%cbe%' AND gl.stage_code IN ('G4','G5','G6') THEN 'G4_6'
  WHEN lower(gl.curriculum) LIKE '%cbe%' AND gl.stage_code IN ('G7','G8','G9') THEN 'G7_9'
  WHEN lower(gl.curriculum) LIKE '%cbe%' AND gl.stage_code IN ('G10','G11','G12') THEN 'G10_12'
  WHEN (lower(gl.curriculum) LIKE '%8-4-4%' OR lower(gl.curriculum) LIKE '%844%') AND gl.stage_code GLOB 'STD[1-8]' THEN 'STD'
  WHEN (lower(gl.curriculum) LIKE '%8-4-4%' OR lower(gl.curriculum) LIKE '%844%') AND gl.stage_code GLOB 'FORM[1-4]' THEN 'FORM'
 END AS stage_group
 FROM grade_levels gl
 WHERE gl.is_active=1
)
INSERT OR IGNORE INTO learning_areas
 (id,school_id,curriculum,code,name,stage_code,pathway,is_active,is_mandatory,source_template,catalogue_code)
SELECT lower(hex(randomblob(16))), g.school_id, g.curriculum, c.code, c.name, g.stage_code, c.pathway,
       CASE WHEN c.mandatory=1 THEN 1 ELSE 0 END, c.mandatory,
       'navstar-standard-catalogue', c.code
FROM grade_catalog g
JOIN catalog c ON c.stage_group=g.stage_group
 AND ((c.curriculum_key='CBE' AND lower(g.curriculum) LIKE '%cbe%')
   OR (c.curriculum_key='844' AND (lower(g.curriculum) LIKE '%8-4-4%' OR lower(g.curriculum) LIKE '%844%')))
WHERE g.stage_group IS NOT NULL
 AND NOT EXISTS (
  SELECT 1 FROM learning_areas existing
  WHERE existing.school_id=g.school_id
    AND existing.stage_code=g.stage_code
    AND existing.code=c.code
    AND COALESCE(existing.pathway,'')=COALESCE(c.pathway,'')
 );
