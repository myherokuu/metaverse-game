"""SQLite access: per-thread connections, WAL, FK enforcement, versioned schema."""
import re
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

from config import Config

_local = threading.local()
_DIR = Path(__file__).parent
_path = Config.DB_PATH


def set_path(path):
    """Used by tests to point at a throwaway DB."""
    global _path
    _path = path
    _local.__dict__.clear()


def conn():
    c = getattr(_local, "c", None)
    if c is None:
        # isolation_level=None -> autocommit; tx() issues explicit BEGIN/COMMIT.
        c = sqlite3.connect(_path, timeout=10, isolation_level=None)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        _local.c = c
    return c


@contextmanager
def tx():
    """Transaction; re-entrant. The outermost call is BEGIN/COMMIT; an inner call is a SAVEPOINT, so an exception caught by the
    caller rolls back only the inner work (a half-posted journal can never survive)."""
    c = conn()
    depth = getattr(_local, "depth", 0)
    if depth:
        name = "sp%d" % depth
        c.execute("SAVEPOINT " + name)
        _local.depth = depth + 1
        try:
            yield c
        except BaseException:
            c.execute("ROLLBACK TO " + name)
            c.execute("RELEASE " + name)
            raise
        else:
            c.execute("RELEASE " + name)
        finally:
            _local.depth = depth
        return
    c.execute("BEGIN IMMEDIATE")
    _local.depth = 1
    try:
        yield c
        c.execute("COMMIT")
    except BaseException:
        c.execute("ROLLBACK")
        raise
    finally:
        _local.depth = 0


def q(sql, args=()):
    return [dict(r) for r in conn().execute(sql, args).fetchall()]


def q1(sql, args=()):
    r = conn().execute(sql, args).fetchone()
    return dict(r) if r else None


def run(sql, args=()):
    return conn().execute(sql, args)


def get_setting(key, default=None):
    r = q1("SELECT value FROM system_settings WHERE key=?", (key,))
    return r["value"] if r else default


def set_setting(key, value):
    run("INSERT INTO system_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, str(value)))


def init_db():
    c = conn()
    has = c.execute("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'").fetchone()
    if not has:
        c.executescript((_DIR / "schema.sql").read_text())
    cur = c.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0]
    for f in sorted((_DIR / "migrations").glob("*.sql")):
        m = re.match(r"(\d+)_", f.name)
        if m and int(m.group(1)) > cur:
            c.executescript(f.read_text())
            c.execute("INSERT INTO schema_migrations(version) VALUES(?)", (int(m.group(1)),))
