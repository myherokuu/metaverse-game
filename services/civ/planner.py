"""Government planning. Needs analysis and project choice are deterministic. Ollama (when available) only writes the project's
name and rationale and an announcement; it cannot set cost, parcel, approval or any money - those come from Python rules."""
import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor

from database.db import q, q1, run
from services import ollama_service as ollama
from services.civ import citizens, construction as cn, events, finance

_pool = ThreadPoolExecutor(max_workers=1)
_last_llm = {}


def needs(gid):
    """Ranked list of (kind, reason) following the government's priority policy."""
    pop = q1("SELECT COUNT(*) n FROM citizens WHERE government_id=?", (gid,))["n"]
    done = {r["kind"]: r["n"] for r in q("SELECT kind, COUNT(*) n FROM construction_projects WHERE government_id=? AND status IN ('completed','active','approved','awaiting_approval','awaiting_budget') GROUP BY kind", (gid,))}
    seekers = q1("SELECT COUNT(*) n FROM citizens WHERE government_id=? AND salary_minor=0", (gid,))["n"]
    found = {}
    if pop >= citizens.housing_capacity(gid) * 0.85:
        found["housing"] = ("apartment" if pop > 30 else "house", "population %d is close to housing capacity %d" % (pop, citizens.housing_capacity(gid)))
    if seekers > 0 or pop > citizens.jobs_capacity(gid) * 0.95:
        found["jobs"] = ("office", "%d residents are looking for work" % seekers)
    if done.get("clinic", 0) * 30 < pop:
        found["health"] = ("clinic", "no clinic yet for %d citizens" % pop)
    if done.get("research_lab", 0) * 40 < pop:
        found["research"] = ("research_lab", "research capacity is below the national goal")
    return [found[p] for p in finance.policy(gid, "priorities", []) if p in found] + [v for k, v in found.items() if k not in finance.policy(gid, "priorities", [])]


def plan(gid, ts):
    """Daily planning cycle: re-evaluate waiting projects, and propose at most one new project if the pipeline has room."""
    g = finance.gov(gid)
    if g["status"] != "active":
        return None
    for pr in q("SELECT id FROM construction_projects WHERE government_id=? AND status IN ('awaiting_budget') ORDER BY id", (gid,)):
        cn.evaluate(pr["id"], ts)
    pending = q1("SELECT COUNT(*) n FROM construction_projects WHERE government_id=? AND status IN ('awaiting_budget','awaiting_approval')", (gid,))["n"]
    live = q1("SELECT COUNT(*) n FROM construction_projects WHERE government_id=? AND status IN ('approved','active','blocked')", (gid,))["n"]
    if pending >= 2 or live >= finance.policy(gid, "max_active_projects", 1) + 1:
        return None
    for kind, why in needs(gid):
        if q1("SELECT 1 FROM construction_projects WHERE government_id=? AND kind=? AND status IN ('awaiting_budget','awaiting_approval','approved','active','blocked')", (gid, kind)):
            continue
        cands = cn.candidate_parcels(gid, kind)
        if not cands:
            continue
        pid = cn.create_project(gid, kind, cands[0]["id"], ts, rationale=why)
        cn.evaluate(pid, ts)
        _pool.submit(enhance, pid)
        return pid
    return None


def assign_waiting(ts):
    for pr in q("SELECT id FROM construction_projects WHERE status='approved' AND contractor_id IS NULL ORDER BY id"):
        cn.assign_contractor(pr["id"], ts)


def _ask(agent_row, system, user, timeout=40):
    if not ollama.status()["connected"]:
        return None
    try:
        text, _ = ollama.chat(agent_row["model"] if agent_row else "", [{"role": "system", "content": system}, {"role": "user", "content": user}], {"num_predict": 120, "temperature": 0.5}, timeout=timeout)
        return text
    except Exception:
        return None


def enhance(project_id):
    """Background: ask the Development Minister (via Ollama) for a name and a one-sentence rationale. Text only; validated."""
    try:
        pr = q1("SELECT * FROM construction_projects WHERE id=?", (project_id,))
        if not pr:
            return
        dept = q1("SELECT head_agent_id FROM government_departments WHERE government_id=? AND key='development'", (pr["government_id"],))
        ag = q1("SELECT * FROM agents WHERE id=?", (dept["head_agent_id"],)) if dept else None
        g = finance.gov(pr["government_id"])
        out = _ask(ag, "You are the Development Minister of %s, a fictional simulated government. Reply with ONE JSON object only: {\"name\": \"<=4 words\", \"rationale\": \"one sentence\"}." % g["name"],
                   "Project: %s on a %s parcel. Reason: %s." % (pr["kind"].replace("_", " "), "vacant", pr["rationale"]))
        m = re.search(r"\{.*?\}", out or "", re.S)
        if not m:
            return
        d = json.loads(m.group(0))
        name, rat = str(d.get("name", ""))[:40].strip(), str(d.get("rationale", ""))[:240].strip()
        if re.fullmatch(r"[\w .\-']{3,40}", name):
            run("UPDATE construction_projects SET name=? WHERE id=? AND status IN ('awaiting_budget','awaiting_approval','approved','active')", (name, project_id))
        if rat:
            run("UPDATE construction_projects SET rationale=? WHERE id=?", (rat, project_id))
            events.emit(pr["zone_id"], pr["government_id"], "minister_statement", "Development Minister: " + rat, 0, {"project_id": project_id})
    except Exception:
        pass
