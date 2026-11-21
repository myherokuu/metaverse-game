"""Thin Ollama client. All model traffic goes through here: queued, time-limited, never exposed to the browser."""
import json
import re
import threading
import time
import urllib.error
import urllib.request

from config import Config
from database.db import get_setting

_sem = threading.BoundedSemaphore(Config.OLLAMA_MAX_CONCURRENT)
_lock = threading.Lock()
_active = _waiting = 0
_cache = {"t": 0, "status": None}
# Names that are poor chat defaults (embedding/vision/reasoning/security-tuned). Only used to pick a *default*; user can choose any.
_SKIP = re.compile(r"embed|llava|vl|think|r1|secur|xploiter|pentest|agentix|abliterated|coder|glimmer", re.I)


class OllamaError(Exception):
    pass


def base_url():
    return (get_setting("ollama_url") or Config.OLLAMA_URL).rstrip("/")


def _http(path, payload=None, timeout=5):
    req = urllib.request.Request(base_url() + path, method="POST" if payload is not None else "GET",
                                 data=json.dumps(payload).encode() if payload is not None else None,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise OllamaError("Ollama HTTP %s: %s" % (e.code, e.read()[:200].decode("utf-8", "replace")))
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise OllamaError("Ollama unreachable: %s" % getattr(e, "reason", e))


def models():
    """Installed models (GET /api/tags), newest probe each call (cheap)."""
    return [{"name": m["name"], "size": m.get("size", 0)} for m in _http("/api/tags").get("models", [])]


def status():
    """Always probes (2s cache) so reconnecting needs no restart."""
    now = time.time()
    if _cache["status"] and now - _cache["t"] < 2:
        s = dict(_cache["status"])
    else:
        try:
            ms = models()
            s = {"connected": True, "url": base_url(), "model_count": len(ms), "error": None}
        except OllamaError as e:
            s = {"connected": False, "url": base_url(), "model_count": 0, "error": str(e)}
        _cache.update(t=now, status=dict(s))
    s.update(active=_active, waiting=_waiting, max_concurrent=Config.OLLAMA_MAX_CONCURRENT)
    return s


def reset_cache():
    _cache.update(t=0, mt=0)


def default_model():
    """Configured default, else smallest sensible installed chat model. Never hardcoded."""
    m = get_setting("default_model")
    if m:
        return m
    now = time.time()
    if now - _cache.get("mt", 0) > 10:  # serialise() calls this per agent; avoid hammering /api/tags
        try:
            _cache.update(mt=now, ms=models())
        except OllamaError:
            _cache.update(mt=now, ms=[])
    ms = _cache["ms"]
    good = [x for x in ms if not _SKIP.search(x["name"]) and x["size"] > 1.5e9] or ms
    return min(good, key=lambda x: x["size"])["name"] if good else ""


def chat(model, messages, options=None, timeout=None):
    """POST /api/chat (non-streaming). Blocks while queued behind other requests."""
    global _active, _waiting
    model = model or default_model()
    if not model:
        raise OllamaError("No Ollama model available (is Ollama running and a model installed?)")
    opts = dict(Config.OLLAMA_OPTIONS, **(options or {}))
    with _lock:
        _waiting += 1
    _sem.acquire()
    with _lock:
        _waiting -= 1
        _active += 1
    try:
        r = _http("/api/chat", {"model": model, "messages": messages, "stream": False, "options": opts},
                  timeout=timeout or Config.OLLAMA_TIMEOUT)
    finally:
        with _lock:
            _active -= 1
        _sem.release()
    text = (r.get("message") or {}).get("content", "")
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()  # drop reasoning blocks
    if not text:
        raise OllamaError("Model returned an empty reply")
    return text, model
