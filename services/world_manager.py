"""World layout (single source of truth), seeding, waypoint graph + A*, collision push-out."""
import heapq
import json
import math

from database.db import get_setting, q, q1, run, set_setting, tx

WORLD_NAME = "Aether City"

# key, name, kind, x, z, w, d, h, neon colour, waypoint node
LOCATIONS = [
    ("plaza", "Main Plaza", "plaza", 0, 0, 26, 26, 0, "#35e0ff", "c"),
    ("hq", "AI Headquarters", "hq", -42, -32, 18, 14, 26, "#7c5cff", "hq"),
    ("lab", "AI Research Laboratory", "lab", 42, -32, 18, 14, 14, "#2cff9a", "lab"),
    ("library", "AI Library", "library", -42, 32, 20, 13, 10, "#ffb347", "lib"),
    ("meeting", "AI Meeting Center", "meeting", 42, 32, 18, 14, 12, "#ff5cae", "mtg"),
    ("residential", "AI Residential Area", "residential", 0, 56, 70, 28, 7, "#5cc8ff", "res"),
]
# Residential houses (collision boxes + visuals): x, z, w, d, h
HOUSES = [(-30, 44, 8, 8, 6), (-12, 44, 8, 8, 6), (12, 44, 8, 8, 6), (30, 44, 8, 8, 6),
          (-30, 64, 8, 8, 6), (-12, 64, 8, 8, 6), (12, 64, 8, 8, 6), (30, 64, 8, 8, 6)]

NODES = {"c": (0, 0), "n": (0, -21), "s": (0, 21), "e": (21, 0), "w": (-21, 0),
         "nw": (-21, -21), "ne": (21, -21), "sw": (-21, 21), "se": (21, 21),
         "hq": (-42, -21), "lab": (42, -21), "lib": (-42, 21), "mtg": (42, 21),
         "ra": (0, 36), "res": (0, 54), "resw": (-22, 54), "rese": (22, 54)}
EDGES = [("c", "n"), ("c", "s"), ("c", "e"), ("c", "w"), ("n", "nw"), ("nw", "hq"), ("n", "ne"), ("ne", "lab"),
         ("s", "sw"), ("sw", "lib"), ("s", "se"), ("se", "mtg"), ("nw", "w"), ("w", "sw"), ("ne", "e"), ("e", "se"),
         ("s", "ra"), ("ra", "res"), ("res", "resw"), ("res", "rese")]
PATROL = ["c", "n", "ne", "e", "se", "s", "sw", "w", "nw"]  # loop around the city

# Axis-aligned obstacle boxes (minx, maxx, minz, maxz) for the original Aether City.
BOXES = [(x - w / 2, x + w / 2, z - d / 2, z + d / 2) for _, _, kind, x, z, w, d, _, _, _ in LOCATIONS
         if kind not in ("plaza", "residential")] + \
        [(x - w / 2, x + w / 2, z - d / 2, z + d / 2) for x, z, w, d, _ in HOUSES]

AETHER = "aether_city"
_G = {}   # zone_id -> {nodes, adj, patrol, boxes}; loaded from world_zones.meta


def aether_meta():
    return {"nodes": {k: list(v) for k, v in NODES.items()}, "edges": [list(e) for e in EDGES], "patrol": PATROL,
            "boxes": [list(b) for b in BOXES]}


def graph(zone):
    g = _G.get(zone)
    if g is None:
        row = q1("SELECT meta FROM world_zones WHERE id=?", (zone,))
        meta = json.loads(row["meta"]) if row else aether_meta()
        adj = {}
        for a, b in meta["edges"]:
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)
        g = _G[zone] = {"nodes": {k: tuple(v) for k, v in meta["nodes"].items()}, "adj": adj, "patrol": meta["patrol"],
                        "boxes": [tuple(b) for b in meta["boxes"]]}
    return g


def reload_graph(zone):
    _G.pop(zone, None)


def node_pos(zone, node):
    return graph(zone)["nodes"][node]


def seed_world():
    if q1("SELECT 1 FROM worlds"):
        return
    with tx() as c:
        c.execute("INSERT INTO worlds(id,name,description) VALUES(1,?,?)", (WORLD_NAME, "Futuristic AI city"))
        c.executemany("INSERT INTO world_locations(world_id,key,name,kind,x,z,w,d,h,color,node) VALUES(1,?,?,?,?,?,?,?,?,?,?)",
                      LOCATIONS)
        c.execute("INSERT INTO world_state(key,value) VALUES('time_of_day','17')")


def nearest_node(zone, x, z):
    nodes = graph(zone)["nodes"]
    return min(nodes, key=lambda n: (nodes[n][0] - x) ** 2 + (nodes[n][1] - z) ** 2)


def find_path(zone, a, b):
    """A* over the zone's waypoint graph. Returns list of node names (a..b)."""
    g = graph(zone); nodes, adj = g["nodes"], g["adj"]

    def h(n):
        return math.dist(nodes[n], nodes[b])
    pq, best, prev = [(h(a), 0, a)], {a: 0}, {}
    while pq:
        _, gc, n = heapq.heappop(pq)
        if n == b:
            path = [n]
            while n in prev:
                n = prev[n]
                path.append(n)
            return path[::-1]
        for m in adj.get(n, []):
            ng = gc + math.dist(nodes[n], nodes[m])
            if ng < best.get(m, 1e9):
                best[m], prev[m] = ng, n
                heapq.heappush(pq, (ng + h(m), ng, m))
    return [a]


def push_out(zone, x, z, r=0.8):
    """Slide a point out of any obstacle box (basic obstacle avoidance)."""
    for x0, x1, z0, z1 in graph(zone)["boxes"]:
        if x0 - r < x < x1 + r and z0 - r < z < z1 + r:
            d = [x - (x0 - r), (x1 + r) - x, z - (z0 - r), (z1 + r) - z]
            i = d.index(min(d))
            x, z = [(x0 - r, z), (x1 + r, z), (x, z0 - r), (x, z1 + r)][i]
    return x, z


def locations(zone=AETHER):
    return q("SELECT key,name,kind,x,z,w,d,h,color,node FROM world_locations WHERE zone=? ORDER BY id", (zone,))


def get_setting_ws(key, default):
    r = q1("SELECT value FROM world_state WHERE key=?", (key,))
    return r["value"] if r else default


def set_world_state(key, value):
    run("INSERT INTO world_state(key,value,updated_at) VALUES(?,?,datetime('now')) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at", (key, str(value)))


def _meta():
    row = q1("SELECT meta FROM world_zones WHERE id=?", (AETHER,))
    return json.loads(row["meta"]) if row else aether_meta()


def get_state(user_id=None):
    """Aether City layout for the original scene builder (zone state/position come from zone_manager)."""
    from services import zone_manager
    return {"name": q1("SELECT name FROM worlds WHERE id=1")["name"], "locations": locations(AETHER),
            "houses": HOUSES, "nodes": _meta()["nodes"], "edges": _meta()["edges"],   # incl. roads built by the government
            "time_of_day": float(get_setting_ws("time_of_day", 17)),
            "player": zone_manager.position_for(user_id, AETHER) if user_id else {"x": 0, "y": 0, "z": 8, "rot": 3.14159}}
