// Pandora Nature World scene config (original alien-nature design): colossal home tree, glowing flora, floating islands with
// waterfalls, woven pods, docks over an azure sea, ancient ruins. Reuses the generic open-zone engine (WakandaZone with a config):
// streamed terrain chunks, instanced vegetation, server-defined objects. Bioluminescence uses the shared night factor (glowMat).
import * as THREE from 'three';
import { M, glowMat } from './materials.js';
import { makeLabel, crownGeo, scaleUV } from './world.js';
import { WakandaZone, mesh, bx, cy } from './wakanda.js';
import { civicBuilders } from './civic.js';
import { WATER } from './terrain.js';

const bark = () => M.plain(0x2b2340, .9), moss = () => M.ground();
const GL = {
  teal: () => glowMat({ color: 0x0f3b40, emissive: 0x2affd0, roughness: .7 }, .9), violet: () => glowMat({ color: 0x24103c, emissive: 0xb06cff, roughness: .7 }, 1.0),
  pink: () => glowMat({ color: 0x3c1030, emissive: 0xff5fb0, roughness: .7 }, 1.1), green: () => glowMat({ color: 0x0f3a18, emissive: 0x7dff6a, roughness: .7 }, 1.0),
  cyan: () => glowMat({ color: 0x0b2a40, emissive: 0x66e6ff, roughness: .4 }, 1.6), warm: () => glowMat({ color: 0x2a2010, emissive: 0xffd9a0, roughness: .5 }, 1.1),
};
const glows = {}; const gm = k => glows[k] || (glows[k] = GL[k]());
const weaveMat = (() => { let m; return () => m || (m = (() => { const x = M.thatch().clone(); x.color.set(0xb79ad8); return x; })()); })();
const PB = {};

function bigTree(o, canopyK, g = new THREE.Group()) {
  const { r, h } = o.data, tb = glowMat({ color: 0x4a3a70, emissive: 0x2a8f9a, roughness: .85 }, .3);      // bark with faint luminous veins
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r * .5, r, h, 28, 6), tb); trunk.position.y = h / 2; trunk.castShadow = trunk.receiveShadow = true; g.add(trunk);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, root = new THREE.Mesh(new THREE.TorusGeometry(r * .8, r * .2, 8, 16, Math.PI), tb); root.position.set(Math.cos(a) * r * .75, 0, Math.sin(a) * r * .75); root.rotation.y = -a; root.castShadow = true; g.add(root); }
  const cols = ['teal', 'violet', 'teal', 'green', 'violet'];
  for (let i = 0; i < 5; i++) {                                           // layered glowing canopy
    const R = r * canopyK * (1 - i * .13), blob = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 14), gm(cols[i])); blob.scale.y = .32; blob.position.set(Math.cos(i * 2.2) * r * .6, h * (.74 + i * .06), Math.sin(i * 2.2) * r * .6); blob.castShadow = true; g.add(blob);
  }
  for (let i = 0; i < 34; i++) {                                           // hanging glowing vines
    const a = i * 2.4, rad = r * canopyK * (.35 + (i % 5) * .13), len = 14 + (i * 7 % 26), v = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, len, 5), bark());
    v.position.set(Math.cos(a) * rad, h * .74 - len / 2, Math.sin(a) * rad); g.add(v);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(.4, 8, 6), gm(i % 2 ? 'pink' : 'cyan')); tip.position.set(v.position.x, h * .74 - len, v.position.z); g.add(tip);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 2.4, .25, 8, 64), gm('teal')); ring.rotation.x = Math.PI / 2; ring.position.y = .15; g.add(ring);
  return g;
}
PB.hometree = o => bigTree(o, 3.1);
PB.spirit_tree = o => bigTree(o, 2.6);

PB.organic_hut = o => {
  const { r, h } = o.data, g = new THREE.Group(), dome = new THREE.Mesh(new THREE.SphereGeometry(r * 1.15, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2), weaveMat());
  dome.scale.y = h / (r * 1.15); dome.position.y = .5; dome.castShadow = dome.receiveShadow = true; g.add(dome);
  g.add(cy(r * 1.2, r * 1.3, .5, bark(), 0, .25, 0, 18));
  const a = o.rot, dx = -Math.cos(a), dz = -Math.sin(a), door = new THREE.Mesh(new THREE.TorusGeometry(r * .36, .12, 8, 18, Math.PI), gm('warm')); door.position.set(dx * r * 1.1, .5, dz * r * 1.1); door.rotation.y = Math.atan2(dx, dz); g.add(door);
  for (let i = 0; i < 6; i++) { const t = i / 6 * 6.28 + .4; const s = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 6), gm(i % 2 ? 'teal' : 'violet')); s.position.set(Math.cos(t) * r * .95, 1.5 + (i % 3) * .5, Math.sin(t) * r * .95); g.add(s); }
  const tip = new THREE.Mesh(new THREE.SphereGeometry(.4, 10, 8), gm('teal')); tip.position.y = h + .9; g.add(tip);
  return g;
};
PB.council_hall = o => {
  const { w, d, h } = o.data, g = new THREE.Group(), dome = new THREE.Mesh(new THREE.SphereGeometry(w * .5, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), weaveMat());
  dome.scale.set(1, h / (w * .5), d / w); dome.position.y = 1; dome.castShadow = dome.receiveShadow = true; g.add(dome);
  g.add(cy(w * .56, w * .6, 1, bark(), 0, .5, 0, 28));
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; const p = cy(.5, .7, h * .8, bark(), Math.cos(a) * w * .5, h * .4, Math.sin(a) * d * .5, 8); g.add(p); const bead = new THREE.Mesh(new THREE.SphereGeometry(.5, 8, 6), gm('cyan')); bead.position.set(Math.cos(a) * w * .5, h * .82, Math.sin(a) * d * .5); g.add(bead); }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(w * .3, .3, 8, 48), gm('teal')); halo.rotation.x = Math.PI / 2; halo.position.y = h + 2; g.add(halo);
  return g;
};
PB.dock = o => {
  const { w, d } = o.data, g = new THREE.Group(); g.add(bx(w, .3, d, M.wood(), 0, -.15, 0, 2));
  for (let z = -d / 2 + 2; z <= d / 2; z += 6) for (const sx of [-1, 1]) g.add(cy(.18, .18, 4, M.wood(), sx * (w / 2 - .4), -2.1, z, 8));
  for (let z = -d / 2 + 4; z <= d / 2; z += 9) { const p = cy(.07, .07, 2, bark(), w / 2 - .3, 1, z, 6), l = new THREE.Mesh(new THREE.SphereGeometry(.28, 8, 6), gm('warm')); l.position.set(w / 2 - .3, 2.1, z); g.add(p, l); }
  return g;
};
PB.ruin = o => {
  const { w, d, h } = o.data, g = new THREE.Group(); g.rotation.y = o.rot; const rock = M.rock();
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, hh = h * (.35 + ((i * 37) % 10) / 14), c = cy(1.1, 1.3, hh, rock, Math.cos(a) * w * .42, hh / 2, Math.sin(a) * d * .42, 10); c.rotation.z = ((i * 13) % 7 - 3) * .02; g.add(c); }
  const arch = new THREE.Mesh(new THREE.TorusGeometry(w * .22, 1, 8, 16, Math.PI * .78), rock); arch.position.set(0, h * .55, d * .42); arch.rotation.z = .2; arch.castShadow = true; g.add(arch);
  for (let i = 0; i < 6; i++) g.add(bx(2.4 + i % 3, 1.2, 1.8, rock, (i - 2.5) * 3, .6, (i % 2 ? 1 : -1) * d * .1, 2));
  g.add(new THREE.Mesh(new THREE.OctahedronGeometry(.9), gm('cyan'))).children.at(-1).position.set(0, 1.2, 0);
  return g;
};
PB.flight_ground = o => {
  const { r } = o.data, g = new THREE.Group(), pad = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(r, r, .3, 32), 3, 1), M.concrete()); pad.position.y = .15; pad.receiveShadow = true; g.add(pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * .8, .2, 8, 48), gm('cyan')); ring.rotation.x = Math.PI / 2; ring.position.y = .35; g.add(ring);
  for (let i = 0; i < 3; i++) { const a = i * 2.1, p = cy(.18, .22, 9, bark(), Math.cos(a) * r * .55, 4.5, Math.sin(a) * r * .55, 8); g.add(p, bx(4, .25, .25, bark(), Math.cos(a) * r * .55, 9, Math.sin(a) * r * .55, 1)); }
  return g;
};
PB.info_point = (o, z) => {
  const g = new THREE.Group(), cap = gm('warm');
  g.add(cy(.3, .45, 1.2, bark(), 0, .6, 0, 10)); g.add(new THREE.Mesh(new THREE.OctahedronGeometry(.3), cap)).children.at(-1).position.y = 1.7;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.5, .04, 6, 24), cap); ring.position.y = 1.7; g.add(ring);
  z.addInfo({ x: o.x, z: o.z, title: o.data.title, text: o.data.text }); z.addAnim((dt, t) => { ring.rotation.x = t; ring.rotation.y = t * .7; });
  return g;
};
PB.floating_island = (o, z) => {
  const { r, h, alt } = o.data, g = new THREE.Group(), isl = new THREE.Group(); isl.position.y = alt; g.add(isl);
  const top = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(r, r * .92, 3, 24), r / 3, 1), moss()); top.material = top.material.clone(); top.material.color.set(0x6fc9a8); top.castShadow = top.receiveShadow = true; isl.add(top);
  const geo = new THREE.ConeGeometry(r * .92, h * 1.5, 16, 4, true); const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 1 + Math.sin(p.getX(i) * .31 + p.getY(i) * .23) * .12 + Math.cos(p.getZ(i) * .27 - p.getY(i) * .17) * .1; p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k); } geo.computeVertexNormals();
  const under = new THREE.Mesh(geo, M.rock()); under.rotation.x = Math.PI; under.position.y = -1.5 - h * .75; under.castShadow = true; isl.add(under);
  for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(.9, 5 + i % 3 * 2, 6), gm('cyan')); const a = i * 1.05; c.position.set(Math.cos(a) * r * .25, -h * 1.1 - 3, Math.sin(a) * r * .25); c.rotation.x = Math.PI; isl.add(c); }
  for (let i = 0; i < 9; i++) {                                           // glowing flora on top
    const a = i * 2.4, rr = r * (.15 + (i % 4) * .18), x = Math.cos(a) * rr, zz = Math.sin(a) * rr;
    isl.add(cy(.25, .35, 4, bark(), x, 3.5, zz, 7)); const cr = new THREE.Mesh(new THREE.SphereGeometry(2 + i % 3, 12, 8), gm(['teal', 'violet', 'green'][i % 3])); cr.scale.y = .5; cr.position.set(x, 6, zz); isl.add(cr);
  }
  const wr = r * .3, fall = new THREE.Mesh(new THREE.PlaneGeometry(wr, alt + 8), new THREE.MeshBasicMaterial({ map: fallTex(), transparent: true, opacity: .6, side: THREE.DoubleSide, depthWrite: false }));
  fall.position.set(r * .86, -(alt + 8) / 2 + 1.5, 0); fall.rotation.y = Math.PI / 2; isl.add(fall);
  for (let i = 0; i < 14; i++) { const a = i / 14 * 6.28, len = 8 + (i * 5 % 14), v = cy(.05, .05, len, bark(), Math.cos(a) * r * .95, -len / 2, Math.sin(a) * r * .95, 5); isl.add(v); const t = new THREE.Mesh(new THREE.SphereGeometry(.3, 8, 6), gm(i % 2 ? 'pink' : 'cyan')); t.position.set(Math.cos(a) * r * .95, -len, Math.sin(a) * r * .95); isl.add(t); }
  z.addAnim((dt, t) => { isl.position.y = alt + Math.sin(t * .35 + o.x * .1) * .4; isl.rotation.y += dt * .01; });
  return g;
};
let _ft; function fallTex() {
  if (_ft) return _ft;
  const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#d8f4ff'; g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * .8})`; g.fillRect(Math.random() * 64, Math.random() * 256, 1 + Math.random() * 2, 20 + Math.random() * 60); }
  _ft = new THREE.CanvasTexture(c); _ft.wrapS = _ft.wrapT = THREE.RepeatWrapping; _ft.colorSpace = THREE.SRGBColorSpace; _ft.repeat.set(1, 6); return _ft;
}
Object.assign(PB, civicBuilders('pandora'));

// ---------- vegetation ----------
const shared = g => { g.userData.shared = true; return g; };
const G = {};
const geoOf = (k, f) => G[k] || (G[k] = shared(f()));
function pickTree(h, rnd, data) {
  const r = rnd();
  if (h < 1.4) return r < .6 ? 'fern' : 'shroom';
  if (data && data.mix === 'sacred') return r < .32 ? 'lumitree' : r < .75 ? 'shroom' : 'fern';
  return r < .5 ? 'lumitree' : r < .8 ? 'fern' : 'shroom';
}
function treeMeshes(list) {
  const out = [], m4 = new THREE.Matrix4(), col = new THREE.Color();
  const mk = (geo, mat, items, place) => { if (!items.length) return; const m = new THREE.InstancedMesh(geo, mat, items.length); items.forEach((t, i) => { place(t, i, m); }); m.castShadow = true; out.push(m); };
  const trunkG = geoOf('trunk', () => { const g = new THREE.CylinderGeometry(.22, .5, 5.5, 7); g.translate(0, 2.75, 0); return g; });
  const crownG = geoOf('crown', () => { const g = crownGeo('acacia').clone(); return g; });
  const stemG = geoOf('stem', () => { const g = new THREE.CylinderGeometry(.14, .22, 2.4, 7); g.translate(0, 1.2, 0); return g; });
  const capG = geoOf('cap', () => { const g = new THREE.SphereGeometry(1.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1, .6, 1); g.translate(0, 2.4, 0); return g; });
  const fernG = geoOf('fern', () => { const parts = []; for (let i = 0; i < 6; i++) { const c = new THREE.ConeGeometry(.35, 3.2, 5); c.translate(0, 1.6, 0); c.rotateZ(.5 + (i % 2) * .2); c.rotateY(i / 6 * 6.28); parts.push(c.toNonIndexed()); } let n = 0; const g = new THREE.BufferGeometry(); const pos = []; for (const p of parts) pos.push(...p.attributes.position.array); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; });
  const set = (t, i, m, sy = 1) => { m4.makeRotationY(t.ry).scale(new THREE.Vector3(t.s, t.s * sy, t.s)).setPosition(t.x, t.y - .1, t.z); m.setMatrixAt(i, m4); };
  const lumi = list.filter(t => t.type === 'lumitree'), kinds = ['teal', 'violet', 'pink'];
  mk(trunkG, bark(), lumi, (t, i, m) => set(t, i, m, .9 + t.c * .4));
  for (let k = 0; k < 3; k++) mk(crownG, gm(kinds[k]), lumi.filter((t, i) => i % 3 === k), (t, i, m) => { m4.makeRotationY(t.ry).scale(new THREE.Vector3(t.s * .9, t.s * (.9 + t.c * .4), t.s * .9)).setPosition(t.x, t.y + 1.2, t.z); m.setMatrixAt(i, m4); });
  const sh = list.filter(t => t.type === 'shroom');
  mk(stemG, M.plain(0xdfd3f0, .8), sh, (t, i, m) => set(t, i, m));
  for (let k = 0; k < 3; k++) mk(capG, gm(['pink', 'violet', 'cyan'][k]), sh.filter((t, i) => i % 3 === k), (t, i, m) => set(t, i, m));
  const fe = list.filter(t => t.type === 'fern'); for (let k = 0; k < 2; k++) mk(fernG, gm(['green', 'teal'][k]), fe.filter((t, i) => i % 2 === k), (t, i, m) => set(t, i, m, 1 + t.c));
  return out;
}

// Landing surfaces (collider.lid = never blocks, but aircraft and jumping players can stand on it): canopies, mushroom caps, island tops.
function lids(o, z) {
  const d = o.data, g = z.hf.groundAt(o.x, o.z);
  if (o.kind === 'hometree' || o.kind === 'spirit_tree') { const R = d.r * (o.kind === 'hometree' ? 3.1 : 2.6) * .62; return [{ x0: o.x - R, x1: o.x + R, z0: o.z - R, z1: o.z + R, h: g + d.h * .74 + d.r * (o.kind === 'hometree' ? 3.1 : 2.6) * .32 * .85, lid: true }]; }
  if (o.kind === 'floating_island') { const R = d.r * .85; return [{ x0: o.x - R, x1: o.x + R, z0: o.z - R, z1: o.z + R, h: g + d.alt + 1.5, lid: true }]; }
  return [];
}
function trunkH(t) {                    // trunk blocks only up to its own height, so aircraft can settle on the canopy above it
  if (t.type === 'lumitree') return t.y + 4.0 * t.s * (.9 + t.c * .4);
  if (t.type === 'shroom') return t.y + 2.4 * t.s;
  return undefined;
}
function treeLid(t) {
  if (t.type === 'lumitree') { const R = 2.2 * t.s; return [{ x0: t.x - R, x1: t.x + R, z0: t.z - R, z1: t.z + R, h: t.y + 1.2 + 5.2 * t.s * (.9 + t.c * .4), lid: true }]; }
  if (t.type === 'shroom') { const R = .95 * t.s; return [{ x0: t.x - R, x1: t.x + R, z0: t.z - R, z1: t.z + R, h: t.y + 3.0 * t.s, lid: true }]; }
  return [];
}

function addSea(z) {                                                       // the azure sea beyond the shore line
  const c = z.objects.find(o => o.kind === 'coast'); if (!c) return;
  const w = z.bound * 2 + 400, d = z.bound - c.data.z0 + 300, geo = scaleUV(new THREE.PlaneGeometry(w, d), w / 14, d / 14); geo.rotateX(-Math.PI / 2);
  const sea = mesh(geo, M.river(), 0, WATER + .02, c.data.z0 + d / 2 - 20, false); sea.castShadow = false; z.group.add(sea);
}

export function makePandoraZone() {
  return new WakandaZone('pandora', {
    title: 'Pandora', nightFill: [.55, 0x3a6a8a], B: PB, always: new Set(['hometree', 'spirit_tree', 'floating_island', 'council_hall']), glbPrefix: 'pd_', dirtAll: true, maxTrees: 7500, fog: [110, 720],
    palette: { hue: .5, sat: .55, light: .08, alt: '#5b3a8a', rock: '#43405e', sand: '#cdb98c' }, pickTree, treeMeshes, extra: addSea, lids, treeLid, trunkH,
  });
}
