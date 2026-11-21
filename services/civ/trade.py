"""Trade between governments: agreements are delivered once per period (UNIQUE agreement+period), paid in each side's own currency."""
from database.db import q, q1, run, tx
from services.civ import clock, events, finance, ledger
from services.civ.ledger import LedgerError


def create_agreement(seller, buyer, resource, quantity, unit_price_minor, period_days, ts, by="finance_ministries"):
    if seller == buyer or quantity <= 0 or unit_price_minor <= 0 or not 1 <= period_days <= 90:
        raise ValueError("invalid agreement")
    return run("INSERT INTO trade_agreements(seller_government_id,buyer_government_id,resource,quantity,unit_price_minor,period_days,created_ts,approved_by) VALUES(?,?,?,?,?,?,?,?)",
               (seller, buyer, resource[:80], int(quantity), int(unit_price_minor), int(period_days), ts, by)).lastrowid


def settle(ts):
    """Deliver every active agreement whose period has started. Safe to call repeatedly."""
    done = 0
    for a in q("SELECT * FROM trade_agreements WHERE status='active'"):
        key = str(ts // (a["period_days"] * clock.DAY))
        if q1("SELECT 1 FROM intergovernmental_trades WHERE agreement_id=? AND period_key=?", (a["id"], key)):
            continue
        s_amt = a["quantity"] * a["unit_price_minor"]
        b_amt = finance.convert(s_amt, a["seller_government_id"], a["buyer_government_id"])
        s, b = finance.gov(a["seller_government_id"]), finance.gov(a["buyer_government_id"])
        if s["status"] != "active" or b["status"] != "active":
            continue
        try:
            with tx() as c:
                tb = finance.record_expense(b["id"], "trade", b_amt, "trade:%d:%s:b" % (a["id"], key), ts, "Purchase: %s from %s" % (a["resource"], s["name"]))
                ts_ = finance.record_revenue(s["id"], "trade", s_amt, "trade:%d:%s:s" % (a["id"], key), ts, "Sale: %s to %s" % (a["resource"], b["name"]))
                c.execute("INSERT INTO intergovernmental_trades(agreement_id,period_key,quantity,seller_amount_minor,buyer_amount_minor,sim_ts,seller_txn_id,buyer_txn_id) VALUES(?,?,?,?,?,?,?,?)",
                          (a["id"], key, a["quantity"], s_amt, b_amt, ts, ts_, tb))
            events.emit(s["zone_id"], s["id"], "trade_settled", "%s delivered %d x %s to %s" % (s["name"], a["quantity"], a["resource"], b["name"]), ts)
            events.emit(b["zone_id"], b["id"], "trade_settled", "%s received %d x %s from %s" % (b["name"], a["quantity"], a["resource"], s["name"]), ts)
            done += 1
        except LedgerError as e:
            events.emit(b["zone_id"], b["id"], "trade_failed", "Trade for %s failed: %s" % (a["resource"], e), ts)
    return done
