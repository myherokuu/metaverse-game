"""Deterministic NPC behaviour. A background thread runs a state machine per agent; no LLM involved here.
States: idle, walking, patrolling, working, exploring, talking, following, going_to_building, meeting, returning."""
import math
import random
import threading
import time

from config import Config
from database.db import conn, q, q1, run
from services import event_manager as ev
from services import world_manager as world

LIVE = {}  # agent_id -> state dict (authoritative live position, read by /api/world/agents/state)
_lock = threading.RLock()
_player = {"t": 0, "x": 0.0, "z": 8.0, "zone": "aether_city"}  # last player heartbeat (for follow + sim pausing)
SPEED = 1.7  # m/s, a relaxed human walking pace (matches the walk animation)


def player_seen(x, z, zone="aether_city"):
    _player.update(t=time.time(), x=x, z=z, zone=zone)


def _node_pos(s, node):
    return world.node_pos(s["zone"], node)


def _loc(key, zone=None):
    return q1("SELECT key,name,node,zone FROM world_locations WHERE key=? AND zone=COALESCE(?, zone)", (key, zone))


def _new(a):
    return {"id": a["id"], "zone": a["zone"], "name": a["name"], "x": a["x"], "z": a["z"], "rot": 0.0, "state": "idle", "target": None,
            "path": [], "patrol_left": 0, "timer": random.uniform(1, 4), "hold": 0.0, "home": a["home_location"],
            "autonomous": bool(a["autonomous"]), "working_task": False, "last_state": "idle", "act_row": None,
            "follow_until": 0.0, "role": a["role"]}


def sync_agent(agent_id):
    """(Re)load an agent from the DB; remove it from the sim when inactive."""
    a = q1("SELECT * FROM agents WHERE id=?", (agent_id,))
    with _lock:
        if not a or a["status"] != "active":
            LIVE.pop(agent_id, None)
            return
        s = LIVE.get(agent_id)
        if s is None:
            s = LIVE[agent_id] = _new(a)
            _resume(s, a)
        s.update(autonomous=bool(a["autonomous"]), home=a["home_location"], name=a["name"], zone=a["zone"], role=a["role"])


def load_all():
    for a in q("SELECT id FROM agents WHERE status='active'"):
        sync_agent(a["id"])


def _resume(s, a):
    """Continue the persisted activity after a restart: same position, re-plan the walk to the stored target."""
    if a["activity"] in ("going_to_building", "returning", "exploring", "meeting") and a["target"]:
        _go(s, a["target"], a["activity"])


def set_hold(agent_id, seconds):
    with _lock:
        s = LIVE.get(agent_id)
        if s:
            s["hold"] = max(s["hold"], seconds)
            s["state"] = "talking" if s["state"] != "following" else "following"


def talk(agent_id, on):
    """Player opened/closed the chat: stop, face the player, stay put (hold is refreshed by the client)."""
    with _lock:
        s = LIVE.get(agent_id)
        if not s:
            return
        if on:
            s.update(state="talking", path=[], target=None, hold=20, follow_until=0,
                     rot=math.atan2(_player["x"] - s["x"], _player["z"] - s["z"]))
        elif s["state"] == "talking":
            s.update(hold=0, state="idle", timer=3)


def set_working(agent_id, on):
    s = LIVE.get(agent_id)
    if s:
        s["working_task"] = on


def command(agent_id, act):
    """Execute an already-validated action (see agent_manager.ACTION_SCHEMA). Returns what was applied."""
    with _lock:
        return _command(LIVE.get(agent_id), act)


def _command(s, act):
    if not s:
        return None
    t = act["type"]
    if t == "goto":
        _go(s, act["location"], "going_to_building")
        s["hold"] = 0
        return {"type": "goto", "location": act["location"]}
    if t == "follow":
        s.update(state="following", path=[], hold=0, follow_until=time.time() + 90)
        return {"type": "follow"}
    if t == "stop":
        s.update(state="idle", path=[], timer=4, follow_until=0)
        return {"type": "stop"}
    return None


def _go(s, loc_key, state):
    loc = _loc(loc_key, s["zone"])
    if not loc:
        return
    s["target"] = loc_key
    z = s["zone"]
    nodes = world.find_path(z, world.nearest_node(z, s["x"], s["z"]), loc["node"])
    s["path"] = [_node_pos(s, n) for n in nodes]
    s["state"] = state


_hour_cache = {}


def _local_hour(zone):
    now = time.time()
    c = _hour_cache.get(zone)
    if not c or now - c[0] > 5:
        try:
            from services.civ import clock
            c = _hour_cache[zone] = (now, clock.local_hour(zone))
        except Exception:
            c = _hour_cache[zone] = (now, 12.0)
    return c[1]


def _choose(s):
    """Idle -> next activity (weighted, deterministic rules + dice). At night (zone local time) officials go home and rest;
    security staff stay on duty."""
    hr = _local_hour(s["zone"])
    if (hr >= 22 or hr < 6) and not any(w in (s.get("role") or "") for w in ("Security", "Guard")):
        home = _node_pos(s, _loc(s["home"])["node"])
        if math.dist((s["x"], s["z"]), home) > 8:
            return _go(s, s["home"], "returning")
        s["state"], s["timer"] = "idle", random.uniform(40, 90)
        return
    at_home = math.dist((s["x"], s["z"]), _node_pos(s, _loc(s["home"])["node"])) < 8
    r = random.random()
    if not at_home and r < 0.5:
        return _go(s, s["home"], "returning")
    if r < 0.30:
        s["patrol_left"] = random.randint(3, 6)
        s["state"] = "patrolling"
        _patrol_step(s)
    elif r < 0.60:
        if at_home:
            s.update(state="working", timer=random.uniform(15, 35))
        else:
            _go(s, s["home"], "going_to_building")
    elif r < 0.78:
        _go(s, random.choice([l["key"] for l in world.locations(s["zone"]) if l["kind"] != "plaza"] or [s["home"]]), "exploring")
    elif r < 0.92 and [o for o in LIVE.values() if o["id"] != s["id"] and o["zone"] == s["zone"]]:
        other = random.choice([o for o in LIVE.values() if o["id"] != s["id"] and o["zone"] == s["zone"]])
        z = s["zone"]
        s["target"] = "agent:%d" % other["id"]
        nodes = world.find_path(z, world.nearest_node(z, s["x"], s["z"]), world.nearest_node(z, other["x"], other["z"]))
        s["path"] = [_node_pos(s, n) for n in nodes]
        s["state"] = "meeting"
    else:
        s["state"], s["timer"] = "idle", random.uniform(4, 9)


def _patrol_step(s):
    z, patrol = s["zone"], world.graph(s["zone"])["patrol"]
    cur = world.nearest_node(z, s["x"], s["z"])
    i = patrol.index(cur) if cur in patrol else 0
    nxt = patrol[(i + 1) % len(patrol)]
    s["path"] = [_node_pos(s, n) for n in world.find_path(z, cur, nxt)]
    s["patrol_left"] -= 1


def _arrived(s):
    st = s["state"]
    s["path"] = []
    if st == "patrolling" and s["patrol_left"] > 0:
        return _patrol_step(s)
    name = (_loc(s["target"], s["zone"]) or {}).get("name") if s["target"] and not s["target"].startswith("agent:") else None
    if name:
        ev.emit("agent_arrived", "%s arrived at %s" % (s["name"], name), s["id"])
    if st == "meeting" and s["target"] and s["target"].startswith("agent:"):
        o = LIVE.get(int(s["target"].split(":")[1]))
        if o and o["zone"] == s["zone"] and math.dist((s["x"], s["z"]), (o["x"], o["z"])) < 9 and o["state"] != "talking":
            from services import agent_manager
            s["state"], s["hold"] = "talking", 14
            o["hold"] = 14
            agent_manager.chatter(s["id"], o["id"])
            return
    if s["target"] == s["home"] or (st in ("going_to_building",) and s["target"] == s["home"]):
        s["state"], s["timer"] = "working", random.uniform(15, 35)
    else:
        s["state"], s["timer"] = "idle", random.uniform(4, 10)
    s["target"] = None if s["state"] == "idle" else s["target"]


def _step(s, dt):
    """Advance one agent by dt seconds."""
    if s["hold"] > 0:  # talking: stand still, face nothing in particular
        s["hold"] -= dt
        if s["hold"] <= 0:
            s["state"], s["timer"] = ("walking" if s["path"] else "idle"), 3
        return
    if s["working_task"]:
        s["state"] = "working"
        return
    if s["state"] == "following":
        px, pz = _player["x"], _player["z"]
        if time.time() > s["follow_until"] or time.time() - _player["t"] > 20:
            s.update(state="idle", timer=3)
            return
        if math.dist((s["x"], s["z"]), (px, pz)) > 3.5:
            _move(s, px, pz, SPEED * 1.5 * dt)
        return
    if s["path"]:
        tx_, tz_ = s["path"][0]
        if math.dist((s["x"], s["z"]), (tx_, tz_)) < 0.6:
            s["path"].pop(0)
            if not s["path"]:
                _arrived(s)
            return
        _move(s, tx_, tz_, SPEED * dt)
        return
    if s["state"] in ("working", "idle", "exploring", "going_to_building", "returning", "meeting", "walking", "patrolling"):
        s["timer"] -= dt
        if s["timer"] <= 0:
            if s["autonomous"]:
                _choose(s)
            else:
                s["timer"] = 5
                s["state"] = "idle"


def _move(s, tx_, tz_, d):
    dx, dz = tx_ - s["x"], tz_ - s["z"]
    dist = math.hypot(dx, dz) or 1
    k = min(1, d / dist)
    s["x"], s["z"] = world.push_out(s["zone"], s["x"] + dx * k, s["z"] + dz * k)
    s["rot"] = math.atan2(dx, dz)


def _persist():
    c = conn()
    for s in list(LIVE.values()):
        c.execute("UPDATE agents SET x=?, z=?, activity=?, target=? WHERE id=?",
                  (s["x"], s["z"], s["state"], s["target"], s["id"]))
        if s["state"] != s["last_state"]:
            c.execute("UPDATE agent_activities SET ended_at=datetime('now') WHERE agent_id=? AND ended_at IS NULL", (s["id"],))
            c.execute("INSERT INTO agent_activities(agent_id,activity,target) VALUES(?,?,?)", (s["id"], s["state"], s["target"]))
            if s["state"] not in ("idle", "talking"):
                ev.emit("agent_activity", "%s is now %s" % (s["name"], s["state"].replace("_", " ")), s["id"])
            s["last_state"] = s["state"]


def _loop():
    last, saved = time.monotonic(), 0.0
    while True:
        time.sleep(1.0 / Config.TICK_HZ)
        now = time.monotonic()
        dt, last = min(now - last, 0.5), now
        try:
            if time.time() - _player["t"] > Config.PAUSE_WITHOUT_PLAYER:
                continue  # nobody watching: pause the simulation (saves CPU)
            with _lock:
                for s in list(LIVE.values()):
                    if s["zone"] == _player["zone"]:      # only the zone the player is in is simulated
                        _step(s, dt)
            saved += dt
            if saved > 3:
                saved = 0
                _persist()
        except Exception as e:  # never let the sim thread die
            print("behavior error:", repr(e))


def start():
    load_all()
    threading.Thread(target=_loop, daemon=True, name="behavior").start()


def live_states(zone="aether_city"):
    ag = {a["id"]: a for a in q("SELECT id,role,model,model_key,texture_variant,outfit_variant,animation_profile,scale,expression_profile FROM agents WHERE status='active' AND zone=?", (zone,))}
    from services.agent_manager import _color
    return [{"id": s["id"], "zone": s["zone"], "name": s["name"], "role": ag.get(s["id"], {}).get("role", ""), "x": round(s["x"], 2),
             "z": round(s["z"], 2), "rot": round(s["rot"], 3), "state": s["state"], "color": _color(s["name"]),
             "moving": bool(s["path"]) or (s["state"] == "following"),
             "look": {k: ag[s["id"]][k] for k in ("model_key", "texture_variant", "outfit_variant", "animation_profile", "scale", "expression_profile")}} for s in LIVE.values() if s["id"] in ag]
