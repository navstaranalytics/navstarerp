-- A school can offer CBE and 8-4-4 concurrently.
ALTER TABLE schools ADD COLUMN curricula_json TEXT NOT NULL DEFAULT '[]';
UPDATE schools SET curricula_json=CASE WHEN lower(curriculum) LIKE '%8-4-4%' THEN '["Kenyan 8-4-4"]' WHEN lower(curriculum) LIKE '%cbe%' OR lower(curriculum) LIKE '%cbc%' THEN '["Kenyan CBE"]' ELSE '[]' END WHERE curricula_json='[]';
