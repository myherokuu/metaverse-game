// The city. Modular PBR buildings (or GLB buildings from assets.json), roads with kerbs and pavements, plaza, trees, street
// lights. Lighting/sky live in lighting.js, materials in materials.js. Units are metres (floor height ~3.8 m, road 6 m).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { M, facade, glowMat, opts, fbm } from './materials.js';
import { getBuilding, fitModel } from './assets.js';

export const scene = new THREE.Scene();   // lights/sky live here; every zone's content is a Group added to it
export let seats = [];                    // {x,z,y,heading}: places you can sit (benches); y = seat surface height above ground
export let colliders = [];                // {x0,x1,z0,z1} of the zone being built (live binding)
export const BOUND = 98;
let animated = [];
let root = scene;                         // where the builders below add things

const rand = (seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; })(42);

export function makeLabel(text, sub, color = '#35e0ff', scaleW = 12) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  spr.scale.set(scaleW, scaleW / 4, 1);
  const draw = (t, s, col) => {
    const g = c.getContext('2d'); g.clearRect(0, 0, 512, 128);
    g.fillStyle = 'rgba(8,12,28,.72)'; g.strokeStyle = col; g.lineWidth = 3;
    g.beginPath(); g.roundRect(6, 6, 500, 116, 22); g.fill(); g.stroke();
    g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = 'bold 50px system-ui,sans-serif';
    g.fillText(t, 256, s ? 62 : 82, 480);
    if (s) { g.fillStyle = col; g.font = '30px system-ui,sans-serif'; g.fillText(s, 256, 104, 480); }
    tex.needsUpdate = true;
  };
  draw(text, sub, color); spr.userData.redraw = draw;
  return spr;
}

// ---------- helpers ----------
export const scaleUV = (geo, su, sv) => { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); uv.needsUpdate = true; return geo; };
export function boxUV(geo, w, h, d, tile) {          // box faces: px,nx (d x h), py,ny (w x d), pz,nz (w x h)
  const f = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]], uv = geo.attributes.uv;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) uv.setXY(i * 4 + j, uv.getX(i * 4 + j) * f[i][0] / tile, uv.getY(i * 4 + j) * f[i][1] / tile);
  return geo;
}
const box = (w, h, d, mat, x, y, z, tile = 3, parent = root) => {
  const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, tile), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
};
const addCollider = (x, z, w, d) => colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
function distSeg(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz);
}
const warmGlow = () => glowMat({ color: 0x222222, emissive: 0xffd9a0, roughness: .3 }, 1.1);

// ---------- buildings ----------
const STYLE = { hq: 'glass', lab: 'lab', library: 'stone', meeting: 'civic' };
function buildBuilding(loc) {
  const { x, z, w, d, h, color, kind } = loc, g = new THREE.Group(); g.position.set(x, 0, z);
  const sgn = z < 0 ? 1 : -1, hexc = new THREE.Color(color), glb = getBuilding(kind), conc = M.concrete();
  if (glb) {                                           // user-supplied GLB replaces the procedural building
    const m = glb.scene.clone(true); fitModel(m, w, d, h); m.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; }); g.add(m);
  } else {
    const style = STYLE[kind] || 'civic', floors = Math.max(2, Math.round(h / 3.8)), cw = Math.max(3, Math.round(w / 2.6)), cd = Math.max(3, Math.round(d / 2.6));
    const fx = facade(style, cd, floors, color, 1), fz = facade(style, cw, floors, color, 2), roofM = M.concrete();
    const body = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, 3), [fx, fx, roofM, conc, fz, fz]);
    body.position.y = h / 2 + .3; body.castShadow = body.receiveShadow = true; g.add(body);
    box(w + .8, .6, d + .8, conc, 0, .3, 0, 3, g);                                 // plinth
    // parapet + glowing roof edge
    const t = .35, py = h + .3 + .45;
    for (const [bw, bd, bx, bz] of [[w + .4, t, 0, d / 2], [w + .4, t, 0, -d / 2], [t, d, w / 2, 0], [t, d, -w / 2, 0]]) box(bw, .9, bd, conc, bx, py, bz, 3, g);
    const strip = glowMat({ color: hexc, emissive: hexc }, 1.6);
    for (const [bw, bd, bx, bz] of [[w + .4, .1, 0, d / 2 + .02], [w + .4, .1, 0, -d / 2 - .02], [.1, d, w / 2 + .02, 0], [.1, d, -w / 2 - .02, 0]]) box(bw, .12, bd, strip, bx, py + .5, bz, 3, g);
    if (!opts.fallback) {                                                          // vertical fins add real depth to the facade
      const finMat = style === 'glass' ? M.plain(0x1a202c, .35, .85) : conc, cols = [[cw, w, 'x'], [cd, d, 'z']];
      const fins = new THREE.InstancedMesh(new THREE.BoxGeometry(.22, h - .2, .38), finMat, (cw + 1) * 2 + (cd + 1) * 2); let n = 0, mt = new THREE.Matrix4();
      for (let i = 0; i <= cw; i++) for (const s of [1, -1]) { mt.makeTranslation(-w / 2 + i * w / cw, h / 2 + .3, s * (d / 2 + .1)); fins.setMatrixAt(n++, mt); }
      for (let i = 0; i <= cd; i++) for (const s of [1, -1]) { mt.makeTranslation(s * (w / 2 + .1), h / 2 + .3, -d / 2 + i * d / cd); fins.setMatrixAt(n++, mt); }
      fins.castShadow = fins.receiveShadow = true; if (style === 'glass' || style === 'lab') g.add(fins);
      for (let i = 0; i < 3; i++) box(2 + rand() * 1.5, 1.2, 1.6, M.metal(), (rand() - .5) * w * .6, h + .9 + .6, (rand() - .5) * d * .6, 2, g);   // roof plant
    }
    if (kind === 'hq') {                                                           // setback crown + antenna beacon
      const cf = facade('glass', Math.max(3, Math.round(w * .62 / 2.6)), 2, color, 3), cf2 = facade('glass', Math.max(3, Math.round(d * .62 / 2.6)), 2, color, 4);
      const crown = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w * .62, 7.6, d * .62), w * .62, 7.6, d * .62, 3), [cf2, cf2, roofM, conc, cf, cf]); crown.position.y = h + 1.2 + 3.8; crown.castShadow = true; g.add(crown);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(.08, .15, 9, 8), M.metal()); ant.position.y = h + 9 + 4.5; ant.castShadow = true; g.add(ant);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(.4, 12, 8), strip); tip.position.y = h + 18.2; g.add(tip);
    } else if (kind === 'lab') {                                                   // observatory dome
      const r = Math.min(w, d) * .28, dome = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.glass(0x9fd6c4));
      dome.position.y = h + 1.2; g.add(dome);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, .18, 8, 40), strip); ring.rotation.x = Math.PI / 2; ring.position.y = h + 1.2; g.add(ring);
    } else if (kind === 'library') {                                               // portico: columns, entablature, pediment, steps
      const pz = sgn * (d / 2 + 1.6), ph = h - .6;
      for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(.34, .38, ph, 16), M.plaster()); c.position.set((i - 2.5) * (w * .8 / 5), ph / 2 + .6, pz); c.castShadow = true; g.add(c); }
      box(w * .84, .7, 3.2, conc, 0, ph + .95, sgn * (d / 2 + 1.2), 3, g);
      const tri = new THREE.Shape(); tri.moveTo(-w * .42, 0); tri.lineTo(w * .42, 0); tri.lineTo(0, 2.4);
      const ped = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 3.2, bevelEnabled: false }), conc); scaleUV(ped.geometry, .3, .3);
      ped.position.set(0, ph + 1.3, sgn * (d / 2 + 1.2) - 1.6); ped.castShadow = true; g.add(ped);
      for (let i = 0; i < 3; i++) box(w * .8 + (2 - i) * .8, .22, 1.2 + i * .3, conc, 0, .11 + i * .22 - .05, sgn * (d / 2 + 2.6 + (2 - i) * .3), 3, g);
    } else if (kind === 'meeting') {                                               // glowing halo ring over the roof + canopy
      const ring = new THREE.Mesh(new THREE.TorusGeometry(w * .3, .22, 10, 48), strip); ring.rotation.x = Math.PI / 2; ring.position.y = h + 3.2; g.add(ring); animated.push(ring);
      for (const sx of [-1, 1]) box(.4, 4.4, .4, conc, sx * 4.8, 2.4, sgn * (d / 2 + 2.6), 3, g);
      box(11, .35, 4.2, conc, 0, 4.7, sgn * (d / 2 + 2.1), 3, g);
    }
    // entrance: glass door with warm interior glow + canopy
    const door = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.4, .15), warmGlow()); door.position.set(0, 1.9, sgn * (d / 2 + .06)); g.add(door);
    if (kind !== 'library' && kind !== 'meeting') box(6, .3, 2.4, M.metal(), 0, 4.2, sgn * (d / 2 + 1.2), 2, g);
  }
  const lab = makeLabel(loc.name, null, color, 15); lab.position.set(0, h + (kind === 'hq' ? 24 : 8), 0); g.add(lab);
  root.add(g); addCollider(x, z, w + .8, d + .8);
}

function buildHouses(L, res) {
  const accents = [0xd8c8b0, 0xc9d3dc, 0xdcc3b4, 0xbfd0c2];
  L.houses.forEach(([x, z, w, d, h], i) => {
    const sgn = z < 54 ? 1 : -1, g = new THREE.Group(); g.position.set(x, 0, z);
    const wall = M.plaster().clone(); wall.color.set(accents[i % 4]); wall.envMapIntensity = .5;
    box(w, h, d, wall, 0, h / 2, 0, 3, g); box(w + .3, .35, d + .3, M.concrete(), 0, .17, 0, 3, g);
    const rs = new THREE.Shape(); rs.moveTo(-(w + 1) / 2, 0); rs.lineTo((w + 1) / 2, 0); rs.lineTo(0, 2.6);
    const roof = new THREE.Mesh(scaleUV(new THREE.ExtrudeGeometry(rs, { depth: d + 1, bevelEnabled: false }), .5, .5), M.roof());
    roof.position.set(0, h, -(d + 1) / 2); roof.castShadow = roof.receiveShadow = true; g.add(roof);
    box(.7, 2.2, .7, M.concrete(), w * .25, h + 1.6, 0, 3, g);                              // chimney
    const win = warmGlow(); box(1, 2.1, .12, M.plain(0x5a4030, .6), 0, 1.1, sgn * (d / 2 + .04), 3, g);
    for (const wx of [-w * .3, w * .3]) { box(1.2, 1.3, .14, win, wx, 2.6, sgn * (d / 2 + .03), 3, g); box(1.5, .12, .3, M.concrete(), wx, 1.9, sgn * (d / 2 + .1), 3, g); }
    root.add(g); addCollider(x, z, w, d);
  });
  const rl = makeLabel(res.name, null, res.color, 15); rl.position.set(res.x, 13, res.z - 4); root.add(rl);
}

// ---------- roads / plaza / props ----------
function buildRoads(L) {
  const roadW = 6, deg = {}; L.edges.forEach(([a, b]) => { deg[a] = (deg[a] || 0) + 1; deg[b] = (deg[b] || 0) + 1; });
  const flat = (geo, mat, x, y, z, rotY) => { const m = new THREE.Mesh(geo, mat); m.rotation.set(-Math.PI / 2, rotY, 0, 'YXZ'); m.position.set(x, y, z); m.receiveShadow = true; root.add(m); return m; };
  const asph = M.asphalt(), pave = M.pavement(), lane = M.lane(), kerb = M.concrete();
  for (const [a, b] of L.edges) {
    if (/^rd\d/.test(a) || /^rd\d/.test(b)) continue;                    // government-built roads are drawn by their civic_road object
    const A = L.nodes[a], B = L.nodes[b], len = Math.hypot(B[0] - A[0], B[1] - A[1]), ang = -Math.atan2(B[1] - A[1], B[0] - A[0]), mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
    flat(scaleUV(new THREE.PlaneGeometry(len, roadW), len / 6, 1), asph, mx, .03, mz, ang);
    flat(scaleUV(new THREE.PlaneGeometry(len, .16), len / 6, 1), lane, mx, .045, mz, ang);
    // pavements either side, trimmed where roads meet so they do not cross the junction
    const t0 = deg[a] > 1 ? 4.2 : 0, t1 = deg[b] > 1 ? 4.2 : 0, sl = len - t0 - t1;
    if (sl > 2) for (const s of [1, -1]) {
      const off = (roadW / 2 + 1.2) * s, c = (t0 - t1) / 2, ux = (B[0] - A[0]) / len, uz = (B[1] - A[1]) / len;
      const px = mx + ux * c - uz * off, pz = mz + uz * c + ux * off;
      flat(scaleUV(new THREE.PlaneGeometry(sl, 2.4), sl / 2, 1.2), pave, px, .055, pz, ang);
      const kx = mx + ux * c - uz * (roadW / 2 + .05) * s, kz = mz + uz * c + ux * (roadW / 2 + .05) * s;   // kerb line
      const k = new THREE.Mesh(new THREE.BoxGeometry(sl, .1, .14), kerb); k.position.set(kx, .06, kz); k.rotation.y = ang; k.receiveShadow = true; root.add(k);
    }
  }
  for (const [k, n] of Object.entries(L.nodes)) if (!/^rd\d/.test(k)) flat(scaleUV(new THREE.CircleGeometry(3.4, 24), 1.1, 1.1), asph, n[0], .031, n[1], 0);
}

function buildPlaza(L) {
  const pl = L.locations.find(l => l.kind === 'plaza'), R = 13;
  const disc = new THREE.Mesh(scaleUV(new THREE.CircleGeometry(R, 64), R * 2 / 4, R * 2 / 4), M.plaza()); disc.rotation.x = -Math.PI / 2; disc.position.y = .06; disc.receiveShadow = true; root.add(disc);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(R, .12, 6, 96), M.concrete()); edge.rotation.x = Math.PI / 2; edge.position.y = .08; edge.receiveShadow = true; root.add(edge);
  const inlay = new THREE.Mesh(new THREE.RingGeometry(R - 1.1, R - .8, 96), glowMat({ color: 0x35e0ff, emissive: 0x35e0ff, side: THREE.DoubleSide }, 1.4)); inlay.rotation.x = -Math.PI / 2; inlay.position.y = .09; root.add(inlay);
  const core = new THREE.Mesh(new THREE.CircleGeometry(2.4, 48), glowMat({ color: 0x0b1a2a, emissive: 0x35e0ff, side: THREE.DoubleSide }, .9)); core.rotation.x = -Math.PI / 2; core.position.y = .09; root.add(core);
  // floating gyroscope sculpture (keeps the plaza centre walkable)
  const gy = new THREE.Group(), gm = glowMat({ color: 0x9fb4ff, emissive: 0x5c7cff, roughness: .25, metalness: .9 }, 1.1); gy.position.y = 3.4;
  for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(1.1 + i * .35, .05, 10, 64), gm); r.rotation.set(i * 1.05, i * .6, 0); r.castShadow = true; r.userData.spin = [.4 + i * .15, .3, .2 * i]; gy.add(r); animated.push(r); }
  root.add(gy);
  const pol = new THREE.Mesh(new THREE.CylinderGeometry(.12, .22, 2.2, 12), M.metal()); pol.position.y = 1.1; pol.castShadow = true; root.add(pol);
  const lab = makeLabel(pl.name, null, pl.color, 12); lab.position.set(0, 7.5, 0); root.add(lab);
  if (opts.fallback) return;
  // benches facing the centre + planters on the diagonals (clear of the walking paths)
  const wood = M.plain(0x6b4a30, .7), steel = M.plain(0x20242c, .4, .8);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, g = new THREE.Group(); g.position.set(Math.cos(a) * 9.6, 0, Math.sin(a) * 9.6); g.rotation.y = -a + Math.PI / 2;
    box(2, .08, .55, wood, 0, .45, 0, 1, g); box(2, .5, .08, wood, 0, .8, -.27, 1, g); for (const sx of [-.85, .85]) box(.08, .45, .5, steel, sx, .22, 0, 1, g);
    root.add(g); addCollider(g.position.x, g.position.z, 2.2, 2.2);
    for (const sx of [-.5, .5]) { const c = Math.cos(g.rotation.y), sn = Math.sin(g.rotation.y); seats.push({ x: g.position.x + sx * c - .08 * sn, z: g.position.z - sx * sn - .08 * c, y: .49, heading: g.rotation.y }); }   // two seats per bench, facing the bench's front
    const pa = a + .28, px = Math.cos(pa) * 11.4, pz = Math.sin(pa) * 11.4, pot = new THREE.Mesh(new THREE.CylinderGeometry(.7, .55, .8, 16), M.concrete()); pot.position.set(px, .4, pz); pot.castShadow = pot.receiveShadow = true; root.add(pot);
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(.75, 2), M.leaf()); bush.position.set(px, 1.2, pz); bush.scale.y = .8; bush.castShadow = true; root.add(bush);
  }
}

// ---------- vegetation ----------
const _crown = {};
export function crownGeo(kind) {            // 'round' | 'conifer' | 'acacia' (cached, shared between instanced meshes)
  kind = kind === true ? 'conifer' : kind === false ? 'round' : kind;
  if (_crown[kind]) return _crown[kind];
  let parts = [];
  if (kind === 'conifer') for (let i = 0; i < 4; i++) { const c = new THREE.ConeGeometry(1.7 - i * .32, 2.4, 10); c.translate(0, 2.6 + i * 1.15, 0); parts.push(c); }
  else {
    const blobs = kind === 'acacia' ? [[2.6, 0, 4.6, 0, .38], [2.0, 1.9, 4.2, .6, .34], [2.1, -1.8, 4.3, -.7, .34]] : [[1.9, 0, 4.4, 0, 1], [1.4, .95, 3.7, .4, 1], [1.5, -.9, 3.8, -.5, 1], [1.2, .1, 5.4, -.2, 1]];
    for (const [r, x, y, z, sy] of blobs) {
      let b = new THREE.IcosahedronGeometry(r, 2); b.deleteAttribute('normal'); b.deleteAttribute('uv'); b = mergeVertices(b);
      const p = b.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + (fbm((p.getX(i) + 9) * .13 + .5, (p.getZ(i) + p.getY(i) + 9) * .13 + .5, 3, 4, 3) - .5) * .7; p.setXYZ(i, p.getX(i) * k + x, p.getY(i) * k * sy + y, p.getZ(i) * k + z); }
      b.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from({ length: p.count * 2 }, (_, i) => (i % 2 ? p.getY(i >> 1) : p.getX(i >> 1)) * .4), 2)); b.computeVertexNormals(); parts.push(b);
    }
  }
  const g = mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g)); g.userData.shared = true; return (_crown[kind] = g);
}

function buildVegetation(L) {
  const segs = L.edges.map(([a, b]) => [L.nodes[a], L.nodes[b]]), pts = [];
  for (let i = 0; i < 2500 && pts.length < (opts.fallback ? 70 : 150); i++) {
    const x = (rand() - .5) * 2 * 118, z = (rand() - .5) * 2 * 118;
    if (Math.hypot(x, z) < 18 || segs.some(s => distSeg(x, z, s[0], s[1]) < 7.5)) continue;
    if (colliders.some(c => x > c.x0 - 4 && x < c.x1 + 4 && z > c.z0 - 4 && z < c.z1 + 4)) continue;
    if ((L.parcels || []).some(p => x > p.x0 - 3 && x < p.x1 + 3 && z > p.z0 - 3 && z < p.z1 + 3)) continue;   // land reserved for government development
    pts.push([x, z, rand() < .35]);
  }
  const trunkG = new THREE.CylinderGeometry(.16, .3, 3.2, 8); trunkG.translate(0, 1.6, 0); scaleUV(trunkG, 1, 1.5);
  for (const conifer of [false, true]) {
    const list = pts.filter(p => p[2] === conifer), m4 = new THREE.Matrix4(), col = new THREE.Color();
    const trunk = new THREE.InstancedMesh(trunkG, M.bark(), list.length), crown = new THREE.InstancedMesh(crownGeo(conifer ? 'conifer' : 'round'), M.leaf(), list.length);
    list.forEach(([x, z], i) => {
      const s = .75 + rand() * .75, ry = rand() * 6.28; m4.makeRotationY(ry).scale(new THREE.Vector3(s, s * (.9 + rand() * .3), s)).setPosition(x, 0, z);
      trunk.setMatrixAt(i, m4); crown.setMatrixAt(i, m4); crown.setColorAt(i, col.setHSL(conifer ? .4 : .24 + rand() * .08, .3, .34 + rand() * .24)); addCollider(x, z, .7, .7);
    });
    trunk.castShadow = crown.castShadow = true; crown.receiveShadow = true; root.add(trunk, crown);
  }
}

function buildLamps(L) {
  const lamps = [], pole = M.plain(0x2a2f3a, .45, .8);
  L.edges.forEach(([a, b], k) => {
    const A = L.nodes[a], B = L.nodes[b], len = Math.hypot(B[0] - A[0], B[1] - A[1]), ux = (B[0] - A[0]) / len, uz = (B[1] - A[1]) / len;
    for (let t = 8, j = 0; t < len - 6; t += 16, j++) { const s = (j + k) % 2 ? 1 : -1; lamps.push([A[0] + ux * t - uz * 4.5 * s, A[1] + uz * t + ux * 4.5 * s]); }
  });
  const n = lamps.length, post = new THREE.InstancedMesh(new THREE.CylinderGeometry(.06, .1, 6.2, 8), pole, n), arm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, .08, .08), pole, n);
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(.8, .12, .32), glowMat({ color: 0x333333, emissive: 0xfff0d0 }, 2.2), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  lamps.forEach(([x, z], i) => {
    let dx = 0, dz = 0;                                                      // arm points toward the road centre line (nearest edge)
    let best = 1e9; for (const [a, b] of L.edges) { const A = L.nodes[a], B = L.nodes[b], d = distSeg(x, z, A, B); if (d < best) { best = d; const ex = B[0] - A[0], ez = B[1] - A[1], l = Math.hypot(ex, ez), tt = Math.max(0, Math.min(1, ((x - A[0]) * ex + (z - A[1]) * ez) / (l * l))); dx = A[0] + ex * tt - x; dz = A[1] + ez * tt - z; } }
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl; q.setFromAxisAngle(up, -Math.atan2(dz, dx));
    m.compose(new THREE.Vector3(x, 3.1, z), new THREE.Quaternion(), one); post.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x + dx * .8, 6.2, z + dz * .8), q, one); arm.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x + dx * 1.55, 6.12, z + dz * 1.55), q, one); head.setMatrixAt(i, m);
  });
  for (const o of [post, arm, head]) { o.castShadow = o !== head; root.add(o); }
}

export function buildWorld(L) {
  root = new THREE.Group(); colliders = []; seats = []; animated = [];
  const ground = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(900, 900), 900 / 8, 900 / 8), M.ground());
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; root.add(ground);
  buildRoads(L); buildPlaza(L);
  for (const loc of L.locations) if (!['plaza', 'residential'].includes(loc.kind)) buildBuilding(loc);
  buildHouses(L, L.locations.find(l => l.kind === 'residential'));
  buildVegetation(L); buildLamps(L);
  const handle = { group: root, colliders, seats, animated, ground }; root = scene; return handle;
}

// Free GPU memory of a zone group. Geometries flagged userData.shared (and all cached materials/textures) are kept.
export function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry && !(o.geometry.userData && o.geometry.userData.shared)) o.geometry.dispose();
    if (o.isInstancedMesh) o.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) { const t = m && m.map; if (t && t.userData && t.userData.own) t.dispose(); }
  });
  g.removeFromParent();
}

export function updateWorld(dt, list = animated) { for (const o of list) { const s = o.userData.spin; if (s) { o.rotation.x += dt * s[0]; o.rotation.y += dt * s[1]; o.rotation.z += dt * s[2]; } else o.rotation.z += dt * .4; } }
