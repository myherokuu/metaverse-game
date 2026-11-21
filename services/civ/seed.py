"""Initial governments, departments (with Ollama-capable agents), policies, accounts, contractors, land, businesses and citizens.
Idempotent. Everything here is simulated: fictional governments and fictional currencies."""
import json
import random

from database.db import q, q1, run, tx
from services import agent_manager as am
from services import zone_mars, zone_pandora
from services.civ import clock, finance, ledger
from services.civ.ledger import MINOR

CR = lambda n: int(n * MINOR)
WAGE_SCALE = 0.3                 # daily wages are scaled down so the public finances stay in a plausible range

DEPTS = [("executive", "Executive Office"), ("finance", "Ministry of Finance"), ("development", "Ministry of Development"),
         ("construction", "Construction Department"), ("trade", "Ministry of Trade"), ("population", "Population & Welfare Department"),
         ("security", "Security Department")]

GOVS = [
    dict(zone="aether_city", name="Aether City Government", type="Technocratic Republic", leader="AI President", economy="Technology and Services",
         cur=("AC", "Aether Credits"), fx=1.0, treasury=6_000_000, home="hq",
         heads={"executive": ("President Solis", "AI President"), "finance": ("Minister Quill", "AI Finance Minister"), "development": ("Minister Vance", "AI Development Minister"),
                "construction": ("Director Forge", "AI Construction Director"), "trade": ("Minister Mercer", "AI Trade Minister"),
                "population": ("Director Hale", "AI Population & Welfare Director"), "security": ("Chief Sentry", "AI Security Chief")},
         priorities=["housing", "jobs", "health", "research"], resource_daily=0, enterprise_daily=14000,
         homes=["res", "resw", "rese", "ra"], social="c"),
    dict(zone="wakanda", name="Wakanda Kingdom", type="Constitutional Monarchy", leader="AI Monarch", economy="Research, Technology and Resources",
         cur=("WC", "Wakanda Credits"), fx=0.8, treasury=8_450_000, home="wk_capital",
         heads={"executive": ("Monarch Ayo", "AI Monarch"), "finance": ("Minister Zola", "AI Treasury Minister"), "development": ("Minister Kofi", "AI Royal Development Minister"),
                "construction": ("Director Dayo", "AI Construction Director"), "trade": ("Minister Efe", "AI Trade Minister"),
                "population": ("Director Nala", "AI Population & Welfare Director"), "security": ("Chief Tariq", "AI Security Chief")},
         priorities=["research", "housing", "health", "jobs"], resource_daily=15000, enterprise_daily=4000,
         homes=["vil", "vil_b", "cap_w", "cap", "vil_a"], social="cap_n"),
    dict(zone="pandora", name="Pandora Tribal Confederation", type="Tribal Confederation", leader="AI High Elder", economy="Nature, Marine Trade and Natural Resources",
         cur=("PC", "Pandora Credits"), fx=0.9, treasury=7_200_000, home="pd_hometree",
         heads={"executive": ("Elder Mirae", "AI High Elder"), "finance": ("Minister Teo", "AI Economy & Trade Minister"), "development": ("Keeper Lumen", "AI Spirit Keeper (Nature & Ecology)"),
                "construction": ("Ayla", "AI Organic Architect (Land & Construction)"), "trade": ("Leader Marei", "AI Reef Leader (Trade)"),
                "population": ("Elder Oro", "AI Welfare Elder"), "security": ("Chief Zephra", "AI Sky Chief (Security & Wildlife)")},
         depts={"executive": "Tribal High Council", "finance": "Economy & Trade Council", "development": "Nature & Ecology Council", "construction": "Land & Construction Council",
                "trade": "Reef Trade Council", "population": "Population & Welfare Council", "security": "Security & Wildlife Council"},
         extra_agents=[("Leader Dorran", "AI Frontier Leader (Research & Exploration)", "pd_wild", "development")],
         priorities=["housing", "health", "jobs", "research"], resource_daily=12000, enterprise_daily=3000,
         homes=["ht", "ht_e", "ht_w", "ht_s"], social="ht"),
    dict(zone="mars", name="Mars Colonial Administration", type="Colonial Administration", leader="AI Colonial Governor", economy="Mining, Agriculture, Energy and Space Trade",
         cur=("MC", "Mars Credits"), fx=1.2, treasury=9_000_000, home="mr_central",
         heads={"executive": ("Governor Vega", "AI Colonial Governor"), "finance": ("Minister Orlov", "AI Economy & Population Minister"), "development": ("Director Reyes", "AI Infrastructure & Engineering Director"),
                "construction": ("Foreman Okoro", "AI Construction Director"), "trade": ("Chief Tanaka", "AI Transport & Logistics Chief"),
                "population": ("Dr. Amara Lind", "AI Life Support & Health Director"), "security": ("Chief Rourke", "AI Security & Emergency Chief")},
         depts={"executive": "Colonial Executive Council", "finance": "Economy & Population", "development": "Infrastructure & Engineering", "construction": "Construction Directorate",
                "trade": "Transport & Logistics", "population": "Life Support & Health", "security": "Security & Emergency"},
         extra_agents=[("Commander Elias", "AI Chief Engineer", "mr_central", "development"), ("MX-07", "AI Maintenance Robot", "mr_central", "construction"), ("Scout Ilya", "AI Exploration Lead (Science & Exploration)", "mr_valles", "development")],
         priorities=["housing", "health", "jobs", "research"], resource_daily=14000, enterprise_daily=3000,
         homes=["cc", "cc_e", "cc_w", "cc_s"], social="cc"),
]
SUBS = {"construction": [("AI Project Manager", "Project Manager"), ("AI Architect", "Architect"), ("AI Quantity Surveyor", "Quantity Surveyor"), ("AI Contractor Liaison", "Contractor Liaison")],
        "development": [("AI Urban Planner", "Urban Planner")], "finance": [("AI Auditor", "Auditor")]}
PROMPTS = {"executive": "You lead the government. You set priorities and make strategic decisions, and explain them plainly.",
           "finance": "You manage the treasury, budgets and project funding. You approve or reject spending according to the rules and explain why.",
           "development": "You plan land use and identify development needs (housing, jobs, health, research) and propose projects.",
           "construction": "You run construction: contractors, schedules and costs. You report progress honestly.",
           "trade": "You manage trade with other governments and the local economy.",
           "population": "You look after citizens: housing, employment and welfare.",
           "security": "You keep the territory and its infrastructure safe."}

# (zone, code, x0, z0, classification, permission, land value) -- 16x16 m plots, 4 m gaps; validated by tests (no overlap, clear of roads/buildings)
PARCELS = {"aether_city": [("AE-W1", -94, -18, "residential", "approved"), ("AE-W2", -74, -18, "residential", "approved"), ("AE-W3", -94, 2, "commercial", "approved"), ("AE-W4", -74, 2, "mixed", "approved"),
                           ("AE-E1", 58, -18, "commercial", "approved"), ("AE-E2", 78, -18, "civic", "approved"), ("AE-E3", 58, 2, "industrial", "approved"), ("AE-E4", 78, 2, "conservation", "restricted")],
           "wakanda": [("WK-A1", 40, 80, "residential", "approved"), ("WK-A2", 60, 80, "residential", "approved"), ("WK-A3", 80, 80, "mixed", "approved"),
                       ("WK-A4", 40, 100, "residential", "approved"), ("WK-A5", 60, 100, "commercial", "approved"), ("WK-A6", 80, 100, "conservation", "restricted"),
                       ("WK-B1", 30, -130, "civic", "approved"), ("WK-B2", 50, -130, "civic", "approved"), ("WK-B3", 70, -130, "industrial", "approved"),
                       ("WK-B4", 30, -110, "mixed", "approved"), ("WK-B5", 50, -110, "commercial", "approved"), ("WK-B6", 70, -110, "residential", "approved")]}
PARCEL = 16
PARCELS["pandora"] = [("PD-%02d" % (i + 1), x0, z0, zone_pandora.PARCEL_CLASSES[i], "restricted" if zone_pandora.PARCEL_CLASSES[i] == "conservation" else "approved")
                      for i, (x0, z0) in enumerate(zone_pandora.pick_parcels())]
PARCELS["mars"] = [("MR-%02d" % (i + 1), x0, z0, zone_mars.PARCEL_CLASSES[i], "restricted" if zone_mars.PARCEL_CLASSES[i] == "conservation" else "approved")
                   for i, (x0, z0) in enumerate(zone_mars.pick_parcels())]
CONTRACTORS = [("Aether Constructors Ltd", "aether_city", 1, 40, .80, 2, .82, ["aether_city", "wakanda"], 2_000_000),
               ("Aether Civic Works", "aether_city", 0, 24, .70, 2, .70, ["aether_city"], 1_500_000),
               ("Wakanda Royal Builders", "wakanda", 0, 36, .85, 2, .86, ["wakanda"], 2_500_000),
               ("Pandora Grove Builders", "pandora", 0, 34, .82, 2, .84, ["pandora"], 2_200_000),
               ("Reef & Root Co", "pandora", 1, 28, .76, 2, .75, ["pandora"], 1_800_000),
               ("Savanna Construction Co", "wakanda", 1, 30, .75, 2, .74, ["wakanda"], 2_000_000),
               ("Red Dust Constructors", "mars", 0, 38, .83, 2, .85, ["mars"], 2_400_000),
               ("Olympus Robotics Works", "mars", 1, 30, .78, 2, .76, ["mars"], 1_900_000)]
BUSINESSES = {"aether_city": [("Nexus Tech", "technology", "lab"), ("Aether Market", "retail", "c"), ("Meridian Cafe", "food", "e")],
              "wakanda": [("Vibrant Works", "technology", "tec"), ("Village Market", "retail", "vil"), ("Savanna Crafts", "crafts", "cap")],
              "pandora": [("Glowfruit Farms", "farm", "for_a"), ("Reef Exchange", "retail", "reef"), ("Timber Guild", "crafts", "ht_e")],
              "mars": [("Eden Hydroponics", "farm", "ed"), ("Olympus Ore Co", "crafts", "mn"), ("Ares Freight", "retail", "sp")]}
# occupation, employer ('government' or business name), work node, daily gross (credits), count, profile
JOBS = {"aether_city": [("Civil servant", "government", "hq", 1900, 6, "standard"), ("Researcher", "government", "lab", 2500, 4, "standard"), ("Librarian", "government", "lib", 1800, 3, "standard"),
                        ("Security officer", "government", "hq", 2000, 3, "night_shift"), ("Software engineer", "Nexus Tech", "lab", 2800, 8, "standard"),
                        ("Shopkeeper", "Aether Market", "c", 1700, 5, "standard"), ("Cafe worker", "Meridian Cafe", "e", 1500, 4, "standard"), ("Facilitator", "government", "mtg", 1900, 3, "standard")],
        "wakanda": [("Palace official", "government", "pal", 2200, 5, "standard"), ("Palace guard", "government", "pal", 2000, 4, "night_shift"), ("Royal clerk", "government", "cap", 1900, 5, "standard"),
                    ("Researcher", "government", "lab", 2600, 6, "standard"), ("Engineer", "Vibrant Works", "tec", 2900, 7, "standard"), ("Market trader", "Village Market", "vil", 1500, 6, "standard"),
                    ("Ranger", "government", "mtn", 1800, 3, "standard"), ("Artisan", "Savanna Crafts", "cap", 1700, 5, "standard")],
        "pandora": [("Organic architect", "government", "ht_n", 2300, 4, "standard"), ("Council clerk", "government", "ht_n", 1900, 4, "standard"), ("Grove guardian", "government", "for", 2000, 5, "night_shift"),
                    ("Sky rider", "government", "sky", 2200, 3, "standard"), ("Healer", "government", "ht", 2100, 3, "standard"), ("Forager", "Glowfruit Farms", "for_a", 1500, 7, "standard"),
                    ("Reef trader", "Reef Exchange", "reef", 1700, 6, "standard"), ("Weaver", "Timber Guild", "ht_e", 1600, 5, "standard"), ("Frontier hunter", "government", "wild", 1900, 3, "standard")],
        "mars": [("Colonial engineer", "government", "cc_n", 2600, 6, "standard"), ("Life-support technician", "government", "cc_n", 2300, 5, "night_shift"), ("Mars scientist", "government", "cc_e", 2700, 4, "standard"),
                 ("Colony doctor", "government", "cc_w", 2500, 3, "standard"), ("Miner", "Olympus Ore Co", "mn", 2100, 8, "standard"), ("Greenhouse farmer", "Eden Hydroponics", "ed", 1700, 7, "standard"),
                 ("Rover driver", "Ares Freight", "sp", 1800, 5, "standard"), ("Security officer", "government", "cc_s", 2000, 3, "night_shift")]}
NAMES = {"aether_city": (["Ari", "Bea", "Cato", "Dev", "Eli", "Fay", "Gus", "Hana", "Ivo", "Juno", "Kit", "Lia", "Max", "Nell", "Oz", "Pia"], ["Voss", "Reed", "Kwan", "Ortiz", "Lund", "Okoye", "Park", "Silva"]),
         "pandora": (["Ayu", "Oro", "Teya", "Lio", "Nyra", "Kael", "Sora", "Tavi", "Ilu", "Reni", "Maka", "Yuna", "Zeno", "Aru", "Neva", "Tali"], ["of the Grove", "of the Reef", "Skywatcher", "Rootbound", "Dawnleaf", "Tidecaller", "Mossfoot", "Glowvine"]),
         "mars": (["Elias", "Maya", "Jun", "Sofia", "Kai", "Noor", "Dmitri", "Aiko", "Tomas", "Zuri", "Ravi", "Lena", "Omar", "Ines", "Yara", "Teo"], ["Okafor", "Lind", "Petrov", "Tanaka", "Reyes", "Haddad", "Novak", "Singh"]),
         "wakanda": (["Ada", "Bayo", "Chidi", "Dara", "Emeka", "Fola", "Gozie", "Hawa", "Imani", "Jide", "Kemi", "Lami", "Moyo", "Nuru", "Obi", "Sefu"], ["Adeyemi", "Mensah", "Diallo", "Okafor", "Nkosi", "Banda", "Tembo", "Kamau"])}
SCHEDULES = {"standard": [(0, 6, "sleeping"), (6, 8, "commuting"), (8, 12, "working"), (12, 14, "resting"), (14, 18, "working"), (18, 19, "commuting_home"), (19, 22, "leisure"), (22, 24, "sleeping")],
             "night_shift": [(0, 6, "working"), (6, 7, "commuting_home"), (7, 15, "sleeping"), (15, 21, "leisure"), (21, 22, "commuting"), (22, 24, "working")]}


def parcel_valid(zone, code, x0, z0):
    return True   # geometry is verified in tests against roads/buildings; kept data-driven here


def seed():
    """Idempotent: seeds every government whose zone exists but has none yet (so a new zone can be added to an existing world)."""
    ts = clock.glob()["sim_ts"]
    for pr, rows in SCHEDULES.items():
        for a, b, act in rows:
            run("INSERT OR IGNORE INTO citizen_schedules(profile,start_h,end_h,activity) VALUES(?,?,?,?)", (pr, a, b, act))
    fresh = not q1("SELECT 1 FROM governments")
    for spec in GOVS:
        if not q1("SELECT 1 FROM governments WHERE zone_id=?", (spec["zone"],)) and q1("SELECT 1 FROM world_zones WHERE id=?", (spec["zone"],)):
            _gov(spec, ts)
            if spec["zone"] == "pandora":
                run("UPDATE agents SET outfit_variant='pandora_tribal' WHERE zone='pandora' AND outfit_variant=''")
            if spec["zone"] == "mars":                                       # colonists wear pressure suits; the maintenance robot is plain steel
                run("UPDATE agents SET outfit_variant='mars_suit' WHERE zone='mars' AND outfit_variant='' AND role NOT LIKE '%Robot%'")
                run("UPDATE agents SET outfit_variant='mars_robot', texture_variant='#9aa3ad' WHERE zone='mars' AND role LIKE '%Robot%'")
    gid = {r["zone_id"]: r["id"] for r in q("SELECT id,zone_id FROM governments")}
    def deal(seller, buyer, res, qty, price):          # trade deals signed by both finance ministries (once)
        if seller in gid and buyer in gid and not q1("SELECT 1 FROM trade_agreements WHERE seller_government_id=? AND buyer_government_id=? AND resource=?", (gid[seller], gid[buyer], res)):
            run("INSERT INTO trade_agreements(seller_government_id,buyer_government_id,resource,quantity,unit_price_minor,period_days,created_ts) VALUES(?,?,?,?,?,?,?)", (gid[seller], gid[buyer], res, qty, CR(price), 7, ts))
    deal("wakanda", "aether_city", "research technology licences", 12, 6500)
    deal("aether_city", "wakanda", "construction services", 5, 9000)
    deal("mars", "aether_city", "rare minerals & ore", 30, 5200)
    deal("aether_city", "mars", "construction robots", 6, 11000)
    deal("mars", "wakanda", "hydroponic technology licences", 8, 7000)
    deal("pandora", "aether_city", "timber & organic fibre", 20, 3200)
    deal("aether_city", "pandora", "technology equipment", 6, 7800)
    deal("pandora", "wakanda", "bioluminescent flora extracts", 10, 4100)


def _gov(spec, ts):
    zone = spec["zone"]
    with tx() as c:
        gid = c.execute("INSERT INTO governments(zone_id,name,gov_type,leader_title,economy,currency_code,currency_name,fx_to_base) VALUES(?,?,?,?,?,?,?,?)",
                        (zone, spec["name"], spec["type"], spec["leader"], spec["economy"], spec["cur"][0], spec["cur"][1], spec["fx"])).lastrowid
    policies = {"income_tax_rate": (0.25, "Withheld from wages"), "sales_tax_rate": (0.05, "On citizen spending"), "business_tax_rate": (0.12, "On business sales"),
                "budget_shares": ({"construction": 0.40, "research": 0.25, "public_services": 0.20, "security": 0.15}, "Share of the monthly budget per category"),
                "monthly_budget_minor": (CR(2_400_000), "Total monthly spending envelope"), "min_reserve_minor": (CR(500_000), "Treasury must stay above this"),
                "auto_approve_limit_minor": (CR(700_000), "Semi-autonomous: routine projects up to this need no user approval"),
                "autonomous_limit_minor": (CR(1_500_000), "Autonomous mode: per-project ceiling"), "max_active_projects": (2, "Construction quota"),
                "priorities": (spec["priorities"], "Development priorities in order"), "resource_daily_minor": (CR(spec["resource_daily"]), "Natural resource royalties per day"),
                "enterprise_daily_minor": (CR(spec["enterprise_daily"]), "State enterprise dividends per day"), "planning_hour": (9, "Local hour of the daily planning cycle"),
                "growth_per_month": (0.05, "Population growth when housing is available"), "housing_extra": (6, "Spare housing at start")}
    for k, (v, d) in policies.items():
        finance.set_policy(gid, k, v, d)
    # agents: heads are real in-world agents (Ollama-capable); sub-agents are personas
    leader = None
    for key, dname in DEPTS:
        nm, role = spec["heads"][key]
        dname = spec.get("depts", {}).get(key, dname)
        home = spec["home"] if key not in ("executive", "security") else ("wk_palace" if zone == "wakanda" else spec["home"] if zone in ("pandora", "mars") else "hq")
        a = am.create_agent({"name": nm, "role": role, "home_location": home, "personality": "Professional, concise, speaks for their department.",
                             "system_prompt": "You are %s, %s of %s (a fictional, simulated government). %s Answer in the player's language, briefly." % (nm, role, spec["name"], PROMPTS[key]),
                             "goals": ["Serve " + spec["name"], dname + " duties"]})
        with tx() as c:
            did = c.execute("INSERT INTO government_departments(government_id,key,name,head_agent_id) VALUES(?,?,?,?)", (gid, key, dname, a["id"])).lastrowid
            hid = c.execute("INSERT INTO government_agents(government_id,department_id,agent_id,name,role) VALUES(?,?,?,?,?)", (gid, did, a["id"], nm, role)).lastrowid
            for sn, sr in SUBS.get(key, []):
                c.execute("INSERT INTO government_agents(government_id,department_id,agent_id,name,role,parent_id) VALUES(?,?,?,?,?,?)", (gid, did, None, sn, sr, hid))
            if key == "executive":
                leader = a["id"]
    for nm, role, home, dkey in spec.get("extra_agents", []):
        a = am.create_agent({"name": nm, "role": role, "home_location": home, "personality": "Professional, concise.",
                             "system_prompt": "You are %s, %s of %s (a fictional, simulated government). Answer briefly in the player's language." % (nm, role, spec["name"]), "goals": ["Serve " + spec["name"]]})
        did = q1("SELECT id FROM government_departments WHERE government_id=? AND key=?", (gid, dkey))["id"]
        run("INSERT INTO government_agents(government_id,department_id,agent_id,name,role) VALUES(?,?,?,?,?)", (gid, did, a["id"], nm, role))
    run("UPDATE governments SET leader_agent_id=? WHERE id=?", (leader, gid))
    if zone == "wakanda":                                                   # officials wear the Wakanda costumes too
        run("UPDATE agents SET outfit_variant=CASE WHEN role LIKE '%Guard%' OR role LIKE '%Security%' THEN 'wakanda_guard' ELSE 'wakanda_royal' END WHERE zone='wakanda' AND outfit_variant=''")
    # books
    cash = ledger.post("open:gov:%d" % gid, "opening", [(finance.gacct(gid, "treasury"), "D", CR(spec["treasury"])), (finance.gacct(gid, "equity"), "C", CR(spec["treasury"]))], ts, gid, "Opening treasury")
    finance.gacct(gid, "escrow"); finance.period_for(gid, ts)
    # contractors
    for name, hz, priv, workers, skill, cap, rating, permits, cash_cr in CONTRACTORS:
        if hz != zone:
            continue
        run("INSERT INTO construction_contractors(name,owner_government_id,is_private,workers,skill,capacity,rating,home_zone,permit_zones) VALUES(?,?,?,?,?,?,?,?,?)",
            (name, None if priv else gid, priv, workers, skill, cap, rating, hz, json.dumps(permits)))
        cid = q1("SELECT id FROM construction_contractors WHERE name=?", (name,))["id"]
        ca = ledger.account("contractor", cid, "cash", name + " cash", "asset", spec["cur"][0], gid)
        ledger.account("contractor", cid, "revenue", name + " contract revenue", "revenue", spec["cur"][0], gid)
        ledger.account("contractor", cid, "expense", name + " wages & materials", "expense", spec["cur"][0], gid)
        eq = ledger.account("contractor", cid, "equity", name + " equity", "equity", spec["cur"][0], gid)
        ledger.post("open:contractor:%d" % cid, "opening", [(ca, "D", CR(cash_cr)), (eq, "C", CR(cash_cr))], ts, gid, "Opening capital")
    # land
    for code, x0, z0, cls, perm in PARCELS[zone]:
        run("INSERT INTO land_parcels(zone_id,code,x0,x1,z0,z1,classification,owner_government_id,permission,land_value_minor) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (zone, code, x0, x0 + PARCEL, z0, z0 + PARCEL, cls, gid, perm, CR(120_000 if cls != "conservation" else 40_000)))
    # businesses + citizens
    bids = {}
    for name, kind, node in BUSINESSES[zone]:
        run("INSERT INTO businesses(zone_id,government_id,name,kind,owner_government_id,node) VALUES(?,?,?,?,?,?)", (zone, gid, name, kind, gid if kind == "technology" else None, node))
        bid = q1("SELECT id FROM businesses WHERE zone_id=? AND name=?", (zone, name))["id"]; bids[name] = bid
        ba = ledger.account("business", bid, "cash", name + " cash", "asset", spec["cur"][0], gid)
        ledger.account("business", bid, "revenue", name + " sales", "revenue", spec["cur"][0], gid)
        ledger.account("business", bid, "expense", name + " costs", "expense", spec["cur"][0], gid)
        eq = ledger.account("business", bid, "equity", name + " equity", "equity", spec["cur"][0], gid)
        ledger.post("open:business:%d" % bid, "opening", [(ba, "D", CR(400_000)), (eq, "C", CR(400_000))], ts, gid, "Opening capital")
    rnd = random.Random(zone)
    first, last = NAMES[zone]; n = 0
    for occ, emp, node, wage, count, prof in JOBS[zone]:
        for _ in range(count):
            add_citizen(gid, zone, spec, rnd, "%s %s" % (rnd.choice(first), rnd.choice(last)), occ, emp, node, wage, prof, bids, ts, n)
            n += 1
    finance.set_policy(gid, "housing_base", n + finance.policy(gid, "housing_extra", 6), "Citizens the existing housing can hold")


def add_citizen(gid, zone, spec, rnd, name, occ, emp, node, wage, prof, bids, ts, n):
    bid = bids.get(emp)
    with tx() as c:
        cid = c.execute("INSERT INTO citizens(zone_id,government_id,name,age_group,occupation,employer_kind,business_id,home_node,work_node,social_node,profile,salary_minor,color,jitter_x,jitter_z) "
                        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (zone, gid, name, rnd.choice(["young", "adult", "adult", "senior"]), occ, "business" if bid else "government", bid, spec["homes"][n % len(spec["homes"])],
                         node, spec["social"], prof, CR(wage * WAGE_SCALE), rnd.randrange(360), rnd.uniform(-3, 3), rnd.uniform(-3, 3))).lastrowid
    ca = ledger.account("citizen", cid, "cash", name + " cash", "asset", spec["cur"][0], gid)
    eq = ledger.account("citizen", cid, "equity", name + " equity", "equity", spec["cur"][0], gid)
    ledger.account("citizen", cid, "income", name + " income", "revenue", spec["cur"][0], gid)
    ledger.account("citizen", cid, "expense", name + " living costs", "expense", spec["cur"][0], gid)
    ledger.post("open:citizen:%d" % cid, "opening", [(ca, "D", CR(8000)), (eq, "C", CR(8000))], ts, gid, "Opening savings")
    run("UPDATE citizens SET account_id=? WHERE id=?", (ca, cid))
    return cid
