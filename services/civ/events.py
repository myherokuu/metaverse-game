import json

from database.db import run


def emit(zone_id, gov_id, kind, message, sim_ts, data=None):
    return run("INSERT INTO civilization_events(zone_id,government_id,kind,message,data,sim_ts) VALUES(?,?,?,?,?,?)",
               (zone_id, gov_id, kind, message[:300], json.dumps(data) if data else None, sim_ts)).lastrowid
