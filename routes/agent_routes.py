from flask import Blueprint, request

from routes.common import admin_required, is_admin, current_user_id, json_body, ok
from services import agent_manager as am
from services import agent_memory as mem
from services import agent_behavior as beh
from services.errors import ApiError

bp = Blueprint("agents", __name__, url_prefix="/api")


@bp.get("/agents")
def list_():
    return ok(am.list_agents(zone=request.args.get("zone")))


@bp.post("/agents")
@admin_required
def create():
    return ok(am.create_agent(json_body()), 201)


@bp.get("/agents/<int:aid>")
def detail(aid):
    a = am.serialize(am.get_row(aid), True)
    if not is_admin():  # prompts, errors and internal task logs are admin-only
        for k in ("system_prompt", "last_error", "last_ollama_at", "tasks", "recent_interactions", "relationships"):
            a.pop(k, None)
    return ok(a)


@bp.put("/agents/<int:aid>")
@admin_required
def update(aid):
    return ok(am.update_agent(aid, json_body()))


@bp.post("/agents/<int:aid>/chat")
def chat(aid):
    return ok(am.chat(aid, current_user_id(), json_body().get("message")))


@bp.get("/agents/<int:aid>/messages")
def messages(aid):
    return ok(am.messages(aid, current_user_id(), min(int(request.args.get("limit", 50)), 200)))


@bp.get("/agents/<int:aid>/memory")
@admin_required
def memory(aid):
    am.get_row(aid)
    return ok(mem.list_memories(aid))


@bp.post("/agents/<int:aid>/task")
@admin_required
def task(aid):
    d = json_body()
    return ok(am.assign_task(aid, d.get("description"), d.get("delegate_to")), 202)


@bp.post("/agents/<int:aid>/command")
def command(aid):
    """Player-issued commands (follow me / stop / go to). Same action schema as LLM-proposed actions."""
    d = json_body()
    am.get_row(aid)
    act, spec = {"type": d.get("type")}, am.ACTION_SCHEMA.get(d.get("type"))
    if spec is None or d["type"] == "delegate":
        raise ApiError("type must be follow|stop|goto", 422, "validation")
    if d["type"] == "goto":
        act["location"] = d.get("location")
        if not isinstance(act["location"], str):
            raise ApiError("location required", 422, "validation")
    _, valid = am.parse_action("ACTION: " + __import__("json").dumps(act), 0, [], am.get_row(aid)["zone"])
    if not valid:
        raise ApiError("Invalid action", 422, "validation")
    return ok(beh.command(aid, valid))


@bp.post("/agents/<int:aid>/talk")
def talk(aid):
    am.get_row(aid)
    beh.talk(aid, bool(json_body().get("on", True)))
    return ok()
