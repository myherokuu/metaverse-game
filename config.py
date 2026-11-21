"""Configuration. Everything is overridable by environment variable."""
import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = BASE_DIR / "instance"
INSTANCE_DIR.mkdir(exist_ok=True)


def _persisted_secret(name):
    """Env var wins; otherwise generate once and keep in instance/ (chmod 600)."""
    env = os.environ.get(name.upper())
    if env:
        return env
    p = INSTANCE_DIR / name
    if not p.exists():
        p.write_text(secrets.token_urlsafe(32))
        p.chmod(0o600)
    return p.read_text().strip()


class Config:
    HOST = os.environ.get("HOST", "127.0.0.1")  # LAN later: HOST=0.0.0.0
    PORT = int(os.environ.get("PORT", "2000"))
    DB_PATH = os.environ.get("DB_PATH", str(INSTANCE_DIR / "ai_metaverse.db"))
    SECRET_KEY = _persisted_secret("secret_key")
    ADMIN_TOKEN = _persisted_secret("admin_token")

    OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
    OLLAMA_TIMEOUT = float(os.environ.get("OLLAMA_TIMEOUT", "120"))
    OLLAMA_MAX_CONCURRENT = int(os.environ.get("OLLAMA_MAX_CONCURRENT", "1"))
    OLLAMA_OPTIONS = {"temperature": 0.7, "num_predict": 400, "num_ctx": 4096}

    CONTEXT_MESSAGES = int(os.environ.get("CONTEXT_MESSAGES", "10"))  # short-term window
    MEMORY_TOP_K = int(os.environ.get("MEMORY_TOP_K", "4"))
    MAX_DELEGATION_DEPTH = int(os.environ.get("MAX_DELEGATION_DEPTH", "2"))
    TASK_TIMEOUT = float(os.environ.get("TASK_TIMEOUT", "240"))  # whole delegation chain
    AGENT_REASON_COOLDOWN = float(os.environ.get("AGENT_REASON_COOLDOWN", "120"))  # autonomous LLM use
    AGENT_CHATTER = os.environ.get("AGENT_CHATTER", "1") == "1"
    MAX_MESSAGE_CHARS = 2000

    SIM_INTERVAL = float(os.environ.get("SIM_INTERVAL", "1.0"))   # seconds between civilization worker cycles
    SIM_MAX_STEPS = int(os.environ.get("SIM_MAX_STEPS", "720"))   # simulated minutes processed per cycle at most
    TICK_HZ = 4
    PAUSE_WITHOUT_PLAYER = 45  # seconds without a player heartbeat -> world sim pauses
