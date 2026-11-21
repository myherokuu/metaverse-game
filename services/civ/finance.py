"""Government finance on top of the ledger: fiscal periods, budgets, revenue/expense recording, FX, summaries."""
import json

from database.db import q, q1, run, tx
from services.civ import clock, ledger
from services.civ.ledger import MINOR

CATEGORIES = ("construction", "research", "public_services", "security")
REV_ACCOUNTS = {"income_tax": "Income tax", "sales_tax": "Sales tax", "business_tax": "Business tax", "resources": "Natural resources",
                "trade": "Trade revenue", "enterprise": "State enterprise profit"}
EXP_ACCOUNTS = {"construction": "Construction", "wages": "Public wages", "research": "Research", "public_services": "Public services",
                "security": "Security", "maintenance": "Infrastructure maintenance", "trade": "Trade purchases"}


def policy(gov_id, key, default=None):
    r = q1("SELECT value FROM government_policies WHERE government_id=? AND key=?", (gov_id, key))
    return json.loads(r["value"]) if r else default


def set_policy(gov_id, key, value, description=""):
    run("INSERT INTO government_policies(government_id,key,value,description) VALUES(?,?,?,?) ON CONFLICT(government_id,key) DO UPDATE SET value=excluded.value",
        (gov_id, key, json.dumps(value), description))


def gov(gov_id):
    return q1("SELECT * FROM governments WHERE id=?", (gov_id,))


def gacct(gov_id, code):
    """Government account by short code, created on first use."""
    g = gov(gov_id)
    names = {"treasury": ("Treasury cash", "asset"), "escrow": ("Project escrow", "asset"), "equity": ("Opening equity", "equity")}
    names.update({"rev_" + k: (v, "revenue") for k, v in REV_ACCOUNTS.items()}); names.update({"exp_" + k: (v + " expense", "expense") for k, v in EXP_ACCOUNTS.items()})
    n, t = names[code]
    return ledger.account("government", gov_id, code, n, t, g["currency_code"], gov_id, allow_negative=0)


def period_for(gov_id, sim_ts):
    """Open fiscal period (a 30-day sim month) containing sim_ts; created with its budgets on first use. The period is keyed on
    GLOBAL sim time so every government closes its months together."""
    month = sim_ts // (30 * clock.DAY)
    label = "%04d-M%02d" % (2100 + month // 12, month % 12 + 1)
    with tx() as c:
        p = c.execute("SELECT * FROM government_fiscal_periods WHERE government_id=? AND label=?", (gov_id, label)).fetchone()
        if p:
            return dict(p)
        c.execute("UPDATE government_fiscal_periods SET status='closed' WHERE government_id=? AND status='open'", (gov_id,))
        pid = c.execute("INSERT INTO government_fiscal_periods(government_id,label,start_ts,end_ts) VALUES(?,?,?,?)",
                        (gov_id, label, month * 30 * clock.DAY, (month + 1) * 30 * clock.DAY)).lastrowid
        shares, total = policy(gov_id, "budget_shares", {}), policy(gov_id, "monthly_budget_minor", 0)
        for cat in CATEGORIES:
            c.execute("INSERT INTO government_budgets(government_id,period_id,category,allocated_minor) VALUES(?,?,?,?)", (gov_id, pid, cat, int(total * shares.get(cat, 0))))
        return dict(c.execute("SELECT * FROM government_fiscal_periods WHERE id=?", (pid,)).fetchone())


def budget(gov_id, category, sim_ts):
    p = period_for(gov_id, sim_ts)
    return q1("SELECT * FROM government_budgets WHERE period_id=? AND category=?", (p["id"], category))


def available(gov_id, category, sim_ts):
    b = budget(gov_id, category, sim_ts)
    return (b["allocated_minor"] - b["committed_minor"] - b["spent_minor"]) if b else 0


def record_revenue(gov_id, source, amount, ref, sim_ts, memo=""):
    if amount <= 0:
        return None
    p = period_for(gov_id, sim_ts)
    with tx() as c:
        t = ledger.post(ref, "revenue:" + source, [(gacct(gov_id, "treasury"), "D", amount), (gacct(gov_id, "rev_" + source), "C", amount)], sim_ts, gov_id, memo or REV_ACCOUNTS[source])
        if not c.execute("SELECT 1 FROM government_revenues WHERE transaction_id=?", (t,)).fetchone():
            c.execute("INSERT INTO government_revenues(government_id,period_id,source,amount_minor,transaction_id,sim_ts) VALUES(?,?,?,?,?,?)", (gov_id, p["id"], source, amount, t, sim_ts))
        return t


def record_expense(gov_id, category, amount, ref, sim_ts, memo="", project_id=None, from_account="treasury", budget_cat=None):
    """Expense paid from `from_account` (treasury or project escrow). Budget 'spent' is updated for budget categories."""
    if amount <= 0:
        return None
    p = period_for(gov_id, sim_ts)
    with tx() as c:
        t = ledger.post(ref, "expense:" + category, [(gacct(gov_id, "exp_" + category), "D", amount), (gacct(gov_id, from_account), "C", amount)], sim_ts, gov_id, memo or category)
        if not c.execute("SELECT 1 FROM government_expenses WHERE transaction_id=?", (t,)).fetchone():
            c.execute("INSERT INTO government_expenses(government_id,period_id,category,amount_minor,transaction_id,project_id,sim_ts) VALUES(?,?,?,?,?,?,?)", (gov_id, p["id"], category, amount, t, project_id, sim_ts))
            bc = budget_cat or (category if category in CATEGORIES else None)
            if bc:
                c.execute("UPDATE government_budgets SET spent_minor=spent_minor+? WHERE period_id=? AND category=?", (amount, p["id"], bc))
        return t


def grant(gov_id, amount, sim_ts, ref=None):
    """Administrator top-up: `amount` (whole credits) is added to the treasury (Dr treasury / Cr opening equity, so the books still balance)
    and to this month's category budgets pro rata, and the monthly budget policy is raised so later months have it too."""
    import time
    amt = int(amount) * MINOR
    if amt <= 0 or amt > 10 ** 16:
        raise ValueError("amount must be a positive whole number of credits (max 100 trillion)")
    shares, p = policy(gov_id, "budget_shares", {}), period_for(gov_id, sim_ts)
    with tx() as c:
        t = ledger.post(ref or "grant:%d:%d" % (gov_id, time.time_ns()), "grant", [(gacct(gov_id, "treasury"), "D", amt), (gacct(gov_id, "equity"), "C", amt)],
                        sim_ts, gov_id, "Administrator treasury grant")
        for cat in CATEGORIES:
            c.execute("UPDATE government_budgets SET allocated_minor=allocated_minor+? WHERE period_id=? AND category=?", (int(amt * shares.get(cat, 0)), p["id"], cat))
        set_policy(gov_id, "monthly_budget_minor", max(policy(gov_id, "monthly_budget_minor", 0), amt), "raised by administrator grant")
    return t


def convert(amount_minor, from_gov, to_gov):
    """Convert between fictional currencies through the common base unit (integer arithmetic, rounded)."""
    a, b = gov(from_gov), gov(to_gov)
    return int(round(amount_minor * a["fx_to_base"] / b["fx_to_base"]))


def treasury(gov_id):
    return ledger.balance(gacct(gov_id, "treasury"))


def summary(gov_id, sim_ts):
    p = period_for(gov_id, sim_ts)
    rev = q("SELECT source, SUM(amount_minor) a FROM government_revenues WHERE government_id=? AND period_id=? GROUP BY source", (gov_id, p["id"]))
    exp = q("SELECT category, SUM(amount_minor) a FROM government_expenses WHERE government_id=? AND period_id=? GROUP BY category", (gov_id, p["id"]))
    hist = q("SELECT p.label, COALESCE((SELECT SUM(amount_minor) FROM government_revenues r WHERE r.period_id=p.id),0) rev, "
             "COALESCE((SELECT SUM(amount_minor) FROM government_expenses e WHERE e.period_id=p.id),0) exp FROM government_fiscal_periods p "
             "WHERE p.government_id=? ORDER BY p.start_ts DESC LIMIT 12", (gov_id,))
    return {"currency": gov(gov_id)["currency_code"], "treasury_minor": treasury(gov_id), "escrow_minor": ledger.balance(gacct(gov_id, "escrow")),
            "period": p["label"], "revenue_minor": sum(r["a"] for r in rev), "expenses_minor": sum(e["a"] for e in exp),
            "revenue_by_source": {r["source"]: r["a"] for r in rev}, "expenses_by_category": {e["category"]: e["a"] for e in exp},
            "budgets": q("SELECT category, allocated_minor, committed_minor, spent_minor FROM government_budgets WHERE period_id=?", (p["id"],)),
            "history": list(reversed(hist))}
