"""End-to-end civilization tests on a throwaway DB; Ollama is not needed (planner text is optional)."""
import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "civ.db")

from database import db  # noqa: E402
from database.db import q, q1, run  # noqa: E402
from services import ollama_service as ollama  # noqa: E402
from services.civ import citizens, clock, construction as cn, engine, finance, government, ledger, planner, trade  # noqa: E402
from app import create_app  # noqa: E402

M = 100


class Civ(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ollama.status = lambda: {"connected": False}          # planner falls back to deterministic text
        planner._pool.submit = lambda *a, **k: None            # no background LLM thread in tests
        create_app(start_sim=False)
        cls.ae = q1("SELECT * FROM governments WHERE zone_id='aether_city'")
        cls.wk = q1("SELECT * FROM governments WHERE zone_id='wakanda'")

    def ts(self):
        return clock.glob()["sim_ts"]

    def test_01_governments_independent(self):
        self.assertEqual((self.ae["currency_code"], self.wk["currency_code"]), ("AC", "WC"))
        self.assertEqual((self.ae["gov_type"], self.wk["gov_type"]), ("Technocratic Republic", "Constitutional Monarchy"))
        for g in (self.ae, self.wk):
            self.assertEqual(len(q("SELECT 1 FROM government_departments WHERE government_id=?", (g["id"],))), 7)
            self.assertGreaterEqual(len(q("SELECT 1 FROM government_agents WHERE government_id=? AND agent_id IS NULL", (g["id"],))), 4 if g is self.ae else 4)
            self.assertEqual(g["autonomy"], "semi")                                  # default
        self.assertEqual(finance.treasury(self.wk["id"]), 8_450_000 * M)
        self.assertNotEqual(finance.gacct(self.ae["id"], "treasury"), finance.gacct(self.wk["id"], "treasury"))
        self.assertEqual(ledger.verify_balances(), [])

    def test_02_parcels_valid(self):
        for zone in ("aether_city", "wakanda"):
            ps = q("SELECT * FROM land_parcels WHERE zone_id=?", (zone,))
            self.assertGreaterEqual(len(ps), 8)
            for i, a in enumerate(ps):
                for b in ps[i + 1:]:
                    self.assertTrue(a["x1"] <= b["x0"] or b["x1"] <= a["x0"] or a["z1"] <= b["z0"] or b["z1"] <= a["z0"], "overlap %s %s" % (a["code"], b["code"]))
        with self.assertRaises(Exception):                                            # duplicate code / bad geometry rejected by constraints
            run("INSERT INTO land_parcels(zone_id,code,x0,x1,z0,z1,classification) VALUES('wakanda','WK-A1',0,1,0,1,'civic')")

    def test_03_project_rules(self):
        ts = self.ts()
        restricted = q1("SELECT * FROM land_parcels WHERE zone_id='wakanda' AND permission='restricted'")
        with self.assertRaises(ValueError): cn.create_project(self.wk["id"], "house", restricted["id"], ts)       # restricted land
        aether_parcel = q1("SELECT * FROM land_parcels WHERE zone_id='aether_city' AND classification='residential'")
        with self.assertRaises(ValueError): cn.create_project(self.wk["id"], "house", aether_parcel["id"], ts)    # someone else's land
        civic = q1("SELECT * FROM land_parcels WHERE zone_id='wakanda' AND classification='residential'")
        with self.assertRaises(ValueError): cn.create_project(self.wk["id"], "clinic", civic["id"], ts)           # wrong classification

    def test_04_full_workflow_semi_autonomous(self):
        gid = self.wk["id"]
        t0 = finance.treasury(gid)
        for _ in range(3):
            engine.step(60 * 24 * 3)                               # 9 simulated days: planning, approval, contractor, construction
        projects = q("SELECT * FROM construction_projects WHERE government_id=?", (gid,))
        self.assertTrue(projects, "the government should have proposed something")
        self.assertEqual(ledger.verify_balances(), [])
        d, c = ledger.trial_balance(); self.assertEqual(d, c)
        done = [p for p in projects if p["status"] == "completed"]
        for p in projects:                                           # every project respects its rules
            if p["status"] in ("approved", "active", "completed"):
                self.assertEqual(p["reserved_minor"], p["estimated_cost_minor"])
                self.assertIsNotNone(p["approved_by"])
        pending = [p for p in projects if p["status"] == "awaiting_approval"]
        for p in projects:
            if p["status"] == "awaiting_approval":                   # semi mode: expensive projects wait for the user
                self.assertGreater(p["estimated_cost_minor"], finance.policy(gid, "auto_approve_limit_minor"))
        if done:
            p = done[0]; par = q1("SELECT * FROM land_parcels WHERE id=?", (p["parcel_id"],))
            self.assertEqual(par["status"], "developed"); self.assertEqual(par["current_building"], p["kind"])
            self.assertEqual(p["paid_minor"], p["estimated_cost_minor"])
            obj = q1("SELECT * FROM world_objects WHERE id=?", (p["object_id"],))
            self.assertEqual(obj["kind"], "civic_" + p["kind"])
            self.assertTrue(par["x0"] <= obj["x"] <= par["x1"] and par["z0"] <= obj["z"] <= par["z1"])
            self.assertEqual(q1("SELECT COUNT(*) n FROM construction_milestones WHERE project_id=? AND paid=1", (p["id"],))["n"], 5)

    def test_05_manual_requires_user_and_approve_reject(self):
        gid = self.ae["id"]
        run("UPDATE governments SET autonomy='manual' WHERE id=?", (gid,))
        ts = self.ts()
        parcel = cn.candidate_parcels(gid, "office")[0]
        pid = cn.create_project(gid, "office", parcel["id"], ts)
        self.assertIn(cn.evaluate(pid, ts), ("awaiting_approval", "awaiting_budget"))
        self.assertNotEqual(q1("SELECT status FROM construction_projects WHERE id=?", (pid,))["status"], "approved")   # manual never auto-approves
        status = q1("SELECT status FROM construction_projects WHERE id=?", (pid,))["status"]
        if status == "awaiting_approval":
            before = finance.treasury(gid)
            cn.approve(pid, "user:test", ts)
            self.assertEqual(finance.treasury(gid), before - q1("SELECT estimated_cost_minor c FROM construction_projects WHERE id=?", (pid,))["c"])   # reserved up front
            cn.cancel(pid, "user:test", ts)                                                                                                          # refund
            self.assertEqual(finance.treasury(gid), before)
        run("UPDATE governments SET autonomy='semi' WHERE id=?", (gid,))
        self.assertEqual(ledger.verify_balances(), [])

    def test_06_contractor_cannot_build_outside_parcel(self):
        gid = self.ae["id"]
        ts = self.ts()
        parcel = cn.candidate_parcels(gid, "house")[0]
        pid = cn.create_project(gid, "house", parcel["id"], ts)
        cn.approve(pid, "user:test", ts); cn.assign_contractor(pid, ts)
        run("UPDATE land_assignments SET released_ts=? WHERE project_id=?", (ts, pid))          # tamper: remove the assignment
        run("UPDATE construction_projects SET status='active' WHERE id=?", (pid,))
        cn.work(ts + 3600 * 5)
        row = q1("SELECT status, blocked_reason, progress FROM construction_projects WHERE id=?", (pid,))
        self.assertEqual(row["status"], "blocked"); self.assertEqual(row["progress"], 0)
        cn.cancel(pid, "user:test", ts)

    def test_07_clock_and_citizen_routines(self):
        run("UPDATE world_clocks SET sim_ts=? WHERE id='global'", ((clock.glob()["sim_ts"] // clock.DAY + 1) * clock.DAY + 7 * clock.HOUR,))   # 07:00 Aether
        pa = {p["id"]: p for p in citizens.positions("aether_city")}
        self.assertTrue(any(p["activity"] == "commuting" for p in pa.values()))
        pw = citizens.positions("wakanda")                                                      # Wakanda is 7 h ahead: 14:00 local
        self.assertTrue(any(p["activity"] == "working" for p in pw))
        self.assertTrue(all(p["activity"] in ("working", "resting", "sleeping", "leisure", "commuting", "commuting_home") for p in pw))

    def test_08_trade_once_per_period_and_fx(self):
        ts = (self.ts() // (7 * clock.DAY) + 2) * 7 * clock.DAY          # a period that has not been delivered yet
        ag = q1("SELECT * FROM trade_agreements WHERE seller_government_id=?", (self.wk["id"],))
        n0 = q1("SELECT COUNT(*) n FROM intergovernmental_trades")["n"]
        trade.settle(ts); trade.settle(ts); trade.settle(ts + 3600)                              # same period three times
        self.assertEqual(q1("SELECT COUNT(*) n FROM intergovernmental_trades")["n"], n0 + q1("SELECT COUNT(*) n FROM trade_agreements WHERE status='active'")["n"])    # every agreement delivered exactly once
        tr = q1("SELECT * FROM intergovernmental_trades WHERE agreement_id=?", (ag["id"],))
        self.assertEqual(tr["buyer_amount_minor"], finance.convert(tr["seller_amount_minor"], self.wk["id"], self.ae["id"]))
        self.assertEqual(ledger.verify_balances(), [])

    def test_09_finance_reports_and_reversal(self):
        s = finance.summary(self.wk["id"], self.ts())
        self.assertGreater(s["revenue_minor"], 0); self.assertGreater(s["expenses_minor"], 0)
        self.assertTrue(s["budgets"])
        t = q1("SELECT id FROM government_transactions WHERE kind='revenue:resources' AND status='posted' AND reversed_of IS NULL AND government_id=? ORDER BY id DESC LIMIT 1", (self.wk["id"],))
        before = finance.treasury(self.wk["id"])
        ledger.reverse(t["id"], self.ts(), "audit")
        self.assertLess(finance.treasury(self.wk["id"]), before)
        self.assertEqual(ledger.verify_balances(), [])

    def test_10_engine_resumable_no_double_processing(self):
        g = clock.glob()
        run("UPDATE world_clocks SET sim_ts=processed_ts+600 WHERE id='global'")
        a = engine.process(4); b = engine.process(100); c = engine.process(100)
        self.assertEqual((a, b, c), (4, 6, 0))                                                   # resumes where it stopped, then nothing left
        self.assertEqual(clock.glob()["processed_ts"], clock.glob()["sim_ts"])

    def test_11_long_run_invariants(self):
        for _ in range(10):
            engine.step(60 * 24 * 3)                                                   # 30 more simulated days
        d, c = ledger.trial_balance(); self.assertEqual(d, c)                          # every journal still balances
        self.assertEqual(ledger.verify_balances(), [])
        self.assertEqual(q1("SELECT COUNT(*) n FROM government_accounts WHERE type='asset' AND balance_minor<0")["n"], 0)
        self.assertEqual(q1("SELECT COUNT(*) n FROM civilization_events WHERE kind='wages_unpaid'")["n"], 0)
        self.assertEqual(q1("SELECT COUNT(*) n FROM (SELECT ref FROM government_transactions GROUP BY ref HAVING COUNT(*)>1)")["n"], 0)   # no duplicate postings
        for p in q("SELECT * FROM construction_projects WHERE status='completed'"):
            self.assertEqual(p["paid_minor"], p["estimated_cost_minor"])


class MapGrowth(unittest.TestCase):
    """New land and connected roads (run after Civ so the shared DB exists)."""
    @classmethod
    def setUpClass(cls):
        create_app(start_sim=False)
        cls.ae = q1("SELECT * FROM governments WHERE zone_id='aether_city'")
        finance.grant(cls.ae["id"], 10 ** 9, clock.glob()["sim_ts"])

    def test_expand_adds_six_parcels_and_charges_treasury(self):
        before = finance.treasury(self.ae["id"])
        codes = cn.expand_territory(self.ae["id"], "north", clock.glob()["sim_ts"])
        self.assertEqual(len(codes), 6)
        self.assertEqual(before - finance.treasury(self.ae["id"]), cn.LAND_PRICE * 6 * M)
        self.assertEqual(ledger.verify_balances(), [])

    def test_road_completes_and_connects_graph(self):
        from services import world_manager as world
        ts = clock.glob()["sim_ts"]
        pid = cn.create_road(self.ae["id"], "e", "east", 200, ts)
        if cn.evaluate(pid, ts) != "approved":                    # semi-autonomous governments wait for the administrator
            cn.approve(pid, "test", ts)
        for _ in range(30):
            engine.step(1440)
            if q1("SELECT status FROM construction_projects WHERE id=?", (pid,))["status"] == "completed":
                break
        self.assertEqual(q1("SELECT status FROM construction_projects WHERE id=?", (pid,))["status"], "completed")
        g = world.graph("aether_city")
        node = [k for k in g["nodes"] if k.startswith("rd")][-1]
        self.assertIn(node, g["adj"]["e"])                       # joined to the waypoint it started from
        with self.assertRaises(ValueError):
            cn.create_road(self.ae["id"], "e", "east", 500, clock.glob()["sim_ts"])


class MarsColony(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        create_app(start_sim=False)

    def test_layout_is_clean_and_has_parcels(self):
        from services import zone_mars
        objs, meta = zone_mars.generate()
        self.assertEqual(zone_mars.validate(meta), [])
        self.assertEqual(len(zone_mars.pick_parcels(meta)), 12)

    def test_government_agents_and_life_support(self):
        from services.civ import mars_life
        g = q1("SELECT * FROM governments WHERE zone_id='mars'")
        self.assertEqual((g["currency_code"], g["gov_type"]), ("MC", "Colonial Administration"))
        self.assertTrue(q1("SELECT 1 FROM agents WHERE name='Commander Elias' AND zone='mars'"))
        self.assertTrue(q1("SELECT 1 FROM agents WHERE name='MX-07' AND outfit_variant='mars_robot'"))
        st = mars_life.status("mars")
        self.assertEqual(set(st["levels"]), {"oxygen", "water", "energy", "food"})
        self.assertTrue(all(0 <= v <= 100 for v in st["levels"].values()))


if __name__ == "__main__":
    unittest.main()


class CivApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = create_app(start_sim=False).test_client()
        import json as _j
        from config import Config
        cls.H = {"X-Requested-With": "XMLHttpRequest", "Content-Type": "application/json"}
        cls.A = dict(cls.H, **{"X-Admin-Token": Config.ADMIN_TOKEN})

    def test_read_endpoints(self):
        for u in ("/api/civilization/clock", "/api/civilization/governments", "/api/civilization/governments/1", "/api/civilization/governments/2/finance",
                  "/api/civilization/governments/1/transactions", "/api/civilization/zones/wakanda/parcels", "/api/civilization/zones/aether_city/sites",
                  "/api/civilization/zones/wakanda/citizens", "/api/civilization/zones/wakanda/civilization", "/api/civilization/contractors", "/api/civilization/trade", "/api/civilization/events"):
            r = self.c.get(u); self.assertEqual(r.status_code, 200, u); self.assertTrue(r.json["ok"], u)

    def test_admin_controls_need_token(self):
        for u, b in (("/api/civilization/clock", {"speed": 24}), ("/api/civilization/sim/step", {"minutes": 5}), ("/api/civilization/governments/1/autonomy", {"mode": "auto"})):
            self.assertEqual(self.c.post(u, json=b, headers=self.H).status_code, 401, u)
        r = self.c.post("/api/civilization/governments/1/autonomy", json={"mode": "bogus"}, headers=self.A); self.assertEqual(r.status_code, 422)
        r = self.c.post("/api/civilization/clock", json={"speed": 24, "zone": {"id": "wakanda", "tz_offset_min": 360}}, headers=self.A)
        self.assertEqual(r.json["data"]["speed"], 24); self.assertEqual({z["zone_id"]: z["tz_offset_min"] for z in r.json["data"]["zones"]}["wakanda"], 360)
        self.c.post("/api/civilization/clock", json={"speed": 60, "zone": {"id": "wakanda", "tz_offset_min": 420}}, headers=self.A)

    def test_propose_approve_via_api(self):
        r = self.c.post("/api/civilization/governments/1/propose", json={"kind": "house", "parcel": "WK-A1"}, headers=self.A); self.assertEqual(r.status_code, 422)   # not their land
        gid = 1
        from services.civ import construction as cn2
        code = cn2.candidate_parcels(gid, "house")[0]["code"]
        r = self.c.post("/api/civilization/governments/1/propose", json={"kind": "house", "parcel": code}, headers=self.A); self.assertEqual(r.status_code, 201)
        pid = r.json["data"]["project_id"]
        st = q1("SELECT status FROM construction_projects WHERE id=?", (pid,))["status"]
        if st == "awaiting_approval":
            self.assertEqual(self.c.post("/api/civilization/projects/%d/approve" % pid, headers=self.A).status_code, 200)
        self.assertEqual(self.c.post("/api/civilization/projects/%d/cancel" % pid, headers=self.A).status_code, 200)
        self.assertEqual(self.c.post("/api/civilization/projects/%d/cancel" % pid, headers=self.A).status_code, 409)   # cannot cancel twice


class Pandora(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = create_app(start_sim=False).test_client()
        cls.pd = q1("SELECT * FROM governments WHERE zone_id='pandora'")

    def test_layout_valid_and_deterministic(self):
        from services import zone_pandora as zp
        a, ma = zp.generate(); b, mb = zp.generate()
        self.assertEqual(a, b); self.assertEqual(zp.validate(ma), [])
        ps = zp.pick_parcels(ma); self.assertEqual(len(ps), 12)
        for i, (x, z) in enumerate(ps):
            for (x2, z2) in ps[i + 1:]:
                self.assertTrue(x + 16 <= x2 or x2 + 16 <= x or z + 16 <= z2 or z2 + 16 <= z)

    def test_zone_and_government_installed(self):
        self.assertEqual((self.pd["currency_code"], self.pd["gov_type"], self.pd["autonomy"]), ("PC", "Tribal Confederation", "semi"))
        self.assertEqual(q1("SELECT COUNT(*) n FROM government_departments WHERE government_id=?", (self.pd["id"],))["n"], 7)
        self.assertGreaterEqual(q1("SELECT COUNT(*) n FROM citizens WHERE zone_id='pandora'")["n"], 30)
        self.assertEqual(q1("SELECT COUNT(*) n FROM land_parcels WHERE zone_id='pandora'")["n"], 12)
        self.assertEqual(q1("SELECT COUNT(*) n FROM agents WHERE zone='pandora' AND outfit_variant='pandora_tribal'")["n"], 8)
        objs = self.c.get("/api/world/zones/pandora/objects").json["data"]
        self.assertGreater(len(objs), 60); self.assertTrue({"hometree", "floating_island", "dock", "organic_hut"} <= {o["kind"] for o in objs})
        self.assertEqual(ledger.balance(finance.gacct(self.pd["id"], "equity")), 7_200_000 * M)   # opening capital (the treasury itself moves with the shared test simulation)
        self.assertEqual(ledger.verify_balances(), [])

    def test_travel_and_clock(self):
        H = {"X-Requested-With": "XMLHttpRequest", "Content-Type": "application/json"}
        r = self.c.post("/api/world/travel", json={"zone_id": "pandora"}, headers=H).json["data"]
        self.assertEqual((r["zone"]["id"], r["position"]["z"]), ("pandora", 44))
        zones = {z["zone_id"]: z for z in clock.snapshot()["zones"]}
        self.assertEqual(zones["pandora"]["tz_offset_min"], -300)

    def test_construction_in_pandora_workflow(self):
        gid = self.pd["id"]; ts = clock.glob()["sim_ts"]
        parcel = cn.candidate_parcels(gid, "house")[0]
        pid = cn.create_project(gid, "house", parcel["id"], ts)
        run("UPDATE governments SET autonomy='manual' WHERE id=?", (gid,)); cn.evaluate(pid, ts)
        cn.approve(pid, "user:test", ts); cn.assign_contractor(pid, ts)
        self.assertIn(q1("SELECT c.name FROM construction_projects p JOIN construction_contractors c ON c.id=p.contractor_id WHERE p.id=?", (pid,))["name"], ("Pandora Grove Builders", "Reef & Root Co"))
        for _ in range(3): engine.step(60 * 24 * 3)
        self.assertEqual(q1("SELECT status FROM construction_projects WHERE id=?", (pid,))["status"], "completed")
        self.assertEqual(q1("SELECT kind FROM world_objects WHERE id=(SELECT object_id FROM construction_projects WHERE id=?)", (pid,))["kind"], "civic_house")
        d, c = ledger.trial_balance(); self.assertEqual(d, c)
        run("UPDATE governments SET autonomy='semi' WHERE id=?", (gid,))
