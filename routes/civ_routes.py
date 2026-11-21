import json

from flask import Blueprint, request

from database.db import q, q1, run
from routes.common import admin_required, json_body, ok
from services import zone_manager
from services.civ import mars_life, citizens, clock, construction as cn, engine, finance, government, ledger, trade
from services.errors import ApiError

bp = Blueprint("civ", __name__, url_prefix="/api/civilization")


def _gov(gid):
    g = finance.gov(gid)
    if not g:
        raise ApiError("Unknown government", 404, "not_found")
    return g


def _val(fn, *a, **k):
    try:
        return fn(*a, **k)
    except (ValueError, ledger.LedgerError) as e:
        raise ApiError(str(e), 409, "rejected")


@bp.get("/mars/status")
def mars_status():
    st = mars_life.status("mars")
    if not st:
        raise ApiError("Mars Colony is not installed", 404, "not_found")
    return ok(st)


@bp.get("/clock")
def get_clock():
    return ok(clock.snapshot())


@bp.post("/clock")
@admin_required
def set_clock():
    d = json_body()
    try:
        clock.set_speed(d.get("speed"), d.get("running"))
        if isinstance(d.get("zone"), dict):
            z = d["zone"]
            clock.set_zone(z.get("id"), **{k: z.get(k) for k in ("tz_offset_min", "sunrise_h", "sunset_h", "work_start_h", "work_end_h", "biz_open_h", "biz_close_h")})
    except (ValueError, TypeError) as e:
        raise ApiError(str(e), 422, "validation")
    return ok(clock.snapshot())


@bp.post("/sim/step")
@admin_required
def sim_step():
    try:
        return ok({"minutes_processed": engine.step(json_body().get("minutes", 60)), "clock": clock.snapshot()})
    except (ValueError, TypeError) as e:
        raise ApiError(str(e), 422, "validation")


@bp.get("/governments")
def governments():
    return ok(government.list_governments())


@bp.get("/governments/<int:gid>")
def gov_dash(gid):
    _gov(gid)
    return ok(government.dashboard(gid))


@bp.post("/governments/<int:gid>/autonomy")
@admin_required
def gov_autonomy(gid):
    _gov(gid)
    m = json_body().get("mode")
    if m not in ("manual", "semi", "auto"):
        raise ApiError("mode must be manual|semi|auto", 422, "validation")
    run("UPDATE governments SET autonomy=? WHERE id=?", (m, gid))
    return ok({"autonomy": m})


@bp.post("/governments/<int:gid>/grant")
@admin_required
def gov_grant(gid):
    _gov(gid)
    amount = json_body().get("amount")
    if not isinstance(amount, int) or isinstance(amount, bool):
        raise ApiError("amount must be a whole number of credits", 422, "validation")
    t = _val(finance.grant, gid, amount, clock.glob()["sim_ts"])
    return ok({"transaction_id": t, "treasury_minor": finance.treasury(gid)})


@bp.post("/governments/<int:gid>/status")
@admin_required
def gov_status(gid):
    _gov(gid)
    s = json_body().get("status")
    if s not in ("active", "paused"):
        raise ApiError("status must be active|paused", 422, "validation")
    run("UPDATE governments SET status=? WHERE id=?", (s, gid))
    return ok({"status": s})


@bp.get("/governments/<int:gid>/finance")
def gov_finance(gid):
    _gov(gid)
    s = finance.summary(gid, clock.glob()["sim_ts"])
    s["accounts"] = q("SELECT code,name,type,balance_minor FROM government_accounts WHERE owner_type='government' AND owner_id=? ORDER BY type,code", (gid,))
    return ok(s)


@bp.get("/governments/<int:gid>/transactions")
def gov_txns(gid):
    _gov(gid)
    rows = q("SELECT * FROM government_transactions WHERE government_id=? ORDER BY id DESC LIMIT ?", (gid, min(int(request.args.get("limit", 40)), 200)))
    for r in rows:
        r["lines"] = q("SELECT a.name, e.debit_minor, e.credit_minor FROM ledger_entries e JOIN government_accounts a ON a.id=e.account_id WHERE e.transaction_id=?", (r["id"],))
        r["local_time"] = clock.fmt(r["sim_ts"])
    return ok(rows)


@bp.post("/transactions/<int:tid>/reverse")
@admin_required
def txn_reverse(tid):
    return ok({"reversal_id": _val(ledger.reverse, tid, clock.glob()["sim_ts"], str(json_body().get("reason", "admin reversal"))[:100])})


@bp.get("/governments/<int:gid>/projects")
def gov_projects(gid):
    _gov(gid)
    return ok([cn.project_view(p) for p in q("SELECT * FROM construction_projects WHERE government_id=? ORDER BY id DESC LIMIT 50", (gid,))])


@bp.post("/governments/<int:gid>/propose")
@admin_required
def propose(gid):
    _gov(gid)
    d = json_body()
    parcel = q1("SELECT id FROM land_parcels WHERE code=? AND owner_government_id=?", (d.get("parcel"), gid))
    if not parcel:
        raise ApiError("Unknown parcel for this government", 422, "validation")
    ts = clock.glob()["sim_ts"]
    pid = _val(cn.create_project, gid, d.get("kind"), parcel["id"], ts, "user", None, "Proposed by an administrator")
    return ok({"project_id": pid, "status": cn.evaluate(pid, ts)}, 201)


def _project(pid):
    p = q1("SELECT * FROM construction_projects WHERE id=?", (pid,))
    if not p:
        raise ApiError("Unknown project", 404, "not_found")
    return p


@bp.post("/governments/<int:gid>/expand")
@admin_required
def gov_expand(gid):
    _gov(gid)
    return ok({"parcels": _val(cn.expand_territory, gid, json_body().get("direction"), clock.glob()["sim_ts"])}, 201)


@bp.get("/governments/<int:gid>/road_options")
def road_options(gid):
    _gov(gid)
    return ok({"nodes": cn.road_nodes(gid), "cost_per_m": cn.ROAD_COST_PER_M, "land_price": cn.LAND_PRICE * 6})


@bp.post("/governments/<int:gid>/road")
@admin_required
def gov_road(gid):
    _gov(gid)
    d = json_body()
    ts = clock.glob()["sim_ts"]
    pid = _val(cn.create_road, gid, d.get("from"), d.get("direction"), d.get("length"), ts)
    return ok({"project_id": pid, "status": cn.evaluate(pid, ts)}, 201)


@bp.post("/projects/<int:pid>/approve")
@admin_required
def p_approve(pid):
    _project(pid); ts = clock.glob()["sim_ts"]
    _val(cn.approve, pid, "user", ts); cn.assign_contractor(pid, ts)
    return ok(cn.project_view(_project(pid)))


@bp.post("/projects/<int:pid>/reject")
@admin_required
def p_reject(pid):
    _project(pid)
    _val(cn.reject, pid, "user", clock.glob()["sim_ts"], str(json_body().get("reason", "rejected by administrator")))
    return ok({"status": "rejected"})


@bp.post("/projects/<int:pid>/cancel")
@admin_required
def p_cancel(pid):
    _project(pid)
    _val(cn.cancel, pid, "user", clock.glob()["sim_ts"])
    return ok({"status": "cancelled"})


@bp.get("/zones/<zid>/parcels")
def parcels(zid):
    return ok(q("SELECT id,code,x0,x1,z0,z1,classification,permission,status,current_building,building_project_id,land_value_minor FROM land_parcels WHERE zone_id=? ORDER BY id", (zid,)))


@bp.get("/zones/<zid>/sites")
def sites(zid):
    """Construction sites to draw in 3D (stage + progress)."""
    out = []
    for p in q("SELECT * FROM construction_projects WHERE zone_id=? AND status IN ('approved','active','blocked')", (zid,)):
        bp_ = json.loads(p["blueprint"])
        out.append({"project_id": p["id"], "name": p["name"], "kind": p["kind"], "stage": p["stage"], "progress": round(p["progress"], 1), "status": p["status"],
                    "x": bp_["x"], "z": bp_["z"], "w": bp_["w"], "d": bp_["d"], "h": bp_["h"], "floors": bp_["floors"], "pad": bp_["pad"]})
    return ok(out)


@bp.get("/zones/<zid>/citizens")
def zone_citizens(zid):
    return ok(citizens.positions(zid))


@bp.get("/zones/<zid>/civilization")
def zone_civ(zid):
    g = q1("SELECT id FROM governments WHERE zone_id=?", (zid,))
    if not g:
        raise ApiError("No government in this zone", 404, "not_found")
    acts = {r["activity"]: r["n"] for r in q("SELECT activity, COUNT(*) n FROM citizens WHERE zone_id=? GROUP BY activity", (zid,))}
    d = government.dashboard(g["id"])
    return ok({"clock": d["clock"], "population": d["population"], "employment_rate": d["employment_rate"], "housing_capacity": d["housing_capacity"], "activities": acts,
               "public_services": {"clinics": q1("SELECT COUNT(*) n FROM construction_projects WHERE government_id=? AND kind='clinic' AND status='completed'", (g["id"],))["n"],
                                   "research_labs": q1("SELECT COUNT(*) n FROM construction_projects WHERE government_id=? AND kind='research_lab' AND status='completed'", (g["id"],))["n"]},
               "agents": q("SELECT a.name,a.role,a.activity FROM agents a JOIN government_agents ga ON ga.agent_id=a.id WHERE ga.government_id=?", (g["id"],)),
               "events": q("SELECT id,kind,message,sim_ts FROM civilization_events WHERE government_id=? ORDER BY id DESC LIMIT 25", (g["id"],))})


@bp.get("/contractors")
def contractors():
    return ok(q("SELECT id,name,workers,skill,capacity,rating,is_private,home_zone,permit_zones FROM construction_contractors ORDER BY id"))


@bp.get("/trade")
def trades():
    ag = q("SELECT a.*, s.name seller, b.name buyer FROM trade_agreements a JOIN governments s ON s.id=a.seller_government_id JOIN governments b ON b.id=a.buyer_government_id ORDER BY a.id")
    return ok({"agreements": ag, "deliveries": q("SELECT * FROM intergovernmental_trades ORDER BY id DESC LIMIT 30")})


@bp.get("/events")
def events():
    zone, after = request.args.get("zone"), int(request.args.get("after", 0))
    rows = q("SELECT id,zone_id,government_id,kind,message,sim_ts FROM civilization_events WHERE id>? " + ("AND zone_id=? " if zone else "") + "ORDER BY id DESC LIMIT 50", (after, zone) if zone else (after,))
    return ok(rows)
