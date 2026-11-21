"""Mars life support: deterministic oxygen / water / energy / food levels derived from the live colony state (population vs. the capacity
that finished buildings add), plus dust storms by sol. No LLM and no hidden state, so it is cheap and every number can be audited.
Levels are game values, not engineering readings: at the starting population they equal the design brief's demo (84 / 72 / 91 / 67 %)."""
from database.db import q, q1
from services.civ import clock

START = {"oxygen": 84, "water": 72, "energy": 91, "food": 67}
POP0 = 41                                     # citizens at world creation
HEADROOM = 1.25                               # supply needed per citizen for a 100 % level
SOL = 88775                                   # seconds in a sol
# capacity added (in 'citizens served') by each finished building kind
EFFECT = {"workshop": {"oxygen": 6, "water": 2, "energy": 6, "food": 3}, "research_lab": {"oxygen": 2, "water": 5, "energy": 3, "food": 2},
          "clinic": {"oxygen": 3}, "office": {"food": 4, "energy": 1}}
PROTOCOL = ["Alert the Colonial Governor", "Inspect generators and storage", "Dispatch maintenance robots to the fault", "Prioritise hospital and habitat modules",
            "Postpone resource-heavy industry", "Restore operations when stable"]


def storm(sim_ts):
    return (sim_ts // SOL) % 9 in (4, 5)


def status(zone_id="mars"):
    g = q1("SELECT id FROM governments WHERE zone_id=?", (zone_id,))
    if not g:
        return None
    ts = clock.glob()["sim_ts"]
    pop = q1("SELECT COUNT(*) n FROM citizens WHERE government_id=?", (g["id"],))["n"]
    done = {r["kind"]: r["n"] for r in q("SELECT kind, COUNT(*) n FROM construction_projects WHERE government_id=? AND status='completed' GROUP BY kind", (g["id"],))}
    dust = storm(ts)
    levels = {}
    for res, start in START.items():
        supply = POP0 * HEADROOM * start / 100 + sum(EFFECT.get(k, {}).get(res, 0) * n for k, n in done.items())
        if res == "energy" and dust:
            supply *= .7                                              # dust storm cuts solar output
        levels[res] = round(max(0, min(100, 100 * supply / (max(1, pop) * HEADROOM))))
    worst = min(levels, key=levels.get)
    state = "critical" if levels[worst] < 30 else "warning" if levels[worst] < 50 else "operational"
    alerts = ["Dust storm: solar output reduced 30%"] if dust else []
    if state != "operational":
        alerts.append("%s at %d%%" % (worst.capitalize(), levels[worst]))
    return {"sol": ts // SOL + 1, "population": pop, "robots": q1("SELECT COUNT(*) n FROM agents WHERE zone=? AND role LIKE '%Robot%'", (zone_id,))["n"],
            "buildings": sum(done.values()), "active_projects": q1("SELECT COUNT(*) n FROM construction_projects WHERE government_id=? AND status IN ('approved','active')", (g["id"],))["n"],
            "levels": levels, "state": state, "storm": dust, "alerts": alerts, "protocol": PROTOCOL if levels["oxygen"] < 30 else []}
