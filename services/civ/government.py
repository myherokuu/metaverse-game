"""Government read-models (dashboards) and the per-government daily cycle."""
import json

from database.db import q, q1, run
from services import agent_behavior as beh
from services.civ import citizens, clock, construction as cn, finance, ledger, planner


def list_governments():
    out = []
    for g in q("SELECT * FROM governments ORDER BY id"):
        out.append({"id": g["id"], "zone_id": g["zone_id"], "name": g["name"], "type": g["gov_type"], "leader_title": g["leader_title"], "economy": g["economy"],
                    "currency": g["currency_code"], "currency_name": g["currency_name"], "autonomy": g["autonomy"], "status": g["status"]})
    return out


def dashboard(gid, ts=None):
    g = finance.gov(gid)
    if not g:
        return None
    ts = ts if ts is not None else clock.glob()["sim_ts"]
    pop = q1("SELECT COUNT(*) n FROM citizens WHERE government_id=?", (gid,))["n"]
    employed = q1("SELECT COUNT(*) n FROM citizens WHERE government_id=? AND salary_minor>0", (gid,))["n"]
    fin = finance.summary(gid, ts)
    depts = []
    for d in q("SELECT * FROM government_departments WHERE government_id=? ORDER BY id", (gid,)):
        head = q1("SELECT a.id,a.name,a.role,a.activity FROM agents a WHERE a.id=?", (d["head_agent_id"],))
        subs = q("SELECT name,role FROM government_agents WHERE department_id=? AND agent_id IS NULL", (d["id"],))
        depts.append({"key": d["key"], "name": d["name"], "head": head, "sub_agents": subs})
    live = [cn.project_view(p) for p in q("SELECT * FROM construction_projects WHERE government_id=? AND status IN ('awaiting_budget','awaiting_approval','approved','active','blocked') ORDER BY id", (gid,))]
    cap = citizens.housing_capacity(gid)
    return {"government": {k: g[k] for k in ("id", "zone_id", "name", "gov_type", "leader_title", "economy", "currency_code", "currency_name", "autonomy", "status")},
            "leader": q1("SELECT id,name FROM agents WHERE id=?", (g["leader_agent_id"],)), "population": pop, "employed": employed,
            "employment_rate": round(employed / pop, 3) if pop else 0, "housing_capacity": cap, "jobs_capacity": citizens.jobs_capacity(gid),
            "buildings_completed": q1("SELECT COUNT(*) n FROM construction_projects WHERE government_id=? AND status='completed'", (gid,))["n"],
            "finance": fin, "departments": depts, "initiatives": live, "needs": [{"kind": k, "reason": r} for k, r in planner.needs(gid)],
            "policies": {p["key"]: json.loads(p["value"]) for p in q("SELECT key,value FROM government_policies WHERE government_id=?", (gid,))},
            "clock": next((z for z in clock.snapshot()["zones"] if z["zone_id"] == g["zone_id"]), None),
            "parcels": q("SELECT code,x0,x1,z0,z1,classification,permission,status,current_building,land_value_minor FROM land_parcels WHERE zone_id=? ORDER BY id", (g["zone_id"],)),
            "contractors": q("SELECT name,workers,skill,capacity,rating,is_private FROM construction_contractors WHERE permit_zones LIKE ? ORDER BY id", ('%"' + g["zone_id"] + '"%',))}


def agent_context(agent_id):
    """One paragraph appended to a government agent's prompt so it answers from real, current numbers."""
    r = q1("SELECT g.* FROM government_agents ga JOIN governments g ON g.id=ga.government_id WHERE ga.agent_id=?", (agent_id,))
    if not r:
        return ""
    ts = clock.glob()["sim_ts"]
    f = finance.summary(r["id"], ts)
    live = q("SELECT name,stage,progress,status FROM construction_projects WHERE government_id=? AND status IN ('awaiting_approval','awaiting_budget','approved','active','blocked')", (r["id"],))
    pop = q1("SELECT COUNT(*) n FROM citizens WHERE government_id=?", (r["id"],))["n"]
    return ("Government facts (simulated, authoritative - quote them, never invent numbers): %s; local time %s; treasury %s %s; this month revenue %s, expenses %s; "
            "population %d; autonomy mode %s; current projects: %s." % (r["name"], clock.fmt(clock.local_ts(r["zone_id"], ts)), r["currency_code"], f["treasury_minor"] // 100,
                                                                         f["revenue_minor"] // 100, f["expenses_minor"] // 100, pop, r["autonomy"],
                                                                         "; ".join("%s [%s %.0f%%, %s]" % (p["name"], p["stage"], p["progress"], p["status"]) for p in live) or "none"))


def daily_operations(zone_id, ts):
    """Operating spending against the budgets (research, public services, security, maintenance) and daily non-tax income."""
    g = q1("SELECT * FROM governments WHERE zone_id=?", (zone_id,))
    if not g or g["status"] != "active":
        return
    gid, day = g["id"], ts // clock.DAY
    for src in ("resources", "enterprise"):
        finance.record_revenue(gid, src, finance.policy(gid, {"resources": "resource_daily_minor", "enterprise": "enterprise_daily_minor"}[src], 0), "inc:%s:%d:%d" % (src, gid, day), ts)
    for cat in ("research", "public_services", "security"):
        b = finance.budget(gid, cat, ts)
        amt = int(b["allocated_minor"] / 30 * 0.35)
        if amt > 0 and finance.treasury(gid) - amt >= 0:
            try:
                finance.record_expense(gid, cat, amt, "ops:%s:%d:%d" % (cat, gid, day), ts)
            except ledger.LedgerError:
                pass
    n = q1("SELECT COUNT(*) n FROM construction_projects WHERE government_id=? AND status='completed'", (gid,))["n"]
    if n and finance.treasury(gid) > 0:
        try:
            finance.record_expense(gid, "maintenance", n * 40_000, "ops:maint:%d:%d" % (gid, day), ts, "Maintenance of %d new buildings" % n, budget_cat="public_services")
        except ledger.LedgerError:
            pass


def contractor_wages(zone_id, ts):
    day = ts // clock.DAY
    for k in q("SELECT * FROM construction_contractors WHERE home_zone=?", (zone_id,)):
        crew = q1("SELECT COUNT(*) n FROM construction_projects WHERE contractor_id=? AND status='active'", (k["id"],))["n"]
        amt = (k["workers"] if crew else k["workers"] // 4) * 15_000          # 150 credits per worker per day (idle crew costs a quarter)
        try:
            ledger.post("cw:%d:%d" % (k["id"], day), "contractor_wages", [(ledger.acct("contractor", k["id"], "expense"), "D", amt), (ledger.acct("contractor", k["id"], "cash"), "C", amt)], ts, None, "Crew wages & materials")
        except ledger.LedgerError:
            pass
