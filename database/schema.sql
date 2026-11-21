-- Schema v1. Later changes go in database/migrations/NNN_name.sql (N > 1).
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'player',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE worlds (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE world_locations (
  id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL,
  x REAL NOT NULL, z REAL NOT NULL, w REAL NOT NULL, d REAL NOT NULL, h REAL NOT NULL,
  color TEXT NOT NULL, node TEXT NOT NULL);  -- node: waypoint agents walk to

CREATE TABLE agents (
  id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL UNIQUE COLLATE NOCASE, role TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',            -- '' = use system default model
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  autonomous INTEGER NOT NULL DEFAULT 1,
  home_location TEXT NOT NULL REFERENCES world_locations(key),
  x REAL NOT NULL DEFAULT 0, z REAL NOT NULL DEFAULT 0,
  activity TEXT NOT NULL DEFAULT 'idle', target TEXT,
  last_interaction_at TEXT, last_ollama_at TEXT, last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_agents_status ON agents(status);

CREATE TABLE agent_personalities (
  agent_id INTEGER PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  personality TEXT NOT NULL DEFAULT '', system_prompt TEXT NOT NULL DEFAULT '');

CREATE TABLE agent_goals (
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  goal TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_goals_agent ON agent_goals(agent_id);

CREATE TABLE agent_memories (
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'long' CHECK (kind IN ('short','long')),
  content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'event', importance INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_mem_agent ON agent_memories(agent_id, created_at);

CREATE TABLE agent_relationships (
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  other_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  affinity INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (agent_id, other_agent_id));

CREATE TABLE agent_activities (
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  activity TEXT NOT NULL, target TEXT, started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT);
CREATE INDEX idx_act_agent ON agent_activities(agent_id, started_at);

CREATE TABLE agent_tasks (
  id INTEGER PRIMARY KEY, parent_task_id INTEGER REFERENCES agent_tasks(id) ON DELETE SET NULL,
  from_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed')),
  result TEXT, depth INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT);
CREATE INDEX idx_tasks_agent ON agent_tasks(agent_id, status);

CREATE TABLE agent_conversations (
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('player','agent')),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  peer_agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES agent_tasks(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), last_message_at TEXT);
CREATE INDEX idx_conv_lookup ON agent_conversations(agent_id, kind, user_id);

CREATE TABLE agent_messages (
  id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')), sender TEXT NOT NULL,
  content TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_msg_conv ON agent_messages(conversation_id, id);

CREATE TABLE world_events (
  id INTEGER PRIMARY KEY, world_id INTEGER NOT NULL REFERENCES worlds(id),
  type TEXT NOT NULL, agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  message TEXT NOT NULL, data TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_events_time ON world_events(created_at);

CREATE TABLE world_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE user_positions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, rot REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Full-text index for long-term memory retrieval (kept in sync by triggers).
CREATE VIRTUAL TABLE memories_fts USING fts5(content, content='agent_memories', content_rowid='id');
CREATE TRIGGER mem_ai AFTER INSERT ON agent_memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content); END;
CREATE TRIGGER mem_ad AFTER DELETE ON agent_memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content); END;

INSERT INTO schema_migrations(version) VALUES (1);
