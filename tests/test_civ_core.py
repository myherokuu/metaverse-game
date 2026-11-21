"""Clock + ledger tests (own temp DB)."""
import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "civ_core.db")

from database import db  # noqa: E402
from services.civ import clock, ledger  # noqa: E402
from app import create_app  # noqa: E402


class Core(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        create_app(start_sim=False)

    def test_clock_advance_and_no_double_on_restart(self):
        db.run("UPDATE world_clocks SET sim_ts=1000, carry=0, speed=60, running=1, last_real_ts=100 WHERE id='global'")
        self.assertEqual(clock.advance(now=102.0), 120)                       # 2 s x 60
        self.assertEqual(clock.advance(now=102.5), 30)
        self.assertEqual(clock.glob()["sim_ts"], 1150)
        clock.advance(now=1_000_000.0)                                        # a huge gap (downtime) is clamped, not credited
        self.assertEqual(clock.glob()["sim_ts"], 1150 + int(5 * 60))
        clock.resume(now=2_000_000.0)                                         # worker restart: downtime ignored
        self.assertEqual(clock.advance(now=2_000_001.0), 60)
        clock.set_speed(running=False)
        t = clock.glob()["sim_ts"]; clock.advance(now=2_000_100.0)
        self.assertEqual(clock.glob()["sim_ts"], t)                           # paused: nothing advances
        clock.set_speed(running=True)

    def test_zone_local_time(self):
        db.run("UPDATE world_clocks SET sim_ts=? WHERE id='global'", (3 * clock.DAY + 12 * clock.HOUR,))
        self.assertAlmostEqual(clock.local_hour("aether_city"), 12.0)
        self.assertAlmostEqual(clock.local_hour("wakanda"), 19.0)             # +7 h
        snap = {z["zone_id"]: z for z in clock.snapshot()["zones"]}
        self.assertTrue(snap["aether_city"]["is_day"]); self.assertFalse(snap["wakanda"]["is_day"])

    def test_ledger_double_entry_idempotent_reverse(self):
        a = ledger.account("citizen", 9001, "cash", "A cash", "asset", "AC")
        b = ledger.account("citizen", 9002, "cash", "B cash", "asset", "AC")
        eq = ledger.account("citizen", 9001, "equity", "Opening", "equity", "AC")
        ledger.post("t:open", "opening", [(a, "D", 10000), (eq, "C", 10000)], 1)
        t = ledger.post("t:pay1", "payment", [(b, "D", 2500), (a, "C", 2500)], 2)
        self.assertEqual(ledger.post("t:pay1", "payment", [(b, "D", 2500), (a, "C", 2500)], 2), t)   # same ref -> same txn, no 2nd payment
        self.assertEqual((ledger.balance(a), ledger.balance(b)), (7500, 2500))
        with self.assertRaises(ledger.LedgerError): ledger.post("t:bad", "x", [(a, "D", 5), (b, "C", 4)], 3)           # unbalanced
        with self.assertRaises(ledger.LedgerError): ledger.post("t:over", "x", [(b, "D", 99999), (a, "C", 99999)], 3)   # negative balance
        self.assertEqual(ledger.balance(a), 7500)                                                                      # failed post left no trace
        ledger.reverse(t, 4, "test")
        self.assertEqual((ledger.balance(a), ledger.balance(b)), (10000, 0))
        with self.assertRaises(ledger.LedgerError): ledger.reverse(t, 5)                                                # cannot reverse twice
        d, c = ledger.trial_balance(); self.assertEqual(d, c)
        self.assertEqual(ledger.verify_balances(), [])


    def test_failed_nested_journal_leaves_no_partial_entries(self):
        a = ledger.account("citizen", 9101, "cash", "X", "asset", "AC"); b = ledger.account("citizen", 9102, "cash", "Y", "asset", "AC")
        eq = ledger.account("citizen", 9101, "equity", "E", "equity", "AC"); ledger.post("n:open", "o", [(a, "D", 100), (eq, "C", 100)], 1)
        n0 = db.q1("SELECT COUNT(*) n FROM ledger_entries")["n"]
        with db.tx():                                       # an outer transaction (like the engine's minute)
            try:
                with db.tx():
                    ledger.post("n:bad", "x", [(b, "D", 500), (a, "C", 500)], 2)      # fails on the second line: insufficient funds
            except ledger.LedgerError:
                pass
            ledger.post("n:ok", "x", [(b, "D", 10), (a, "C", 10)], 3)                 # the outer work still proceeds
        self.assertEqual(db.q1("SELECT COUNT(*) n FROM ledger_entries")["n"], n0 + 2)
        d, c = ledger.trial_balance(); self.assertEqual(d, c)
        self.assertEqual(ledger.verify_balances(), [])


if __name__ == "__main__":
    unittest.main()
