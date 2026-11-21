// Government construction visuals: a construction site that changes with the project stage, and the finished civic buildings.
// Themes: 'aether_city' (modern glass/concrete) and 'wakanda' (dark alloy + gold). Everything is procedural PBR (see materials.js).
import * as THREE from 'three';
import { M, facade, glowMat } from './materials.js';
import { boxUV, scaleUV, makeLabel } from './world.js';

const mesh = (geo, mat, x = 0, y = 0, z = 0, cast = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; return m; };
const bx = (w, h, d, mat, x, y, z, tile = 3) => mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, tile), mat, x, y, z);
const cyl = (rt, rb, h, mat, x, y, z, seg = 10) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);
const STYLE = { aether_city: { apartment: 'civic', office: 'glass', clinic: 'lab', research_lab: 'lab', workshop: 'civic' }, wakanda: { apartment: 'royal', office: 'tech', clinic: 'lab', research_lab: 'tech', workshop: 'civic' }, mars: { apartment: 'tech', office: 'tech', clinic: 'lab', research_lab: 'lab', workshop: 'civic' } };
const ACCENT = { aether_city: '#35e0ff', wakanda: '#f2c14e', mars: '#ff8a4c' };

function facadeBody(w, h, d, style, accent, seed) {
  const floors = Math.max(1, Math.round(h / 3.6)), cd = Math.max(2, Math.round(d / 2.6)), cw = Math.max(2, Math.round(w / 2.6)), roof = M.concrete();
  const fx = facade(style, cd, floors, accent, seed), fz = facade(style, cw, floors, accent, seed + 1);
  return mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, 3), [fx, fx, roof, roof, fz, fz], 0, h / 2, 0);
}

// ---------- finished buildings ----------
export function civicBuilders(theme) {
  if (theme === 'pandora') return organicCivic();
  const accent = ACCENT[theme] || '#35e0ff', gold = theme === 'wakanda', B = {};
  const common = (g, w, d, h, name, kind) => {
    g.add(bx(w + 1.2, .5, d + 1.2, M.concrete(), 0, .25, 0));                                       // plinth
    g.add(bx(w + .4, .6, d + .4, gold ? M.gold() : M.concrete(), 0, h + .3, 0));                     // parapet / cornice
    const door = mesh(new THREE.BoxGeometry(2.4, 2.8, .15), glowMat({ color: 0x222222, emissive: 0xffd9a0 }, 1.1), 0, 1.6, d / 2 + .08, false); g.add(door);
    const lab = makeLabel(name || kind, null, accent, 9); lab.position.set(0, h + 4, 0); g.add(lab);
  };
  for (const kind of ['apartment', 'office', 'clinic', 'research_lab', 'workshop']) {
    B['civic_' + kind] = (o) => {
      const { w, d, h, name } = o.data, g = new THREE.Group(), style = (STYLE[theme] || STYLE.aether_city)[kind];
      g.add(facadeBody(w, h, d, style, accent, 71 + kind.length));
      common(g, w, d, h, name, kind);
      if (kind === 'clinic') { const cross = glowMat({ color: 0x113311, emissive: 0x30ff80 }, 1.6); g.add(mesh(new THREE.BoxGeometry(2.4, .7, .2), cross, 0, h - 1.5, d / 2 + .12, false)); g.add(mesh(new THREE.BoxGeometry(.7, 2.4, .2), cross, 0, h - 1.5, d / 2 + .12, false)); }
      if (kind === 'research_lab') { const dome = mesh(new THREE.SphereGeometry(Math.min(w, d) * .3, 24, 12, 0, 6.2832, 0, 1.5708), M.glass(0x9fd6ff), 0, h + .6, 0, false); g.add(dome); }
      if (kind === 'workshop') { for (let i = -1; i <= 1; i++) g.add(bx(w * .25, 1, d + .5, M.metal(), i * w * .3, h + .9, 0, 2)); g.add(cyl(.5, .5, h + 4, M.metal(), w / 2 - 1.5, (h + 4) / 2, -d / 2 + 1.5)); }
      if (kind === 'office' || kind === 'apartment') for (const s of [-1, 1]) g.add(bx(.3, h, .5, gold ? M.gold() : M.plain(0x1a202c, .35, .85), s * (w / 2 + .05), h / 2, d / 2 + .05, 1));
      return g;
    };
  }
  B.civic_house = (o) => {
    const { w, d, h, name } = o.data, g = new THREE.Group(), wall = M.plaster();
    g.add(bx(w, h, d, wall, 0, h / 2, 0)); g.add(bx(w + .4, .3, d + .4, M.concrete(), 0, .15, 0));
    const rs = new THREE.Shape(); rs.moveTo(-(w + 1) / 2, 0); rs.lineTo((w + 1) / 2, 0); rs.lineTo(0, 2.4);
    const roof = mesh(scaleUV(new THREE.ExtrudeGeometry(rs, { depth: d + 1, bevelEnabled: false }), .5, .5), M.roof(), 0, h, -(d + 1) / 2); g.add(roof);
    g.add(bx(1, 2.1, .12, M.wood(), 0, 1.1, d / 2 + .04, 2));
    for (const sx of [-1, 1]) g.add(bx(1.2, 1.3, .14, glowMat({ color: 0x222222, emissive: 0xffd9a0 }, 1.1), sx * w * .3, 2.2, d / 2 + .03, 1));
    const lab = makeLabel(name || 'House', null, accent, 7); lab.position.set(0, h + 5, 0); g.add(lab);
    return g;
  };
  // a finished road: asphalt ribbon draped over the terrain with a centre line and lamp posts; data = {a:[x,z], b:[x,z], w}
  B.civic_road = (o, zone) => {
    const { a, b, w, name } = o.data, g = new THREE.Group(), gy = zone && zone.groundAt ? (x, z) => zone.groundAt(x, z) : () => 0, y0 = gy(o.x, o.z);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.ceil(len / 3)), ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len, nx = -uz, nz = ux;
    const ribbon = (half, lift, mat, tile) => {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        for (const s of [-1, 1]) { const px = x + nx * half * s, pz = z + nz * half * s; pos.push(px - o.x, gy(px, pz) - y0 + lift, pz - o.z); uv.push(t * len / tile, s > 0 ? 1 : 0); }
        if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; return m;
    };
    const asph = M.asphalt(); asph.polygonOffset = true; asph.polygonOffsetFactor = -2;
    g.add(ribbon(w / 2, .09, asph, 6), ribbon(.08, .11, M.lane(), 6));
    const pole = M.plain(0x2a2f3a, .45, .8), lampM = glowMat({ color: 0x333333, emissive: 0xfff0d0 }, 2.2);
    for (let t = 8, j = 0; t < len - 6; t += 16, j++) {                                  // lamp posts alternate sides
      const s = j % 2 ? 1 : -1, x = a[0] + ux * t + nx * (w / 2 + .6) * s, z = a[1] + uz * t + nz * (w / 2 + .6) * s, y = gy(x, z) - y0;
      g.add(mesh(new THREE.CylinderGeometry(.06, .1, 6.2, 8), pole, x - o.x, y + 3.1, z - o.z), mesh(new THREE.BoxGeometry(.8, .12, .32), lampM, x - o.x, y + 6.2, z - o.z, false));
    }
    const lab = makeLabel(name || 'Road', null, accent, 8); lab.position.set(0, 7, 0); g.add(lab);
    return g;
  };
  return B;
}

// ---------- Pandora: grown, woven pods and tree-houses (organic, glowing at night) ----------
function organicCivic() {
  const B = {}, weave = M.thatch().clone(), glow = glowMat({ color: 0x103a40, emissive: 0x2affd0, roughness: .6 }, 1.1), door = glowMat({ color: 0x222222, emissive: 0xffd9a0 }, 1.2), bark = M.plain(0x2b2340, .9);
  weave.color.set(0xb79ad8);
  const dome = (r, h, y = 0) => { const m = mesh(new THREE.SphereGeometry(r, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2), weave, 0, y, 0); m.scale.y = h / r; return m; };
  const pod = (g, r, h, name) => {
    g.add(cyl(r * 1.15, r * 1.25, .6, bark, 0, .3, 0, 20)); g.add(dome(r, h, .6));
    const d = mesh(new THREE.TorusGeometry(r * .32, .1, 8, 18, Math.PI), door, 0, .6, r * .93, false); g.add(d);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + .3; g.add(mesh(new THREE.SphereGeometry(.22, 8, 6), glow, Math.cos(a) * r * .93 * Math.cos(.7), 1.8 + h * .35, Math.sin(a) * r * .93 * Math.cos(.7), false)); }
    g.add(mesh(new THREE.SphereGeometry(.4, 10, 8), glow, 0, h + .9, 0, false));
    const l = makeLabel(name || 'Pod', null, '#5ff0c8', 8); l.position.set(0, h + 5, 0); g.add(l);
  };
  B.civic_house = o => { const g = new THREE.Group(), r = Math.max(4, o.data.w / 2); pod(g, r, o.data.h + 1.5, o.data.name); return g; };
  for (const [kind, k] of [['apartment', 1], ['office', .9], ['clinic', .8], ['research_lab', .9], ['workshop', .8]]) {
    B['civic_' + kind] = o => {                          // a trunk with stacked woven pods (tree-house tower)
      const { w, h, name } = o.data, g = new THREE.Group(), floors = Math.max(1, Math.round(h / 3.8));
      g.add(cyl(w * .22, w * .3, h + 2, bark, 0, (h + 2) / 2, 0, 12));
      for (let f = 0; f < floors; f++) { const r = w * .5 * (1 - f * .06) * k + 1, y = 1 + f * h / floors; g.add(cyl(r, r * .9, .35, bark, 0, y, 0, 18)); const p = dome(r * .75, 2.6, y + .2); g.add(p); const ring = mesh(new THREE.TorusGeometry(r * .75, .07, 6, 24), glow, 0, y + .35, 0, false); ring.rotation.x = Math.PI / 2; g.add(ring); }
      if (kind === 'research_lab') g.add(mesh(new THREE.OctahedronGeometry(1.4), glowMat({ color: 0x103040, emissive: 0x66e6ff }, 1.8), 0, h + 3.5, 0, false));
      if (kind === 'clinic') g.add(mesh(new THREE.TorusGeometry(1.1, .2, 8, 20), glowMat({ color: 0x113311, emissive: 0x30ff80 }, 1.6), 0, h + 3, 0, false));
      const l = makeLabel(name, null, '#5ff0c8', 9); l.position.set(0, h + 7, 0); g.add(l); return g;
    };
  }
  return B;
}

// ---------- construction site ----------
function signTexture(title, stage, pct) { return makeLabel(title, `${stage} · ${Math.round(pct)}%`, '#ffb347', 9); }

export function buildSite(s, theme) {
  const g = new THREE.Group(), { w, d, h, pad, progress: p, stage, name } = s, pw = pad[1] - pad[0], pd = pad[3] - pad[2];
  const orange = M.plain(0xff8c1a, .6), steel = M.metal(), conc = M.concrete(), dirt = M.earth();
  g.position.set(s.x, 0, s.z);
  const lx = (pad[0] + pad[1]) / 2 - s.x, lz = (pad[2] + pad[3]) / 2 - s.z;          // pad centre relative to the building centre
  const padGeo = new THREE.PlaneGeometry(pw - 1, pd - 1); padGeo.rotateX(-Math.PI / 2);
  const pm = mesh(scaleUV(padGeo, pw / 3, pd / 3), dirt, lx, .12, lz, false); pm.material = pm.material.clone(); pm.material.polygonOffset = true; pm.material.polygonOffsetFactor = -4; g.add(pm);
  for (let i = 0; i <= 8; i++) for (const [fx, fz, rx] of [[pad[0] + 1 + i * (pw - 2) / 8, pad[2] + 1, 0], [pad[0] + 1 + i * (pw - 2) / 8, pad[3] - 1, 0], [pad[0] + 1, pad[2] + 1 + i * (pd - 2) / 8, 1], [pad[1] - 1, pad[2] + 1 + i * (pd - 2) / 8, 1]])
    g.add(cyl(.07, .07, 1.5, steel, fx - s.x, .75, fz - s.z, 6));                       // fence posts
  for (const [fx, fz, len, rot] of [[(pad[0] + pad[1]) / 2, pad[2] + 1, pw - 2, 0], [(pad[0] + pad[1]) / 2, pad[3] - 1, pw - 2, 0], [pad[0] + 1, (pad[2] + pad[3]) / 2, pd - 2, 1], [pad[1] - 1, (pad[2] + pad[3]) / 2, pd - 2, 1]]) {
    const m = mesh(new THREE.PlaneGeometry(len, 1), new THREE.MeshStandardMaterial({ color: 0xff8c1a, transparent: true, opacity: .55, side: THREE.DoubleSide, roughness: .8 }), fx - s.x, 1, fz - s.z, false); if (rot) m.rotation.y = Math.PI / 2; g.add(m);
  }
  const sign = signTexture(name, stage, p); sign.position.set(lx, 4.2, pad[3] - s.z - 1.2); g.add(sign);
  g.add(cyl(.08, .08, 3.2, steel, lx, 1.6, pad[3] - s.z - 1.2, 6));
  const idx = ['Proposed', 'Budget Approved', 'Contractor Assigned', 'Site Preparation', 'Foundation', 'Structural Construction', 'Exterior Completion', 'Inspection'].indexOf(stage);
  if (idx <= 2) {                                                                      // survey stakes only
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(mesh(new THREE.ConeGeometry(.2, 1.2, 6), orange, sx * w / 2, .6, sz * d / 2, false));
    return g;
  }
  if (idx === 3) {                                                                     // excavator + spoil heaps
    const ex = new THREE.Group(); ex.position.set(-w * .2, 0, -d * .2);
    ex.add(bx(3, 1.2, 2, orange, 0, .9, 0, 1)); ex.add(bx(1.4, 1.2, 1.4, M.glass(0x88aacc), .5, 2, 0, 1)); ex.add(bx(1.6, .5, .5, steel, -1.7, 2.1, 0, 1));
    for (const sx of [-1, 1]) ex.add(bx(3.2, .5, .6, M.plain(0x222222, .9), 0, .3, sx * 1.1, 1)); g.add(ex);
    for (let i = 0; i < 4; i++) g.add(mesh(new THREE.ConeGeometry(1.8, 1.6, 8), dirt, (i - 1.5) * 3, .8, d / 2 - 1, true));
    return g;
  }
  if (idx >= 4) g.add(bx(w + .4, .5, d + .4, conc, 0, .25, 0));                         // foundation slab
  if (idx === 4) { for (let i = -3; i <= 3; i++) for (const sz of [-1, 1]) g.add(cyl(.05, .05, 1.4, M.plain(0x7a4a2a, .7, .5), i * w / 7, .9, sz * d / 2.3, 5)); return g; }
  const floors = Math.max(1, Math.round(h / 3.4)), fh = h / floors;
  const sp = idx === 5 ? Math.min(1, Math.max(0, (p - 35) / 40)) : 1;                  // structural frame height fraction
  const built = Math.max(1, Math.ceil(sp * floors));
  const col = M.plain(0x9a9a96, .8);
  for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) g.add(bx(.5, built * fh, .5, col, cx * (w / 2 - .4), .5 + built * fh / 2, cz * (d / 2 - .4), 1));
  for (let f = 1; f <= built; f++) g.add(bx(w - .2, .35, d - .2, conc, 0, .5 + f * fh, 0, 3));
  if (idx >= 6) {                                                                      // cladding rises on the exterior stage
    const cl = idx === 6 ? Math.min(1, Math.max(.05, (p - 75) / 17)) : 1, ch = h * cl;
    const style = (STYLE[theme] || STYLE.aether_city)[s.kind] || 'civic', body = facadeBody(w, h, d, style, ACCENT[theme] || '#35e0ff', 71 + s.kind.length);
    body.scale.y = cl; body.position.y = (h * cl) / 2 + .5; g.add(body);
    if (idx === 6) for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) g.add(bx(.12, ch + 1, .12, orange, sx * (w / 2 + .7), ch / 2, (k - 1) * d / 3, 1));   // scaffolding
  }
  if (idx <= 6) {                                                                      // tower crane
    const cx = w / 2 + 3, cz = -d / 2 - 2, ch = h + 6;
    g.add(bx(.6, ch, .6, M.plain(0xffcc00, .6), cx, ch / 2, cz, 1)); g.add(bx(w + 8, .4, .4, M.plain(0xffcc00, .6), cx - (w + 8) / 2 + 2, ch, cz, 1)); g.add(bx(2, 1, 1, steel, cx + 1.2, ch + .5, cz, 1));
    g.add(cyl(.03, .03, 4, steel, cx - w / 2, ch - 2, cz, 4));
  }
  return g;
}
