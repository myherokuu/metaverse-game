"""Government construction: proposal -> budget check -> approval (by autonomy level) -> escrow -> contractor + plot -> visible stages
-> milestone payments -> completion (a real world object). All money/ownership/permission rules are deterministic Python;
an LLM may only suggest a name or rationale (planner.py) and can never change a cost, approval or assignment."""
import json
import math

from database.db import q, q1, run, tx
from services import world_manager as world
from services import zone_manager
from services.civ import clock, events, finance, ledger
from services.civ.ledger import MINOR, LedgerError

STAGES = ["Proposed", "Budget Approved", "Contractor Assigned", "Site Preparation", "Foundation", "Structural Construction", "Exterior Completion", "Inspection", "Completed"]
RANGES = [("Site Preparation", 0, 15), ("Foundation", 15, 35), ("Structural Construction", 35, 75), ("Exterior Completion", 75, 92), ("Inspection", 92, 100)]
PAY_PCT = {"Site Preparation": 10, "Foundation": 20, "Structural Construction": 35, "Exterior Completion": 20, "Inspection": 15}   # % of cost on stage completion
WORK_K = 0.6                      # worker-hours per m2 of floor area x complexity
# kind: footprint w,d, floors, floor height, cost (credits), allowed parcel classes, effect
KINDS = {
    "house": dict(w=9, d=9, floors=1, fh=3.2, cost=160_000, cx=1.0, classes=("residential", "mixed"), effect={"housing": 4}),
    "apartment": dict(w=13, d=13, floors=4, fh=3.4, cost=640_000, cx=1.1, classes=("residential", "mixed"), effect={"housing": 16}),
    "office": dict(w=13, d=13, floors=5, fh=3.6, cost=780_000, cx=1.2, classes=("commercial", "mixed"), effect={"jobs": 30}),
    "workshop": dict(w=14, d=11, floors=1, fh=5.0, cost=380_000, cx=1.0, classes=("industrial", "mixed"), effect={"jobs": 18}),
    "clinic": dict(w=12, d=12, floors=2, fh=3.6, cost=450_000, cx=1.15, classes=("civic", "mixed"), effect={"health": 1}),
    "research_lab": dict(w=13, d=13, floors=3, fh=4.0, cost=900_000, cx=1.4, classes=("civic", "commercial", "mixed", "industrial"), effect={"research": 1}),
    "road": dict(w=10, d=10, floors=1, fh=.2, cost=0, cx=.5, classes=("civic",), effect={}),   # sized per project by create_road(); never proposed by the planner
}
ROAD_W, ROAD_COST_PER_M, LAND_PRICE = 10, 3_000, 150_000          # metres wide, credits per metre of road, credits per 16x16 parcel
DIRS = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}
LIVE = ("awaiting_budget", "awaiting_approval", "approved", "active", "blocked")


def estimate(kind):
    k = KINDS[kind]
    return dict(kind=kind, w=k["w"], d=k["d"], floors=k["floors"], h=round(k["floors"] * k["fh"], 1), complexity=k["cx"], cost_minor=int(k["cost"] * MINOR), effect=k["effect"])


def _parcel(pid):
    return q1("SELECT * FROM land_parcels WHERE id=?", (pid,))


def candidate_parcels(gov_id, kind):
    k = KINDS[kind]
    out = []
    for p in q("SELECT * FROM land_parcels WHERE owner_government_id=? AND status='vacant' AND permission='approved' ORDER BY id", (gov_id,)):
        if p["classification"] in k["classes"] and p["x1"] - p["x0"] >= k["w"] + 2 and p["z1"] - p["z0"] >= k["d"] + 2 and not q1(
                "SELECT 1 FROM construction_projects WHERE parcel_id=? AND status IN %s" % str(LIVE), (p["id"],)):
            out.append(p)
    return out


def blueprint(kind, parcel):
    """World Builder: a validated 3D construction blueprint centred on the parcel. Raises ValueError if it does not fit."""
    e = estimate(kind)
    cx, cz = (parcel["x0"] + parcel["x1"]) / 2, (parcel["z0"] + parcel["z1"]) / 2
    if e["w"] > parcel["x1"] - parcel["x0"] - 2 or e["d"] > parcel["z1"] - parcel["z0"] - 2 or e["h"] > 40:
        raise ValueError("building does not fit the parcel")
    return {"kind": kind, "x": cx, "z": cz, "w": e["w"], "d": e["d"], "h": e["h"], "floors": e["floors"], "pad": [parcel["x0"], parcel["x1"], parcel["z0"], parcel["z1"]]}


def create_project(gov_id, kind, parcel_id, ts, proposed_by="development_ministry", name=None, rationale=""):
    g = finance.gov(gov_id)
    if kind not in KINDS:
        raise ValueError("unknown project kind")
    p = _parcel(parcel_id)
    if not p or p["zone_id"] != g["zone_id"] or p["owner_government_id"] != gov_id:
        raise ValueError("parcel is not owned by this government")
    if p["permission"] != "approved" or p["status"] != "vacant" or p["classification"] not in KINDS[kind]["classes"]:
        raise ValueError("parcel is not available/approved for this kind of development")
    bp = blueprint(kind, p)
    e = estimate(kind)
    try:
        pid = run("INSERT INTO construction_projects(government_id,zone_id,parcel_id,kind,name,floors,w,d,h,complexity,estimated_cost_minor,proposed_by,rationale,blueprint,created_ts) "
                  "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (gov_id, g["zone_id"], parcel_id, kind, (name or "%s on %s" % (kind.replace("_", " ").title(), p["code"]))[:60], e["floors"], e["w"], e["d"], e["h"], e["complexity"],
                   e["cost_minor"], proposed_by, rationale[:300], json.dumps(bp), ts)).lastrowid
    except Exception as ex:
        if "UNIQUE" in str(ex):
            raise ValueError("parcel already has a live project")
        raise
    events.emit(g["zone_id"], gov_id, "project_proposed", "%s proposed: %s (%s)" % (g["name"], KINDS[kind] and kind.replace("_", " "), p["code"]), ts, {"project_id": pid})
    return pid


# ---------- map growth: new land + connected roads ----------
def _overlap(a, b, m=0):                                            # (x0,x1,z0,z1) boxes
    return a[0] - m < b[1] and a[1] + m > b[0] and a[2] - m < b[3] and a[3] + m > b[2]


def _zone_bound(zone):
    return q1("SELECT bound FROM world_zones WHERE id=?", (zone,))["bound"]


def _river_dist(meta, x, z):
    r = meta.get("river")
    if not r:
        return 1e9
    best, pts = 1e9, r["pts"]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]; dx, dz = b[0] - a[0], b[1] - a[1]
        t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz or 1)))
        best = min(best, math.hypot(x - a[0] - t * dx, z - a[1] - t * dz))
    return best - r["w"] / 2


def expand_territory(gov_id, direction, ts):
    """Annex a new 2x3 block of 16x16 parcels (same grid as the existing ones, 4 m lanes) just beyond the built-up edge in `direction`.
    Paid from the treasury (counts against the construction budget). Returns the new parcel codes."""
    g = finance.gov(gov_id); zone = g["zone_id"]
    if direction not in DIRS:
        raise ValueError("direction must be north|south|east|west")
    dx, dz = DIRS[direction]
    ps = q("SELECT * FROM land_parcels WHERE zone_id=?", (zone,))
    if not ps:
        raise ValueError("no existing land to expand from")
    boxes, bound = world.graph(zone)["boxes"], _zone_bound(zone)
    edge = max((p["x1"] if dx > 0 else -p["x0"] if dx < 0 else p["z1"] if dz > 0 else -p["z0"]) for p in ps)
    mid = sum((p["z0"] + p["z1"]) / 2 if dx else (p["x0"] + p["x1"]) / 2 for p in ps) / len(ps)
    mid = round(mid / 20) * 20
    letter, prefix = direction[0].upper(), ps[0]["code"].split("-")[0]
    meta, cells = _meta(zone), None
    for push in range(0, 6):                                        # slide outward until the block is clear of buildings, land and (Wakanda) the river
        cand = []
        for c in range(2):
            for r in range(3):
                a, lat = edge + 20 + push * 20 + c * 20, mid + (r - 1) * 20 - 8
                if dx:
                    x0 = a if dx > 0 else -a - 16; cand.append((x0, x0 + 16, lat, lat + 16))
                else:
                    z0 = a if dz > 0 else -a - 16; cand.append((lat, lat + 16, z0, z0 + 16))
        if all(max(abs(b[0]), abs(b[1]), abs(b[2]), abs(b[3])) < bound - 8
               and not any(_overlap(b, (p["x0"], p["x1"], p["z0"], p["z1"]), 4) for p in ps) and not any(_overlap(b, bx, 2) for bx in boxes)
               and _river_dist(meta, (b[0] + b[1]) / 2, (b[2] + b[3]) / 2) > 12 for b in cand):
            cells = cand
            break
    if not cells:
        raise ValueError("no clear land %s of the city (buildings, the river or the zone edge are in the way)" % direction)
    cost = LAND_PRICE * 6 * MINOR
    if finance.available(gov_id, "construction", ts) < cost:
        raise ValueError("construction budget insufficient")
    n0 = q1("SELECT COUNT(*) n FROM land_parcels WHERE zone_id=? AND code LIKE ?", (zone, "%s-%s%%" % (prefix, letter)))["n"]
    classes = ["residential", "mixed", "commercial", "residential", "civic", "industrial"]
    codes = []
    with tx() as c:
        finance.record_expense(gov_id, "construction", cost, "land:%d:%s:%d" % (gov_id, direction, ts), ts, "Land acquisition: 6 parcels %s" % direction)
        for i, b in enumerate(cells):
            code = "%s-%s%d" % (prefix, letter, n0 + i + 1)
            c.execute("INSERT INTO land_parcels(zone_id,code,x0,x1,z0,z1,classification,owner_government_id,land_value_minor) VALUES(?,?,?,?,?,?,?,?,?)",
                      (zone, code, b[0], b[1], b[2], b[3], classes[i], gov_id, LAND_PRICE * MINOR))
            codes.append(code)
    events.emit(zone, gov_id, "territory_expanded", "%s acquired %d new parcels to the %s" % (g["name"], len(codes), direction), ts, {"parcels": codes})
    return codes


def _meta(zone):
    return json.loads(q1("SELECT meta FROM world_zones WHERE id=?", (zone,))["meta"])


def road_nodes(gov_id):
    z = finance.gov(gov_id)["zone_id"]
    return [{"key": k, "x": round(v[0], 1), "z": round(v[1], 1)} for k, v in sorted(world.graph(z)["nodes"].items())]


def create_road(gov_id, from_node, direction, length, ts):
    """Propose a straight road from an existing waypoint. On completion the new end becomes a waypoint joined to `from_node`, so
    agents, citizens' traffic and your vehicles can drive on it. It goes through the normal budget -> approval -> contractor pipeline."""
    g = finance.gov(gov_id); zone = g["zone_id"]
    if direction not in DIRS:
        raise ValueError("direction must be north|south|east|west")
    if not isinstance(length, int) or not 20 <= length <= 200:
        raise ValueError("length must be 20..200 m")
    nodes = world.graph(zone)["nodes"]
    if from_node not in nodes:
        raise ValueError("unknown waypoint")
    ax, az = nodes[from_node]; dx, dz = DIRS[direction]; bx, bz = ax + dx * length, az + dz * length
    if max(abs(bx), abs(bz)) > _zone_bound(zone) - 8:
        raise ValueError("the road would leave the zone")
    hw = ROAD_W / 2
    rect = (min(ax, bx) - (0 if dx else hw), max(ax, bx) + (0 if dx else hw), min(az, bz) - (hw if dx else 0), max(az, bz) + (hw if dx else 0))
    if any(_overlap(rect, bx_, 1.5) for bx_ in world.graph(zone)["boxes"]):
        raise ValueError("the road would cross an existing building")
    inner = (rect[0], rect[1], rect[2] + 3, rect[3] - 3) if dx else (rect[0] + 3, rect[1] - 3, rect[2], rect[3])      # the 4 m lanes between parcels carry the road; its kerbs may overhang 3 m
    if any(_overlap(inner, (p["x0"], p["x1"], p["z0"], p["z1"])) for p in q("SELECT x0,x1,z0,z1 FROM land_parcels WHERE zone_id=? AND code NOT LIKE 'RD-%'", (zone,))):
        raise ValueError("the road would cross land parcels")
    meta = _meta(zone)
    if any(_river_dist(meta, ax + dx * t, az + dz * t) < 4 for t in range(0, length + 1, 4)):
        raise ValueError("the road would cross the river (a bridge is not supported yet)")
    n = q1("SELECT COUNT(*) n FROM land_parcels WHERE zone_id=? AND code LIKE 'RD-%'", (zone,))["n"] + 1
    node = "rd%d" % n
    while node in nodes:
        n += 1; node = "rd%d" % n
    cx, cz, w, d = (rect[0] + rect[1]) / 2, (rect[2] + rect[3]) / 2, rect[1] - rect[0], rect[3] - rect[2]
    cost = length * ROAD_COST_PER_M * MINOR
    bp = {"kind": "road", "x": cx, "z": cz, "w": w, "d": d, "h": .2, "floors": 1, "pad": list(rect), "a": [ax, az], "b": [bx, bz], "from": from_node, "node": node, "width": ROAD_W}
    with tx() as c:
        parcel = c.execute("INSERT INTO land_parcels(zone_id,code,x0,x1,z0,z1,classification,owner_government_id) VALUES(?,?,?,?,?,?,'civic',?)",
                           (zone, "RD-%d" % n, rect[0], rect[1], rect[2], rect[3], gov_id)).lastrowid
        pid = c.execute("INSERT INTO construction_projects(government_id,zone_id,parcel_id,kind,name,floors,w,d,h,complexity,estimated_cost_minor,proposed_by,rationale,blueprint,created_ts) "
                        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (gov_id, zone, parcel, "road", ("Road %s %s %d m" % (from_node, direction, length))[:60], 1, w, d, .2, .5, cost, "user", "Connected road extension", json.dumps(bp), ts)).lastrowid
    events.emit(zone, gov_id, "project_proposed", "%s proposed: road %s %d m %s" % (g["name"], from_node, length, direction), ts, {"project_id": pid})
    return pid


def _proj(pid):
    return q1("SELECT * FROM construction_projects WHERE id=?", (pid,))


def evaluate(pid, ts):
    """Finance Ministry: is there budget and cash? Then, per autonomy level, approve automatically or wait for the user."""
    pr = _proj(pid)
    if not pr or pr["status"] not in ("awaiting_budget", "awaiting_approval"):
        return pr["status"] if pr else None
    gid, cost = pr["government_id"], pr["estimated_cost_minor"]
    g = finance.gov(gid)
    if g["status"] != "active":
        return "paused"
    free_budget = finance.available(gid, "construction", ts)
    cash = finance.treasury(gid) - finance.policy(gid, "min_reserve_minor", 0)
    if free_budget < cost or cash < cost:
        why = "construction budget" if free_budget < cost else "treasury reserve"
        if pr["status"] != "awaiting_budget" or pr["blocked_reason"] != why:
            events.emit(g["zone_id"], gid, "budget_deferred", "Finance deferred '%s': not enough %s" % (pr["name"], why), ts, {"project_id": pid})
        run("UPDATE construction_projects SET status='awaiting_budget', blocked_reason=? WHERE id=?", (why, pid))
        return "awaiting_budget"
    mode = g["autonomy"]
    limit = finance.policy(gid, "auto_approve_limit_minor" if mode == "semi" else "autonomous_limit_minor", 0)
    if mode in ("semi", "auto") and cost <= limit and _active_count(gid) < finance.policy(gid, "max_active_projects", 1):
        approve(pid, "government_policy:" + mode, ts)      # routine project within limits and quota; manual mode never auto-approves
        return "approved"
    if pr["status"] != "awaiting_approval":
        run("UPDATE construction_projects SET status='awaiting_approval', blocked_reason=NULL WHERE id=?", (pid,))
        events.emit(g["zone_id"], gid, "approval_needed", "'%s' needs approval (%s autonomy)" % (pr["name"], mode), ts, {"project_id": pid})
    return "awaiting_approval"


def _active_count(gid):
    return q1("SELECT COUNT(*) n FROM construction_projects WHERE government_id=? AND status IN ('approved','active','blocked')", (gid,))["n"]


def approve(pid, by, ts):
    """Reserve the full budget in escrow BEFORE any work starts; create the payment milestones; reserve the parcel."""
    pr = _proj(pid)
    if not pr or pr["status"] not in ("awaiting_budget", "awaiting_approval"):
        raise ValueError("project cannot be approved in status %s" % (pr["status"] if pr else "?"))
    gid, cost = pr["government_id"], pr["estimated_cost_minor"]
    if finance.available(gid, "construction", ts) < cost:
        raise ValueError("construction budget insufficient")
    if finance.treasury(gid) - finance.policy(gid, "min_reserve_minor", 0) < cost:
        raise ValueError("treasury below required reserve")
    with tx() as c:
        ledger.post("reserve:%d" % pid, "escrow_reserve", [(finance.gacct(gid, "escrow"), "D", cost), (finance.gacct(gid, "treasury"), "C", cost)], ts, gid, "Reserve for project #%d" % pid)
        p = finance.period_for(gid, ts)
        c.execute("UPDATE government_budgets SET committed_minor=committed_minor+? WHERE period_id=? AND category='construction'", (cost, p["id"]))
        c.execute("UPDATE construction_projects SET status='approved', stage='Budget Approved', approved_by=?, reserved_minor=?, blocked_reason=NULL WHERE id=?", (by, cost, pid))
        c.execute("UPDATE land_parcels SET status='reserved', building_project_id=?, construction_cost_minor=? WHERE id=?", (pid, cost, pr["parcel_id"]))
        done = 0
        for st, pct in PAY_PCT.items():
            amt = cost * pct // 100 if st != "Inspection" else cost - done
            done += amt if st != "Inspection" else 0
            c.execute("INSERT OR IGNORE INTO construction_milestones(project_id,stage,at_progress,payment_minor) VALUES(?,?,?,?)", (pid, st, dict((s, e) for s, _, e in RANGES)[st], amt))
    g = finance.gov(gid)
    events.emit(g["zone_id"], gid, "project_approved", "'%s' approved (%s); budget reserved" % (pr["name"], by), ts, {"project_id": pid})


def reject(pid, by, ts, reason="rejected"):
    pr = _proj(pid)
    if not pr or pr["status"] not in ("awaiting_budget", "awaiting_approval"):
        raise ValueError("only a pending proposal can be rejected")
    run("UPDATE construction_projects SET status='rejected', approved_by=?, blocked_reason=?, stage='Proposed' WHERE id=?", (by, reason[:100], pid))
    g = finance.gov(pr["government_id"])
    events.emit(g["zone_id"], g["id"], "project_rejected", "'%s' rejected: %s" % (pr["name"], reason), ts, {"project_id": pid})


def assign_contractor(pid, ts):
    """Construction Department: pick the best permitted contractor with spare capacity and give it the parcel."""
    pr = _proj(pid)
    if not pr or pr["status"] != "approved" or pr["contractor_id"]:
        return False
    best = None
    for k in q("SELECT * FROM construction_contractors WHERE status='active' ORDER BY rating DESC, id"):
        if pr["zone_id"] not in json.loads(k["permit_zones"]):
            continue
        if q1("SELECT COUNT(*) n FROM construction_projects WHERE contractor_id=? AND status IN ('approved','active')", (k["id"],))["n"] >= k["capacity"]:
            continue
        best = k
        break
    if not best:
        return False
    with tx() as c:
        c.execute("INSERT INTO land_assignments(parcel_id,contractor_id,project_id,assigned_ts) VALUES(?,?,?,?)", (pr["parcel_id"], best["id"], pid, ts))
        c.execute("UPDATE construction_projects SET contractor_id=?, stage='Contractor Assigned' WHERE id=?", (best["id"], pid))
    events.emit(pr["zone_id"], pr["government_id"], "contractor_assigned", "%s assigned to '%s'" % (best["name"], pr["name"]), ts, {"project_id": pid})
    return True


def _may_build(pr, ts):
    """Hard rules, re-checked on every tick: contractor permit + active assignment on this very parcel, ownership, permission, bounds."""
    k = q1("SELECT * FROM construction_contractors WHERE id=?", (pr["contractor_id"],))
    p = _parcel(pr["parcel_id"])
    a = q1("SELECT 1 FROM land_assignments WHERE parcel_id=? AND contractor_id=? AND project_id=? AND released_ts IS NULL", (pr["parcel_id"], pr["contractor_id"], pr["id"]))
    z = q1("SELECT bound FROM world_zones WHERE id=?", (pr["zone_id"],))
    bp = json.loads(pr["blueprint"])
    if not k or not p or not a:
        return "no active land assignment"
    if pr["zone_id"] not in json.loads(k["permit_zones"]):
        return "contractor has no permit for this zone"
    if p["owner_government_id"] != pr["government_id"] or p["zone_id"] != pr["zone_id"] or p["permission"] != "approved":
        return "parcel not owned/approved"
    if not (p["x0"] <= bp["x"] - bp["w"] / 2 and bp["x"] + bp["w"] / 2 <= p["x1"] and p["z0"] <= bp["z"] - bp["d"] / 2 and bp["z"] + bp["d"] / 2 <= p["z1"]) or abs(bp["x"]) > z["bound"] or abs(bp["z"]) > z["bound"]:
        return "construction outside the approved parcel"
    return None


def stage_for(progress):
    for st, a, b in RANGES:
        if progress < b:
            return st
    return "Inspection"


def work(ts):
    """One simulated minute of work on every active project. Called by the engine for each processed minute."""
    for pr in q("SELECT * FROM construction_projects WHERE status IN ('approved','active','blocked') AND contractor_id IS NOT NULL"):
        why = _may_build(pr, ts)
        if why:
            if pr["status"] != "blocked":
                run("UPDATE construction_projects SET status='blocked', blocked_reason=? WHERE id=?", (why, pr["id"]))
                events.emit(pr["zone_id"], pr["government_id"], "project_blocked", "'%s' blocked: %s" % (pr["name"], why), ts, {"project_id": pr["id"]})
            continue
        if pr["status"] == "blocked":
            run("UPDATE construction_projects SET status='active', blocked_reason=NULL WHERE id=?", (pr["id"],))
        zc = clock.zone_row(pr["zone_id"])
        h = clock.local_hour(pr["zone_id"], ts)
        if not (zc["work_start_h"] <= h < zc["work_end_h"]):
            continue                                                   # no construction outside working hours
        k = q1("SELECT * FROM construction_contractors WHERE id=?", (pr["contractor_id"],))
        n_proj = max(1, q1("SELECT COUNT(*) n FROM construction_projects WHERE contractor_id=? AND status IN ('approved','active')", (k["id"],))["n"])
        crew = max(1, k["workers"] // n_proj)
        cash = ledger.balance(ledger.acct("contractor", k["id"], "cash"))
        materials = min(1.0, max(0.35, cash / max(1, pr["estimated_cost_minor"] // 4)))     # cash shortage slows the work
        total = pr["w"] * pr["d"] * pr["floors"] * pr["complexity"] * WORK_K
        prog = min(100.0, pr["progress"] + (crew * k["skill"] * materials / 60.0) / total * 100.0)
        if pr["status"] == "approved":
            run("UPDATE land_parcels SET status='under_construction' WHERE id=?", (pr["parcel_id"],))
            run("UPDATE construction_projects SET status='active', started_ts=? WHERE id=?", (ts, pr["id"]))
            events.emit(pr["zone_id"], pr["government_id"], "construction_started", "Construction of '%s' began" % pr["name"], ts, {"project_id": pr["id"]})
        _progress(pr, prog, ts)


def _progress(pr, prog, ts):
    pid = pr["id"]
    old_stage = pr["stage"]
    for st, a, b in RANGES:                                           # pay every milestone whose end progress has been reached
        if prog >= b and not q1("SELECT paid FROM construction_milestones WHERE project_id=? AND stage=?", (pid, st))["paid"]:
            if st == "Inspection":
                k = q1("SELECT rating FROM construction_contractors WHERE id=?", (pr["contractor_id"],))
                if k["rating"] < 0.5:                                 # failed inspection: rework
                    prog = 85.0
                    events.emit(pr["zone_id"], pr["government_id"], "inspection_failed", "'%s' failed inspection; rework required" % pr["name"], ts, {"project_id": pid})
                    break
            _pay(pr, st, ts)
    stage = "Completed" if prog >= 100 else stage_for(prog)
    run("UPDATE construction_projects SET progress=?, stage=? WHERE id=?", (prog, stage, pid))
    if stage != old_stage and stage != "Completed":
        events.emit(pr["zone_id"], pr["government_id"], "construction_stage", "'%s': %s" % (pr["name"], stage), ts, {"project_id": pid, "stage": stage})
    if prog >= 100:
        complete(pid, ts)


def _pay(pr, stage, ts):
    """Pay a milestone from the project escrow to the contractor (each side in its own books; FX if currencies differ)."""
    m = q1("SELECT * FROM construction_milestones WHERE project_id=? AND stage=?", (pr["id"], stage))
    if m["paid"]:
        return
    gid, amt = pr["government_id"], m["payment_minor"]
    k = q1("SELECT * FROM construction_contractors WHERE id=?", (pr["contractor_id"],))
    home = q1("SELECT id FROM governments WHERE zone_id=?", (k["home_zone"],))["id"]
    amt_k = finance.convert(amt, gid, home)
    with tx() as c:
        t = finance.record_expense(gid, "construction", amt, "ms:%d:%s:g" % (pr["id"], stage), ts, "%s - %s" % (pr["name"], stage), pr["id"], from_account="escrow")
        ledger.post("ms:%d:%s:c" % (pr["id"], stage), "contract_income", [(ledger.acct("contractor", k["id"], "cash"), "D", amt_k), (ledger.acct("contractor", k["id"], "revenue"), "C", amt_k)], ts, home, "%s - %s" % (pr["name"], stage))
        p = finance.period_for(gid, ts)
        c.execute("UPDATE government_budgets SET committed_minor=MAX(0,committed_minor-?) WHERE period_id=? AND category='construction'", (amt, p["id"]))
        c.execute("UPDATE construction_milestones SET paid=1, completed_ts=?, transaction_id=? WHERE id=?", (ts, t, m["id"]))
        c.execute("UPDATE construction_projects SET paid_minor=paid_minor+? WHERE id=?", (amt, pr["id"]))


def complete(pid, ts):
    pr = _proj(pid)
    if pr["status"] == "completed":
        return
    p = _parcel(pr["parcel_id"])
    bp = json.loads(pr["blueprint"])
    with tx() as c:
        for st in PAY_PCT:                                            # settle anything unpaid (rounding) before closing
            if not q1("SELECT paid FROM construction_milestones WHERE project_id=? AND stage=?", (pid, st))["paid"]:
                _pay(_proj(pid), st, ts)
        left = ledger.balance(finance.gacct(pr["government_id"], "escrow"))
        c.execute("UPDATE land_assignments SET released_ts=? WHERE project_id=? AND released_ts IS NULL", (ts, pid))
        if pr["kind"] == "road":
            obj = zone_manager.add_road(pr["zone_id"], bp, pr["name"], pid)
        else:
            obj = zone_manager.add_objects(pr["zone_id"], [{"kind": "civic_" + pr["kind"], "x": bp["x"], "z": bp["z"], "rot": 0, "district": None,
                                                        "data": {"w": bp["w"], "d": bp["d"], "h": bp["h"], "floors": bp["floors"], "name": pr["name"], "project_id": pid, "box": [bp["w"], bp["d"]]}}], "construction")[0]
        c.execute("UPDATE construction_projects SET status='completed', stage='Completed', progress=100, completed_ts=?, object_id=? WHERE id=?", (ts, obj, pid))
        c.execute("UPDATE land_parcels SET status='developed', current_building=?, land_value_minor=land_value_minor+?, construction_cost_minor=? WHERE id=?",
                  (pr["kind"], pr["estimated_cost_minor"] // 5, pr["estimated_cost_minor"], pr["parcel_id"]))
    events.emit(pr["zone_id"], pr["government_id"], "building_completed", "'%s' completed and operational" % pr["name"], ts, {"project_id": pid, "object_id": obj})


def cancel(pid, by, ts, reason="cancelled by administrator"):
    """Release the unspent escrow back to the treasury and the parcel back to the pool. Already-paid milestones stay paid."""
    pr = _proj(pid)
    if not pr or pr["status"] in ("completed", "cancelled", "rejected"):
        raise ValueError("project cannot be cancelled")
    gid = pr["government_id"]
    with tx() as c:
        unspent = pr["reserved_minor"] - pr["paid_minor"]
        if unspent > 0:
            ledger.post("release:%d" % pid, "escrow_release", [(finance.gacct(gid, "treasury"), "D", unspent), (finance.gacct(gid, "escrow"), "C", unspent)], ts, gid, "Release escrow of cancelled project #%d" % pid)
            p = finance.period_for(gid, ts)
            c.execute("UPDATE government_budgets SET committed_minor=MAX(0,committed_minor-?) WHERE period_id=? AND category='construction'", (unspent, p["id"]))
        c.execute("UPDATE land_assignments SET released_ts=? WHERE project_id=? AND released_ts IS NULL", (ts, pid))
        c.execute("UPDATE construction_projects SET status='cancelled', blocked_reason=?, approved_by=COALESCE(approved_by,?) WHERE id=?", (reason[:100], by, pid))
        c.execute("UPDATE land_parcels SET status='vacant', building_project_id=NULL, construction_cost_minor=0 WHERE id=?", (pr["parcel_id"],))
    g = finance.gov(gid)
    events.emit(g["zone_id"], gid, "project_cancelled", "'%s' cancelled; %d reserved funds released" % (pr["name"], max(0, pr["reserved_minor"] - pr["paid_minor"]) // MINOR), ts, {"project_id": pid})


def project_view(pr):
    d = dict(pr)
    d["blueprint"] = json.loads(pr["blueprint"])
    d["milestones"] = q("SELECT stage, payment_minor, paid FROM construction_milestones WHERE project_id=? ORDER BY id", (pr["id"],))
    k = q1("SELECT name FROM construction_contractors WHERE id=?", (pr["contractor_id"],)) if pr["contractor_id"] else None
    d["contractor"] = k["name"] if k else None
    d["parcel"] = q1("SELECT code,x0,x1,z0,z1 FROM land_parcels WHERE id=?", (pr["parcel_id"],))
    return d
