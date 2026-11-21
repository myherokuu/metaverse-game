import hmac
from functools import wraps

from flask import jsonify, request, session

from config import Config
from database.db import q1, run
from services.errors import ApiError


def ok(data=None, status=200):
    return jsonify({"ok": True, "data": data}), status


def current_user_id():
    """Anonymous local player identified by a signed session cookie."""
    uid = session.get("uid")
    if uid and q1("SELECT 1 FROM users WHERE id=?", (uid,)):
        return uid
    uid = run("INSERT INTO users(username) VALUES('player')").lastrowid
    run("UPDATE users SET username='player-'||id WHERE id=?", (uid,))
    session["uid"], session.permanent = uid, True
    return uid


def is_admin():
    return hmac.compare_digest(request.headers.get("X-Admin-Token", ""), Config.ADMIN_TOKEN)


def admin_required(f):
    @wraps(f)
    def w(*a, **k):
        if not is_admin():
            raise ApiError("Admin token required", 401, "unauthorized")
        return f(*a, **k)
    return w


def json_body():
    d = request.get_json(silent=True)
    if not isinstance(d, dict):
        raise ApiError("JSON object body required", 400, "bad_json")
    return d
