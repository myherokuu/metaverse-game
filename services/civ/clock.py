"""One shared simulation clock; every zone shows it through its own timezone offset.
sim_ts = simulated seconds. Calendar: 360-day year of 12 x 30-day months (simple and deterministic).
Restart safety: the real time of the last advance is persisted, and a gap is clamped (MAX_REAL_GAP), so after downtime or a
worker restart time never jumps forward and no period is processed twice (see engine: processed_ts)."""
import time

from database.db import q, q1, run, tx

DAY, HOUR = 86400, 3600
MAX_REAL_GAP = 5.0                      # seconds of real time credited per advance, at most
SPEEDS = [1, 24, 60, 240, 1440]         # 1x real time, 24x (1 real hour = 1 sim day), 60x, ...
START_TS = 1 * DAY + 12 * HOUR           # day 2, 12:00 (Aether local)
ZONE_DEFAULTS = {"aether_city": dict(tz_offset_min=0), "wakanda": dict(tz_offset_min=420), "pandora": dict(tz_offset_min=-300), "mars": dict(tz_offset_min=-720)}   # Wakanda is 7 h ahead


def init(now=None):
    now = now if now is not None else time.time()
    with tx() as c:
        if not c.execute("SELECT 1 FROM world_clocks WHERE id='global'").fetchone():
            c.execute("INSERT INTO world_clocks(id,kind,sim_ts,processed_ts,speed,running,last_real_ts) VALUES('global','global',?,?,60,1,?)", (START_TS, START_TS, now))
        for z in c.execute("SELECT id FROM world_zones").fetchall():
            if not c.execute("SELECT 1 FROM world_clocks WHERE id=?", (z[0],)).fetchone():
                d = ZONE_DEFAULTS.get(z[0], {})
                c.execute("INSERT INTO world_clocks(id,kind,tz_offset_min,sunrise_h,sunset_h) VALUES(?, 'zone', ?, 6, 18)", (z[0], d.get("tz_offset_min", 0)))


def resume(now=None):
    """Call on startup: elapsed downtime is NOT credited."""
    run("UPDATE world_clocks SET last_real_ts=? WHERE id='global'", (now if now is not None else time.time(),))


def glob():
    return q1("SELECT * FROM world_clocks WHERE id='global'")


def advance(now=None):
    """Advance the shared clock by real elapsed time x speed. Returns whole sim seconds added."""
    now = now if now is not None else time.time()
    with tx() as c:
        g = dict(c.execute("SELECT * FROM world_clocks WHERE id='global'").fetchone())
        dt = min(max(now - g["last_real_ts"], 0.0), MAX_REAL_GAP)
        if not g["running"]:
            c.execute("UPDATE world_clocks SET last_real_ts=? WHERE id='global'", (now,))
            return 0
        total = g["carry"] + dt * g["speed"]
        whole = int(total)
        c.execute("UPDATE world_clocks SET sim_ts=sim_ts+?, carry=?, last_real_ts=? WHERE id='global'", (whole, total - whole, now))
        return whole


def set_speed(speed=None, running=None):
    if speed is not None:
        if not 0 < float(speed) <= 100000:
            raise ValueError("speed must be 0-100000")
        run("UPDATE world_clocks SET speed=? WHERE id='global'", (float(speed),))
    if running is not None:
        run("UPDATE world_clocks SET running=?, last_real_ts=? WHERE id='global'", (1 if running else 0, time.time()))


def set_zone(zone_id, **kw):
    cols = {k: v for k, v in kw.items() if k in ("tz_offset_min", "sunrise_h", "sunset_h", "work_start_h", "work_end_h", "biz_open_h", "biz_close_h") and v is not None}
    if not cols or not q1("SELECT 1 FROM world_clocks WHERE id=? AND kind='zone'", (zone_id,)):
        raise ValueError("unknown zone or nothing to change")
    if "tz_offset_min" in cols and abs(int(cols["tz_offset_min"])) > 14 * 60:
        raise ValueError("tz_offset_min must be within +-840")
    run("UPDATE world_clocks SET %s WHERE id=?" % ",".join(k + "=?" for k in cols), list(cols.values()) + [zone_id])


def zone_row(zone_id):
    return q1("SELECT * FROM world_clocks WHERE id=? AND kind='zone'", (zone_id,))


def local_ts(zone_id, ts=None):
    ts = glob()["sim_ts"] if ts is None else ts
    return ts + (zone_row(zone_id) or {"tz_offset_min": 0})["tz_offset_min"] * 60


def local_hour(zone_id, ts=None):
    return (local_ts(zone_id, ts) % DAY) / HOUR


def calendar(lts):
    d = lts // DAY
    return {"year": 2100 + d // 360, "month": (d % 360) // 30 + 1, "day": d % 30 + 1, "hour": (lts % DAY) // HOUR, "minute": (lts % HOUR) // 60}


def fmt(lts):
    c = calendar(lts)
    return "%04d-%02d-%02d %02d:%02d" % (c["year"], c["month"], c["day"], c["hour"], c["minute"])


def snapshot():
    g = glob()
    zones = []
    for z in q("SELECT * FROM world_clocks WHERE kind='zone' ORDER BY id"):
        lts = g["sim_ts"] + z["tz_offset_min"] * 60
        h = (lts % DAY) / HOUR
        zones.append({"zone_id": z["id"], "tz_offset_min": z["tz_offset_min"], "local_ts": lts, "local_time": fmt(lts), "local_hour": round(h, 3),
                      "is_day": z["sunrise_h"] <= h < z["sunset_h"], "sunrise_h": z["sunrise_h"], "sunset_h": z["sunset_h"],
                      "work_start_h": z["work_start_h"], "work_end_h": z["work_end_h"], "biz_open_h": z["biz_open_h"], "biz_close_h": z["biz_close_h"],
                      "working_hours": z["work_start_h"] <= h < z["work_end_h"], "business_open": z["biz_open_h"] <= h < z["biz_close_h"]})
    return {"sim_ts": g["sim_ts"], "speed": g["speed"], "running": bool(g["running"]), "processed_ts": g["processed_ts"], "speeds": SPEEDS, "zones": zones}
