"""Two-level memory. Short-term = recent messages of one conversation. Long-term = agent_memories (+FTS5).
`search()` is the only retrieval entry point: swap its body for embeddings/vector search later."""
import re

from database.db import q, run

_PREF = re.compile(r"\b(remember|my name is|i prefer|i like|i love|i hate|i am a|i'm a|nama saya|saya suka|ingat)\b", re.I)


def add(agent_id, content, kind="long", importance=1, source="event"):
    run("INSERT INTO agent_memories(agent_id,kind,content,importance,source) VALUES(?,?,?,?,?)",
        (agent_id, kind, content[:500], importance, source))


def remember_user_text(agent_id, text):
    """Only explicitly stated preferences/facts become high-importance long-term memory."""
    if _PREF.search(text):
        add(agent_id, "Player said: " + text, importance=3, source="user_preference")
        return True
    return False


def search(agent_id, query, k=4):
    toks = list(dict.fromkeys(re.findall(r"\w{3,}", query.lower())))[:8]
    rows = []
    if toks:
        match = " OR ".join('"%s"' % t for t in toks)
        rows = q("SELECT m.content FROM memories_fts f JOIN agent_memories m ON m.id=f.rowid "
                 "WHERE memories_fts MATCH ? AND m.agent_id=? ORDER BY m.importance DESC, bm25(memories_fts) LIMIT ?",
                 (match, agent_id, k))
    if len(rows) < k:  # top up with the most important recent memories
        have = {r["content"] for r in rows}
        for r in q("SELECT content FROM agent_memories WHERE agent_id=? AND importance>=2 "
                   "ORDER BY id DESC LIMIT ?", (agent_id, k)):
            if r["content"] not in have and len(rows) < k:
                rows.append(r)
    return [r["content"] for r in rows]


def list_memories(agent_id, limit=50):
    return q("SELECT id,kind,content,source,importance,created_at FROM agent_memories "
             "WHERE agent_id=? ORDER BY id DESC LIMIT ?", (agent_id, limit))


def recent_messages(conv_id, n):
    rows = q("SELECT role,content FROM agent_messages WHERE conversation_id=? ORDER BY id DESC LIMIT ?", (conv_id, n))
    return rows[::-1]
