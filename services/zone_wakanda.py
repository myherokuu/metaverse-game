"""Wakanda zone layout (original Afrofuturist design). Deterministic: fixed seed -> identical layout on every install.
Everything is plain data; the browser turns it into terrain, buildings and vegetation. Coordinates are metres, world = +-400."""
import json
import math
import random

SEED = 2026
BOUND = 400
ZONE = dict(id="wakanda", name="Wakanda", builder="wakanda", bound=BOUND, seed=SEED, sort=2,
            description="Afrofuturist kingdom of gold-and-dark-alloy towers, royal gardens, rivers, a great waterfall and lush mountains.")

# key, name, kind, x, z, w, d, h, colour, node, description
LOCATIONS = [
    ("wk_capital", "Royal Capital", "district", 0, 0, 120, 120, 0, "#f2c14e", "cap", "Ceremonial plaza, fountain, towers and gardens."),
    ("wk_palace", "Royal Palace", "district", 0, -170, 100, 70, 0, "#ff9f43", "pal", "Elevated palace, grand gate, gardens and guards."),
    ("wk_lab", "Advanced Research Laboratory", "district", 190, 30, 90, 80, 0, "#6c5ce7", "lab", "Glass-and-alloy laboratory with holographic displays."),
    ("wk_mountain", "Waterfall & Mountain Region", "district", -270, -140, 160, 160, 0, "#2ecc71", "mtn", "Trails, observation platform, river and the great waterfall."),
    ("wk_village", "Traditional Village", "district", -190, 95, 100, 100, 0, "#e17055", "vil", "Earth-built homes, market and community fire circle."),
    ("wk_tech", "Technology District", "district", 200, 200, 120, 120, 0, "#00cec9", "tec", "Research towers, maglev station and engineering halls."),
]
NODES = {
    "cap": (0, 34), "cap_e": (34, 0), "cap_n": (0, -34), "cap_w": (-34, 0),
    "pal_a": (0, -95), "pal": (0, -132),
    "lab_a": (110, 8), "lab": (172, 6), "lab_w": (125, 40), "lab_s": (130, 100),
    "s2": (0, 110), "tec_a": (95, 175), "tec": (190, 190), "tec_n": (200, 150),
    "vil_a": (-80, 22), "vil_b": (-150, 62), "vil": (-190, 120),
    "m1": (-215, 30), "m2": (-250, -45), "mtn": (-285, -100), "mtn_pool": (-285, -170),
}
EDGES = [("cap", "cap_e"), ("cap_e", "cap_n"), ("cap_n", "cap_w"), ("cap_w", "cap"),
         ("cap_n", "pal_a"), ("pal_a", "pal"),
         ("cap_e", "lab_a"), ("lab_a", "lab"), ("lab_a", "lab_w"), ("lab_w", "lab_s"), ("lab_s", "tec_n"), ("tec_n", "tec"),
         ("cap", "s2"), ("s2", "tec_a"), ("tec_a", "tec"),
         ("cap_w", "vil_a"), ("vil_a", "vil_b"), ("vil_b", "vil"),
         ("vil_b", "m1"), ("m1", "m2"), ("m2", "mtn"), ("mtn", "mtn_pool")]
PATROL = ["cap", "cap_e", "cap_n", "cap_w"]
RIVER = dict(pts=[(-242, -212), (-190, -165), (-132, -105), (-122, -30), (-118, 45), (-128, 130), (-90, 205), (-30, 290), (5, 400)], w=16, depth=3.2)

SPAWNS = [  # key, name, district, x, z, rot, default
    ("royal_capital", "Royal Capital plaza", "wk_capital", 0, 30, math.pi, 1),
    ("royal_palace", "Palace gate", "wk_palace", 0, -128, math.pi, 0),
    ("research_lab", "Laboratory entrance", "wk_lab", 168, 12, math.pi / 2, 0),
    ("waterfall", "Observation platform", "wk_mountain", -285, -100, math.pi, 0),
    ("village", "Village fire circle", "wk_village", -186, 116, math.pi, 0),
    ("tech_district", "Technology district", "wk_tech", 186, 186, math.pi, 0),
]


def _seg_hit(a, b, c, d):
    """Intersection of segments ab and cd -> (x, z) or None."""
    r = (b[0] - a[0], b[1] - a[1]); s = (d[0] - c[0], d[1] - c[1]); den = r[0] * s[1] - r[1] * s[0]
    if abs(den) < 1e-9:
        return None
    t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den; u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
    return (a[0] + t * r[0], a[1] + t * r[1]) if 0 <= t <= 1 and 0 <= u <= 1 else None


def generate():
    rnd = random.Random(SEED)
    objs = []

    def add(kind, x, z, rot=0.0, district=None, **data):
        objs.append(dict(kind=kind, x=round(x, 2), z=round(z, 2), rot=round(rot, 3), district=district, data=data))

    # ---- terrain features (read by the client height field) ----
    for x, z, r, h in [(-330, -300, 110, 112), (-390, 40, 95, 70), (310, -260, 105, 84), (345, 90, 85, 62), (-70, -375, 95, 88), (130, -365, 75, 58), (-200, 365, 85, 60), (120, 380, 70, 50)]:
        add("mountain", x, z, r=r, h=h, mesa=(x == -330))
    add("hill", -290, -110, r=46, h=16, district="wk_mountain")
    add("hill", 90, -60, r=40, h=5); add("hill", -60, 190, r=45, h=6); add("hill", 270, -40, r=50, h=9)
    for x, z, r, h, b in [(0, 0, 62, 0.5, 42), (0, -170, 62, 12, 55), (190, 30, 58, 1.5, 40), (200, 200, 72, 1.0, 40), (-190, 95, 52, 0.4, 40)]:
        add("plateau", x, z, r=r, h=h, blend=b)
    add("pool", -242, -212, r=28, depth=4.2, district="wk_mountain")
    add("river", 0, 0, pts=RIVER["pts"], w=RIVER["w"], depth=RIVER["depth"])
    add("waterfall", -252, -222, math.atan2(88, 88), w=26, h=108, district="wk_mountain")

    # ---- Royal Capital ----
    add("plaza", 0, 0, r=48, district="wk_capital")
    add("fountain", 0, 0, district="wk_capital", r=9, box=[19, 19])
    for i, (x, z) in enumerate([(66, 62), (-66, 62), (66, -62), (-66, -62), (98, -52)]):
        add("skyscraper", x, z, district="wk_capital", w=22, d=22, h=round(72 + rnd.random() * 40), style="royal", shape="round" if i % 2 else "rect", box=[22, 22])
    for sx in (-1, 1):
        add("garden", sx * 36, 52, district="wk_capital", w=22, d=16); add("garden", sx * 36, -52, district="wk_capital", w=22, d=16)
    add("info_point", 8, 24, district="wk_capital", title="Royal Capital", text="The capital of Wakanda: a ring of gold-and-alloy towers around the Fountain of Ancestors. Roads lead to the Palace (north), the Laboratory (east), the Technology District (south-east) and the Village across the river (west).")
    # ---- Royal Palace ----
    add("palace", 0, -180, district="wk_palace", w=48, d=30, h=22, boxes=[[0, 0, 48, 30]])
    for sx in (-1, 1):
        add("tower", sx * 36, -172, district="wk_palace", r=7, h=36, style="gold", roof="cone", box=[15, 15])
        add("garden", sx * 28, -138, district="wk_palace", w=24, d=18)
    add("gate", 0, -148, district="wk_palace", w=18, h=10, boxes=[[-9.5, 0, 3, 3], [9.5, 0, 3, 3]])
    add("info_point", 12, -126, district="wk_palace", title="Royal Palace", text="The palace stands on a raised terrace. The great hall hosts the council; guards keep watch at the gate.")
    # ---- Advanced Research Laboratory ----
    add("lab", 207, 42, district="wk_lab", r=22, h=26, box=[44, 44])
    add("lab_wing", 160, 48, district="wk_lab", w=36, d=30, h=14, box=[36, 30])
    add("hologram", 176, -4, math.pi, district="wk_lab", w=9, h=5.5, text="VIBRANT-LATTICE SIMULATION")
    add("hologram", 150, 12, math.pi / 2, district="wk_lab", w=8, h=5, text="ENERGY GRID  98.2%")
    add("info_point", 168, 22, district="wk_lab", title="Advanced Research Laboratory", text="Research on sustainable energy, materials and AI. Amara and her team run experiments in the main drum; displays show live simulations.")
    # ---- Waterfall & Mountain ----
    add("platform", -290, -104, district="wk_mountain", w=16, d=16)
    add("info_point", -280, -112, district="wk_mountain", title="Observation platform", text="The great waterfall drops over 100 m from the mesa into a calm pool, which feeds the river running through the kingdom.")
    add("forest", -262, -60, district="wk_mountain", r=85, count=380, seed=11)
    add("forest", -330, -150, district="wk_mountain", r=60, count=230, seed=12)
    # ---- Traditional Village ----
    for i in range(8):
        a = i * math.pi / 4 + 0.489; r = 34 + rnd.random() * 4
        add("village_hut", -190 + math.cos(a) * r, 95 + math.sin(a) * r, a, district="wk_village", r=4.6 + rnd.random() * .8, h=3.4, box=[10, 10])
    for x, z in [(-228, 70), (-150, 112)]:
        add("granary", x, z, district="wk_village", r=2.4, h=5, box=[5.5, 5.5])
    add("meeting_circle", -190, 95, district="wk_village", r=9)
    add("market", -190, 152, district="wk_village", n=5, w=40, boxes=[[-16, 0, 6, 5], [-8, 0, 6, 5], [0, 0, 6, 5], [8, 0, 6, 5], [16, 0, 6, 5]])
    for x, z in [(-232, 118), (-150, 80), (-205, 55)]:
        add("garden", x, z, district="wk_village", w=12, d=9, crops=True)
    add("info_point", -186, 104, district="wk_village", title="Village fire circle", text="Stories of the kingdom are passed on here. Temba keeps the village history; the market opens at dawn.")
    # ---- Technology District ----
    for x, z, r, h in [(165, 165, 10, 74), (238, 168, 9, 92), (232, 238, 11, 64)]:
        add("tower", x, z, district="wk_tech", r=r, h=h, style="tech", roof="flat", box=[r * 2 + 2, r * 2 + 2])
    add("station", 200, 236, district="wk_tech", w=36, d=12, h=7, boxes=[[0, 0, 36, 12]])
    add("rail", 200, 200, district="wk_tech", r=36, y=8, offset=10)
    add("engineering", 150, 240, district="wk_tech", w=38, d=24, h=14, box=[38, 24])
    add("engineering", 252, 205, district="wk_tech", w=22, d=36, h=12, box=[22, 36])
    add("info_point", 178, 196, district="wk_tech", title="Technology District", text="Maglev transit, fabrication halls and research towers. The elevated rail loops the whole district.")
    # ---- vegetation across the kingdom ----
    for x, z, r, n in [(60, -110, 70, 200), (-40, -250, 90, 280), (260, -150, 80, 240), (-130, 260, 90, 260), (60, 300, 90, 240), (330, 250, 70, 160), (-330, 200, 80, 200), (-60, -140, 50, 100), (120, 90, 45, 90), (-20, 190, 40, 70)]:
        add("forest", x, z, r=r, count=n, seed=rnd.randint(1, 9999))

    # ---- bridges: wherever a road crosses the river ----
    pts = RIVER["pts"]; bridges = []
    for a, b in EDGES:
        A, B = NODES[a], NODES[b]
        for i in range(len(pts) - 1):
            hit = _seg_hit(A, B, pts[i], pts[i + 1])
            if hit:
                bridges.append(dict(x=round(hit[0], 2), z=round(hit[1], 2), rot=round(math.atan2(B[1] - A[1], B[0] - A[0]), 3)))
    for br in bridges:
        add("bridge", br["x"], br["z"], br["rot"], len=44, w=9, arch=2.6)

    boxes = []
    for o in objs:
        d = o["data"]
        for b in ([[0, 0, d["box"][0], d["box"][1]]] if "box" in d else d.get("boxes", [])):
            boxes.append([round(o["x"] + b[0] - b[2] / 2, 2), round(o["x"] + b[0] + b[2] / 2, 2), round(o["z"] + b[1] - b[3] / 2, 2), round(o["z"] + b[1] + b[3] / 2, 2)])
    meta = dict(nodes={k: list(v) for k, v in NODES.items()}, edges=[list(e) for e in EDGES], patrol=PATROL, boxes=boxes,
                river=dict(RIVER, pts=[list(p) for p in pts]), bridges=bridges)
    return objs, meta


def validate(meta):
    """Sanity checks used by the tests: nodes clear of obstacles/water, roads clear of obstacles."""
    problems, boxes = [], meta["boxes"]
    pts = RIVER["pts"]
    def d_river(p):
        best = 1e9
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]; dx, dz = b[0] - a[0], b[1] - a[1]
            t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)))
            best = min(best, math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz))
        return best
    for k, p in NODES.items():
        if d_river(p) < RIVER["w"] / 2 + 6: problems.append("node %s too close to river" % k)
        for b in boxes:
            if b[0] - 1.5 < p[0] < b[1] + 1.5 and b[2] - 1.5 < p[1] < b[3] + 1.5: problems.append("node %s inside obstacle %s" % (k, b))
    for a, b in EDGES:
        A, B = NODES[a], NODES[b]
        for i in range(0, 41):
            t = i / 40; p = (A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t)
            for bx in boxes:
                if bx[0] - 1 < p[0] < bx[1] + 1 and bx[2] - 1 < p[1] < bx[3] + 1: problems.append("edge %s-%s crosses obstacle %s" % (a, b, bx)); break
    return sorted(set(problems))


if __name__ == "__main__":
    o, m = generate()
    print(len(o), "objects;", len(m["bridges"]), "bridges;", len(m["boxes"]), "boxes")
    for p in validate(m): print("PROBLEM:", p)
