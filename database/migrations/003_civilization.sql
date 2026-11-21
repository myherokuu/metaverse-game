-- Autonomous governments, economy, land, construction, citizens, simulation clock. Additive only.
CREATE TABLE governments (
  id INTEGER PRIMARY KEY, zone_id TEXT NOT NULL UNIQUE REFERENCES world_zones(id),
  name TEXT NOT NULL, gov_type TEXT NOT NULL, leader_title TEXT NOT NULL, leader_agent_id INTEGER REFERENCES agents(id),
  economy TEXT NOT NULL DEFAULT '', currency_code TEXT NOT NULL, currency_name TEXT NOT NULL,
  fx_to_base REAL NOT NULL DEFAULT 1.0,                  -- value of 1 unit of this (fictional) currency in a common base unit
  autonomy TEXT NOT NULL DEFAULT 'semi' CHECK (autonomy IN ('manual','semi','auto')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE government_departments (
  id INTEGER PRIMARY KEY, government_id INTEGER NOT NULL REFERENCES governments(id) ON DELETE CASCADE,
  key TEXT NOT NULL, name TEXT NOT NULL, head_agent_id INTEGER REFERENCES agents(id), UNIQUE (government_id, key));

CREATE TABLE government_agents (
  id INTEGER PRIMARY KEY, government_id INTEGER NOT NULL REFERENCES governments(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES government_departments(id) ON DELETE CASCADE,
  agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,      -- NULL = sub-agent persona without a body in the world
  name TEXT NOT NULL, role TEXT NOT NULL, parent_id INTEGER REFERENCES government_agents(id) ON DELETE SET NULL);
CREATE INDEX idx_govagents_gov ON government_agents(government_id);

CREATE TABLE government_policies (
  id INTEGER PRIMARY KEY, government_id INTEGER NOT NULL REFERENCES governments(id) ON DELETE CASCADE,
  key TEXT NOT NULL, value TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', UNIQUE (government_id, key));

CREATE TABLE land_parcels (
  id INTEGER PRIMARY KEY, zone_id TEXT NOT NULL REFERENCES world_zones(id) ON DELETE CASCADE, code TEXT NOT NULL,
  x0 REAL NOT NULL, x1 REAL NOT NULL, z0 REAL NOT NULL, z1 REAL NOT NULL CHECK (x1 > x0 AND z1 > z0),
  classification TEXT NOT NULL CHECK (classification IN ('residential','commercial','industrial','civic','mixed','conservation')),
  owner_government_id INTEGER REFERENCES governments(id),
  permission TEXT NOT NULL DEFAULT 'approved' CHECK (permission IN ('approved','restricted','forbidden')),
  status TEXT NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant','reserved','under_construction','developed')),
  building_project_id INTEGER, current_building TEXT,
  land_value_minor INTEGER NOT NULL DEFAULT 0, construction_cost_minor INTEGER NOT NULL DEFAULT 0, UNIQUE (zone_id, code));
CREATE INDEX idx_parcels_zone ON land_parcels(zone_id, status);

CREATE TABLE construction_contractors (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, owner_government_id INTEGER REFERENCES governments(id),
  is_private INTEGER NOT NULL DEFAULT 0, workers INTEGER NOT NULL, skill REAL NOT NULL, capacity INTEGER NOT NULL,
  rating REAL NOT NULL DEFAULT 0.7, home_zone TEXT NOT NULL REFERENCES world_zones(id),
  permit_zones TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active');

CREATE TABLE construction_projects (
  id INTEGER PRIMARY KEY, government_id INTEGER NOT NULL REFERENCES governments(id), zone_id TEXT NOT NULL REFERENCES world_zones(id),
  parcel_id INTEGER NOT NULL REFERENCES land_parcels(id), kind TEXT NOT NULL, name TEXT NOT NULL,
  floors INTEGER NOT NULL, w REAL NOT NULL, d REAL NOT NULL, h REAL NOT NULL, complexity REAL NOT NULL DEFAULT 1,
  estimated_cost_minor INTEGER NOT NULL, reserved_minor INTEGER NOT NULL DEFAULT 0, paid_minor INTEGER NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'Proposed', progress REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'awaiting_budget' CHECK (status IN ('awaiting_budget','awaiting_approval','approved','active','blocked','completed','rejected','cancelled')),
  contractor_id INTEGER REFERENCES construction_contractors(id), proposed_by TEXT NOT NULL DEFAULT 'development_ministry',
  approved_by TEXT, rationale TEXT NOT NULL DEFAULT '', blueprint TEXT NOT NULL DEFAULT '{}', object_id INTEGER,
  created_ts INTEGER NOT NULL, started_ts INTEGER, completed_ts INTEGER, blocked_reason TEXT);
CREATE INDEX idx_projects_gov ON construction_projects(government_id, status);
-- one live project per parcel
CREATE UNIQUE INDEX uq_project_parcel_live ON construction_projects(parcel_id)
  WHERE status IN ('awaiting_budget','awaiting_approval','approved','active','blocked');

CREATE TABLE land_assignments (
  id INTEGER PRIMARY KEY, parcel_id INTEGER NOT NULL REFERENCES land_parcels(id), contractor_id INTEGER NOT NULL REFERENCES construction_contractors(id),
  project_id INTEGER NOT NULL REFERENCES construction_projects(id), assigned_ts INTEGER NOT NULL, released_ts INTEGER);
CREATE UNIQUE INDEX uq_assignment_active ON land_assignments(parcel_id) WHERE released_ts IS NULL;

CREATE TABLE construction_milestones (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES construction_projects(id) ON DELETE CASCADE,
  stage TEXT NOT NULL, at_progress REAL NOT NULL, payment_minor INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0,
  completed_ts INTEGER, transaction_id INTEGER, UNIQUE (project_id, stage));

CREATE TABLE government_accounts (
  id INTEGER PRIMARY KEY, government_id INTEGER REFERENCES governments(id),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('government','contractor','citizen','business')), owner_id INTEGER NOT NULL,
  code TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  currency TEXT NOT NULL, balance_minor INTEGER NOT NULL DEFAULT 0, allow_negative INTEGER NOT NULL DEFAULT 0,
  UNIQUE (owner_type, owner_id, code));
CREATE INDEX idx_accounts_gov ON government_accounts(government_id);

CREATE TABLE government_transactions (        -- journal header; one row per balanced journal entry
  id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE,                      -- idempotency key: the same ref can never post twice
  government_id INTEGER REFERENCES governments(id), kind TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '', sim_ts INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), reversed_of INTEGER REFERENCES government_transactions(id),
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')));
CREATE INDEX idx_txn_gov ON government_transactions(government_id, sim_ts);

CREATE TABLE ledger_entries (                 -- journal lines (double entry)
  id INTEGER PRIMARY KEY, transaction_id INTEGER NOT NULL REFERENCES government_transactions(id),
  account_id INTEGER NOT NULL REFERENCES government_accounts(id),
  debit_minor INTEGER NOT NULL DEFAULT 0 CHECK (debit_minor >= 0), credit_minor INTEGER NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  CHECK ((debit_minor = 0) <> (credit_minor = 0)));
CREATE INDEX idx_ledger_txn ON ledger_entries(transaction_id);
CREATE INDEX idx_ledger_acct ON ledger_entries(account_id);

CREATE TABLE government_fiscal_periods (
  id INTEGER PRIMARY KEY, government_id INTEGER NOT NULL REFERENCES governments(id) ON DELETE CASCADE, label TEXT NOT NULL,
  start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  UNIQUE (government_id, label));

CREATE TABLE government_budgets (
  id INTEGER PRIMARY KEY, government_id INTEGER NOT NULL REFERENCES governments(id) ON DELETE CASCADE,
  period_id INTEGER NOT NULL REFERENCES government_fiscal_periods(id) ON DELETE CASCADE, category TEXT NOT NULL,
  allocated_minor INTEGER NOT NULL, committed_minor INTEGER NOT NULL DEFAULT 0, spent_minor INTEGER NOT NULL DEFAULT 0,
  UNIQUE (period_id, category));

CREATE TABLE government_revenues (
  id INTEGER PRIMARY KEY, government_id INTEGER NOT NULL REFERENCES governments(id), period_id INTEGER REFERENCES government_fiscal_periods(id),
  source TEXT NOT NULL, amount_minor INTEGER NOT NULL, transaction_id INTEGER REFERENCES government_transactions(id), sim_ts INTEGER NOT NULL);
CREATE INDEX idx_rev_gov ON government_revenues(government_id, sim_ts);

CREATE TABLE government_expenses (
  id INTEGER PRIMARY KEY, government_id INTEGER NOT NULL REFERENCES governments(id), period_id INTEGER REFERENCES government_fiscal_periods(id),
  category TEXT NOT NULL, amount_minor INTEGER NOT NULL, transaction_id INTEGER REFERENCES government_transactions(id),
  project_id INTEGER REFERENCES construction_projects(id), sim_ts INTEGER NOT NULL);
CREATE INDEX idx_exp_gov ON government_expenses(government_id, sim_ts);

CREATE TABLE world_clocks (                   -- 'global' row = the one shared simulation clock; one row per zone = local offsets/hours
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('global','zone')),
  sim_ts INTEGER NOT NULL DEFAULT 0, carry REAL NOT NULL DEFAULT 0, speed REAL NOT NULL DEFAULT 60, running INTEGER NOT NULL DEFAULT 1,
  last_real_ts REAL NOT NULL DEFAULT 0, processed_ts INTEGER NOT NULL DEFAULT 0,
  tz_offset_min INTEGER NOT NULL DEFAULT 0, sunrise_h REAL NOT NULL DEFAULT 6, sunset_h REAL NOT NULL DEFAULT 18,
  work_start_h REAL NOT NULL DEFAULT 8, work_end_h REAL NOT NULL DEFAULT 17, biz_open_h REAL NOT NULL DEFAULT 9, biz_close_h REAL NOT NULL DEFAULT 20);

CREATE TABLE citizen_schedules (
  id INTEGER PRIMARY KEY, profile TEXT NOT NULL, start_h REAL NOT NULL, end_h REAL NOT NULL, activity TEXT NOT NULL, UNIQUE (profile, start_h));

CREATE TABLE businesses (
  id INTEGER PRIMARY KEY, zone_id TEXT NOT NULL REFERENCES world_zones(id), government_id INTEGER NOT NULL REFERENCES governments(id),
  name TEXT NOT NULL, kind TEXT NOT NULL, owner_government_id INTEGER REFERENCES governments(id), employees INTEGER NOT NULL DEFAULT 0,
  node TEXT NOT NULL, UNIQUE (zone_id, name));

CREATE TABLE citizens (
  id INTEGER PRIMARY KEY, zone_id TEXT NOT NULL REFERENCES world_zones(id), government_id INTEGER NOT NULL REFERENCES governments(id),
  name TEXT NOT NULL, age_group TEXT NOT NULL CHECK (age_group IN ('young','adult','senior')), occupation TEXT NOT NULL,
  employer_kind TEXT NOT NULL CHECK (employer_kind IN ('government','business')), business_id INTEGER REFERENCES businesses(id),
  home_node TEXT NOT NULL, work_node TEXT NOT NULL, social_node TEXT NOT NULL, profile TEXT NOT NULL DEFAULT 'standard',
  salary_minor INTEGER NOT NULL, account_id INTEGER REFERENCES government_accounts(id),
  needs TEXT NOT NULL DEFAULT '{}', activity TEXT NOT NULL DEFAULT 'sleeping', color INTEGER NOT NULL DEFAULT 0,
  jitter_x REAL NOT NULL DEFAULT 0, jitter_z REAL NOT NULL DEFAULT 0, arrived_ts INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_citizens_zone ON citizens(zone_id);

CREATE TABLE trade_agreements (
  id INTEGER PRIMARY KEY, seller_government_id INTEGER NOT NULL REFERENCES governments(id), buyer_government_id INTEGER NOT NULL REFERENCES governments(id),
  resource TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price_minor INTEGER NOT NULL,   -- price in the seller's currency
  period_days INTEGER NOT NULL DEFAULT 7, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','ended')),
  approved_by TEXT NOT NULL DEFAULT 'finance_ministries', created_ts INTEGER NOT NULL, CHECK (seller_government_id <> buyer_government_id));

CREATE TABLE intergovernmental_trades (
  id INTEGER PRIMARY KEY, agreement_id INTEGER NOT NULL REFERENCES trade_agreements(id), period_key TEXT NOT NULL,
  quantity INTEGER NOT NULL, seller_amount_minor INTEGER NOT NULL, buyer_amount_minor INTEGER NOT NULL, sim_ts INTEGER NOT NULL,
  seller_txn_id INTEGER REFERENCES government_transactions(id), buyer_txn_id INTEGER REFERENCES government_transactions(id),
  UNIQUE (agreement_id, period_key));                                                   -- a period can only be delivered once

CREATE TABLE civilization_events (
  id INTEGER PRIMARY KEY, zone_id TEXT REFERENCES world_zones(id), government_id INTEGER REFERENCES governments(id),
  kind TEXT NOT NULL, message TEXT NOT NULL, data TEXT, sim_ts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_civ_events ON civilization_events(government_id, id);
