from flask import Blueprint, request

from database.db import q, q1, run
from routes.common import admin_required, current_user_id, json_body, ok
from services import agent_behavior as beh
from services import event_manager as ev
from services import ollama_service as ollama
from services import world_manager as world
from services import zone_manager as zones
from services.errors import ApiError

bp = Blueprint("world", __name__, url_prefix="/api")
PLAYER_EVENTS = {"player_entered_world", "player_exited_world", "player_entered_building",
                 "player_exited_building", "player_approached_agent"}


@bp.get("/health")
def health():
    return ok({"status": "ok", "db": bool(q1("SELECT 1 AS x")), "ollama": ollama.status()["connected"]})


@bp.get("/world/state")
def state():
    return ok(world.get_state(current_user_id()))     # Aether City layout (original scene builder)


def _save_position():
    d = json_body()
    uid = current_user_id()
    zone, x, z = zones.save_position(uid, d)
    beh.player_seen(x, z, zone)
    if "time_of_day" in d:
        try:
            world.set_world_state("time_of_day", min(24.0, max(0.0, float(d["time_of_day"]))))
        except (TypeError, ValueError):
            pass
    return ok({"zone_id": zone})


@bp.post("/player/position")
def position():
    return _save_position()


@bp.post("/world/position")
def position2():
    return _save_position()


@bp.get("/world/player-location")
def player_location():
    return ok(zones.player_location(current_user_id()))


@bp.get("/world/zones")
def zone_list():
    return ok(zones.list_zones(current_user_id()))


@bp.get("/world/zones/<zid>")
def zone_get(zid):
    return ok(zones.get_zone(zid))


@bp.get("/world/zones/<zid>/map")
def zone_map(zid):
    return ok(zones.zone_map(zid))


@bp.get("/world/zones/<zid>/objects")
def zone_objects(zid):
    return ok(zones.zone_objects(zid, int(request.args.get("after", 0))))


@bp.get("/world/zones/<zid>/agents")
def zone_agents(zid):
    return ok(zones.zone_agents(zid))


@bp.post("/world/zones/<zid>/build")
@admin_required
def zone_build(zid):
    return ok(zones.build(zid, json_body().get("objects")), 201)


@bp.post("/world/travel")
def travel():
    d = json_body()
    res = zones.travel(current_user_id(), d.get("zone_id"), d.get("spawn"), d.get("here"), d.get("at"))
    beh.player_seen(res["position"]["x"], res["position"]["z"], res["zone"]["id"])
    return ok(res)


@bp.get("/world/locations")
def all_locations():
    return ok(q("SELECT key,name,kind,zone FROM world_locations ORDER BY zone,id"))


@bp.get("/world/events")
def events():
    return ok(ev.list_events(int(request.args.get("after", 0)), request.args.get("limit", 50), request.args.get("zone")))


@bp.post("/world/events")
def post_event():
    d = json_body()
    if d.get("type") not in PLAYER_EVENTS or not isinstance(d.get("message"), str):
        raise ApiError("Unsupported event", 422, "validation")
    return ok({"id": ev.emit(d["type"], d["message"][:200], zone=zones.current_zone(current_user_id()))}, 201)


@bp.get("/world/agents/state")
def agents_state():
    return ok(beh.live_states(request.args.get("zone") or zones.current_zone(current_user_id())))
