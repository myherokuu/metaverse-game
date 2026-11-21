// Mars Colony scene config (original design): domed habitats, command centre, greenhouses, mining rigs, a spaceport with a lander, solar
// fields and a rust-red desert with a butterscotch sky and low gravity. Reuses the generic open-zone engine (WakandaZone with a config):
// streamed terrain chunks, instanced rocks, server-defined objects. Shortcut: procedural primitives, no GLB art (add "mr_<kind>" in assets.json).
import * as THREE from 'three';
import { M, glowMat } from './materials.js';
import { WakandaZone, mesh, bx, cy } from './wakanda.js';
import { civicBuilders } from './civic.js';
import { makeLabel } from './world.js';

const hull = () => M.plain(0xe9e5de, .45, .25), hull2 = () => M.plain(0xbfc3c9, .4, .5), rust = () => M.plain(0x8c4a30, .85, .3), dark = () => M.plain(0x24272e, .55, .6);
const panel = () => M.plain(0x0d1d44, .25, .85), yellow = () => M.plain(0xe0b020, .6, .2), glass = () => M.glass(0x9fd6ff);
const GL = { warm: () => glowMat({ color: 0x2a2010, emissive: 0xffd9a0, roughness: .5 }, 1.3), cyan: () => glowMat({ color: 0x0b2a40, emissive: 0x66e6ff, roughness: .4 }, 1.6),
  green: () => glowMat({ color: 0x0f3a18, emissive: 0x6dff6a, roughness: .6 }, 1.0), red: () => glowMat({ color: 0x400a0a, emissive: 0xff3b2a, roughness: .5 }, 1.6), orange: () => glowMat({ color: 0x3a1a08, emissive: 0xff8a3c, roughness: .5 }, 1.4) };
const gl = {}; const g = k => gl[k] || (gl[k] = GL[k]());
const PB = {};
const half = (r, mat, sy = 1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat); m.scale.y = sy; m.castShadow = m.receiveShadow = true; return m; };
const ring = (R, t, mat, y, rotX = Math.PI / 2) => { const m = new THREE.Mesh(new THREE.TorusGeometry(R, t, 8, 48), mat); m.rotation.x = rotX; m.position.y = y; return m; };

PB.habitat_dome = o => {
  const { r, h } = o.data, grp = new THREE.Group(); grp.add(cy(r * 1.12, r * 1.2, .6, hull2(), 0, .3, 0, 28)); const d = half(r, hull(), h / r); d.position.y = .6; grp.add(d);
  grp.add(ring(r * 1.01, .12, g('warm'), 2.2)); grp.add(ring(r * .72, .1, g('warm'), h * .8 + .3));
  const a = o.rot, dx = -Math.cos(a), dz = -Math.sin(a), lock = bx(2.4, 2.4, 3.4, hull2(), dx * r * 1.15, 1.3, dz * r * 1.15, 1); lock.rotation.y = Math.atan2(dx, dz); grp.add(lock);
  grp.add(cy(.05, .05, 3, dark(), 0, h + 2, 0, 6), (() => { const l = new THREE.Mesh(new THREE.SphereGeometry(.2, 8, 6), g('red')); l.position.y = h + 3.6; return l; })());
  return grp;
};
PB.medical_dome = o => {
  const { r, h } = o.data, grp = PB.habitat_dome(o), cross = g('red');
  const a = bx(.5, 4, .3, cross, 0, 3.4, r * 1.03, 1), b = bx(4, .5, .3, cross, 0, 3.4, r * 1.03, 1); grp.add(a, b); return grp;
};
PB.lab_dome = o => {
  const { r, h } = o.data, grp = new THREE.Group(); grp.add(cy(r * 1.1, r * 1.2, .8, hull2(), 0, .4, 0, 28)); const d = half(r, glass(), h / r); d.position.y = .8; grp.add(d);
  const core = new THREE.Mesh(new THREE.SphereGeometry(r * .32, 16, 12), g('cyan')); core.position.y = h * .45; grp.add(core);
  const dish = half(2.2, hull(), .5); dish.position.set(r * .6, h + .6, 0); dish.rotation.z = -.7; grp.add(dish, cy(.08, .08, 2, dark(), r * .6, h - .2, 0, 6));
  return grp;
};
PB.market_dome = o => {
  const { r, h } = o.data, grp = new THREE.Group(); grp.add(cy(r * 1.08, r * 1.15, .6, hull2(), 0, .3, 0, 28)); const d = half(r, glass(), h / r); d.position.y = .6; grp.add(d);
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; grp.add(bx(1.6, .08, 3, i % 2 ? M.plain(0xff8a4c) : M.plain(0xf2f2f2), Math.cos(a) * r * .86, 3.3, Math.sin(a) * r * .86, 1)).children.at(-1).rotation.y = -a; }
  grp.add(ring(r * .6, .15, g('warm'), h * .7)); return grp;
};
PB.command_center = o => {
  const { w, h } = o.data, grp = new THREE.Group(), R = w * .3;
  grp.add(cy(R * 1.25, R * 1.35, 2, hull2(), 0, 1, 0, 40)); const dome = half(R, glass(), h / R * .7); dome.position.y = 2; grp.add(dome);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(R * .35, R * .35, h * .8, 20), hull()); core.position.y = h * .4 + 2; grp.add(core);
  for (let i = 0; i < 3; i++) { const a = i / 3 * 6.283 + .5, wing = bx(8, 5, 18, hull(), Math.cos(a) * R * 1.35, 3, Math.sin(a) * R * 1.35, 1); wing.rotation.y = -a + Math.PI / 2; grp.add(wing, ring(2.2, .12, g('warm'), 5.6)); grp.children.at(-1).position.set(Math.cos(a) * R * 1.35, 5.6, Math.sin(a) * R * 1.35); }
  grp.add(cy(.25, .5, h * 1.5, dark(), 0, h * .75 + 2, 0, 8)); grp.add(ring(R * .9, .25, g('orange'), 3.2));
  const dish = half(3, hull(), .45); dish.position.set(0, h * 1.5 + 2, 0); dish.rotation.z = .5; grp.add(dish);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.5, 10, 8), g('red')); beacon.position.y = h * 1.5 + 4.2; grp.add(beacon);
  return grp;
};
PB.oxygen_plant = o => {
  const { w, d, h } = o.data, grp = new THREE.Group(); grp.add(bx(w, 2, d, hull2(), 0, 1, 0, 2));
  for (let i = -1; i <= 1; i++) { grp.add(cy(3, 3, h, hull(), i * 6.5, h / 2 + 2, -2, 20), half(3, hull(), .8)); grp.children.at(-1).position.set(i * 6.5, h + 2, -2); grp.add(ring(3.05, .15, g('cyan'), h * .6 + 2)); grp.children.at(-1).position.x = i * 6.5; grp.children.at(-1).position.z = -2; }
  grp.add(bx(w * .8, 1.2, 1.2, dark(), 0, 3, d * .35, 1), cy(.7, .9, h + 4, dark(), w * .42, (h + 4) / 2, d * .3, 10)); return grp;
};
PB.water_extractor = o => {
  const { w, d, h } = o.data, grp = new THREE.Group(); grp.add(bx(w, 1.5, d, hull2(), 0, .75, 0, 2));
  grp.add(bx(3, h, 3, M.plain(0xd9d4cb, .5, .5), -w * .25, h / 2 + 1, 0, 2)); for (const s of [-1, 1]) grp.add(bx(.3, h, .3, dark(), -w * .25 + s * 1.6, h / 2 + 1, 1.6, 1), bx(.3, h, .3, dark(), -w * .25 + s * 1.6, h / 2 + 1, -1.6, 1));
  grp.add(cy(.3, .3, h * .8, chromeLike(), -w * .25, h * .4, 0, 8)); grp.add(cy(3.6, 3.6, 5, hull(), w * .25, 3.5, 0, 22), ring(3.65, .15, g('cyan'), 4.4)); grp.children.at(-1).position.x = w * .25;
  const tank = half(3.6, hull(), .5); tank.position.set(w * .25, 6, 0); grp.add(tank); return grp;
};
const chromeLike = () => M.plain(0xb9bec6, .25, .9);
PB.solar_farm = o => {
  const { w, d } = o.data, grp = new THREE.Group(), cols = Math.floor(w / 12), rows = Math.floor(d / 10);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = (i - (cols - 1) / 2) * 12, z = (j - (rows - 1) / 2) * 10, p = bx(10, .18, 6, panel(), x, 2.2, z, 2); p.rotation.x = -.5; grp.add(p);
    grp.add(bx(.2, 2.2, .2, dark(), x, 1.1, z + 1.4, 1), bx(.2, 1.4, .2, dark(), x, .7, z - 1.4, 1));
  }
  grp.add(bx(3, 3, 3, hull(), -w / 2 + 2, 1.5, d / 2 - 2, 1), ring(1.6, .1, g('green'), 3.2)); grp.children.at(-1).position.set(-w / 2 + 2, 3.2, d / 2 - 2); return grp;
};
function rover(x, z, rot, c) {
  const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = rot; grp.add(bx(2.6, 1, 3.8, M.plain(c, .5, .4), 0, 1.4, 0, 1), bx(2.2, .9, 1.6, glass(), 0, 2.3, .8, 1), bx(2.8, .15, 3.4, dark(), 0, 1.0, 0, 1));
  for (const s of [-1, 1]) for (const zz of [-1.4, 0, 1.4]) { const w = cy(.55, .55, .5, dark(), s * 1.5, .55, zz, 12); w.rotation.z = Math.PI / 2; grp.add(w); }
  grp.add(cy(.04, .04, 1.6, dark(), -.8, 3.1, -1.2, 5), (() => { const l = new THREE.Mesh(new THREE.SphereGeometry(.16, 8, 6), g('orange')); l.position.set(-.8, 3.9, -1.2); return l; })());
  return grp;
}
PB.rover_depot = o => {
  const { w, d, h } = o.data, grp = new THREE.Group(); grp.add(bx(w, h * .8, d, hull2(), 0, h * .4, 0, 2));
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, w, 20, 1, false, 0, Math.PI), hull()); roof.rotation.z = Math.PI / 2; roof.rotation.y = Math.PI / 2; roof.position.y = h * .8; roof.scale.set(1, 1, .45); roof.castShadow = true; grp.add(roof);
  grp.add(bx(w * .5, h * .55, .3, g('warm'), 0, h * .3, d / 2 + .05, 1)); grp.add(rover(-w * .3, d / 2 + 5, .2, 0xc9a227), rover(w * .05, d / 2 + 6, -.15, 0xe8e4de), rover(w * .35, d / 2 + 5, .1, 0xc9a227)); return grp;
};
PB.portal_gate = o => {
  const { r, h } = o.data, grp = new THREE.Group(), ringM = hull2();
  const outer = new THREE.Mesh(new THREE.TorusGeometry(r, .9, 14, 48), ringM); outer.position.y = r + 1; outer.castShadow = true; grp.add(outer);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(r * .88, .22, 10, 48), g('cyan')); inner.position.y = r + 1; grp.add(inner);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r * .86, 40), new THREE.MeshBasicMaterial({ color: 0x66e6ff, transparent: true, opacity: .22, side: THREE.DoubleSide, depthWrite: false })); disc.position.y = r + 1; grp.add(disc);
  for (const s of [-1, 1]) grp.add(bx(1.6, 1, 2.4, hull2(), s * r, .5, 0, 1));
  const lab = makeLabel('Interplanetary Portal', null, '#66e6ff', 10); lab.position.y = r * 2 + 4; grp.add(lab);
  return grp;
};
PB.mining_rig = o => {
  const { w, h } = o.data, grp = new THREE.Group(); grp.add(bx(w, 1, w, rust(), 0, .5, 0, 2));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const leg = cy(.3, .45, h, yellow(), sx * w * .3, h / 2 + 1, sz * w * .3, 6); leg.rotation.z = -sx * .12; leg.rotation.x = sz * .12; grp.add(leg); }
  grp.add(bx(w * .6, .5, w * .6, yellow(), 0, h * .55, 0, 2), bx(w * .5, .5, w * .5, yellow(), 0, h * .9, 0, 2));
  grp.add(cy(.45, .45, h * 1.1, dark(), 0, h * .5, 0, 10)); grp.add(cy(1.3, 1.3, 2.4, hull2(), 0, h + 1.6, 0, 12));
  const conv = bx(3, .6, w * 1.8, dark(), w * .75, 3, 0, 2); conv.rotation.z = -.15; grp.add(conv); const beacon = new THREE.Mesh(new THREE.SphereGeometry(.35, 8, 6), g('orange')); beacon.position.y = h + 3.2; grp.add(beacon);
  return grp;
};
PB.ore_pile = o => { const { r, h } = o.data, m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 9), M.plain(0x5d3326, .95)); m.position.y = h / 2; m.scale.z = .8; m.castShadow = m.receiveShadow = true; return m; };
PB.greenhouse = o => {
  const { r, h } = o.data, grp = new THREE.Group(); grp.add(cy(r * 1.04, r * 1.08, 1.2, hull2(), 0, .6, 0, 32)); const d = half(r, glass(), h / r); d.position.y = 1.2; grp.add(d);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(r * .8, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: .12, depthWrite: false })); glow.scale.y = h / (r * .8) * .8; glow.position.y = 1.3; grp.add(glow);
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) { const p = cy(.6, .8, 1.4 + (i + j) % 3 * .4, M.plain(0x2e8a3a, .8), (i - 2) * r * .3, 1.9, (j - 1.5) * r * .3, 6); if (Math.hypot((i - 2) * r * .3, (j - 1.5) * r * .3) < r * .8) grp.add(p); }
  for (let k = -1; k <= 1; k++) grp.add(bx(r * 1.4, .15, .4, g('green'), 0, 3.2 + k * .01, k * r * .35, 1));
  return grp;
};
PB.water_tank = o => { const { r, h } = o.data, grp = new THREE.Group(); grp.add(cy(r, r, h, hull(), 0, h / 2, 0, 22), ring(r + .03, .15, g('cyan'), h * .6)); const t = half(r, hull(), .45); t.position.y = h; grp.add(t); return grp; };
PB.landing_pad = o => {
  const { r } = o.data, grp = new THREE.Group(), pad = cy(r, r, .4, M.concrete(), 0, .2, 0, 48); pad.receiveShadow = true; grp.add(pad);
  grp.add(ring(r * .92, .3, g('cyan'), .45), ring(r * .55, .22, g('orange'), .45), ring(r * .2, .22, g('orange'), .45));
  for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283, l = new THREE.Mesh(new THREE.SphereGeometry(.4, 8, 6), i % 2 ? g('warm') : g('red')); l.position.set(Math.cos(a) * r * .98, .6, Math.sin(a) * r * .98); grp.add(l); }
  return grp;
};
PB.spaceship = (o, z) => {
  const { r, h } = o.data, grp = new THREE.Group(), body = cy(r * .75, r, h * .62, hull(), 0, h * .3 + 3, 0, 28); grp.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(r * .75, h * .34, 28), hull()); nose.position.y = h * .62 + h * .17 + 3; nose.castShadow = true; grp.add(nose);
  grp.add(cy(r * 1.01, r * 1.01, 1.6, M.plain(0xff8a4c, .5), 0, h * .35, 0, 28), cy(r * 1.01, r * 1.01, .5, dark(), 0, h * .5, 0, 28));
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2, fin = bx(.4, h * .3, r * 1.1, hull2(), Math.cos(a) * r * 1.1, h * .12 + 3, Math.sin(a) * r * 1.1, 1); fin.rotation.y = -a; grp.add(fin); const leg = cy(.18, .18, 7, dark(), Math.cos(a) * r * 1.5, 3, Math.sin(a) * r * 1.5, 6); leg.rotation.z = -Math.cos(a) * .3; leg.rotation.x = Math.sin(a) * .3; grp.add(leg); }
  for (let i = 0; i < 3; i++) { const a = i / 3 * 6.283, n = new THREE.Mesh(new THREE.CylinderGeometry(.6, 1.2, 2.4, 12), dark()); n.position.set(Math.cos(a) * r * .5, 2, Math.sin(a) * r * .5); grp.add(n); }
  grp.add(new THREE.Mesh(new THREE.SphereGeometry(.7, 10, 8), glass())).children.at(-1).position.set(0, h * .5 + 3, r * .72);
  const lab = makeLabel('Lander ARES-1', null, '#35e0ff', 8); lab.position.y = h + 8; grp.add(lab);
  return grp;
};
PB.hangar = o => {
  const { w, d, h } = o.data, grp = new THREE.Group(); grp.add(bx(w, h * .6, d, hull2(), 0, h * .3, 0, 2));
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, w, 20, 1, false, 0, Math.PI), hull()); roof.rotation.z = Math.PI / 2; roof.rotation.y = Math.PI / 2; roof.position.y = h * .6; roof.scale.set(1, 1, .5); roof.castShadow = true; grp.add(roof);
  grp.add(bx(w * .55, h * .5, .3, g('orange'), 0, h * .27, d / 2 + .05, 1)); return grp;
};
PB.control_tower = o => {
  const { r, h } = o.data, grp = new THREE.Group(); grp.add(cy(r * .5, r * .9, h * .8, hull(), 0, h * .4, 0, 16), cy(r * 1.5, r * 1.1, 4, glass(), 0, h * .8 + 2, 0, 16), cy(r * 1.7, r * 1.7, .5, dark(), 0, h * .8 + 4.3, 0, 16));
  grp.add(cy(.12, .12, 6, dark(), 0, h * .8 + 7.2, 0, 6)); const b = new THREE.Mesh(new THREE.SphereGeometry(.45, 10, 8), g('red')); b.position.y = h * .8 + 10.4; grp.add(b); return grp;
};
PB.cargo_container = o => { const { w, d, h, shade } = o.data; return bx(w, h, d, M.plain([0xb5532a, 0x2d5f8a, 0xc9a227][shade || 0], .7, .3), 0, h / 2, 0, 2); };
PB.survey_outpost = o => {
  const { r, h } = o.data, grp = new THREE.Group(); const d = half(r, hull(), h / r); d.position.y = .4; grp.add(d, cy(r * 1.1, r * 1.1, .4, hull2(), 0, .2, 0, 20), ring(r * .98, .1, g('warm'), 1.6));
  grp.add(cy(.07, .07, 5, dark(), r * .6, 3, 0, 6)); const dish = half(1.4, hull(), .45); dish.position.set(r * .6, 5.4, 0); dish.rotation.z = .6; grp.add(dish, rover(r * 1.8, r * .8, .5, 0xc9a227)); return grp;
};
PB.info_point = (o, z) => {
  const grp = new THREE.Group(), cap = g('orange');
  grp.add(cy(.3, .45, 1.2, dark(), 0, .6, 0, 10)); const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.3), cap); gem.position.y = 1.7; grp.add(gem);
  const rg = new THREE.Mesh(new THREE.TorusGeometry(.5, .04, 6, 24), cap); rg.position.y = 1.7; grp.add(rg);
  z.addInfo({ x: o.x, z: o.z, title: o.data.title, text: o.data.text }); z.addAnim((dt, t) => { rg.rotation.x = t; rg.rotation.y = t * .7; });
  return grp;
};
Object.assign(PB, civicBuilders('mars'));

// ---------- rocks (the server's "forest" objects become boulder fields) ----------
const shared = geo => { geo.userData.shared = true; return geo; };
const G = {};
const geoOf = (k, f) => G[k] || (G[k] = shared(f()));
function pickTree(h, rnd) { const r = rnd(); return r < .62 ? 'rock' : r < .9 ? 'boulder' : 'spire'; }
function treeMeshes(list) {
  const out = [], m4 = new THREE.Matrix4(), rockG = geoOf('rock', () => { const x = new THREE.DodecahedronGeometry(1, 0); x.scale(1, .65, 1); x.translate(0, .45, 0); return x; }), spireG = geoOf('spire', () => { const x = new THREE.ConeGeometry(.9, 5, 5); x.translate(0, 2.4, 0); return x; });
  const mk = (geo, mat, items, sy) => { if (!items.length) return; const m = new THREE.InstancedMesh(geo, mat, items.length); items.forEach((t, i) => { m4.makeRotationY(t.ry).scale(new THREE.Vector3(t.s * sy[0], t.s * sy[1] * (.8 + t.c * .5), t.s * sy[0])).setPosition(t.x, t.y - .1, t.z); m.setMatrixAt(i, m4); }); m.castShadow = m.receiveShadow = true; out.push(m); };
  const rocks = list.filter(t => t.type === 'rock'), boulders = list.filter(t => t.type === 'boulder'), spires = list.filter(t => t.type === 'spire');
  mk(rockG, M.plain(0x7a4a36, .95), rocks, [.7, .7]); mk(rockG, M.plain(0x5e3a2c, .95), boulders, [1.9, 1.6]); mk(spireG, M.plain(0x6b3d2c, .95), spires, [.9, 1.2]);
  return out;
}

export function makeMarsZone() {
  return new WakandaZone('mars', {
    title: 'Mars', dry: true, gravity: .38, nightFill: [.32, 0x4a2c34], B: PB, always: new Set(['command_center', 'landing_pad', 'spaceship', 'portal_gate', 'solar_farm']), glbPrefix: 'mr_', dirtAll: true, maxTrees: 4200, fog: [80, 560],
    palette: { hue: .045, sat: .5, light: .31, alt: '#7a3a22', rock: '#5a2f22', sand: '#cf9a68', dry: true },
    sky: { top: 0x7a4a32, bot: 0xe0a066, k: .9, sun: 0xffd2a0 }, pickTree, treeMeshes,
  });
}
