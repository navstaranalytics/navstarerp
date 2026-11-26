-- Enforce active boarding placement integrity at the database boundary.
-- API checks provide friendly errors; these triggers also protect against races and alternate write paths.

CREATE TRIGGER IF NOT EXISTS boarding_allocations_validate_insert
BEFORE INSERT ON boarding_allocations
WHEN NEW.status='active' AND (NEW.end_date IS NULL OR NEW.end_date='')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM boarding_houses h
    JOIN boarding_rooms r ON r.house_id=h.id AND r.school_id=h.school_id
    WHERE h.id=NEW.house_id
      AND h.school_id=NEW.school_id
      AND h.status='active'
      AND r.status='active'
      AND lower(trim(r.room_number))=lower(trim(NEW.room_number))
      AND CAST(NEW.bed_number AS INTEGER)>=1
      AND CAST(NEW.bed_number AS TEXT)=trim(NEW.bed_number)
      AND CAST(NEW.bed_number AS INTEGER)<=r.capacity
  ) THEN RAISE(ABORT,'Active placement requires an active house, configured room and valid bed number') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM boarding_allocations a
    WHERE a.school_id=NEW.school_id
      AND a.learner_id=NEW.learner_id
      AND a.status='active'
      AND (a.end_date IS NULL OR a.end_date='')
  ) THEN RAISE(ABORT,'Learner already has an active boarding allocation') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM boarding_allocations a
    WHERE a.school_id=NEW.school_id
      AND a.house_id=NEW.house_id
      AND lower(trim(COALESCE(a.room_number,'')))=lower(trim(COALESCE(NEW.room_number,'')))
      AND lower(trim(COALESCE(a.bed_number,'')))=lower(trim(COALESCE(NEW.bed_number,'')))
      AND a.status='active'
      AND (a.end_date IS NULL OR a.end_date='')
  ) THEN RAISE(ABORT,'Room and bed are already occupied') END;

  SELECT CASE WHEN (
    SELECT COUNT(*) FROM boarding_allocations a
    WHERE a.school_id=NEW.school_id
      AND a.house_id=NEW.house_id
      AND a.status='active'
      AND (a.end_date IS NULL OR a.end_date='')
  ) >= COALESCE((
    SELECT capacity FROM boarding_houses
    WHERE id=NEW.house_id AND school_id=NEW.school_id
  ),0) THEN RAISE(ABORT,'Dormitory capacity reached') END;
END;

CREATE TRIGGER IF NOT EXISTS boarding_allocations_validate_update
BEFORE UPDATE OF school_id,house_id,learner_id,room_number,bed_number,start_date,end_date,status
ON boarding_allocations
WHEN NEW.status='active' AND (NEW.end_date IS NULL OR NEW.end_date='')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM boarding_houses h
    JOIN boarding_rooms r ON r.house_id=h.id AND r.school_id=h.school_id
    WHERE h.id=NEW.house_id
      AND h.school_id=NEW.school_id
      AND h.status='active'
      AND r.status='active'
      AND lower(trim(r.room_number))=lower(trim(NEW.room_number))
      AND CAST(NEW.bed_number AS INTEGER)>=1
      AND CAST(NEW.bed_number AS TEXT)=trim(NEW.bed_number)
      AND CAST(NEW.bed_number AS INTEGER)<=r.capacity
  ) THEN RAISE(ABORT,'Active placement requires an active house, configured room and valid bed number') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM boarding_allocations a
    WHERE a.id<>NEW.id
      AND a.school_id=NEW.school_id
      AND a.learner_id=NEW.learner_id
      AND a.status='active'
      AND (a.end_date IS NULL OR a.end_date='')
  ) THEN RAISE(ABORT,'Learner already has an active boarding allocation') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM boarding_allocations a
    WHERE a.id<>NEW.id
      AND a.school_id=NEW.school_id
      AND a.house_id=NEW.house_id
      AND lower(trim(COALESCE(a.room_number,'')))=lower(trim(COALESCE(NEW.room_number,'')))
      AND lower(trim(COALESCE(a.bed_number,'')))=lower(trim(COALESCE(NEW.bed_number,'')))
      AND a.status='active'
      AND (a.end_date IS NULL OR a.end_date='')
  ) THEN RAISE(ABORT,'Room and bed are already occupied') END;

  SELECT CASE WHEN (
    SELECT COUNT(*) FROM boarding_allocations a
    WHERE a.id<>NEW.id
      AND a.school_id=NEW.school_id
      AND a.house_id=NEW.house_id
      AND a.status='active'
      AND (a.end_date IS NULL OR a.end_date='')
  ) >= COALESCE((
    SELECT capacity FROM boarding_houses
    WHERE id=NEW.house_id AND school_id=NEW.school_id
  ),0) THEN RAISE(ABORT,'Dormitory capacity reached') END;
END;
