# AI Metaverse — autonomous multi-agent virtual world

Flask + SQLite + Ollama backend, Three.js / jQuery / Bootstrap 5 frontend. No cloud AI, no Ollama models are downloaded or modified.

## Run
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # already done in this folder
.venv/bin/python app.py          # http://127.0.0.1:2000
```
Ollama must already be running (`http://127.0.0.1:11434`). Models are discovered via `GET /api/tags`; agents without an assigned model use a default picked from what's installed (change it in **/admin → Settings**).
The first start creates `instance/ai_metaverse.db`, seeds the world and the five agents (Nova, Atlas, Cipher, Luna, Orion), and prints the **admin token** (also in `instance/admin_token`) needed by `/admin`.

Env vars: `HOST`, `PORT`, `OLLAMA_URL`, `OLLAMA_TIMEOUT`, `OLLAMA_MAX_CONCURRENT` (default 1 = queued), `CONTEXT_MESSAGES`, `MAX_DELEGATION_DEPTH`, `TASK_TIMEOUT`, `AGENT_REASON_COOLDOWN`, `AGENT_CHATTER`, `ADMIN_TOKEN`, `SECRET_KEY`, `DB_PATH`.

## Play
WASD move · Shift run · Space jump · mouse (click canvas, or click-drag) rotates · wheel zooms · **E** talk to a nearby agent · **O** Explore/Observer mode (free camera) · Esc releases mouse and opens settings. Chat has *Follow me* / *Stop*. Agents can also be sent places or asked to follow via the chat (LLM-proposed actions are schema-validated).

## Architecture
- `services/agent_behavior.py` — deterministic state machine thread (idle, walking, patrolling, working, exploring, talking, following, going_to_building, meeting, returning). A* over a waypoint graph + box push-out. **No LLM involved.** Pauses when no player heartbeat for 45 s. Positions/activities persist and resume on restart.
- `services/agent_manager.py` — chat, memory-augmented prompts, delegation (depth limit, chain/cycle check, per-task deadline), admin tasks, cooldown-limited agent↔agent chatter on meetings. `ACTION_SCHEMA` allows only `delegate | goto | follow | stop`; anything else is dropped and logged.
- `services/agent_memory.py` — short-term = last N messages of that agent+player conversation; long-term = `agent_memories` with FTS5 retrieval (`search()` is the single seam for embeddings later). Agents never see each other's conversations.
- `services/ollama_service.py` — semaphore queue, timeouts, `<think>` stripping, status probe on every call (reconnect without restart).
- DB: `database/schema.sql` (v1) + `database/migrations/NNN_*.sql`; WAL, foreign keys on, all 16 required tables.
- Security: admin endpoints need `X-Admin-Token`; state-changing calls need `X-Requested-With` (CSRF guard, SameSite=Strict cookie); parameterized SQL; AI text rendered via `.text()` only; server binds to 127.0.0.1.

## API
`/api/health`, `/api/ollama/status|models`, `PUT /api/settings`(admin), `/api/world/state|events|agents/state`, `POST /api/player/position`, `/api/agents` (GET, POST admin), `/api/agents/{id}` (GET, PUT admin), `…/chat`, `…/messages`, `…/memory`(admin), `…/task`(admin; `delegate_to` optional), `…/command`.

## Tests
`.venv/bin/python -m unittest discover -s tests` (Ollama stubbed; covers auth/CSRF, CRUD, chat isolation, FTS memory, delegation, invalid-action rejection, persistence).

## Zones / open world
Zones are data in SQLite (`world_zones`, `world_districts`, `world_spawn_points`, `world_objects`, `world_chunks`, `player_zone_positions`, `world_travel_history`, `agent_zone_assignments`; migration `002_zones.sql`, additive - existing data belongs to `aether_city`). Each zone has its own scene, agents (sim only runs for the player's zone), conversation context, events, graph and spawn points.

- **Global World Map**: `N` or the *World Map* button -> pick a zone. Travel saves your position, validates the destination server-side, shows a loading screen, disposes the old scene (Wakanda) or caches it (Aether), builds the new one, and restores your last position there. *Return to Aether City* puts you back where you left.
- **Wakanda** (original Afrofuturist design, no film assets): Royal Capital (spawn), Royal Palace, Advanced Research Laboratory, Waterfall & Mountain Region, Traditional Village, Technology District, joined by roads and an arched river bridge. The layout is generated once with a fixed seed (`services/zone_wakanda.py`), stored in SQLite and rebuilt from the DB on every visit; terrain streams in 100 m chunks, forests are instanced, small props are lazily built/disposed.
- **Movement**: WASD (cancels any route), Space/Shift as before; terrain following, cliffs and deep water block you. **Click ground** = click-to-move (A* around obstacles, cliffs, water; uses bridges); drag = look; `M` = mouse-look lock. Places panel has two separate actions per district: **Walk there** (route) and **Fast travel** (instant, same zone). Zone travel is only via the World Map.
- **Builder hook**: `POST /api/world/zones/{id}/build` (admin) adds validated objects (`forest`, `village_hut`, `skyscraper`, `tower`, `garden`, `info_point`, ...) to a zone; they are stored with `source='builder'` and appear on the next visit. There was no pre-existing AI World Builder in this project, so this endpoint is the integration point for one.
- **New zone**: insert a `world_zones` row (+ districts/spawns/objects/graph) and register a scene builder in `static/js/zones.js` (`ZONE_TYPES`).

## Autonomous governments & civilization (all fictional/simulated)
Each zone has its own government, currency, treasury, departments, land, contractors, citizens and local time. Migration `003_civilization.sql` (additive).

- **Shared simulation clock** (`services/civ/clock.py`): one sim timestamp, each zone shows it with its own timezone offset (Aether +0 h, Wakanda +7 h by default). Speeds 1x/24x/60x/240x/1440x, pause. Day/night lighting in the 3D world follows the zone's local time (Settings can switch this off). Restart-safe: real time of the last advance is persisted, downtime is not credited, and the engine records `processed_ts` in the same transaction as each simulated minute, so nothing is processed twice.
- **Worker** (`services/civ/engine.py`, started with the app): processes simulated minutes: construction progress, hourly citizen activities, daily planning/payroll/spending/operating costs, weekly trade, monthly fiscal periods and population growth. Ollama is NOT called per tick: it only drafts a project name/rationale asynchronously.
- **Government**: 7 departments per government (Executive, Finance, Development, Construction, Trade, Population & Welfare, Security); heads are real in-world agents (chat with them: they know the live treasury/projects), sub-agents (Architect, Project Manager, Quantity Surveyor, ...) are personas.
- **Land & construction**: parcels (unique, non-overlapping, owner/permission/classification), development workflow Proposed -> Budget Approved -> Contractor Assigned -> Site Preparation -> Foundation -> Structural -> Exterior -> Inspection -> Completed. The budget is reserved in escrow BEFORE work starts, paid by milestone, and every tick re-checks that the contractor holds a permit and an active assignment for that exact parcel. Visible stages in 3D (survey stakes, excavator, slab, frame growing floor by floor with crane, cladding + scaffolding); finished buildings become real world objects.
- **Autonomy** per government: `manual` (every project needs approval), `semi` (default: routine projects under a cost limit and quota are auto-approved), `auto` (within limits/quota). Ollama text can never change cost, parcel, approval or money.
- **Finance**: integer minor units, double-entry ledger (`government_transactions` + `ledger_entries`), idempotent refs (no duplicate payments), no negative asset balances, fiscal periods/budgets, revenues, expenses, FX between the two fictional currencies, audited reversal. Invariant checks: total debits == credits, stored balances == journal sums.
- **Citizens**: schedule-driven routines (no LLM), walk along the road graph between home/work/social places, receive salaries, pay income/sales/business tax, spend at local shops; population grows when housing exists and new buildings create jobs.
- **Trade**: agreements between governments settle once per period (UNIQUE agreement+period), each side in its own currency.
- **UI**: `Gov` button (dashboards: government, development + parcel map + approve/reject/cancel, finance + transaction history + reverse, civilization), `Obs` = Civilization Observer map of the whole world with simulation speed/pause. Write actions need the admin token.
- **Admin API** (token): `POST /api/civilization/clock|sim/step|governments/{id}/autonomy|status|propose|projects/{id}/approve|reject|cancel|transactions/{id}/reverse`.

## Pandora Nature World (zone 3)
An original alien-nature zone (zone id `pandora`, +-500 m): a colossal home tree with a ring of woven pods and a council hall, a luminous sacred forest (glowing trees, mushrooms and ferns that brighten at night), floating islands with waterfalls (scenery, reached by air), an azure sea with docks and floating reef homes, and ancient ruins. Layout: `services/zone_pandora.py` (fixed seed, stored in SQLite); scene: `static/js/pandora.js` on the generic open-zone engine (`wakanda.js` is now parametrised by zone id + config).
- **Government**: Pandora Tribal Confederation (AI High Elder, currency Pandora Credits) with the same 7 departments under tribal names, 8 Ollama-capable officials (e.g. Ayla = Organic Architect / Land & Construction), 12 parcels (one restricted conservation plot), 2 contractors, 40 citizens with tribal wear, and trade deals with Aether and Wakanda. Organic civic buildings (woven pods / tree-house towers) are built through the same construction workflow.
- **Time**: Pandora runs 5 h behind the base clock; night uses a moonlit ambient so the bioluminescence reads. Border: Pandora lies east of Wakanda.
- **Not built**: wildlife/food-chain ecosystem, weather, mounts, walkable floating islands, a Nature Balance Index, and the 16 km terrain of the brief (a browser streams ~1 km).

## Graphics (realistic pipeline)
`static/js/`: `world.js` (modular city) · `materials.js` (procedural PBR: colour + normal + roughness/metalness maps, facade generator) · `lighting.js` (sun + shadows, moon, hemisphere, environment map, sky dome, bloom) · `characters.js` (GLB humanoids + `AnimationMixer` idle/walk/run) · `assets.js` (loading, quality levels, fallback).

- **Quality**: Settings -> Graphics quality (`high` shadows+bloom+reflections, `medium` shadows, `low` none, `fallback` no GLB models / no normal+ORM maps, simple procedural humanoids). Also `?q=fallback`. The frame rate is monitored: if it stays < 22 fps, bloom and then shadows are switched off automatically.
- **Assets**: `static/assets.json` lists the GLB files. Characters use three.js example models (`static/models/Xbot.glb` for agents, `Soldier.glb` for the player; MIT-licensed example assets, see the three.js repo). If a file is missing or fails, the procedural humanoid is used.
- **Your own GLB buildings**: put them in `static/models/` and add e.g. `"buildings": {"hq": "/static/models/hq.glb"}` (keys: `hq`, `lab`, `library`, `meeting`). They are auto-fitted to the building footprint. Your own textures: replace the generators in `materials.js` (`M.asphalt` etc.) with `TextureLoader` maps.
- Scale is metres: 1.8 m characters, 3.8 m floors, 6 m roads, walking 3.4 m/s, running 7 m/s.
# metaverse-game
