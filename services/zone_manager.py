"""Zones: registry, travel, per-zone player positions, stored layouts and the object 'builder'.
A zone is data in SQLite (world_zones + objects/districts/spawns); the browser picks a scene builder by zone.builder,
so adding a zone needs data, not changes here."""
import json
import math

from config import Config
from database.db import q, q1, run, tx
from services import event_manager as ev
from services import world_manager as world
from services import zone_mars, zone_pandora, zone_wakanda
from services.errors import ApiError

CHUNK = 100.0
# kinds an admin/AI builder may add, with the numeric fields each one needs
BUILDABLE = {"forest": ("r", "count"), "village_hut": ("r", "h"), "granary": ("r", "h"), "skyscraper": ("w", "d", "h"),
             "tower": ("r", "h"), "garden": ("w", "d"), "info_point": (), "hill": ("r", "h"), "plateau": ("r", "h", "blend"),
             "hologram": ("w", "h"), "platform": ("w", "d")}


def _chunk(v, bound):
    return int(math.floor((v + bound) / CHUNK))


def _insert_objects(c, zone_id, bound, objs, source):
    ids = []
    for o in objs:
        ids.append(c.execute("INSERT INTO world_objects(zone_id,kind,x,z,rot,data,district,chunk_x,chunk_z,source) VALUES(?,?,?,?,?,?,?,?,?,?)",
                  (zone_id, o["kind"], o["x"], o["z"], o.get("rot", 0), json.dumps(o["data"]), o.get("district"),
                   _chunk(o["x"], bound), _chunk(o["z"], bound), source)).lastrowid)
    c.execute("DELETE FROM world_chunks WHERE zone_id=?", (zone_id,))
    c.execute("INSERT INTO world_chunks(zone_id,cx,cz,object_count) SELECT zone_id,chunk_x,chunk_z,COUNT(*) FROM world_objects "
              "WHERE zone_id=? GROUP BY chunk_x,chunk_z", (zone_id,))
    return ids


def add_objects(zone_id, objs, source):
    """Insert already-validated objects (e.g. finished government buildings) and register their obstacle boxes. Returns the new ids."""
    z = get_zone(zone_id)
    with tx() as c:
        ids = _insert_objects(c, zone_id, z["bound"], objs, source)
        meta = json.loads(c.execute("SELECT meta FROM world_zones WHERE id=?", (zone_id,)).fetchone()[0])
        for o in objs:
            b = o["data"].get("box")
            if b:
                meta["boxes"].append([o["x"] - b[0] / 2, o["x"] + b[0] / 2, o["z"] - b[1] / 2, o["z"] + b[1] / 2])
        c.execute("UPDATE world_zones SET meta=? WHERE id=?", (json.dumps(meta), zone_id))
    world.reload_graph(zone_id)
    return ids


def add_road(zone_id, bp, name, project_id):
    """A finished road: a visible world object plus a new waypoint joined to its starting waypoint, so pathfinding and traffic can use it."""
    ids = add_objects(zone_id, [{"kind": "civic_road", "x": bp["x"], "z": bp["z"], "rot": 0, "district": None,
                                 "data": {"a": bp["a"], "b": bp["b"], "w": bp["width"], "name": name, "project_id": project_id}}], "construction")
    with tx() as c:
        meta = json.loads(c.execute("SELECT meta FROM world_zones WHERE id=?", (zone_id,)).fetchone()[0])
        meta["nodes"][bp["node"]] = list(bp["b"]); meta["edges"].append([bp["from"], bp["node"]])
        c.execute("UPDATE world_zones SET meta=? WHERE id=?", (json.dumps(meta), zone_id))
    world.reload_graph(zone_id)
    return ids[0]


def ensure_zones(full=True):
    """Idempotent: register Aether City (existing data) and generate Wakanda once (fixed seed, stored in SQLite)."""
    with tx() as c:
        if not c.execute("SELECT 1 FROM world_zones WHERE id='aether_city'").fetchone():
            c.execute("INSERT INTO world_zones(id,name,description,builder,bound,seed,sort,meta) VALUES(?,?,?,?,?,?,?,?)",
                      ("aether_city", "Aether City", "The original AI city: plaza, headquarters, laboratory, library, meeting centre and homes.",
                       "aether_city", 250, 0, 1, json.dumps(world.aether_meta())))
            c.execute("INSERT OR IGNORE INTO world_spawn_points(zone_id,key,name,x,y,z,rot,is_default) VALUES('aether_city','plaza','Main Plaza',0,0,8,3.14159,1)")
            for l in world.LOCATIONS:
                if l[2] != "plaza":
                    c.execute("INSERT OR IGNORE INTO world_districts(zone_id,location_key,name) VALUES('aether_city',?,?)", (l[0], l[1]))
        c.execute("INSERT OR IGNORE INTO agent_zone_assignments(agent_id,zone_id,district_key) SELECT id,zone,home_location FROM agents")
        if full and not c.execute("SELECT 1 FROM world_zones WHERE id='wakanda'").fetchone():
            z = zone_wakanda.ZONE
            objs, meta = zone_wakanda.generate()
            c.execute("INSERT INTO world_zones(id,name,description,builder,bound,seed,sort,meta) VALUES(?,?,?,?,?,?,?,?)",
                      (z["id"], z["name"], z["description"], z["builder"], z["bound"], z["seed"], z["sort"], json.dumps(meta)))
            for key, name, kind, x, zz, w, d, h, col, node, desc in zone_wakanda.LOCATIONS:
                c.execute("INSERT INTO world_locations(world_id,key,name,kind,x,z,w,d,h,color,node,zone) VALUES(1,?,?,?,?,?,?,?,?,?,?,'wakanda')",
                          (key, name, kind, x, zz, w, d, h, col, node))
                c.execute("INSERT INTO world_districts(zone_id,location_key,name,description,color) VALUES('wakanda',?,?,?,?)", (key, name, desc, col))
            for key, name, dist, x, zz, rot, default in zone_wakanda.SPAWNS:
                c.execute("INSERT INTO world_spawn_points(zone_id,key,name,district_key,x,y,z,rot,is_default) VALUES('wakanda',?,?,?,?,0,?,?,?)",
                          (key, name, dist, x, zz, rot, default))
            _insert_objects(c, "wakanda", z["bound"], objs, "generator")
        if full and not c.execute("SELECT 1 FROM world_zones WHERE id='pandora'").fetchone():
            z = zone_pandora.ZONE
            objs, meta = zone_pandora.generate()
            c.execute("INSERT INTO world_zones(id,name,description,builder,bound,seed,sort,meta) VALUES(?,?,?,?,?,?,?,?)",
                      (z["id"], z["name"], z["description"], z["builder"], z["bound"], z["seed"], z["sort"], json.dumps(meta)))
            for key, name, kind, x, zz, w, d, h, col, node, desc in zone_pandora.LOCATIONS:
                c.execute("INSERT INTO world_locations(world_id,key,name,kind,x,z,w,d,h,color,node,zone) VALUES(1,?,?,?,?,?,?,?,?,?,?,'pandora')", (key, name, kind, x, zz, w, d, h, col, node))
                c.execute("INSERT INTO world_districts(zone_id,location_key,name,description,color) VALUES('pandora',?,?,?,?)", (key, name, desc, col))
            for key, name, dist, x, zz, rot, default in zone_pandora.SPAWNS:
                c.execute("INSERT INTO world_spawn_points(zone_id,key,name,district_key,x,y,z,rot,is_default) VALUES('pandora',?,?,?,?,0,?,?,?)", (key, name, dist, x, zz, rot, default))
            _insert_objects(c, "pandora", z["bound"], objs, "generator")
        if full and not c.execute("SELECT 1 FROM world_zones WHERE id='mars'").fetchone():
            z = zone_mars.ZONE
            objs, meta = zone_mars.generate()
            c.execute("INSERT INTO world_zones(id,name,description,builder,bound,seed,sort,meta) VALUES(?,?,?,?,?,?,?,?)",
                      (z["id"], z["name"], z["description"], z["builder"], z["bound"], z["seed"], z["sort"], json.dumps(meta)))
            for key, name, kind, x, zz, w, d, h, col, node, desc in zone_mars.LOCATIONS:
                c.execute("INSERT INTO world_locations(world_id,key,name,kind,x,z,w,d,h,color,node,zone) VALUES(1,?,?,?,?,?,?,?,?,?,?,'mars')", (key, name, kind, x, zz, w, d, h, col, node))
                c.execute("INSERT INTO world_districts(zone_id,location_key,name,description,color) VALUES('mars',?,?,?,?)", (key, name, desc, col))
            for key, name, dist, x, zz, rot, default in zone_mars.SPAWNS:
                c.execute("INSERT INTO world_spawn_points(zone_id,key,name,district_key,x,y,z,rot,is_default) VALUES('mars',?,?,?,?,0,?,?,?)", (key, name, dist, x, zz, rot, default))
            _insert_objects(c, "mars", z["bound"], objs, "generator")
    if full:
        from services import agent_manager
        agent_manager.seed_wakanda_agents()


# ---------- queries ----------
def list_zones(user_id=None):
    out = []
    for z in q("SELECT id,name,description,builder,status,bound FROM world_zones ORDER BY sort,id"):
        z["agents"] = [a["name"] for a in q("SELECT name FROM agents WHERE zone=? AND status='active' ORDER BY id", (z["id"],))]
        z["districts"] = q("SELECT d.location_key AS key, d.name FROM world_districts d WHERE d.zone_id=?", (z["id"],))
        if user_id:
            p = q1("SELECT x,z,updated_at FROM player_zone_positions WHERE user_id=? AND zone_id=?", (user_id, z["id"]))
            z["visited"] = bool(p)
            z["last_position"] = p
        out.append(z)
    return out


def get_zone(zone_id):
    z = q1("SELECT id,name,description,builder,status,bound,seed FROM world_zones WHERE id=?", (zone_id,))
    if not z:
        raise ApiError("Unknown zone", 404, "not_found")
    z["spawn"] = default_spawn(zone_id)
    return z


def default_spawn(zone_id):
    return q1("SELECT key,name,x,y,z,rot FROM world_spawn_points WHERE zone_id=? ORDER BY is_default DESC,id LIMIT 1", (zone_id,))


def zone_map(zone_id):
    z = get_zone(zone_id)
    meta = json.loads(q1("SELECT meta FROM world_zones WHERE id=?", (zone_id,))["meta"])
    return {"zone": z, "bound": z["bound"], "locations": world.locations(zone_id),
            "districts": q("SELECT location_key AS key,name,description,color FROM world_districts WHERE zone_id=?", (zone_id,)),
            "spawn_points": q("SELECT key,name,district_key,x,y,z,rot,is_default FROM world_spawn_points WHERE zone_id=?", (zone_id,)),
            "nodes": meta["nodes"], "edges": meta["edges"], "river": meta.get("river"), "bridges": meta.get("bridges", [])}


def zone_objects(zone_id, after=0, chunks=None):
    get_zone(zone_id)
    rows = q("SELECT id,kind,x,z,rot,data,district,chunk_x,chunk_z,source FROM world_objects WHERE zone_id=? AND id>? ORDER BY id", (zone_id, after))
    for r in rows:
        r["data"] = json.loads(r["data"])
    return rows


def zone_agents(zone_id):
    from services import agent_manager
    get_zone(zone_id)
    return [a for a in agent_manager.list_agents() if a["zone"] == zone_id]


# ---------- player position / travel ----------
def _clean_pos(p, bound):
    try:
        x, y, z, rot = (float(p.get(k, 0)) for k in ("x", "y", "z", "rot"))
    except (TypeError, ValueError, AttributeError):
        raise ApiError("x,y,z,rot must be numbers", 422, "validation")
    if not all(abs(v) < 5000 for v in (x, y, z, rot)) or abs(x) > bound or abs(z) > bound:
        raise ApiError("Position out of range", 422, "validation")
    return x, y, z, rot


def current_zone(user_id):
    return (q1("SELECT current_zone FROM users WHERE id=?", (user_id,)) or {}).get("current_zone", "aether_city")


def save_position(user_id, pos):
    zone = current_zone(user_id)
    x, y, z, rot = _clean_pos(pos, get_zone(zone)["bound"] + 5)
    run("INSERT INTO player_zone_positions(user_id,zone_id,x,y,z,rot) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,zone_id) DO UPDATE SET "
        "x=excluded.x,y=excluded.y,z=excluded.z,rot=excluded.rot,updated_at=datetime('now')", (user_id, zone, x, y, z, rot))
    if zone == "aether_city":   # legacy table kept in sync
        run("INSERT INTO user_positions(user_id,x,y,z,rot) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET "
            "x=excluded.x,y=excluded.y,z=excluded.z,rot=excluded.rot,updated_at=datetime('now')", (user_id, x, y, z, rot))
    return zone, x, z


def _inside_obstacle(zone_id, x, z):
    return any(b[0] < x < b[1] and b[2] < z < b[3] for b in world.graph(zone_id)["boxes"])


def position_for(user_id, zone_id):
    p = q1("SELECT x,y,z,rot FROM player_zone_positions WHERE user_id=? AND zone_id=?", (user_id, zone_id))
    if not p and zone_id == "aether_city":
        p = q1("SELECT x,y,z,rot FROM user_positions WHERE user_id=?", (user_id,))   # pre-zones saves
    if p and not _inside_obstacle(zone_id, p["x"], p["z"]):
        return p
    s = default_spawn(zone_id)
    return {"x": s["x"], "y": s["y"], "z": s["z"], "rot": s["rot"]}


def player_location(user_id):
    zone = current_zone(user_id)
    return {"zone_id": zone, "position": position_for(user_id, zone), "zone": get_zone(zone)}


def travel(user_id, zone_id, spawn_key=None, here=None, at=None):
    """Validate destination, save the position left behind, switch zone, return where the player appears."""
    if not isinstance(zone_id, str):
        raise ApiError("zone_id required", 422, "validation")
    dest = q1("SELECT id,status FROM world_zones WHERE id=?", (zone_id,))
    if not dest:
        raise ApiError("Unknown zone", 404, "not_found")
    if dest["status"] != "active":
        raise ApiError("Zone is not available", 409, "unavailable")
    src = current_zone(user_id)
    if isinstance(here, dict):
        save_position(user_id, here)
    if spawn_key:
        sp = q1("SELECT x,y,z,rot FROM world_spawn_points WHERE zone_id=? AND key=?", (zone_id, spawn_key))
        if not sp:
            raise ApiError("Unknown spawn point", 422, "validation")
    elif isinstance(at, dict):  # border crossing: arrive at the matching edge of the neighbouring zone (range-checked like any saved position)
        x, y, z, rot = _clean_pos(at, get_zone(zone_id)["bound"])
        sp = {"x": x, "y": y, "z": z, "rot": rot}
    else:
        sp = position_for(user_id, zone_id)
    old = q1("SELECT x,z FROM player_zone_positions WHERE user_id=? AND zone_id=?", (user_id, src)) or {"x": None, "z": None}
    with tx() as c:
        c.execute("UPDATE users SET current_zone=? WHERE id=?", (zone_id, user_id))
        c.execute("INSERT INTO world_travel_history(user_id,from_zone,to_zone,from_x,from_z) VALUES(?,?,?,?,?)", (user_id, src, zone_id, old["x"], old["z"]))
        c.execute("INSERT INTO player_zone_positions(user_id,zone_id,x,y,z,rot) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,zone_id) DO UPDATE SET "
                  "x=excluded.x,y=excluded.y,z=excluded.z,rot=excluded.rot,updated_at=datetime('now')", (user_id, zone_id, sp["x"], sp["y"], sp["z"], sp["rot"]))
    ev.emit("player_traveled", "Player traveled from %s to %s" % (src, zone_id), zone=zone_id)
    return {"zone": get_zone(zone_id), "position": {"x": sp["x"], "y": sp["y"], "z": sp["z"], "rot": sp["rot"]}, "from_zone": src}


# ---------- builder (AI World Builder hook) ----------
def build(zone_id, objects):
    z = get_zone(zone_id)
    if not isinstance(objects, list) or not 0 < len(objects) <= 50:
        raise ApiError("'objects' must be a list of 1-50 items", 422, "validation")
    clean = []
    for o in objects:
        if not isinstance(o, dict) or o.get("kind") not in BUILDABLE:
            raise ApiError("kind must be one of: " + ", ".join(sorted(BUILDABLE)), 422, "validation")
        try:
            x, zz, rot = float(o["x"]), float(o["z"]), float(o.get("rot", 0))
        except (KeyError, TypeError, ValueError):
            raise ApiError("x and z are required numbers", 422, "validation")
        data = o.get("data") or {}
        if abs(x) > z["bound"] - 5 or abs(zz) > z["bound"] - 5 or not isinstance(data, dict):
            raise ApiError("Object outside the zone or bad data", 422, "validation")
        for f in BUILDABLE[o["kind"]]:
            if not isinstance(data.get(f), (int, float)) or not 0 < data[f] <= 500:
                raise ApiError("%s needs numeric data.%s (0-500)" % (o["kind"], f), 422, "validation")
        for k, v in data.items():                     # only plain scalars/short strings are stored
            if not isinstance(v, (int, float, str, bool)) or (isinstance(v, str) and len(v) > 400):
                raise ApiError("data.%s must be a number, bool or short string" % k, 422, "validation")
        if "w" in data and "d" in data and o["kind"] in ("skyscraper",):
            data["box"] = [data["w"], data["d"]]
        if "r" in data and o["kind"] in ("tower", "village_hut", "granary"):
            data["box"] = [data["r"] * 2 + 1, data["r"] * 2 + 1]
        clean.append({"kind": o["kind"], "x": x, "z": zz, "rot": rot, "data": data, "district": o.get("district")})
    with tx() as c:
        _insert_objects(c, zone_id, z["bound"], clean, "builder")
        meta = json.loads(c.execute("SELECT meta FROM world_zones WHERE id=?", (zone_id,)).fetchone()[0])
        for o in clean:
            d = o["data"]
            if "box" in d:
                meta["boxes"].append([o["x"] - d["box"][0] / 2, o["x"] + d["box"][0] / 2, o["z"] - d["box"][1] / 2, o["z"] + d["box"][1] / 2])
        c.execute("UPDATE world_zones SET meta=? WHERE id=?", (json.dumps(meta), zone_id))
    world.reload_graph(zone_id)
    ev.emit("zone_built", "%d object(s) added to %s" % (len(clean), z["name"]), zone=zone_id)
    return {"added": len(clean)}
