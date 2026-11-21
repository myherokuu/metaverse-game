"""Pandora Nature World layout - an ORIGINAL alien-nature design (luminous forest, a colossal home tree, floating islands, an
azure coast with docks, ancient ruins). Deterministic: fixed seed -> same layout everywhere. Metres, world = +-500.
The 16 km x 16 km of the design brief is far beyond a browser; this is a 1 km square streamed in 100 m chunks."""
import math
import random

SEED = 2002
BOUND = 500
ZONE = dict(id="pandora", name="Pandora Nature World", builder="pandora", bound=BOUND, seed=SEED, sort=3,
            description="An alien nature planet: a luminous sacred forest, a colossal home tree, floating mountains, an azure reef coast and ancient ruins. Ruled by a tribal confederation.")

# key, name, kind, x, z, w, d, h, colour, node, description
LOCATIONS = [
    ("pd_hometree", "Great Mother Tree Kingdom", "district", 0, 0, 220, 220, 0, "#5ff0c8", "ht", "Home tree, council hall, homes and the gathering plaza."),
    ("pd_sky", "Floating Mountain Territory", "district", -260, -240, 200, 200, 0, "#8fb4ff", "sky", "Floating islands, waterfalls and the flight-training ground."),
    ("pd_forest", "Luminescent Sacred Forest", "district", 260, -220, 200, 200, 0, "#c77dff", "for", "Glowing sacred forest. Building is restricted."),
    ("pd_reef", "Azure Reef Ocean Kingdom", "district", 0, 395, 240, 190, 0, "#35e0ff", "reef", "Coast, docks and floating homes of the reef tribe."),
    ("pd_wild", "Ancient Ruins & Wildlands", "district", -300, 230, 200, 200, 0, "#ffb347", "wild", "Unclaimed wildlands with ancient ruins."),
]
NODES = {"ht": (0, 40), "ht_e": (52, -8), "ht_w": (-52, -8), "ht_s": (0, 120), "ht_n": (0, -88),
         "for_a": (120, -70), "for_b": (190, -140), "for": (255, -200),
         "sky_a": (-120, -80), "sky_b": (-190, -150), "sky": (-250, -215),
         "reef_a": (0, 215), "reef": (0, 305),
         "wild_a": (-140, 110), "wild": (-270, 205)}
EDGES = [("ht", "ht_e"), ("ht", "ht_w"), ("ht", "ht_s"), ("ht_e", "ht_n"), ("ht_w", "ht_n"),
         ("ht_e", "for_a"), ("for_a", "for_b"), ("for_b", "for"),
         ("ht_w", "sky_a"), ("sky_a", "sky_b"), ("sky_b", "sky"),
         ("ht_s", "reef_a"), ("reef_a", "reef"), ("ht_w", "wild_a"), ("wild_a", "wild")]
PATROL = ["ht", "ht_e", "ht_n", "ht_w"]
SPAWNS = [("hometree_plaza", "Gathering plaza", "pd_hometree", 0, 44, math.pi, 1), ("sky_ground", "Flight-training ground", "pd_sky", -245, -205, math.pi, 0),
          ("sacred_grove", "Grove gate", "pd_forest", 248, -192, math.pi, 0), ("reef_docks", "Reef docks", "pd_reef", 0, 300, math.pi, 0),
          ("wild_camp", "Frontier camp", "pd_wild", -262, 198, math.pi, 0)]
SHORE = 325                                        # z where the sea begins
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

    # ---- terrain ----
    for x, z, r, h in [(-420, -380, 110, 130), (430, -420, 100, 120), (-450, 330, 95, 90), (440, 300, 90, 80), (40, -470, 100, 110), (-120, 460, 60, 40), (150, 470, 60, 40)]:
        add("mountain", x, z, r=r, h=h, mesa=False)
    for x, z, r, h in [(-120, -240, 55, 9), (130, -280, 60, 11), (-200, 40, 60, 8), (210, 60, 55, 10), (60, 190, 45, 5), (-330, 350, 50, 7)]:
        add("hill", x, z, r=r, h=h)
    add("plateau", 0, 0, r=120, h=2.0, blend=70, district="pd_hometree")
    add("coast", 0, SHORE, z0=SHORE, depth=9)
    # ---- Great Mother Tree Kingdom ----
    add("hometree", 0, -30, district="pd_hometree", r=16, h=96, box=[36, 36])
    nodes = {k: tuple(v) for k, v in NODES.items()}
    for ring, step in ((62, 20), (86, 14)):                      # homes ring the tree on two rings, keeping clear of the trails
        for deg in range(0, 360, step):
            a = math.radians(deg + (7 if ring > 70 else 0)); x, z = math.cos(a) * ring, -30 + math.sin(a) * ring
            if z > 150 or any(_segd((x, z), nodes[e0], nodes[e1]) < 14 for e0, e1 in EDGES) or math.hypot(x, z + 30) < 24:
                continue
            add("organic_hut", x, z, a, district="pd_hometree", r=5, h=4.4, box=[11, 11])
    add("council_hall", 0, -125, district="pd_hometree", w=38, d=30, h=14, box=[38, 30])
    add("info_point", 12, 52, district="pd_hometree", title="Great Mother Tree", text="The heart of the confederation. The council meets in the hall to the north; homes ring the tree. Trails lead to the sky islands (north-west), the sacred forest (north-east), the reef (south) and the wildlands (west).")
    add("info_point", -14, -112, district="pd_hometree", title="Tribal High Council", text="The High Elder and the heads of Nature & Ecology, Land & Construction, Trade, Welfare and Security decide how the lands are used. Nature balance comes first.")
    add("forest", -100, 60, district="pd_hometree", r=40, count=70, seed=3); add("forest", 110, 50, district="pd_hometree", r=40, count=70, seed=4)
    # ---- Floating Mountain Territory (scenery in the sky; reach it by air) ----
    for x, z, alt, r, h in [(-260, -250, 70, 46, 34), (-190, -310, 120, 30, 24), (-335, -175, 95, 36, 28), (-120, -210, 150, 22, 18), (150, -340, 105, 28, 22)]:
        add("floating_island", x, z, district="pd_sky", r=r, h=h, alt=alt)
    add("flight_ground", -245, -190, district="pd_sky", r=18)
    add("info_point", -236, -204, district="pd_sky", title="Sky Mountain Clan", text="The floating mountains drift above the valley. Flying mounts launch from this ground; water falls from the islands into the clouds below.")
    add("forest", -230, -130, district="pd_sky", r=70, count=160, seed=21)
    # ---- Luminescent Sacred Forest ----
    add("spirit_tree", 262, -215, district="pd_forest", r=7, h=42, box=[16, 16])
    add("info_point", 246, -190, district="pd_forest", title="Sacred Forest", text="Plants glow at night and react to touch. Building here is restricted: the Forest Guardians protect the biodiversity.")
    add("forest", 262, -215, district="pd_forest", r=110, count=760, seed=31, mix="sacred"); add("forest", 190, -120, district="pd_forest", r=60, count=240, seed=32, mix="sacred")
    # ---- Azure Reef Ocean Kingdom ----
    add("dock", 0, 358, district="pd_reef", w=10, d=72, y=.5)
    add("dock", 32, 352, district="pd_reef", w=10, d=44, y=.5); add("dock", -34, 356, district="pd_reef", w=10, d=44, y=.5)
    for x, z in [(32, 342), (32, 364), (-34, 346), (-34, 368)]:
        add("organic_hut", x, z, 0, district="pd_reef", r=4.2, h=3.8, box=[9.4, 9.4])
    add("info_point", 8, 312, district="pd_reef", title="Azure Reef", text="The reef tribe lives on floating docks. Fishing, diving and trade with the other tribes sustain the coast.")
    add("forest", 70, 250, district="pd_reef", r=45, count=80, seed=41); add("forest", -80, 250, district="pd_reef", r=45, count=80, seed=42)
    # ---- Ancient Ruins & Wildlands ----
    for x, z, w, d, h in [(-292, 212, 34, 28, 15), (-228, 262, 24, 22, 11), (-340, 160, 20, 20, 9)]:
        add("ruin", x, z, rnd.random() * 3, district="pd_wild", w=w, d=d, h=h, box=[w * .6, d * .6])
    add("info_point", -258, 196, district="pd_wild", title="Ancient Ruins", text="Nobody remembers who built these arches. Wildlands like these are claimed slowly, and only if the council allows it.")
    for x, z, r, n, s in [(-300, 230, 90, 240, 51), (-380, 120, 60, 120, 52), (-150, 280, 70, 140, 53), (300, 100, 90, 200, 54), (360, -20, 60, 100, 55), (-60, -300, 70, 160, 56), (180, 220, 70, 120, 57)]:
        add("forest", x, z, district="pd_wild", r=r, count=n, seed=s)

    boxes = []
    for o in objs:
        b = o["data"].get("box")
        if b:
            boxes.append([round(o["x"] - b[0] / 2, 2), round(o["x"] + b[0] / 2, 2), round(o["z"] - b[1] / 2, 2), round(o["z"] + b[1] / 2, 2)])
    meta = dict(nodes={k: list(v) for k, v in NODES.items()}, edges=[list(e) for e in EDGES], patrol=PATROL, boxes=boxes, river=None, bridges=[])
    return objs, meta


def pick_parcels(meta=None, n=12):
    """12 plots of 16x16 m on the flat home-tree plateau: clear of roads, huts, the hall and each other (grid scan, deterministic)."""
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
        if p[1] > SHORE - 5:
            problems.append("node %s in the sea" % k)
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
    print(len(o), "objects;", len(m["boxes"]), "boxes; parcels:", pick_parcels(m))
    for p in validate(m):
        print("PROBLEM:", p)
