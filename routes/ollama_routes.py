from flask import Blueprint

from database.db import set_setting
from routes.common import admin_required, json_body, ok
from services import ollama_service as ollama
from services.errors import ApiError

bp = Blueprint("ollama", __name__, url_prefix="/api")


@bp.get("/ollama/status")
def status():
    return ok(dict(ollama.status(), default_model=ollama.default_model()))


@bp.get("/ollama/models")
def models():
    try:
        return ok({"models": ollama.models(), "default_model": ollama.default_model()})
    except ollama.OllamaError as e:
        raise ApiError(str(e), 503, "ollama_unavailable")


@bp.put("/settings")
@admin_required
def settings():
    d = json_body()
    for k in ("default_model", "ollama_url"):
        if k in d:
            if not isinstance(d[k], str) or len(d[k]) > 200 or (k == "ollama_url" and not d[k].startswith(("http://", "https://"))):
                raise ApiError("Invalid " + k, 422, "validation")
            set_setting(k, d[k].strip())
    ollama.reset_cache()
    return ok(ollama.status())
