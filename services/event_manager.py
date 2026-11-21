import json

from database.db import q, q1, run


def emit(type_, message, agent_id=None, data=None, world_id=1, zone=None):
    if zone is None:   # events about an agent belong to that agent's zone
        a = q1("SELECT zone FROM agents WHERE id=?", (agent_id,)) if agent_id else None
        zone = a["zone"] if a else "aether_city"
    cur = run("INSERT INTO world_events(world_id,type,agent_id,message,data,zone) VALUES(?,?,?,?,?,?)",
              (world_id, type_, agent_id, message[:300], json.dumps(data) if data else None, zone))
    return cur.lastrowid


def list_events(after=0, limit=50, zone=None):
    """Newest-first when after==0, otherwise everything after that id (ascending)."""
    limit = max(1, min(int(limit), 200))
    zc, za = (" AND zone=?", (zone,)) if zone else ("", ())
    if after:
        rows = q("SELECT * FROM world_events WHERE id>?" + zc + " ORDER BY id LIMIT ?", (after,) + za + (limit,))
    else:
        rows = list(reversed(q("SELECT * FROM world_events WHERE 1=1" + zc + " ORDER BY id DESC LIMIT ?", za + (limit,))))
    for r in rows:
        r["data"] = json.loads(r["data"]) if r["data"] else None
    return rows
