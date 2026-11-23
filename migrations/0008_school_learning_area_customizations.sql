-- Preserve school-specific learning-area edits across Navstar catalogue refreshes.
-- Each school's learning_areas rows remain tenant-owned; catalogue_code is the stable master key.
ALTER TABLE learning_areas ADD COLUMN catalogue_code TEXT;
ALTER TABLE learning_areas ADD COLUMN school_customized INTEGER NOT NULL DEFAULT 0 CHECK(school_customized IN (0,1));
UPDATE learning_areas SET catalogue_code=code WHERE catalogue_code IS NULL;
CREATE INDEX IF NOT EXISTS ix_learning_areas_catalogue ON learning_areas(school_id,stage_code,catalogue_code);
