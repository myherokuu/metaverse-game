import logging

from flask import Flask, jsonify, render_template, request

from config import Config
from database import db
from routes import agent_routes, civ_routes, ollama_routes, world_routes
from services import agent_behavior, agent_manager, world_manager, zone_manager
from services.errors import ApiError

log = logging.getLogger("metaverse")


def create_app(start_sim=True):
    app = Flask(__name__)
    app.config.update(SECRET_KEY=Config.SECRET_KEY, SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Strict",
                      PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 365, MAX_CONTENT_LENGTH=64 * 1024)
    db.init_db()
    world_manager.seed_world()
    zone_manager.ensure_zones(full=False)
    agent_manager.seed_agents()
    zone_manager.ensure_zones()
    from services.civ import clock as civ_clock
    civ_clock.init(); civ_clock.resume()
    from services.civ import seed as civ_seed, engine as civ_engine
    civ_seed.seed()
    for m in (world_routes, agent_routes, ollama_routes, civ_routes):
        app.register_blueprint(m.bp)
    if start_sim:
        agent_behavior.start()
        civ_engine.start()
    else:
        agent_behavior.load_all()

    @app.before_request
    def csrf_guard():
        # State-changing API calls must come from our own JS (jQuery sets this header; cross-site forms cannot).
        if request.method in ("POST", "PUT", "DELETE") and request.path.startswith("/api/") \
                and request.headers.get("X-Requested-With") != "XMLHttpRequest":
            return jsonify(ok=False, error={"code": "csrf", "message": "Missing X-Requested-With header"}), 403

    @app.errorhandler(ApiError)
    def api_error(e):
        return jsonify(ok=False, error={"code": e.code, "message": e.message}), e.status

    @app.errorhandler(404)
    def nf(e):
        return jsonify(ok=False, error={"code": "not_found", "message": "Not found"}), 404

    @app.errorhandler(Exception)
    def boom(e):
        log.exception("unhandled")
        return jsonify(ok=False, error={"code": "server_error", "message": "Internal error"}), 500

    @app.after_request
    def headers(r):
        r.headers["X-Content-Type-Options"] = "nosniff"
        r.headers["Cache-Control"] = "no-store" if request.path.startswith(("/api/", "/static/js/")) else "no-cache"
        return r

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/admin")
    def admin():
        return render_template("admin.html")

    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("\n  AI Metaverse -> http://%s:%d   |   admin: /admin\n  Admin token (also in instance/admin_token):\n  %s\n"
          % (Config.HOST, Config.PORT, Config.ADMIN_TOKEN))
    create_app().run(Config.HOST, Config.PORT, threaded=True, use_reloader=False)
