CREATE TABLE IF NOT EXISTS boarding_rooms (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  house_id TEXT NOT NULL REFERENCES boarding_houses(id) ON DELETE CASCADE,
  room_number TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(school_id, house_id, room_number)
);
CREATE INDEX IF NOT EXISTS idx_boarding_rooms_school_house
ON boarding_rooms(school_id, house_id, status, room_number);
