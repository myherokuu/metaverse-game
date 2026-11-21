// Wakanda zone (original Afrofuturist design). The server stores the layout (objects, roads, river); this module turns it
// into a streamed 3D world: height-field terrain chunks, instanced forests, PBR structures, roads, river, bridges and waterfall.
// Everything is procedural (no film assets). Landmarks stay loaded; small props and terrain stream in/out by 100 m chunk.
import * as THREE from 'three';
import { M, facade, glowMat, opts } from './materials.js';
import { makeLabel, crownGeo, boxUV, scaleUV, disposeGroup } from './world.js';
import { createHeightField, buildTerrainChunk, CHUNK, WATER } from './terrain.js';
import { getBuilding, fitModel } from './assets.js';
import { civicBuilders } from './civic.js';
const TERRAIN_KINDS = new Set(['mountain', 'hill', 'plateau', 'pool', 'river', 'coast', 'dock']);

const ALWAYS = new Set(['skyscraper', 'tower', 'palace', 'lab', 'station', 'rail', 'bridge', 'river', 'pool', 'waterfall', 'plaza']);
const TERRAIN_ONLY = new Set(['mountain', 'hill', 'plateau', 'pool', 'river', 'coast']);
const TERRAIN_R = 640, DETAIL_R = 300, DETAIL_DROP = 380;   // terrain is always visible (mountains!), props/trees stream by distance
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

// ---------- small mesh kit ----------
const mesh = (geo, mat, x = 0, y = 0, z = 0, cast = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; return m; };
const bx = (w, h, d, mat, x, y, z, tile = 3) => mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, tile), mat, x, y, z);
const cy = (rt, rb, h, mat, x, y, z, seg = 24, tile = 3) => mesh(scaleUV(new THREE.CylinderGeometry(rt, rb, h, seg), 2 * Math.PI * Math.max(rt, rb) / tile, h / tile), mat, x, y, z);
const hex = c => '#' + new THREE.Color(c).getHexString();
function boxesOf(o) {                        // same maths as the server: absolute AABBs of an object
  const d = o.data, list = 'box' in d ? [[0, 0, d.box[0], d.box[1]]] : (d.boxes || []);
  const h = /^civic_/.test(o.kind) && d.h ? d.h + .6 : undefined;                     // flat-roofed civic buildings can be landed on
  return list.map(b => ({ x0: o.x + b[0] - b[2] / 2, x1: o.x + b[0] + b[2] / 2, z0: o.z + b[1] - b[3] / 2, z1: o.z + b[1] + b[3] / 2, h }));
}
function holoTexture(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 320; const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,30,50,.55)'; g.fillRect(0, 0, 512, 320); g.strokeStyle = '#5ff'; g.lineWidth = 3; g.strokeRect(6, 6, 500, 308);
  g.fillStyle = '#5ff'; g.font = 'bold 30px monospace'; g.textAlign = 'center'; g.fillText(text, 256, 60, 480);
  for (let i = 0; i < 9; i++) { const h = 30 + Math.abs(Math.sin(i * 1.7)) * 120; g.fillStyle = `rgba(95,255,255,${.25 + i % 3 * .18})`; g.fillRect(40 + i * 48, 290 - h, 30, h); }
  g.beginPath(); for (let x = 0; x < 512; x += 8) g.lineTo(x, 150 + Math.sin(x * .05) * 34); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.userData.own = true; return t;
}

// ---------- structure builders: (object, zone) -> THREE.Group, y=0 is the ground at (x,z) ----------
const B = {};
function tierBody(shape, style, w, d, th, y, accent, seed) {
  const floors = Math.max(2, Math.round(th / 3.8)), roof = M.concrete();
  if (shape === 'round') {
    const r = w / 2, side = facade(style, Math.max(6, Math.round(2 * Math.PI * r / 2.6)), floors, accent, seed);
    return mesh(new THREE.CylinderGeometry(r, r, th, 32), [side, roof, roof], 0, y + th / 2, 0);
  }
  const fx = facade(style, Math.max(3, Math.round(d / 2.6)), floors, accent, seed), fz = facade(style, Math.max(3, Math.round(w / 2.6)), floors, accent, seed + 1);
  return mesh(boxUV(new THREE.BoxGeometry(w, th, d), w, th, d, 3), [fx, fx, roof, roof, fz, fz], 0, y + th / 2, 0);
}
B.skyscraper = o => {
  const { w, d, h, style, shape } = o.data, g = new THREE.Group(), accent = style === 'tech' ? '#00cec9' : '#f2c14e', gold = M.gold();
  g.add(bx(w + 3, 3, d + 3, M.concrete(), 0, -.4, 0));
  let y = 0;
  [[1, .55], [.78, .3], [.56, .15]].forEach(([sc, fr], i) => {
    const th = h * fr, tw = w * sc, td = d * sc;
    g.add(tierBody(shape, style, tw, td, th, y, accent, 5 + i * 2)); y += th;
    g.add(shape === 'round' ? cy(tw / 2 + .5, tw / 2 + .5, 1.2, gold, 0, y, 0, 32) : bx(tw + 1, 1.2, td + 1, gold, 0, y, 0));
    if (i === 0 && shape !== 'round') for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.add(bx(.9, th, .9, gold, sx * (tw / 2), th / 2, sz * (td / 2)));
  });
  g.add(mesh(new THREE.ConeGeometry(shape === 'round' ? w * .2 : w * .16, h * .16, 8), gold, 0, y + h * .08, 0));
  const ring = mesh(new THREE.TorusGeometry(w * .33, .35, 8, 40), glowMat({ color: new THREE.Color(accent), emissive: new THREE.Color(accent) }, 1.8), 0, y - h * .1, 0, false); ring.rotation.x = Math.PI / 2; g.add(ring);
  return g;
};
B.tower = o => {
  const { r, h, style, roof } = o.data, g = new THREE.Group(), gold = M.gold();
  g.add(cy(r + 1.2, r + 1.4, 2, M.concrete(), 0, 0, 0, 32));
  if (style === 'gold') {
    g.add(cy(r, r * 1.08, h, gold, 0, h / 2, 0, 32));
    for (let y = 6; y < h - 3; y += 8) g.add(cy(r * 1.1, r * 1.1, .8, M.alloy(), 0, y, 0, 32));
    g.add(mesh(scaleUV(new THREE.ConeGeometry(r * 1.45, r * 2.6, 32), 3, 3), M.alloy(), 0, h + r * 1.3, 0));
    g.add(mesh(new THREE.SphereGeometry(.7, 12, 8), gold, 0, h + r * 2.7, 0));
  } else {
    const accent = '#00cec9', floors = Math.max(3, Math.round(h / 3.8));
    g.add(mesh(new THREE.CylinderGeometry(r, r * 1.1, h, 32), [facade('tech', Math.max(6, Math.round(2 * Math.PI * r / 2.6)), floors, accent, 21), M.alloy(), M.alloy()], 0, h / 2, 0));
    for (let y = 10; y < h; y += 16) { const t = mesh(new THREE.TorusGeometry(r * 1.12, .35, 8, 40), glowMat({ color: new THREE.Color(accent), emissive: new THREE.Color(accent) }, 1.8), 0, y, 0, false); t.rotation.x = Math.PI / 2; g.add(t); }
    g.add(cy(.25, .4, h * .22, M.alloy(), 0, h + h * .11, 0, 8));
  }
  return g;
};
B.palace = o => {
  const { w, d, h } = o.data, g = new THREE.Group(), gold = M.gold(), alloy = M.alloy();
  const floors = Math.round(h / 4.4), fx = facade('royal', Math.round(d / 3), floors, '#f2c14e', 31), fz = facade('royal', Math.round(w / 3), floors, '#f2c14e', 32);
  g.add(mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, 3), [fx, fx, M.concrete(), M.concrete(), fz, fz], 0, h / 2, 0));
  g.add(bx(w + 6, 2.4, d + 6, M.concrete(), 0, -.2, 0)); g.add(bx(w + 2, .8, d + 2, gold, 0, h + .4, 0));
  const front = d / 2 + 2.4;                                                  // colonnade faces +z (toward the capital)
  for (let i = 0; i < 10; i++) g.add(cy(.65, .75, h * .84, gold, (i - 4.5) * (w * .88 / 9), h * .42 + .6, front, 20));
  g.add(bx(w * .92, 1.6, 5.2, alloy, 0, h * .86 + 1.4, d / 2 + 1.4));
  for (let i = 0; i < 6; i++) g.add(bx(w * .5 + (5 - i) * 2, .35, 1.4, M.concrete(), 0, .3 + i * .35 - 1, d / 2 + 4.8 + (5 - i) * .8));
  g.add(cy(13, 14, 4, alloy, 0, h + 2.8, 0, 36));
  const dome = mesh(new THREE.SphereGeometry(13, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), gold, 0, h + 4.8, 0); g.add(dome);
  g.add(mesh(new THREE.ConeGeometry(.9, 9, 10), gold, 0, h + 4.8 + 13 + 3.5, 0));
  const ring = mesh(new THREE.TorusGeometry(13.4, .3, 8, 48), glowMat({ color: 0xffd36b, emissive: 0xffc23d }, 1.8), 0, h + 4.9, 0, false); ring.rotation.x = Math.PI / 2; g.add(ring);
  g.add(bx(5, 6.5, .3, glowMat({ color: 0x332211, emissive: 0xffd9a0 }, 1.2), 0, 3.3, d / 2 + .2));
  return g;
};
B.gate = o => {
  const { w, h } = o.data, g = new THREE.Group(), gold = M.gold(), r = w / 2 + .5;
  for (const sx of [-1, 1]) { g.add(bx(3, h, 3, M.alloy(), sx * (w / 2 + .5), h / 2, 0)); g.add(bx(3.6, 1, 3.6, gold, sx * (w / 2 + .5), h, 0)); }
  const arch = mesh(new THREE.TorusGeometry(r, .9, 12, 32, Math.PI), gold, 0, h, 0); g.add(arch);
  g.add(bx(w + 4, 1.1, 3.4, M.alloy(), 0, h + r + .3, 0));
  return g;
};
B.garden = o => {
  const { w, d, crops } = o.data, g = new THREE.Group(), hedge = M.leaf(), pave = M.pavement();
  g.add(scaleOnGround(new THREE.PlaneGeometry(w, d), crops ? M.earth() : M.ground(), w / 4, d / 4));
  for (const [bw, bd, bx_, bz] of [[w, .9, 0, d / 2], [w, .9, 0, -d / 2], [.9, d, w / 2, 0], [.9, d, -w / 2, 0]]) g.add(bx(bw, 1.1, bd, hedge, bx_, .55, bz, 1.5));
  if (crops) for (let i = -2; i <= 2; i++) g.add(bx(w * .8, .5, .8, M.plain(0x4c8a3c, .9), 0, .25, i * d * .17, 1));
  else {
    g.add(scaleOnGround(new THREE.PlaneGeometry(2, d - 1.2), pave, 1, d / 2));
    const cols = [0xe74c3c, 0xf1c40f, 0xe67e22, 0xecf0f1, 0x9b59b6];
    for (let i = 0; i < 12; i++) { const m = mesh(new THREE.IcosahedronGeometry(.55 + (i % 3) * .12, 1), M.plain(cols[i % 5], .8), ((i % 2) ? 1 : -1) * (w * .28), .5, (i / 12 - .5) * (d - 3)); g.add(m); }
  }
  return g;
};
function scaleOnGround(geo, mat, su, sv) { geo.rotateX(-Math.PI / 2); const m = mesh(scaleUV(geo, su, sv), mat, 0, .08, 0, false); return m; }
B.plaza = o => {
  const { r } = o.data, g = new THREE.Group(), geo = new THREE.CircleGeometry(r, 64); geo.rotateX(-Math.PI / 2);
  const disc = mesh(scaleUV(geo, r * 2 / 4, r * 2 / 4), M.plaza(), 0, .1, 0, false); disc.material = disc.material.clone(); disc.material.polygonOffset = true; disc.material.polygonOffsetFactor = -3; g.add(disc);
  for (const [rr, w] of [[r - 1.5, .5], [r * .6, .35]]) { const ring = mesh(new THREE.RingGeometry(rr, rr + w, 96), glowMat({ color: 0x332200, emissive: 0xffc23d, side: THREE.DoubleSide }, 1.3), 0, .13, 0, false); ring.rotation.x = -Math.PI / 2; g.add(ring); }
  return g;
};
B.fountain = (o, z) => {
  const { r } = o.data, g = new THREE.Group(), gold = M.gold();
  g.add(cy(r, r + .6, 1.3, M.plaza(), 0, .65, 0, 40)); g.add(cy(r - .8, r - .8, .2, M.water(), 0, 1.15, 0, 40));
  g.add(cy(1.3, 1.8, 5.5, gold, 0, 3.4, 0, 20)); g.add(mesh(new THREE.SphereGeometry(1.3, 20, 12), gold, 0, 6.6, 0));
  const jets = new THREE.Group(), jm = glowMat({ color: 0x9fe3ff, emissive: 0x6fd0ff, transparent: true, opacity: .55 }, 1);
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2, c = mesh(new THREE.ConeGeometry(.35, 5.5, 8), jm, Math.cos(a) * 2.6, 3.8, Math.sin(a) * 2.6, false); c.rotation.z = Math.cos(a) * .5; c.rotation.x = -Math.sin(a) * .5; jets.add(c); }
  g.add(jets); z.addAnim((dt, t) => { jets.rotation.y += dt * .6; jm.opacity = .45 + Math.sin(t * 3) * .1; });
  return g;
};
B.lab = o => {
  const { r, h } = o.data, g = new THREE.Group(), floors = Math.round(h / 3.8);
  g.add(cy(r + 1.5, r + 1.8, 1.4, M.concrete(), 0, 0, 0, 40));
  g.add(mesh(new THREE.CylinderGeometry(r, r, h, 40), [facade('tech', Math.round(2 * Math.PI * r / 2.8), floors, '#6c5ce7', 41), M.alloy(), M.alloy()], 0, h / 2, 0));
  g.add(mesh(new THREE.SphereGeometry(r * .8, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.glass(0x9fd6ff), 0, h, 0, false));
  const ring = mesh(new THREE.TorusGeometry(r * .8, .3, 8, 48), glowMat({ color: 0x6c5ce7, emissive: 0x8e7bff }, 1.8), 0, h, 0, false); ring.rotation.x = Math.PI / 2; g.add(ring);
  g.add(cy(r + .6, r + .6, .5, M.gold(), 0, h * .5, 0, 40));
  return g;
};
B.lab_wing = o => {
  const { w, d, h } = o.data, g = new THREE.Group(), fl = Math.round(h / 3.8);
  const fx = facade('tech', Math.round(d / 2.6), fl, '#6c5ce7', 43), fz = facade('tech', Math.round(w / 2.6), fl, '#6c5ce7', 44);
  g.add(mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, 3), [fx, fx, M.concrete(), M.concrete(), fz, fz], 0, h / 2, 0));
  g.add(bx(w * .7, 5, d * .5, M.glass(0x9fd6ff), 0, h + 2.5, 0)); g.add(bx(w * .72, .5, d * .52, M.alloy(), 0, h + 5.2, 0));
  return g;
};
B.hologram = (o, z) => {
  const { w, h, text } = o.data, g = new THREE.Group(); g.rotation.y = o.rot;
  const tex = holoTexture(text || 'HOLOGRAM'), m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false });
  const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); s.position.y = h / 2 + 1.4; g.add(s);
  for (const sx of [-1, 1]) g.add(bx(.25, h + 1.8, .25, M.alloy(), sx * (w / 2 + .3), (h + 1.8) / 2, 0));
  g.add(bx(w + 1, .35, .8, M.gold(), 0, .2, 0));
  z.addAnim((dt, t) => { m.opacity = .72 + Math.sin(t * 2 + o.x) * .14; s.position.y = h / 2 + 1.4 + Math.sin(t * 1.2 + o.z) * .12; });
  return g;
};
B.info_point = (o, z) => {
  const g = new THREE.Group(), cap = glowMat({ color: 0x332200, emissive: 0xffc23d }, 1.6);
  g.add(cy(.35, .5, 1.3, M.alloy(), 0, .65, 0, 12)); g.add(mesh(new THREE.OctahedronGeometry(.28), cap, 0, 1.8, 0, false));
  const ring = mesh(new THREE.TorusGeometry(.5, .04, 6, 24), cap, 0, 1.8, 0, false); g.add(ring);
  z.addInfo({ x: o.x, z: o.z, title: o.data.title, text: o.data.text });
  z.addAnim((dt, t) => { ring.rotation.x = t; ring.rotation.y = t * .7; });
  return g;
};
B.platform = o => {
  const { w, d } = o.data, g = new THREE.Group(), wood = M.wood();
  g.add(bx(w, .4, d, wood, 0, .2, 0, 2));
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(cy(.12, .12, 1.2, wood, px * w / 2, .6, pz * d / 2, 8));
  for (const s of [-1, 1]) { g.add(bx(w, .1, .12, wood, 0, 1.1, s * d / 2, 1)); if (s < 0) g.add(bx(.12, .1, d, wood, s * w / 2, 1.1, 0, 1)); else g.add(bx(.12, .1, d, wood, w / 2, 1.1, 0, 1)); }
  g.add(cy(.12, .18, 1.5, M.alloy(), -w * .3, 1.1, -d * .3, 8)); return g;
};
B.village_hut = o => {
  const { r, h } = o.data, g = new THREE.Group(), a = o.rot, dx = -Math.cos(a), dz = -Math.sin(a);
  g.add(cy(r + .4, r + .5, .5, M.rock(), 0, .25, 0, 20));
  g.add(cy(r, r, h, M.earth(), 0, h / 2 + .4, 0, 24));
  g.add(mesh(new THREE.CylinderGeometry(r + .04, r + .04, .55, 24, 1, true), M.textile('#b03a2e'), 0, h * .72 + .4, 0, false));
  const door = bx(1.2, 2.2, .3, M.wood(), dx * (r - .1), 1.5, dz * (r - .1), 1); door.rotation.y = Math.atan2(dx, dz); g.add(door);
  const roof = mesh(scaleUV(new THREE.ConeGeometry(r * 1.42, 3.6, 28), 4, 2), M.thatch(), 0, h + .4 + 1.8, 0); g.add(roof);
  g.add(mesh(new THREE.SphereGeometry(.28, 8, 6), M.gold(), 0, h + .4 + 3.7, 0));
  return g;
};
B.granary = o => {
  const { r, h } = o.data, g = new THREE.Group();
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.add(cy(.18, .2, 1.4, M.wood(), sx * r * .7, .7, sz * r * .7, 8, 1.5));
  g.add(cy(r, r * .9, h - 2.6, M.thatch(), 0, 1.4 + (h - 2.6) / 2, 0, 18)); g.add(mesh(scaleUV(new THREE.ConeGeometry(r * 1.35, 2.2, 18), 3, 2), M.thatch(), 0, h - 1.2 + 1.1 + 1, 0));
  return g;
};
B.meeting_circle = (o, z) => {
  const { r } = o.data, g = new THREE.Group(), wood = M.wood();
  g.add(scaleOnGround(new THREE.CircleGeometry(r + 2, 32), M.earth(), 3, 3));
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, l = mesh(new THREE.CylinderGeometry(.42, .42, 2.2, 10), wood, Math.cos(a) * r, .45, Math.sin(a) * r); l.rotation.z = Math.PI / 2; l.rotation.y = -a; g.add(l); }
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28; g.add(mesh(new THREE.DodecahedronGeometry(.45, 0), M.rock(), Math.cos(a) * 1.4, .25, Math.sin(a) * 1.4)); }
  const fm = glowMat({ color: 0x331100, emissive: 0xff7a1a, transparent: true, opacity: .9 }, 2), flame = mesh(new THREE.ConeGeometry(.7, 1.9, 8), fm, 0, 1.1, 0, false); g.add(flame);
  z.addAnim((dt, t) => { flame.scale.set(1 + Math.sin(t * 9) * .12, 1 + Math.sin(t * 7 + 1) * .2, 1 + Math.cos(t * 8) * .12); });
  return g;
};
B.market = o => {
  const { n, w } = o.data, g = new THREE.Group(), cols = ['#c0392b', '#f39c12', '#16a085', '#8e44ad', '#2980b9'], wood = M.wood();
  g.add(scaleOnGround(new THREE.PlaneGeometry(w, 12), M.earth(), w / 4, 3));
  for (let i = 0; i < n; i++) {
    const sx = (i - (n - 1) / 2) * 8, s = new THREE.Group(); s.position.x = sx;
    for (const [px, pz] of [[-2.7, -2.2], [2.7, -2.2], [-2.7, 2.2], [2.7, 2.2]]) s.add(cy(.1, .1, 3.2, wood, px, 1.6, pz, 8, 1.5));
    const aw = mesh(new THREE.PlaneGeometry(6, 5.2), M.textile(cols[i % 5]), 0, 3.35, 0); aw.rotation.x = -Math.PI / 2 + .2; s.add(aw);
    s.add(bx(5, 1, 1.8, wood, 0, .5, .6, 1.5));
    for (let k = 0; k < 6; k++) s.add(mesh(new THREE.SphereGeometry(.28, 8, 6), M.plain([0xe67e22, 0xc0392b, 0xf1c40f, 0x27ae60][k % 4], .8), -1.8 + k * .7, 1.25, .6));
    s.add(bx(.9, .8, .9, wood, 2.2, .4, -1.2, 1)); g.add(s);
  }
  return g;
};
B.engineering = o => {
  const { w, d, h } = o.data, g = new THREE.Group(), fl = Math.max(2, Math.round(h / 4));
  const fx = facade('tech', Math.round(d / 3), fl, '#00cec9', 51), fz = facade('tech', Math.round(w / 3), fl, '#00cec9', 52);
  g.add(mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, 3), [fx, fx, M.metal(), M.metal(), fz, fz], 0, h / 2, 0));
  for (let i = -1; i <= 1; i++) g.add(bx(w * .22, 1.2, d + .6, M.alloy(), i * w * .3, h + .5, 0));
  g.add(cy(.8, .8, h + 8, M.metal(), w / 2 + 1.2, (h + 8) / 2, d / 2 - 2, 12));
  g.add(mesh(new THREE.TorusGeometry(.9, .18, 6, 16), glowMat({ color: 0x332200, emissive: 0xff9a3c }, 2), w / 2 + 1.2, h + 8, d / 2 - 2, false));
  for (let i = 0; i < 3; i++) { const p = cy(.35, .35, w * .8, M.metal(), 0, 2 + i * 1.6, -d / 2 - .6, 10); p.rotation.z = Math.PI / 2; g.add(p); }
  return g;
};
B.station = (o, z) => {
  const { w, d, h } = o.data, g = new THREE.Group();
  g.add(bx(w, .9, d, M.alloy(), 0, h - .5, 0, 3));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cy(.7, .9, h - 1, M.concrete(), sx * (w / 2 - 2), (h - 1) / 2, sz * (d / 2 - 2), 12));
  g.add(bx(w + 4, .4, d + 5, M.glass(0xaadfff), 0, h + 5.5, 0)); for (const sx of [-1, 1]) g.add(cy(.25, .25, 5.6, M.gold(), sx * (w / 2), h + 2.6, 0, 8));
  g.add(bx(w, .25, .4, glowMat({ color: 0x332200, emissive: 0xffc23d }, 1.8), 0, h, d / 2 + .1));
  for (let i = 0; i < 8; i++) g.add(bx(w * .4, .3, 1.2, M.concrete(), 0, i * h / 8 + .15, d / 2 + 2.4 + (8 - i) * 1.2, 2));   // stairs
  return g;
};
B.rail = (o, z) => {
  const { r, y, offset } = o.data, g = new THREE.Group(), curve = new THREE.CatmullRomCurve3(Array.from({ length: 48 }, (_, i) => new THREE.Vector3(Math.cos(i / 48 * 6.2832) * r, y, Math.sin(i / 48 * 6.2832) * r)), true);
  g.add(mesh(new THREE.TubeGeometry(curve, 96, .55, 8, true), M.alloy(), 0, 0, 0));
  g.add(mesh(new THREE.TubeGeometry(curve, 96, .15, 6, true), glowMat({ color: 0x113322, emissive: 0x00e0c0 }, 1.8), 0, .7, 0, false));
  for (let i = 0; i < 10; i++) { const a = (offset || 0) * Math.PI / 180 + i * Math.PI / 5; g.add(cy(.55, .75, y, M.concrete(), Math.cos(a) * r, y / 2, Math.sin(a) * r, 10)); }
  const train = new THREE.Group();
  for (let i = 0; i < 3; i++) { train.add(bx(8, 2.1, 2.6, M.alloy(), -i * 8.6, 0, 0, 2)); train.add(bx(7.4, .8, 2.7, M.glass(0xaadfff), -i * 8.6, .35, 0, 2)); }
  train.add(bx(.6, .5, 1.6, glowMat({ color: 0x113322, emissive: 0x00ffe0 }, 2.5), 4, 0, 0, 1)); g.add(train);
  let a = 0; z.addAnim(dt => { a += dt * .16; const p = curve.getPointAt((a / (2 * Math.PI)) % 1), q = curve.getPointAt(((a + .01) / (2 * Math.PI)) % 1); train.position.set(p.x, y + 1.6, p.z); train.rotation.y = Math.atan2(-(q.z - p.z), q.x - p.x); });
  return g;
};
B.bridge = o => {
  const { len, w, arch } = o.data, g = new THREE.Group(), n = 16, gold = M.gold(), y = u => .1 + arch * Math.sin(Math.PI * (u / len + .5));
  g.rotation.y = -o.rot;
  for (let i = 0; i < n; i++) {
    const u0 = -len / 2 + i * len / n, u1 = u0 + len / n, um = (u0 + u1) / 2, ang = Math.atan2(y(u1) - y(u0), len / n), sl = Math.hypot(len / n, y(u1) - y(u0)) + .08;
    const seg = bx(sl, .7, w, M.alloy(), um, y(um) - .42, 0, 3); seg.rotation.z = ang; g.add(seg);
    for (const s of [-1, 1]) { const rail = bx(sl, .14, .14, gold, um, y(um) + 1.05, s * (w / 2 - .1), 1); rail.rotation.z = ang; g.add(rail); if (i % 2 === 0) g.add(bx(.2, 1.1, .2, gold, u0, y(u0) + .55, s * (w / 2 - .1), 1)); }
  }
  for (const s of [-1, 1]) for (const u of [-len * .2, len * .2]) g.add(cy(.7, .9, 6, M.concrete(), u, y(u) - 3.4, s * (w / 2 - 1.2), 10));
  return g;
};

Object.assign(B, civicBuilders('wakanda'));   // finished government buildings (civic_house, civic_apartment, ...)

// ---------- zone ----------
export { B as WAKANDA_BUILDERS, boxesOf, mesh, bx, cy, holoTexture };
export class WakandaZone {
  constructor(id = 'wakanda', cfg = {}) { this.cfg = cfg; this.B = cfg.B || B; this.ALWAYS = cfg.always || ALWAYS; this.id = id; this.cacheable = false; this.group = new THREE.Group(); this.anim = []; this.infoPoints = []; this.chunks = new Map(); this.staticColliders = []; this.t = 0; this.pickList = []; this._cc = { key: '', list: [] }; this.buildQueue = []; this.updateT = 0; this._cur = null; }
  colsOf(o) { return boxesOf(o).concat(this.cfg.lids ? this.cfg.lids(o, this) : []); }   // solid boxes + landing surfaces
  addAnim(f) { f.chunk = this._cur; this.anim.push(f); }
  addInfo(p) { p.chunk = this._cur; this.infoPoints.push(p); }

  async load({ api, progress }) {
    progress('Reading ' + (this.cfg.title || 'Wakanda') + ' layout…');
    const [map, objs, parcels] = await Promise.all([api('GET', `/api/world/zones/${this.id}/map`), api('GET', `/api/world/zones/${this.id}/objects`), api('GET', `/api/civilization/zones/${this.id}/parcels`)]);
    this.parcels = parcels;
    this.api = api; this.lastObjId = Math.max(0, ...objs.map(o => o.id)); this.liveT = 4;
    this.map = map; this.info = map.zone; this.bound = map.bound; this.objects = objs; this.spawn = map.zone.spawn;
    this.hf = createHeightField(objs, this.bound, map.zone.seed); this.hf.palette = this.cfg.palette; this.TERRAIN_R = this.bound * 1.6;
    this.locations = map.locations; this.mapData = { bound: this.bound, nodes: map.nodes, edges: map.edges, locations: map.locations, river: map.river };
    this.obstacles = objs.flatMap(o => boxesOf(o));
    this.byChunk = new Map();
    for (const o of objs) {
      if (TERRAIN_ONLY.has(o.kind) || this.ALWAYS.has(o.kind) || !this.B[o.kind]) continue;   // landmarks/terrain are handled elsewhere
      const k = o.chunk_x + ',' + o.chunk_z; (this.byChunk.get(k) || this.byChunk.set(k, []).get(k)).push(o);
    }
    progress('Building roads, river and landmarks…'); await nextFrame();
    this.buildRoads(); this.buildWater(); this.buildWaterfall(); if (this.cfg.extra) this.cfg.extra(this);
    this.always = objs.filter(o => this.ALWAYS.has(o.kind) && this.B[o.kind]);
    this._cur = null;
    for (const o of this.always) { const g = this.place(o); this.group.add(g); this.staticColliders.push(...this.colsOf(o)); }
    for (const l of this.locations) { const lab = makeLabel(l.name, null, l.color, 30); lab.position.set(l.x, this.hf.groundAt(l.x, l.z) + (l.key === 'wk_capital' ? 46 : 36), l.z); this.group.add(lab); }
    this.genTrees();
    return this;
  }

  place(o) {
    // a GLB listed in assets.json as "wk_<kind>" (e.g. wk_palace) replaces the procedural building; otherwise procedural fallback
    const glb = getBuilding((this.cfg.glbPrefix || 'wk_') + o.kind), d = o.data;
    const g = glb ? fitModel(glb.scene.clone(true), d.w || (d.r || 5) * 2, d.d || (d.r || 5) * 2, d.h) : this.B[o.kind](o, this), grp = new THREE.Group();
    if (glb) g.traverse(m => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
    const y = o.kind === 'bridge' ? 0 : this.hf.groundAt(o.x, o.z);
    grp.add(g); grp.position.set(o.x, y, o.z);
    if (['skyscraper', 'palace', 'lab', 'tower'].includes(o.kind) && o.data.name) { const l = makeLabel(o.data.name, null, '#f2c14e', 16); l.position.y = (o.data.h || 30) + 14; grp.add(l); }
    return grp;
  }

  // roads: ribbons draped over the terrain along the waypoint graph (paved between districts, dirt toward village/mountains)
  buildRoads() {
    const nodes = this.map.nodes, dirt = this.cfg.dirtAll ? { has: () => true } : new Set(['vil', 'vil_b', 'm1', 'm2', 'mtn', 'mtn_pool']);
    for (const [a, b] of this.map.edges) {
      if (/^rd\d/.test(a) || /^rd\d/.test(b)) continue;                // government-built roads are drawn by their civic_road object
      const A = nodes[a], Bn = nodes[b], len = Math.hypot(Bn[0] - A[0], Bn[1] - A[1]), n = Math.max(2, Math.ceil(len / 3)), isDirt = dirt.has(a) || dirt.has(b), half = isDirt ? 2 : 3.4;
      const nx = -(Bn[1] - A[1]) / len, nz = (Bn[0] - A[0]) / len, pos = [], uv = [], idx = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = A[0] + (Bn[0] - A[0]) * t, z = A[1] + (Bn[1] - A[1]) * t;
        for (const s of [-1, 1]) { const px = x + nx * half * s, pz = z + nz * half * s; pos.push(px, this.hf.groundAt(px, pz) + .09, pz); uv.push(t * len / 6, s > 0 ? 1 : 0); }
        if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
      const mat = isDirt ? M.earth() : M.asphalt(); mat.polygonOffset = true; mat.polygonOffsetFactor = -2;
      const r = new THREE.Mesh(geo, mat); r.receiveShadow = true; r.userData.pick = true; this.group.add(r); this.pickList.push(r);
    }
  }
  buildWater() {
    const rv = this.map.river, riverMat = M.river(); if (!rv) { this.anim.push(dt => { for (const t of [riverMat.map, riverMat.normalMap]) if (t) t.offset.y -= dt * .045; }); return; }
    const w = rv.w + 2;
    for (let i = 0; i < rv.pts.length - 1; i++) {
      const a = rv.pts[i], b = rv.pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      const m = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(len + 2, w), (len + 2) / 14, w / 14), riverMat); m.rotation.set(-Math.PI / 2, ang, 0, 'YXZ'); m.position.set((a[0] + b[0]) / 2, WATER, (a[1] + b[1]) / 2); m.receiveShadow = true; this.group.add(m);
      const j = new THREE.Mesh(scaleUV(new THREE.CircleGeometry(w / 2, 20), w / 14, w / 14), riverMat); j.rotation.x = -Math.PI / 2; j.position.set(b[0], WATER + .001, b[1]); this.group.add(j);
    }
    const pool = this.objects.find(o => o.kind === 'pool');
    if (pool) { const p = new THREE.Mesh(scaleUV(new THREE.CircleGeometry(pool.data.r + 6, 40), 3, 3), riverMat); p.rotation.x = -Math.PI / 2; p.position.set(pool.x, WATER + .002, pool.z); this.group.add(p); }
    this.anim.push((dt) => { for (const t of [riverMat.map, riverMat.normalMap]) if (t) t.offset.y -= dt * .045; });
  }
  buildWaterfall() {
    const wf = this.objects.find(o => o.kind === 'waterfall'); if (!wf) return;
    const dir = [Math.cos(wf.rot), Math.sin(wf.rot)], org = [wf.x + dir[0] * 14, wf.z + dir[1] * 14], hw = 9, tx = -dir[1], tz = dir[0];
    const prof = []; let top = -1e9; for (let s = 0; s < 80; s += 1) { const x = org[0] - dir[0] * s, z = org[1] - dir[1] * s, h = this.hf.heightAt(x, z); prof.push([s, h]); top = Math.max(top, h); }
    let s0 = prof.findIndex(p => p[1] > -.3), s1 = prof.findIndex(p => p[1] > top * .985); if (s1 < 0) s1 = prof.length - 1;
    const pos = [], uv = [], idx = []; let acc = 0;
    for (let i = s0; i <= s1; i++) {
      const [s, h] = prof[i], x = org[0] - dir[0] * (s - .9), z = org[1] - dir[1] * (s - .9); if (i > s0) acc += Math.hypot(1, h - prof[i - 1][1]);
      for (const k of [-1, 1]) pos.push(x + tx * hw * k, Math.max(h, WATER) + .5, z + tz * hw * k), uv.push(k > 0 ? 1 : 0, acc / 18);
      if (i < s1) { const q = (i - s0) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#cfefff'; g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * .8})`; g.fillRect(Math.random() * 128, Math.random() * 256, 1 + Math.random() * 3, 20 + Math.random() * 70); }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: .82, side: THREE.DoubleSide, depthWrite: false, fog: true });
    const fall = new THREE.Mesh(geo, m); this.group.add(fall);
    const mist = []; const sc = document.createElement('canvas'); sc.width = sc.height = 64; const sg = sc.getContext('2d'), gr = sg.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); sg.fillStyle = gr; sg.fillRect(0, 0, 64, 64);
    const mt = new THREE.CanvasTexture(sc);
    for (let i = 0; i < 9; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: mt, transparent: true, opacity: .4, depthWrite: false })); sp.position.set(org[0] - dir[0] * 12 + tx * (i - 4) * 2.5, 3, org[1] - dir[1] * 12 + tz * (i - 4) * 2.5); sp.scale.setScalar(14); this.group.add(sp); mist.push(sp); }
    this.anim.push((dt, t) => { tex.offset.y -= dt * .9; mist.forEach((sp, i) => { sp.material.opacity = .32 + Math.sin(t * 1.3 + i) * .1; sp.position.y = 3 + Math.sin(t * .8 + i * 2) * .8; }); });
  }

  // ---- vegetation: deterministic scatter from 'forest' objects, binned by chunk, drawn as instanced meshes ----
  genTrees() {
    const hf = this.hf, trees = new Map(), segs = this.map.edges.map(([a, b]) => [this.map.nodes[a], this.map.nodes[b]]);
    const near = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); };
    const plazas = this.objects.filter(o => o.kind === 'plaza'), forests = this.objects.filter(o => o.kind === 'forest');
    let count = 0;
    for (const f of forests) {
      let s = (f.data.seed || 1) * 9301 + 49297; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      for (let i = 0; i < f.data.count * 3 && count < (this.cfg.maxTrees || 5200); i++) {
        const a = rnd() * 6.2832, d = Math.sqrt(rnd()) * f.data.r, x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d;
        if (Math.abs(x) > this.bound - 8 || Math.abs(z) > this.bound - 8) continue;
        const h = hf.heightAt(x, z); if (h < .5 || h > 48) continue;
        const nn = hf.normalAt(x, z); if (Math.hypot(nn[0], nn[2]) / nn[1] > .75) continue;
        if (this.obstacles.some(b => x > b.x0 - 5 && x < b.x1 + 5 && z > b.z0 - 5 && z < b.z1 + 5)) continue;
        if (this.parcels.some(p => x > p.x0 - 3 && x < p.x1 + 3 && z > p.z0 - 3 && z < p.z1 + 3)) continue;     // reserved for government development
        if (plazas.some(p => Math.hypot(x - p.x, z - p.z) < p.data.r + 8) || segs.some(sg => near(x, z, sg[0], sg[1]) < 7) || hf.riverDist(x, z) < 14) continue;
        const type = this.cfg.pickTree ? this.cfg.pickTree(h, rnd, f.data) : h > 24 ? 'conifer' : rnd() < .45 ? 'acacia' : 'round', k = Math.floor((x + this.bound) / CHUNK) + ',' + Math.floor((z + this.bound) / CHUNK);
        (trees.get(k) || trees.set(k, []).get(k)).push({ x, z, y: h, type, s: .8 + rnd() * .9, ry: rnd() * 6.28, c: rnd() });
        count++; if (count >= (this.cfg.maxTrees || 5200)) break;
      }
    }
    this.trees = trees; this.treeCount = count;
  }
  treeMeshes(list) {
    if (this.cfg.treeMeshes) return this.cfg.treeMeshes(list);
    const out = [], m4 = new THREE.Matrix4(), col = new THREE.Color(), trunkG = this._trunk || (this._trunk = (() => { const g = new THREE.CylinderGeometry(.16, .3, 3.2, 7); g.translate(0, 1.6, 0); scaleUV(g, 1, 1.5); g.userData.shared = true; return g; })());
    for (const type of ['round', 'acacia', 'conifer']) {
      const l = list.filter(t => t.type === type); if (!l.length) continue;
      const trunk = new THREE.InstancedMesh(trunkG, M.bark(), l.length), crown = new THREE.InstancedMesh(crownGeo(type), M.leaf(), l.length);
      l.forEach((t, i) => { m4.makeRotationY(t.ry).scale(new THREE.Vector3(t.s, t.s * (.9 + t.c * .3), t.s)).setPosition(t.x, t.y - .2, t.z); trunk.setMatrixAt(i, m4); crown.setMatrixAt(i, m4); crown.setColorAt(i, col.setHSL(type === 'conifer' ? .4 : .22 + t.c * .1, .34, .32 + t.c * .22)); });
      trunk.castShadow = crown.castShadow = true; crown.receiveShadow = true; out.push(trunk, crown);
    }
    return out;
  }

  // ---- chunks: terrain mesh always present; 'detail' (structures, trees, colliders) streams in/out ----
  buildChunk(cx, cz) {
    const key = cx + ',' + cz, g = new THREE.Group(), rec = { group: g, colliders: [], detail: null };
    const t = buildTerrainChunk(this.hf, cx, cz); g.add(t); this.pickList.push(t); rec.terrain = t;
    this.group.add(g); this.chunks.set(key, rec);
  }
  buildDetail(key) {
    const rec = this.chunks.get(key); if (!rec || rec.detail) return;
    const d = rec.detail = new THREE.Group(); this._cur = key;
    for (const o of this.byChunk.get(key) || []) { d.add(this.place(o)); rec.colliders.push(...this.colsOf(o)); }
    this._cur = null;
    const tl = this.trees.get(key) || [];
    if (tl.length) { for (const m of this.treeMeshes(tl)) d.add(m); for (const t2 of tl) { rec.colliders.push({ x0: t2.x - .4, x1: t2.x + .4, z0: t2.z - .4, z1: t2.z + .4, h: this.cfg.trunkH ? this.cfg.trunkH(t2) : undefined }); if (this.cfg.treeLid) rec.colliders.push(...this.cfg.treeLid(t2)); } }
    rec.group.add(d); this._cc.key = '';
  }
  dropDetail(key) {
    const rec = this.chunks.get(key); if (!rec || !rec.detail) return;
    this.anim = this.anim.filter(f => f.chunk !== key); this.infoPoints = this.infoPoints.filter(p => p.chunk !== key);
    disposeGroup(rec.detail); rec.detail = null; rec.colliders = []; this._cc.key = '';
  }
  chunkDist(key, pos) { const [cx, cz] = key.split(',').map(Number); return Math.hypot(-this.bound + (cx + .5) * CHUNK - pos.x, -this.bound + (cz + .5) * CHUNK - pos.z); }
  desired(pos, r) {
    const n = Math.floor(2 * this.bound / CHUNK), out = [];
    for (let cx = 0; cx < n; cx++) for (let cz = 0; cz < n; cz++) { const key = cx + ',' + cz, d = this.chunkDist(key, pos); if (d < r) out.push([d, key, cx, cz]); }
    return out.sort((a, b) => a[0] - b[0]);
  }
  async preload(pos, progress) {
    const want = this.desired(pos, 230); let i = 0;
    for (const [, key, cx, cz] of want) { if (!this.chunks.has(key)) this.buildChunk(cx, cz); this.buildDetail(key); if (++i % 2 === 0) { progress(`Streaming terrain ${Math.round(i / want.length * 100)}%`); await nextFrame(); } }
  }
  // ---- live builder updates: objects added through /build appear without reloading ----
  pollBuilder(dt) {
    this.liveT -= dt; if (this.liveT > 0 || this.polling) return; this.liveT = 4; this.polling = true;
    this.api('GET', `/api/world/zones/${this.id}/objects?after=${this.lastObjId}`).then(add => { if (add.length) this.addObjects(add); }).always(() => { this.polling = false; });
  }
  addObjects(add) {
    this.lastObjId = Math.max(this.lastObjId, ...add.map(o => o.id)); this.objects.push(...add);
    this.obstacles.push(...add.flatMap(o => boxesOf(o)));
    if (add.some(o => TERRAIN_KINDS.has(o.kind))) {                       // landscape changed: rebuild height field and every chunk
      this.hf = createHeightField(this.objects, this.bound, this.info.seed); this.hf.palette = this.cfg.palette;
      for (const rec of this.chunks.values()) { disposeGroup(rec.group); } this.chunks.clear(); this.pickList = [];
    }
    for (const o of add) {
      if (TERRAIN_KINDS.has(o.kind) || o.kind === 'forest' || !this.B[o.kind]) continue;
      if (this.ALWAYS.has(o.kind)) { this._cur = null; this.group.add(this.place(o)); this.staticColliders.push(...this.colsOf(o)); }
      else (this.byChunk.get(o.chunk_x + ',' + o.chunk_z) || this.byChunk.set(o.chunk_x + ',' + o.chunk_z, []).get(o.chunk_x + ',' + o.chunk_z)).push(o);
    }
    this.genTrees();                                                       // deterministic: same trees, minus those now inside new obstacles
    for (const key of this.chunks.keys()) this.dropDetail(key);            // detail is rebuilt by the normal streaming queue
    this._cc.key = ''; this.updateT = 0;
  }
  update(dt, pos) {
    this.t += dt; for (const f of this.anim) f(dt, this.t); this.pollBuilder(dt);
    this.updateT -= dt;
    if (this.updateT <= 0) {            // streaming decisions twice a second; at most 2 builds per frame
      this.updateT = .5;
      this.buildQueue = this.desired(pos, this.TERRAIN_R).filter(d => !this.chunks.has(d[1])).map(d => ['t', d[1], d[2], d[3]]);
      for (const [key, rec] of this.chunks) { const d = this.chunkDist(key, pos); if (!rec.detail && d < DETAIL_R) this.buildQueue.push(['d', key]); else if (rec.detail && d > DETAIL_DROP) this.dropDetail(key); }
    }
    for (let i = 0; i < 2 && this.buildQueue.length; i++) {
      const [k, key, cx, cz] = this.buildQueue.shift();
      if (k === 't') { if (!this.chunks.has(key)) this.buildChunk(cx, cz); } else this.buildDetail(key);
    }
  }

  // ---- queries used by the player / agents / click-to-move ----
  groundAt(x, z) { return this.hf.groundAt(x, z); }
  collidersFor(x, z) {
    const key = Math.floor(x / 40) + ',' + Math.floor(z / 40);
    if (this._cc.key !== key) {
      const list = [], near = c => c.x1 > x - 80 && c.x0 < x + 80 && c.z1 > z - 80 && c.z0 < z + 80;
      for (const c of this.staticColliders) if (near(c)) list.push(c);
      for (const rec of this.chunks.values()) for (const c of rec.colliders) if (near(c)) list.push(c);
      this._cc = { key, list };
    }
    return this._cc.list;
  }
  // can the player step from (ox,oz) to (nx,nz)? Slope limit is measured on the terrain itself (independent of step length),
  // so cliffs cannot be climbed; deep water blocks unless on a bridge deck.
  blocked(nx, nz, ox, oz) {
    if (this.hf.deckAt(nx, nz) !== null) return false;
    if (!this.cfg.dry && this.hf.heightAt(nx, nz) < -.8) return true;        // dry worlds (Mars) have canyons you can walk into, not water
    const g1 = this.hf.heightAt(nx, nz), g0 = this.hf.heightAt(ox, oz);
    if (g1 <= g0 + .002) return false;                                   // walking downhill / level is always allowed
    const n = this.hf.normalAt(nx, nz, 1.2); return Math.hypot(n[0], n[2]) / n[1] > 1.05;
  }
  walkable(x, z) {
    if (Math.abs(x) > this.bound - 6 || Math.abs(z) > this.bound - 6) return false;
    for (const c of this.collidersFor(x, z)) if (!c.lid && x > c.x0 - .7 && x < c.x1 + .7 && z > c.z0 - .7 && z < c.z1 + .7) return false;
    if (this.hf.deckAt(x, z, 1.2) !== null) return true;                 // middle of a bridge
    if (this.hf.deckAt(x, z) !== null) return false;                     // deck edge: not used for planning
    const nn = this.hf.normalAt(x, z); if (Math.hypot(nn[0], nn[2]) / nn[1] > .85) return false;
    return this.cfg.dry || this.hf.heightAt(x, z) > -.7;
  }
  pickTargets() { return this.pickList; }
  locationAt(x, z) { return this.locations.find(l => Math.hypot(x - l.x, z - l.z) < Math.max(l.w, l.d) / 2) || null; }
  nearestInfo(pos, r = 3.6) { let best = null, bd = r; for (const p of this.infoPoints) { const d = Math.hypot(p.x - pos.x, p.z - pos.z); if (d < bd) { bd = d; best = p; } } return best; }
  fog() { return this.cfg.fog || [140, 640]; }
  dispose() { disposeGroup(this.group); this.chunks.clear(); this.pickList = []; this.anim = []; this.infoPoints = []; }
}
