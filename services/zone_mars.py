"""Mars Colony layout (zone 03 of the design brief) - an ORIGINAL Martian-desert design: a domed capital, a mining territory under a giant
volcano, an agricultural biosphere, a spaceport and a canyon frontier. Deterministic: fixed seed -> same layout everywhere. Metres, world = +-500.
The 20 km x 20 km of the brief is far beyond a browser; this is a 1 km square streamed in 100 m chunks, like the other open zones."""
import math
import random

SEED = 3003
BOUND = 500
ZONE = dict(id="mars", name="Mars Colony", builder="mars", bound=BOUND, seed=SEED, sort=4,
            description="MARS-003: an autonomous colony on the Red Planet. Domed habitats, a mining territory, a hydroponic biosphere, a spaceport and a canyon frontier, run by a colonial AI administration.")

# key, name, kind, x, z, w, d, h, colour, node, description
LOCATIONS = [
    ("mr_central", "New Horizon Central Colony", "district", 0, 0, 220, 220, 0, "#ff8a4c", "cc", "Capital settlement: command centre, habitats, medical dome, research dome and market."),
    ("mr_mining", "Olympus Mining Territory", "district", -270, -230, 200, 200, 0, "#c9a227", "mn", "Mining rigs and robot depots beneath the great volcano."),
    ("mr_eden", "Eden Agricultural Biosphere", "district", 265, -210, 200, 200, 0, "#7dff6a", "ed", "Closed-loop greenhouses: hydroponics, aeroponics and water recycling."),
    ("mr_port", "Ares Spaceport & Logistics", "district", 0, 335, 240, 190, 0, "#35e0ff", "sp", "Landing pad, hangar, cargo yard and control tower."),
    ("mr_valles", "Valles Frontier Exploration Zone", "district", 300, 235, 200, 200, 0, "#b06cff", "vl", "Canyons and ice caves. Unclaimed territory for exploration robots."),
]
NODES = {"cc": (0, 40), "cc_e": (52, -8), "cc_w": (-52, -8), "cc_s": (0, 120), "cc_n": (0, -76),
         "mn_a": (-120, -80), "mn_b": (-195, -150), "mn": (-250, -200),
         "ed_a": (120, -70), "ed_b": (190, -140), "ed": (222, -172),
         "sp_a": (0, 215), "sp": (0, 290),
         "vl_a": (130, 120), "vl_b": (205, 175), "vl": (258, 205)}
EDGES = [("cc", "cc_e"), ("cc", "cc_w"), ("cc", "cc_s"), ("cc_e", "cc_n"), ("cc_w", "cc_n"),
         ("cc_w", "mn_a"), ("mn_a", "mn_b"), ("mn_b", "mn"),
         ("cc_e", "ed_a"), ("ed_a", "ed_b"), ("ed_b", "ed"),
         ("cc_s", "sp_a"), ("sp_a", "sp"), ("cc_s", "vl_a"), ("vl_a", "vl_b"), ("vl_b", "vl")]
PATROL = ["cc", "cc_e", "cc_n", "cc_w"]
SPAWNS = [("colony_gate", "Interplanetary Portal", "mr_central", 0, 56, math.pi, 1), ("mining_gate", "Mining gate", "mr_mining", -246, -196, math.pi, 0),
          ("biosphere_gate", "Biosphere airlock", "mr_eden", 226, -166, math.pi, 0), ("spaceport", "Spaceport apron", "mr_port", 0, 284, math.pi, 0),
          ("frontier_camp", "Frontier camp", "mr_valles", 252, 198, math.pi, 0)]
PARCEL_CLASSES = ["residential", "residential", "commercial", "mixed", "civic", "residential", "industrial", "residential", "mixed", "civic", "commercial", "conservation"]


def _segd(p, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz)


def generate():
    rnd = random.Random(SEED)
    objs = []

    def add(kind, x, z, rot=0.0, district=None, **data):
        objs.append(dict(kind=kind, x=round(x, 2), z=round(z, 2), rot=round(rot, 3), district=district, data=data))

    # ---- terrain: rim mountains, the Olympus volcano, dunes, a flat colony plateau and the Valles canyon (negative hills) ----
    for x, z, r, h in [(-420, -380, 120, 150), (430, -420, 100, 110), (-450, 330, 95, 90), (40, -470, 100, 100), (-120, 460, 60, 40), (150, 470, 60, 40), (460, 40, 80, 70)]:
        add("mountain", x, z, r=r, h=h, mesa=False)
    for x, z, r, h in [(-120, -240, 55, 8), (130, -280, 60, 9), (-200, 40, 60, 7), (210, 60, 55, 8), (60, 190, 45, 5), (-330, 350, 50, 7), (380, -60, 60, 8)]:
        add("hill", x, z, r=r, h=h)
    for x, z, r, h in [(-280, -190, 24, -9), (-235, -235, 20, -8), (-300, -250, 22, -9)]:            # open-cast mining pits
        add("hill", x, z, r=r, h=h, district="mr_mining")
    for x, z, r, h in [(255, 185, 36, -20), (300, 215, 40, -28), (345, 245, 42, -26), (390, 280, 36, -20)]:   # Valles canyon floor
        add("hill", x, z, r=r, h=h, district="mr_valles")
    add("plateau", 0, 0, r=190, h=1.5, blend=90, district="mr_central")
    # ---- New Horizon Central Colony ----
    add("command_center", 0, -120, district="mr_central", w=44, d=44, h=18, box=[44, 44])
    nodes = {k: tuple(v) for k, v in NODES.items()}
    for ring, step in ((70, 22), (96, 15)):                      # habitat domes ring the command centre, clear of the roads
        for deg in range(0, 360, step):
            a = math.radians(deg + (7 if ring > 80 else 0)); x, z = math.cos(a) * ring, -120 + math.sin(a) * ring
            if z > 150 or any(_segd((x, z), nodes[e0], nodes[e1]) < 14 for e0, e1 in EDGES) or math.hypot(x, z + 120) < 30:
                continue
            add("habitat_dome", x, z, a, district="mr_central", r=5.5, h=5.2, box=[12, 12])
    add("medical_dome", -112, 18, district="mr_central", r=10, h=7.5, box=[22, 22])
    add("lab_dome", 112, 20, district="mr_central", r=10, h=8, box=[22, 22])
    add("market_dome", 46, 96, district="mr_central", r=9, h=6.5, box=[20, 20])
    add("oxygen_plant", -160, -150, district="mr_central", w=22, d=16, h=12, box=[22, 16])
    add("water_extractor", 160, -150, district="mr_central", w=20, d=16, h=14, box=[20, 16])
    add("solar_farm", 175, -8, district="mr_central", w=60, d=40, h=3, box=[60, 40])
    add("rover_depot", -170, -20, district="mr_central", w=34, d=22, h=10, box=[34, 22])
    add("portal_gate", -28, 66, district="mr_central", r=9, h=14, box=[8, 4])
    add("info_point", 12, 52, district="mr_central", title="Interplanetary Portal", text="You arrived here from Earth. The ring is the only link back; ships use the Ares Spaceport in the south.")
    add("info_point", 28, -96, district="mr_central", title="Colonial Command Centre", text="The Colonial Governor and the heads of Engineering, Life Support, Resources, Food, Security, Science, Transport and Economy meet here. Oxygen, water, energy and food are monitored 24 h a day.")
    add("forest", -100, 90, district="mr_central", r=40, count=40, seed=3); add("forest", 130, 90, district="mr_central", r=40, count=40, seed=4)
    # ---- Olympus Mining Territory ----
    for x, z in [(-272, -226), (-304, -190), (-226, -258)]:
        add("mining_rig", x, z, rnd.random() * 3, district="mr_mining", w=14, d=14, h=22, box=[14, 14])
    for x, z in [(-270, -170), (-196, -215), (-320, -200)]:
        add("ore_pile", x, z, rnd.random() * 3, district="mr_mining", r=7, h=4)
    add("rover_depot", -175, -215, district="mr_mining", w=34, d=22, h=10, box=[34, 22])
    add("info_point", -236, -196, district="mr_mining", title="Olympus Mining Territory", text="Autonomous drill rigs and haul rovers extract iron, silica and industrial minerals. 320 workers and robots keep three open-cast pits running.")
    add("forest", -290, -150, district="mr_mining", r=70, count=170, seed=21)
    # ---- Eden Agricultural Biosphere ----
    for x, z in [(250, -200), (290, -200), (250, -238), (290, -238)]:
        add("greenhouse", x, z, 0, district="mr_eden", r=15, h=9.5, box=[30, 30])
    add("water_tank", 222, -218, district="mr_eden", r=6, h=9, box=[12, 12])
    add("info_point", 240, -178, district="mr_eden", title="Eden Biosphere", text="Hydroponic and aeroponic crops grow under pressurised glass, with every drop of water recycled. 180 workers keep the closed loop running.")
    add("forest", 270, -150, district="mr_eden", r=60, count=90, seed=31)
    # ---- Ares Spaceport & Logistics ----
    add("landing_pad", 0, 345, district="mr_port", r=32)
    add("spaceship", 0, 345, district="mr_port", r=6, h=34, box=[12, 12])
    add("hangar", -78, 325, district="mr_port", w=38, d=28, h=15, box=[38, 28])
    add("control_tower", 62, 318, district="mr_port", r=4.5, h=30, box=[9, 9])
    for i, (x, z) in enumerate([(-30, 410), (-12, 410), (6, 410), (-30, 424), (-12, 424), (6, 424)]):
        add("cargo_container", x, z, 0, district="mr_port", w=12, d=2.6, h=2.6, box=[12, 2.6], shade=i % 3)
    add("info_point", 8, 292, district="mr_port", title="Ares Spaceport", text="Cargo and new colonists arrive here. Rovers carry ore and crops in, and spares and manufactured goods out to the other worlds.")
    add("forest", 80, 250, district="mr_port", r=45, count=50, seed=41); add("forest", -90, 250, district="mr_port", r=45, count=50, seed=42)
    # ---- Valles Frontier ----
    add("survey_outpost", 228, 215, district="mr_valles", r=7, h=5.5, box=[14, 14])
    add("info_point", 250, 200, district="mr_valles", title="Valles Frontier", text="Unclaimed canyon country with ice layers and caves. Exploration robots map it for the next generation of settlements.")
    for x, z, r, n, s in [(300, 235, 95, 190, 51), (400, 120, 60, 110, 52), (-150, 280, 70, 120, 53), (330, -20, 90, 150, 54), (-60, -300, 70, 130, 56), (180, 220, 60, 90, 57), (-380, 60, 80, 120, 58)]:
        add("forest", x, z, district="mr_valles" if x > 200 and z > 100 else None, r=r, count=n, seed=s)

    boxes = []
    for o in objs:
        b = o["data"].get("box")
        if b:
            boxes.append([round(o["x"] - b[0] / 2, 2), round(o["x"] + b[0] / 2, 2), round(o["z"] - b[1] / 2, 2), round(o["z"] + b[1] / 2, 2)])
    meta = dict(nodes={k: list(v) for k, v in NODES.items()}, edges=[list(e) for e in EDGES], patrol=PATROL, boxes=boxes, river=None, bridges=[])
    return objs, meta


def pick_parcels(meta=None, n=12):
    """12 plots of 16x16 m on the flat colony plateau, clear of roads, domes and each other (grid scan, deterministic)."""
    if meta is None:
        meta = generate()[1]
    boxes, nodes = meta["boxes"], {k: tuple(v) for k, v in meta["nodes"].items()}
    out = []
    for z0 in range(48, 240, 20):
        for x0 in list(range(-150, -60, 20)) + list(range(70, 160, 20)):
            r = (x0, x0 + 16, z0, z0 + 16)
            if any(not (r[1] + 4 <= b[0] or b[1] + 4 <= r[0] or r[3] + 4 <= b[2] or b[3] + 4 <= r[2]) for b in boxes):
                continue
            pts = [(x, z) for x in (r[0], r[1], (r[0] + r[1]) / 2) for z in (r[2], r[3], (r[2] + r[3]) / 2)]
            if any(min(_segd(p, nodes[a], nodes[b]) for p in pts) < 8 for a, b in meta["edges"]):
                continue
            out.append((x0, z0))
    return out[:n]


def validate(meta):
    problems, boxes = [], meta["boxes"]
    for k, p in NODES.items():
        for b in boxes:
            if b[0] - 1.5 < p[0] < b[1] + 1.5 and b[2] - 1.5 < p[1] < b[3] + 1.5:
                problems.append("node %s inside %s" % (k, b))
    for a, b in EDGES:
        A, B = NODES[a], NODES[b]
        for i in range(41):
            t = i / 40; p = (A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t)
            for bx in boxes:
                if bx[0] - 1 < p[0] < bx[1] + 1 and bx[2] - 1 < p[1] < bx[3] + 1:
                    problems.append("edge %s-%s crosses %s" % (a, b, bx)); break
    return sorted(set(problems))


if __name__ == "__main__":
    o, m = generate()
    print(len(o), "objects;", len(m["boxes"]), "boxes; parcels:", len(pick_parcels(m)))
    for p in validate(m):
        print("PROBLEM:", p)
