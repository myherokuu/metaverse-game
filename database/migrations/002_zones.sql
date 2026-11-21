-- Multi-zone world. Additive only: existing data stays in place and belongs to zone 'aether_city'.
ALTER TABLE world_locations ADD COLUMN zone TEXT NOT NULL DEFAULT 'aether_city';
ALTER TABLE agents ADD COLUMN zone TEXT NOT NULL DEFAULT 'aether_city';
ALTER TABLE world_events ADD COLUMN zone TEXT NOT NULL DEFAULT 'aether_city';
ALTER TABLE users ADD COLUMN current_zone TEXT NOT NULL DEFAULT 'aether_city';
CREATE INDEX idx_agents_zone ON agents(zone);
CREATE INDEX idx_loc_zone ON world_locations(zone);

CREATE TABLE world_zones (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  builder TEXT NOT NULL,                       -- client-side scene builder to use
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  bound REAL NOT NULL DEFAULT 100, seed INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '{}',             -- JSON: waypoint graph, patrol loop, obstacle boxes, rivers, map colours
  created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE world_districts (
  id INTEGER PRIMARY KEY, zone_id TEXT NOT NULL REFERENCES world_zones(id) ON DELETE CASCADE,
  location_key TEXT NOT NULL UNIQUE REFERENCES world_locations(key) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '#35e0ff');
CREATE INDEX idx_districts_zone ON world_districts(zone_id);

CREATE TABLE world_spawn_points (
  id INTEGER PRIMARY KEY, zone_id TEXT NOT NULL REFERENCES world_zones(id) ON DELETE CASCADE,
  key TEXT NOT NULL, name TEXT NOT NULL, district_key TEXT,
  x REAL NOT NULL, y REAL NOT NULL DEFAULT 0, z REAL NOT NULL, rot REAL NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0, UNIQUE (zone_id, key));

CREATE TABLE world_objects (
  id INTEGER PRIMARY KEY, zone_id TEXT NOT NULL REFERENCES world_zones(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, x REAL NOT NULL, z REAL NOT NULL, rot REAL NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}', district TEXT, chunk_x INTEGER NOT NULL, chunk_z INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'generator',    -- generator | builder (construction history)
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_objects_zone_chunk ON world_objects(zone_id, chunk_x, chunk_z);

CREATE TABLE world_chunks (
  zone_id TEXT NOT NULL REFERENCES world_zones(id) ON DELETE CASCADE, cx INTEGER NOT NULL, cz INTEGER NOT NULL,
  object_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (zone_id, cx, cz));

CREATE TABLE world_travel_history (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_zone TEXT, to_zone TEXT NOT NULL REFERENCES world_zones(id),
  from_x REAL, from_z REAL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_travel_user ON world_travel_history(user_id, created_at);

CREATE TABLE player_zone_positions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, zone_id TEXT NOT NULL REFERENCES world_zones(id),
  x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, rot REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, zone_id));

CREATE TABLE agent_zone_assignments (
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE, zone_id TEXT NOT NULL REFERENCES world_zones(id),
  district_key TEXT, PRIMARY KEY (agent_id, zone_id));
