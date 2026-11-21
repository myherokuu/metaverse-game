"""Double-entry ledger. Amounts are integer minor units (1 credit = 100). Every journal balances; a `ref` posts exactly once;
asset accounts cannot go negative unless flagged. Each party (government, contractor, citizen, business) keeps its own books,
so cross-party payments are two balanced journals posted atomically (see pay())."""
from database.db import q, q1, tx

MINOR = 100


class LedgerError(Exception):
    pass


_SIGN = {"asset": 1, "expense": 1, "liability": -1, "equity": -1, "revenue": -1}   # balance = sign * (debits - credits)


def account(owner_type, owner_id, code, name, type_, currency, government_id=None, allow_negative=0):
    with tx() as c:
        r = c.execute("SELECT id FROM government_accounts WHERE owner_type=? AND owner_id=? AND code=?", (owner_type, owner_id, code)).fetchone()
        if r:
            return r[0]
        return c.execute("INSERT INTO government_accounts(government_id,owner_type,owner_id,code,name,type,currency,allow_negative) VALUES(?,?,?,?,?,?,?,?)",
                         (government_id, owner_type, owner_id, code, name, type_, currency, allow_negative)).lastrowid


def acct(owner_type, owner_id, code):
    r = q1("SELECT id FROM government_accounts WHERE owner_type=? AND owner_id=? AND code=?", (owner_type, owner_id, code))
    if not r:
        raise LedgerError("no such account %s/%s/%s" % (owner_type, owner_id, code))
    return r["id"]


def balance(account_id):
    return q1("SELECT balance_minor b FROM government_accounts WHERE id=?", (account_id,))["b"]


def post(ref, kind, lines, sim_ts, government_id=None, memo="", reversed_of=None):
    """lines = [(account_id, 'D'|'C', amount_minor)]. Returns the transaction id (the existing one if `ref` was already posted)."""
    if not lines:
        raise LedgerError("empty journal")
    d = c_ = 0
    for _, side, amt in lines:
        if side not in ("D", "C") or not isinstance(amt, int) or amt <= 0:
            raise LedgerError("lines need side D|C and a positive integer amount")
        d, c_ = (d + amt, c_) if side == "D" else (d, c_ + amt)
    if d != c_:
        raise LedgerError("unbalanced journal (debits %d != credits %d)" % (d, c_))
    with tx() as c:
        ex = c.execute("SELECT id FROM government_transactions WHERE ref=?", (ref,)).fetchone()
        if ex:
            return ex[0]                                   # idempotent: never a duplicate payment
        tid = c.execute("INSERT INTO government_transactions(ref,government_id,kind,memo,sim_ts,reversed_of) VALUES(?,?,?,?,?,?)",
                        (ref, government_id, kind, memo[:200], sim_ts, reversed_of)).lastrowid
        for aid, side, amt in lines:
            a = c.execute("SELECT type,balance_minor,allow_negative,name FROM government_accounts WHERE id=?", (aid,)).fetchone()
            if not a:
                raise LedgerError("unknown account %s" % aid)
            nb = a["balance_minor"] + _SIGN[a["type"]] * (amt if side == "D" else -amt)
            if nb < 0 and not a["allow_negative"] and a["type"] in ("asset", "liability"):
                raise LedgerError("insufficient funds in '%s' (%d < %d)" % (a["name"], a["balance_minor"], amt))
            c.execute("UPDATE government_accounts SET balance_minor=? WHERE id=?", (nb, aid))
            c.execute("INSERT INTO ledger_entries(transaction_id,account_id,debit_minor,credit_minor) VALUES(?,?,?,?)",
                      (tid, aid, amt if side == "D" else 0, amt if side == "C" else 0))
        return tid


def reverse(txn_id, sim_ts, reason="reversal"):
    """Post the mirror image of a journal and mark the original reversed. Fails (and changes nothing) if funds are missing."""
    with tx() as c:
        t = c.execute("SELECT * FROM government_transactions WHERE id=?", (txn_id,)).fetchone()
        if not t:
            raise LedgerError("unknown transaction")
        if t["status"] != "posted" or t["reversed_of"] is not None:
            raise LedgerError("only an original posted transaction can be reversed")
        lines = [(e["account_id"], "C" if e["debit_minor"] else "D", e["debit_minor"] or e["credit_minor"])
                 for e in c.execute("SELECT * FROM ledger_entries WHERE transaction_id=?", (txn_id,)).fetchall()]
        rid = post("rev:%d" % txn_id, "reversal", lines, sim_ts, t["government_id"], "%s of #%d: %s" % ("reversal", txn_id, reason), reversed_of=txn_id)
        c.execute("UPDATE government_transactions SET status='reversed' WHERE id=?", (txn_id,))
        return rid


def trial_balance():
    """Invariant: total debits == total credits across the whole ledger."""
    r = q1("SELECT COALESCE(SUM(debit_minor),0) d, COALESCE(SUM(credit_minor),0) c FROM ledger_entries")
    return r["d"], r["c"]


def verify_balances():
    """Recompute every account balance from its journal lines; returns accounts whose stored balance is wrong."""
    bad = []
    for a in q("SELECT id,type,balance_minor FROM government_accounts"):
        e = q1("SELECT COALESCE(SUM(debit_minor),0) d, COALESCE(SUM(credit_minor),0) c FROM ledger_entries WHERE account_id=?", (a["id"],))
        if _SIGN[a["type"]] * (e["d"] - e["c"]) != a["balance_minor"]:
            bad.append(a["id"])
    return bad
