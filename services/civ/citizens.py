"""Citizens: lightweight deterministic daily routines (NO LLM), positions derived from local time, and the daily household economy."""
import json
import math

from database.db import q, q1, run, tx
from services import world_manager as world
from services.civ import clock, events, finance, ledger, seed
from services.civ.ledger import LedgerError

_SCHED = {}
_paths = {}


def _schedule():
    if not _SCHED:
        for r in q("SELECT profile,start_h,end_h,activity FROM citizen_schedules ORDER BY profile,start_h"):
            _SCHED.setdefault(r["profile"], []).append((r["start_h"], r["end_h"], r["activity"]))
    return _SCHED


def activity_at(profile, hour):
    for a, b, act in _schedule().get(profile, _schedule()["standard"]):
        if a <= hour < b:
            return act, a, b
    return "sleeping", 0, 24


def _poly(zone, a, b):
    k = (zone, a, b)
    if k not in _paths:
        _paths[k] = [world.node_pos(zone, n) for n in world.find_path(zone, a, b)]
    return _paths[k]


def _along(pts, t):
    t = min(1.0, max(0.0, t))
    seg = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    tot = sum(seg)
    if tot == 0:
        return pts[0]
    d, i = t * tot, 0
    while i < len(seg) - 1 and d > seg[i]:
        d -= seg[i]; i += 1
    f = d / seg[i] if seg[i] else 0
    return (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f)


def where(c, h):
    """(activity, x, z) of a citizen at local hour h, following the schedule and walking along the zone's road graph."""
    z, act = c["zone_id"], None
    act, a, b = activity_at(c["profile"], h)
    t = (h - a) / (b - a) if b > a else 0
    home, work, soc = c["home_node"], c["work_node"], c["social_node"]
    evening_out = c["id"] % 2 == 0                        # half the citizens spend leisure time at the social hub
    if act == "sleeping":
        pos = world.node_pos(z, home)
    elif act == "working":
        pos = world.node_pos(z, work)
    elif act == "commuting":
        pos = _along(_poly(z, home, work), t)
    elif act == "commuting_home":
        pos = _along(_poly(z, work, home), t)
    elif act == "resting":                                # lunch at the social hub: walk there, stay, walk back
        pos = _along(_poly(z, work, soc), t / .2) if t < .2 else _along(_poly(z, soc, work), (t - .8) / .2) if t > .8 else world.node_pos(z, soc)
    else:                                                 # leisure
        if evening_out:
            pos = _along(_poly(z, home, soc), t / .25) if t < .25 else _along(_poly(z, soc, home), (t - .75) / .25) if t > .75 else world.node_pos(z, soc)
        else:
            pos = world.node_pos(z, home)
    return act, pos[0] + c["jitter_x"], pos[1] + c["jitter_z"]


def positions(zone_id, ts=None):
    h = clock.local_hour(zone_id, ts)
    out = []
    for c in q("SELECT * FROM citizens WHERE zone_id=?", (zone_id,)):
        act, x, z = where(c, h)
        outdoors = act in ("commuting", "commuting_home", "resting") or (act == "leisure" and c["id"] % 2 == 0)     # sleeping/working = inside buildings
        out.append({"id": c["id"], "name": c["name"], "occupation": c["occupation"], "activity": act, "x": round(x, 2), "z": round(z, 2), "color": c["color"], "visible": outdoors})
    return out


def update_activities(zone_id, ts):
    h = clock.local_hour(zone_id, ts)
    for c in q("SELECT id,profile,activity FROM citizens WHERE zone_id=?", (zone_id,)):
        act = activity_at(c["profile"], h)[0]
        if act != c["activity"]:
            run("UPDATE citizens SET activity=? WHERE id=?", (act, c["id"]))


def _acct(kind, oid, code):
    return ledger.acct(kind, oid, code)


def daily_economy(zone_id, ts):
    """Wages, income tax, spending and sales/business tax for one local day. Every journal ref contains the day, so a re-run is a no-op."""
    g = q1("SELECT * FROM governments WHERE zone_id=?", (zone_id,))
    if not g or g["status"] != "active":
        return
    gid, day = g["id"], ts // clock.DAY
    it, st, bt = (finance.policy(gid, k, 0) for k in ("income_tax_rate", "sales_tax_rate", "business_tax_rate"))
    shops = q("SELECT * FROM businesses WHERE government_id=? AND kind IN ('retail','food','crafts') ORDER BY id", (gid,))
    unpaid = 0
    for c in q("SELECT * FROM citizens WHERE government_id=? ORDER BY id", (gid,)):
        if c["salary_minor"] <= 0:
            continue
        gross = c["salary_minor"]; tax = int(gross * it); net = gross - tax
        ref = "pay:%d:%d" % (c["id"], day)
        try:
            with tx():
                if c["employer_kind"] == "government":
                    t = ledger.post(ref + ":g", "payroll", [(finance.gacct(gid, "exp_wages"), "D", gross), (finance.gacct(gid, "treasury"), "C", net), (finance.gacct(gid, "rev_income_tax"), "C", tax)], ts, gid, "Wages")
                    _rows(gid, ts, t, [("exp", "wages", gross), ("rev", "income_tax", tax)])
                else:
                    ledger.post(ref + ":b", "payroll", [(_acct("business", c["business_id"], "expense"), "D", gross), (_acct("business", c["business_id"], "cash"), "C", gross)], ts, gid, "Wages")
                    finance.record_revenue(gid, "income_tax", tax, ref + ":t", ts, "Income tax withheld")
                ledger.post(ref + ":c", "salary", [(c["account_id"], "D", net), (_acct("citizen", c["id"], "income"), "C", net)], ts, gid, "Salary")
        except LedgerError:
            unpaid += 1
            continue
        if shops:                                         # household spending at a local shop (price includes sales tax)
            spend = int(net * 0.55); sales_tax = int(spend * st); shop = shops[c["id"] % len(shops)]
            biz_tax = int((spend - sales_tax) * bt); to_shop = spend - sales_tax - biz_tax
            try:
                with tx():
                    ledger.post(ref + ":s", "spending", [(_acct("citizen", c["id"], "expense"), "D", spend), (c["account_id"], "C", spend)], ts, gid, "Household spending")
                    ledger.post(ref + ":sh", "sale", [(_acct("business", shop["id"], "cash"), "D", to_shop), (_acct("business", shop["id"], "revenue"), "C", to_shop)], ts, gid, "Sales")
                    finance.record_revenue(gid, "sales_tax", sales_tax, ref + ":st", ts, "Sales tax")
                    finance.record_revenue(gid, "business_tax", biz_tax, ref + ":bt", ts, "Business tax")
            except LedgerError:
                pass
    # customers from outside the simulated households (visitors, exports): each business earns ~135% of its payroll
    for b in q("SELECT * FROM businesses WHERE government_id=?", (gid,)):
        payroll = q1("SELECT COALESCE(SUM(salary_minor),0) s FROM citizens WHERE business_id=?", (b["id"],))["s"]
        sales = int(payroll * 1.35)
        if sales > 0:
            biz_tax = int(sales * bt)
            try:
                with tx():
                    ledger.post("ext:%d:%d" % (b["id"], day), "sale", [(_acct("business", b["id"], "cash"), "D", sales - biz_tax), (_acct("business", b["id"], "revenue"), "C", sales - biz_tax)], ts, gid, "Sales to outside customers")
                    finance.record_revenue(gid, "business_tax", biz_tax, "ext:%d:%d:t" % (b["id"], day), ts, "Business tax")
            except LedgerError:
                pass
    if unpaid:
        events.emit(zone_id, gid, "wages_unpaid", "%d wage payments could not be made (insufficient employer funds)" % unpaid, ts)


def _rows(gid, ts, txn, items):
    p = finance.period_for(gid, ts)
    for kind, cat, amt in items:
        if amt <= 0:
            continue
        if kind == "exp":
            if not q1("SELECT 1 FROM government_expenses WHERE transaction_id=?", (txn,)):
                run("INSERT INTO government_expenses(government_id,period_id,category,amount_minor,transaction_id,sim_ts) VALUES(?,?,?,?,?,?)", (gid, p["id"], cat, amt, txn, ts))
        elif not q1("SELECT 1 FROM government_revenues WHERE transaction_id=?", (txn,)):
            run("INSERT INTO government_revenues(government_id,period_id,source,amount_minor,transaction_id,sim_ts) VALUES(?,?,?,?,?,?)", (gid, p["id"], cat, amt, txn, ts))


def housing_capacity(gid):
    from services.civ import construction as cn
    base = finance.policy(gid, "housing_base", 0)
    done = q("SELECT kind FROM construction_projects WHERE government_id=? AND status='completed'", (gid,))
    return base + sum(cn.KINDS[d["kind"]]["effect"].get("housing", 0) for d in done)


def jobs_capacity(gid):
    from services.civ import construction as cn
    done = q("SELECT kind FROM construction_projects WHERE government_id=? AND status='completed'", (gid,))
    return q1("SELECT COUNT(*) n FROM citizens WHERE government_id=? AND salary_minor>0 AND occupation NOT IN ('Office worker','Technician')", (gid,))["n"] + \
        sum(cn.KINDS[d["kind"]]["effect"].get("jobs", 0) for d in done) // 3     # one simulated citizen stands for several jobs


def monthly_growth(zone_id, ts):
    """Population grows while housing is available; new citizens look for work and take jobs created by new buildings."""
    g = q1("SELECT * FROM governments WHERE zone_id=?", (zone_id,))
    gid, rate = g["id"], finance.policy(g["id"], "growth_per_month", 0.05)
    pop = q1("SELECT COUNT(*) n FROM citizens WHERE government_id=?", (gid,))["n"]
    room = housing_capacity(gid) - pop
    add = min(room, max(1, int(pop * rate))) if room > 0 else 0
    spec = next(s for s in seed.GOVS if s["zone"] == zone_id)
    import random
    rnd = random.Random("%s:%d" % (zone_id, ts // clock.DAY))
    first, last = seed.NAMES[zone_id]
    for i in range(add):
        seed.add_citizen(gid, zone_id, spec, rnd, "%s %s" % (rnd.choice(first), rnd.choice(last)), "Job seeker", "government", spec["social"], 0, "standard", {}, ts, pop + i)
    # employ job seekers while there are free jobs
    free = jobs_capacity(gid) - q1("SELECT COUNT(*) n FROM citizens WHERE government_id=? AND salary_minor>0", (gid,))["n"]
    for c in q("SELECT id FROM citizens WHERE government_id=? AND salary_minor=0 ORDER BY id LIMIT ?", (gid, max(0, free))):
        run("UPDATE citizens SET occupation='Office worker', salary_minor=?, work_node=? WHERE id=?", (int(1800 * seed.WAGE_SCALE * ledger.MINOR), {"aether_city": "hq", "wakanda": "cap", "pandora": "ht_n", "mars": "cc_n"}[zone_id], c["id"]))
    if add:
        events.emit(zone_id, gid, "population_growth", "%d new citizens moved in (population %d)" % (add, pop + add), ts)
    return add
