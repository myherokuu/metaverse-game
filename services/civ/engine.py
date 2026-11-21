"""Simulation engine. Processes simulated MINUTES one by one: each minute runs inside a transaction that also advances
world_clocks.processed_ts, so work is resumable after a restart and can never be processed twice. Deterministic rules run every
minute; Ollama is only used (asynchronously, text only) when a government drafts a plan."""
import threading
import time

from config import Config
from database.db import q, q1, run, tx
from services.civ import citizens, clock, construction, government, planner, trade
from services.civ import finance

DAY, HOUR = clock.DAY, clock.HOUR
_lock = threading.Lock()


def _zones():
    return [(z["id"], z["tz_offset_min"] * 60, q1("SELECT id FROM governments WHERE zone_id=?", (z["id"],))) for z in q("SELECT id,tz_offset_min FROM world_clocks WHERE kind='zone'")]


def _minute(ts, zones):
    construction.work(ts)
    if ts % HOUR == 0:
        planner.assign_waiting(ts)
    for zid, off, g in zones:
        local = (ts + off) % DAY
        if local % HOUR:
            continue
        hr = local // HOUR
        if g:
            if hr == finance.policy(g["id"], "planning_hour", 9):
                planner.plan(g["id"], ts)
            if hr == 0:
                government.daily_operations(zid, ts)
            if hr == 18:
                government.contractor_wages(zid, ts)
            if hr == 21:
                citizens.daily_economy(zid, ts)
        citizens.update_activities(zid, ts)
    if ts % DAY == 0:
        trade.settle(ts)
        if (ts // DAY) % 30 == 0:
            for zid, off, g in zones:
                if g:
                    finance.period_for(g["id"], ts)
                    citizens.monthly_growth(zid, ts)


def process(max_steps=720):
    """Process pending simulated minutes (processed_ts -> sim_ts). Returns the number of minutes processed."""
    with _lock:
        g, n, zones = clock.glob(), 0, _zones()
        while g["processed_ts"] + 60 <= g["sim_ts"] and n < max_steps:
            ts = g["processed_ts"] + 60
            with tx():
                _minute(ts, zones)
                run("UPDATE world_clocks SET processed_ts=? WHERE id='global' AND processed_ts=?", (ts, g["processed_ts"]))
            g["processed_ts"] = ts
            n += 1
        return n


def step(minutes):
    """Administrative fast-forward by whole simulated minutes (bounded)."""
    minutes = int(minutes)
    if not 1 <= minutes <= 3 * 24 * 60:
        raise ValueError("minutes must be 1..4320")
    run("UPDATE world_clocks SET sim_ts=sim_ts+? WHERE id='global'", (minutes * 60,))
    done = 0
    while True:
        k = process(2000)
        done += k
        if not k:
            return done


def _loop():
    while True:
        time.sleep(Config.SIM_INTERVAL)
        try:
            clock.advance()
            process(Config.SIM_MAX_STEPS)
        except Exception as e:      # the worker must never die
            print("civ engine error:", repr(e))


def start():
    clock.resume()
    threading.Thread(target=_loop, daemon=True, name="civ-engine").start()
