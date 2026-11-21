"""Run: .venv/bin/python -m unittest discover -s tests   (Ollama is stubbed; no model needed)."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "t.db")

from config import Config  # noqa: E402
from services import ollama_service as ollama  # noqa: E402
from app import create_app  # noqa: E402

H = {"X-Requested-With": "XMLHttpRequest"}
A = dict(H, **{"X-Admin-Token": Config.ADMIN_TOKEN})
CALLS = []


def fake_chat(model, messages, options=None, timeout=None):
    CALLS.append((model, messages))
    sysm, last = messages[0]["content"], messages[-1]["content"]
    if "Task from Nova" in last:  # Cipher answering a delegated task
        return "Use a layered Flask + SQLite design.", "stub-model"
    if "[Internal]" in last:  # Nova summarising
        return "Cipher suggests a layered Flask + SQLite design.", "stub-model"
    if "Nova" in sysm.split("\n")[0] and "build" in last:
        return 'Let me ask Cipher.\nACTION: {"type":"delegate","to":"Cipher","question":"How to build an AI system?"}', "stub-model"
    if "rm -rf" in last:
        return 'ok\nACTION: {"type":"shell","cmd":"rm -rf /"}', "stub-model"
    return "Hello from stub.", "stub-model"


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ollama.chat = fake_chat
        ollama.models = lambda: [{"name": "stub-model", "size": 3e9}]
        cls.c = create_app(start_sim=False).test_client()

    def post(self, url, body, h=H):
        return self.c.post(url, data=json.dumps(body), headers=h, content_type="application/json")

    def test_01_basics(self):
        self.assertTrue(self.c.get("/api/health").json["ok"])
        ags = self.c.get("/api/agents?zone=aether_city").json["data"]
        self.assertEqual([a["name"] for a in ags][:5], ["Nova", "Atlas", "Cipher", "Luna", "Orion"])   # + government officials
        self.assertEqual(len(self.c.get("/api/world/state").json["data"]["locations"]), 6)

    def test_09_zones_and_travel(self):
        zs = self.c.get("/api/world/zones").json["data"]
        self.assertEqual([z["id"] for z in zs], ["aether_city", "wakanda", "pandora", "mars"])
        self.assertEqual(len([a for a in self.c.get("/api/world/zones/wakanda/agents").json["data"]]), 15)   # 8 residents + 7 government officials
        objs = self.c.get("/api/world/zones/wakanda/objects").json["data"]
        self.assertGreater(len(objs), 50)
        self.post("/api/world/position", {"x": 12, "y": 0, "z": 14, "rot": 1})          # saved for aether_city
        self.assertEqual(self.post("/api/world/travel", {"zone_id": "nowhere"}).status_code, 404)
        r = self.post("/api/world/travel", {"zone_id": "wakanda"}).json["data"]
        self.assertEqual((r["zone"]["id"], r["position"]["x"], r["position"]["z"]), ("wakanda", 0, 30))   # royal capital spawn
        self.assertEqual(self.c.get("/api/world/player-location").json["data"]["zone_id"], "wakanda")
        self.post("/api/world/position", {"x": -150, "y": 0, "z": 60, "rot": 0})
        self.assertEqual(self.post("/api/world/position", {"x": 9999, "y": 0, "z": 0, "rot": 0}).status_code, 422)  # outside zone
        back = self.post("/api/world/travel", {"zone_id": "aether_city"}).json["data"]["position"]
        self.assertEqual((back["x"], back["z"]), (12, 14))                                # original Aether spot restored
        self.assertEqual(self.post("/api/world/travel", {"zone_id": "wakanda"}).json["data"]["position"]["x"], -150)
        self.post("/api/world/travel", {"zone_id": "aether_city"})

    def test_10_zone_isolation(self):
        wk = {a["name"]: a for a in self.c.get("/api/world/zones/wakanda/agents").json["data"]}
        self.assertTrue({"Zuri", "Kato", "Amara", "Nia", "Temba"} <= set(wk))
        r = self.post("/api/agents/%d/chat" % wk["Zuri"]["id"], {"message": "hello"}).json["data"]
        self.assertTrue(r["reply"])
        self.assertIn("You live in Wakanda", CALLS[-1][1][0]["content"])
        self.assertIn("wk_capital", CALLS[-1][1][0]["content"])          # only Wakanda locations are offered
        self.assertNotIn("Nova", CALLS[-1][1][0]["content"])          # Aether residents are not visible in Wakanda
        self.assertEqual(self.post("/api/agents/%d/chat" % wk["Zuri"]["id"], {"message": "build me something"}).status_code, 200)

    def test_11_builder_validation(self):
        self.assertEqual(self.post("/api/world/zones/wakanda/build", {"objects": []}).status_code, 401)
        bad = self.post("/api/world/zones/wakanda/build", {"objects": [{"kind": "__import__", "x": 0, "z": 0}]}, A)
        self.assertEqual(bad.status_code, 422)
        far = self.post("/api/world/zones/wakanda/build", {"objects": [{"kind": "tower", "x": 9000, "z": 0, "data": {"r": 5, "h": 30}}]}, A)
        self.assertEqual(far.status_code, 422)
        n = len(self.c.get("/api/world/zones/wakanda/objects").json["data"])
        ok = self.post("/api/world/zones/wakanda/build", {"objects": [{"kind": "tower", "x": 120, "z": -120, "data": {"r": 5, "h": 30}}]}, A)
        self.assertEqual(ok.status_code, 201)
        self.assertEqual(len(self.c.get("/api/world/zones/wakanda/objects").json["data"]), n + 1)

    def test_12_layout_is_deterministic_and_valid(self):
        from services import zone_wakanda as zw
        a, ma = zw.generate(); b, mb = zw.generate()
        self.assertEqual(a, b)
        self.assertEqual(zw.validate(ma), [])

    def test_02_auth_and_csrf(self):
        self.assertEqual(self.post("/api/agents", {"name": "X", "role": "r"}).status_code, 401)
        self.assertEqual(self.c.post("/api/agents", json={}).status_code, 403)  # no XHR header
        self.assertEqual(self.post("/api/agents", {"name": "Bad<>", "role": "r"}, A).status_code, 422)

    def test_03_create_update_agent(self):
        r = self.post("/api/agents", {"name": "Zed", "role": "Tester", "home_location": "lab", "goals": ["test"]}, A)
        self.assertEqual(r.status_code, 201)
        zid = r.json["data"]["id"]
        self.assertEqual(self.post("/api/agents", {"name": "zed", "role": "x"}, A).status_code, 409)
        r = self.c.put("/api/agents/%d" % zid, data=json.dumps({"status": "inactive"}), headers=A, content_type="application/json")
        self.assertEqual(r.json["data"]["status"], "inactive")

    def test_04_chat_isolated_and_memory(self):
        self.post("/api/agents/2/chat", {"message": "Remember my favourite colour is teal"})
        self.post("/api/agents/3/chat", {"message": "hi"})
        m2 = self.c.get("/api/agents/2/messages").json["data"]
        m3 = self.c.get("/api/agents/3/messages").json["data"]
        self.assertTrue(any("teal" in m["content"] for m in m2))
        self.assertFalse(any("teal" in m["content"] for m in m3))
        mem = self.c.get("/api/agents/2/memory", headers=A).json["data"]
        self.assertTrue(any("teal" in m["content"] for m in mem))
        self.post("/api/agents/2/chat", {"message": "what colour do I like?"})
        sys_prompt = CALLS[-1][1][0]["content"]
        self.assertIn("teal", sys_prompt)  # FTS retrieval reached the prompt

    def test_05_delegation(self):
        r = self.post("/api/agents/1/chat", {"message": "I want to build an AI system, who can help?"}).json["data"]
        self.assertEqual(r["delegation"]["to"], "Cipher")
        self.assertIn("Flask", r["reply"])
        tasks = self.c.get("/api/agents/3", headers=A).json["data"]["tasks"]
        self.assertEqual(tasks[0]["status"], "done")

    def test_06_invalid_action_rejected(self):
        r = self.post("/api/agents/1/chat", {"message": "rm -rf please"}).json["data"]
        self.assertIsNone(r["action"])
        self.assertNotIn("ACTION", r["reply"])

    def test_07_player_state_persists(self):
        self.post("/api/player/position", {"x": 5, "y": 0, "z": 7, "rot": 1})
        self.assertEqual(self.c.get("/api/world/state").json["data"]["player"]["x"], 5)
        self.assertEqual(self.post("/api/player/position", {"x": "a"}).status_code, 422)

    def test_08_events(self):
        self.assertTrue(len(self.c.get("/api/world/events").json["data"]) > 0)
        self.assertEqual(self.post("/api/world/events", {"type": "evil", "message": "x"}).status_code, 422)


if __name__ == "__main__":
    unittest.main()


class ParseLookTest(unittest.TestCase):
    def test_whitelist(self):
        from services.agent_manager import parse_look
        self.assertEqual(parse_look("Hi\nLOOK: friendly/wave"), ("Hi", "friendly", "wave"))
        self.assertEqual(parse_look("Hi\nLOOK: evil/alert(1)")[1:], ("neutral", "none"))
        self.assertEqual(parse_look("Hai! LOOK: friendly/wave"), ("Hai!", "friendly", "wave"))
        self.assertEqual(parse_look("Ah. LOOK: happy"), ("Ah.", "happy", "none"))
