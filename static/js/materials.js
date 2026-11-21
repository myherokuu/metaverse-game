// Procedural PBR materials: every surface gets colour + normal + roughness/metalness (ORM) maps generated on canvas,
// so the scene needs no external texture files. Real texture files can still replace any of them via assets.js.
// opts.fallback = true -> no normal/ORM maps, scalar roughness/metalness only (cheap mode).
import * as THREE from 'three';

export const opts = { fallback: false, aniso: 4, detail: 1 };   // detail: texture-size multiplier
const allMats = new Set(), glow = [], cache = new Map();
let nightNow = 0, envNow = 1;                       // current lighting, applied to materials created later (lazy zones)
const glowI = (base) => base * (.03 + 1.5 * nightNow);

export function track(m) { allMats.add(m); m.envMapIntensity = envNow; return m; }
export function glowMat(params, base) { const m = track(new THREE.MeshStandardMaterial(params)); m.emissiveIntensity = glowI(base); m.envMapIntensity = envNow; glow.push({ m, base }); return m; }
export function setNight(night) { nightNow = night; for (const g of glow) g.m.emissiveIntensity = glowI(g.base); }
export function setEnvIntensity(v) { envNow = v; for (const m of allMats) m.envMapIntensity = v; }

// ---------- tileable noise ----------
function hash(x, y, s) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, P, s) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), m = a => ((a % P) + P) % P;
  const a = hash(m(x0), m(y0), s), b = hash(m(x0 + 1), m(y0), s), c = hash(m(x0), m(y0 + 1), s), d = hash(m(x0 + 1), m(y0 + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct, base, s = 0) { let sum = 0, amp = .5, f = base, t = 0; for (let i = 0; i < oct; i++) { sum += amp * vnoise(x * f, y * f, f, s + i); t += amp; amp *= .5; f *= 2; } return sum / t; }

// ---------- map set builder ----------
const cv = (W, H) => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
class Maps {
  constructor(W, H) { this.W = W; this.H = H; this.c = cv(W, H); this.h = cv(W, H); this.o = cv(W, H); this.e = null; this.g = { c: this.c.getContext('2d'), h: this.h.getContext('2d'), o: this.o.getContext('2d') }; }
  // per-pixel fill: fn(u,v,x,y) -> [r,g,b (0-255), height 0-1, rough 0-1, metal 0-1]
  pix(fn) {
    const { W, H } = this, ic = this.g.c.createImageData(W, H), ih = this.g.h.createImageData(W, H), io = this.g.o.createImageData(W, H);
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 4) {
      const p = fn(x / W, y / H, x, y); ic.data.set([p[0], p[1], p[2], 255], i);
      const h = p[3] * 255; ih.data.set([h, h, h, 255], i); io.data.set([255, p[4] * 255, p[5] * 255, 255], i);
    }
    this.g.c.putImageData(ic, 0, 0); this.g.h.putImageData(ih, 0, 0); this.g.o.putImageData(io, 0, 0); return this;
  }
  tex(c, srgb) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = opts.aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }
  normalCanvas(strength) {
    const { W, H } = this, d = this.g.h.getImageData(0, 0, W, H).data, out = cv(W, H), g = out.getContext('2d'), img = g.createImageData(W, H);
    const hh = (x, y) => d[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;   // wraps -> tileable
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 4) {
      const dx = (hh(x + 1, y) - hh(x - 1, y)) * strength, dy = (hh(x, y + 1) - hh(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1);
      img.data.set([(-dx / l * .5 + .5) * 255, (dy / l * .5 + .5) * 255, (1 / l * .5 + .5) * 255, 255], i);   // +Y up (canvas y is flipped)
    }
    g.putImageData(img, 0, 0); return out;
  }
  finish(strength = 2) {
    const r = { map: this.tex(this.c, true) };
    if (this.e) r.emissiveMap = this.tex(this.e, true);
    if (!opts.fallback) { r.normalMap = this.tex(this.normalCanvas(strength), false); r.normalScale = new THREE.Vector2(1, 1); r.orm = this.tex(this.o, false); }
    return r;
  }
}

function std(maps, { rough = .8, metal = 0, ...extra } = {}) {
  const p = { map: maps.map, ...extra };
  if (maps.emissiveMap) { p.emissiveMap = maps.emissiveMap; p.emissive = new THREE.Color(0xffffff); }
  if (maps.orm) Object.assign(p, { normalMap: maps.normalMap, normalScale: maps.normalScale, roughnessMap: maps.orm, metalnessMap: maps.orm, roughness: 1, metalness: 1 });
  else Object.assign(p, { roughness: rough, metalness: metal });
  return track(new THREE.MeshStandardMaterial(p));
}
const S = n => Math.max(64, Math.round(n * opts.detail));
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
function stripes(c) {   // woven stripes for market awnings
  const cv2 = cv(64, 64), g = cv2.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 64; i += 16) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(i, 0, 8, 64); }
  const t = new THREE.CanvasTexture(cv2); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
const once = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };

// ---------- catalogue (UV unit = metres; each texture documents the area it covers) ----------
export const M = {
  // 6 m x 6 m of asphalt: fine aggregate + subtle wear
  asphalt: () => once('asphalt', () => std(new Maps(S(256), S(256)).pix((u, v) => {
    const n = fbm(u, v, 5, 8, 1), g = hash(Math.floor(u * 256), Math.floor(v * 256), 7), t = 38 + n * 22 + g * 16;
    return [t, t + 1, t + 4, .35 + n * .3 + g * .35, .78 + n * .2, 0];
  }).finish(2.4), { rough: .88 })),
  // 2 m x 2 m: four 1 m concrete flags with grout
  pavement: () => once('pavement', () => std(new Maps(S(256), S(256)).pix((u, v) => {
    const fu = (u * 2) % 1, fv = (v * 2) % 1, e = Math.min(fu, 1 - fu, fv, 1 - fv), grout = e < .018, tile = Math.floor(u * 2) + Math.floor(v * 2) * 2;
    const n = fbm(u, v, 5, 6, 3), t = 128 + n * 46 + hash(tile, 3, 2) * 14 - (grout ? 52 : 0);
    return [t, t, t + 3, grout ? .1 : .6 + n * .3, grout ? .98 : .82, 0];
  }).finish(2.2), { rough: .85 })),
  // 4 m x 4 m: polished plaza stone, 2 x 2 large slabs with brushed veining
  plaza: () => once('plaza', () => std(new Maps(S(256), S(256)).pix((u, v) => {
    const fu = (u * 2) % 1, fv = (v * 2) % 1, e = Math.min(fu, 1 - fu, fv, 1 - fv), grout = e < .01, tile = Math.floor(u * 2) + Math.floor(v * 2) * 2;
    const n = fbm(u + hash(tile, 1, 4), v, 6, 4, 9), vein = Math.abs(fbm(u, v, 3, 3, 5) - .5), t = 78 + n * 40 + hash(tile, 5, 2) * 16 - (grout ? 34 : 0) - (vein < .02 ? 14 : 0);
    return [t, t + 3, t + 10, grout ? .1 : .6, grout ? .9 : .38 + n * .2, .05];
  }).finish(1.4), { rough: .5 })),
  // 8 m x 8 m: lawn / soil mix for the open ground
  ground: () => once('ground', () => std(new Maps(S(512), S(512)).pix((u, v) => {
    const n = fbm(u, v, 6, 6, 11), m = fbm(u, v, 4, 3, 21), g = hash(Math.floor(u * 512), Math.floor(v * 512), 3);
    const c = mix([54, 70, 40], [84, 96, 52], n), c2 = mix(c, [96, 82, 58], Math.max(0, m - .55) * 2.2);
    return [c2[0] + g * 14, c2[1] + g * 14, c2[2] + g * 8, .4 + n * .4 + g * .2, .95, 0];
  }).finish(2.8), { rough: .95 })),
  // 3 m wide, 8 m long dashes (alpha) for lane markings
  lane: () => once('lane', () => { const m = new Maps(S(64), S(64)).pix((u, v) => [225, 222, 205, .5, .6, 0]); const r = m.finish(.2); const t = r.map; const c = cv(64, 64), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 40, 64); const a = new THREE.CanvasTexture(c); a.wrapS = a.wrapT = THREE.RepeatWrapping; return track(new THREE.MeshStandardMaterial({ map: t, alphaMap: a, transparent: true, roughness: .7, polygonOffset: true, polygonOffsetFactor: -4 })); }),
  concrete: () => once('concrete', () => std(new Maps(S(256), S(256)).pix((u, v) => {
    const n = fbm(u, v, 6, 4, 31), p = hash(Math.floor(u * 256), Math.floor(v * 256), 5) > .985 ? -30 : 0, t = 150 + n * 50 + p;
    return [t, t, t + 3, .5 + n * .3, .85, 0];
  }).finish(1.8), { rough: .88 })),
  // 3 m x 3 m: rendered plaster for houses
  plaster: () => once('plaster', () => std(new Maps(S(256), S(256)).pix((u, v) => {
    const n = fbm(u, v, 6, 8, 41), t = 196 + n * 36;
    return [t, t - 6, t - 16, .5 + n * .5, .9, 0];
  }).finish(2.6), { rough: .9 })),
  // 2 m x 2 m: clay roof tiles in courses
  roof: () => once('roof', () => std(new Maps(S(256), S(256)).pix((u, v) => {
    const row = Math.floor(v * 10), fv = (v * 10) % 1, off = row % 2 ? .5 : 0, fu = ((u * 8 + off) % 1), edge = Math.min(fu, 1 - fu), n = fbm(u, v, 4, 6, 51), shade = hash(Math.floor(u * 8 + off), row, 6) * 28;
    const h = Math.min(1, fv * 1.4) * .7 + (edge < .06 ? -.3 : 0), c = [92 + shade + n * 20, 56 + shade * .6, 48 + shade * .5];
    return [c[0], c[1], c[2], h, .8, 0];
  }).finish(3.2), { rough: .8 })),
  bark: () => once('bark', () => std(new Maps(S(128), S(256)).pix((u, v) => {
    const n = fbm(u * 3, v, 5, 4, 61), t = 52 + n * 48; return [t * 1.05, t * .8, t * .6, n, .95, 0];
  }).finish(3), { rough: .95 })),
  leaf: () => once('leaf', () => std(new Maps(S(128), S(128)).pix((u, v) => {
    const n = fbm(u, v, 5, 8, 71), t = n * 80; return [26 + t * .35, 70 + t * .8, 24 + t * .3, n, .75, 0];
  }).finish(2), { rough: .75, side: THREE.DoubleSide })),
  // brushed metal panels, 2 m x 2 m (2x2 panels)
  metal: () => once('metal', () => std(new Maps(S(256), S(256)).pix((u, v) => {
    const fu = (u * 2) % 1, fv = (v * 2) % 1, e = Math.min(fu, 1 - fu, fv, 1 - fv), seam = e < .012, br = hash(Math.floor(u * 256), 0, 9) * 16, t = 120 + br - (seam ? 50 : 0);
    return [t, t + 4, t + 10, seam ? .2 : .65, .35 + br / 90, .85];
  }).finish(1.6), { rough: .4, metal: .8 })),
  // ---- Wakanda ----
  // neutral grey detail: multiplied by vertex colours (grass / earth / rock) so one material shades the whole terrain
  terrain: () => once('terrain', () => std(new Maps(S(512), S(512)).pix((u, v) => {
    const n = fbm(u, v, 6, 8, 81), m = fbm(u, v, 3, 4, 82), g = hash(Math.floor(u * 512), Math.floor(v * 512), 8), t = 170 + n * 70 + m * 20 + g * 20;
    return [t, t, t, .35 + n * .5 + g * .15, .96, 0];
  }).finish(3), { rough: .96, vertexColors: true })),
  rock: () => once('rock', () => std(new Maps(S(256), S(256)).pix((u, v) => {
    const n = fbm(u, v, 6, 5, 91), cr = Math.abs(fbm(u * 2, v * 2, 4, 3, 92) - .5), t = 92 + n * 70 - (cr < .03 ? 36 : 0);
    return [t * 1.02, t, t * .94, n - (cr < .03 ? .4 : 0), .9, 0];
  }).finish(3.2), { rough: .92 })),
  // brushed gold: PBR metal, tinted albedo
  gold: () => once('gold', () => std(new Maps(S(256), S(256)).pix((u, v) => {
    const br = hash(Math.floor(u * 256), 0, 17) * 22, n = fbm(u, v, 4, 6, 18) * 26;
    return [214 + br - n * .4, 168 + br - n, 62 + br * .4 - n * .8, .55 + br / 80, .3 + n / 160, .95];
  }).finish(1.2), { rough: .32, metal: .95 })),
  // dark alloy with faint seam lines
  alloy: () => once('alloy', () => std(new Maps(S(256), S(256)).pix((u, v) => {
    const fu = (u * 3) % 1, fv = (v * 3) % 1, e = Math.min(fu, 1 - fu, fv, 1 - fv), seam = e < .01, n = fbm(u, v, 4, 6, 33) * 26, t = 44 + n - (seam ? 22 : 0);
    return [t * .95, t * .92, t * 1.15, seam ? .15 : .7, .26 + n / 150, .92];
  }).finish(1.6), { rough: .3, metal: .9 })),
  earth: () => once('earth', () => std(new Maps(S(256), S(256)).pix((u, v) => {
    const n = fbm(u, v, 6, 6, 41), g = hash(Math.floor(u * 256), Math.floor(v * 256), 4), t = n * 46 + g * 12;
    return [150 + t, 92 + t * .7, 58 + t * .45, .45 + n * .5, .95, 0];
  }).finish(2.8), { rough: .95 })),
  thatch: () => once('thatch', () => std(new Maps(S(256), S(256)).pix((u, v) => {
    const st = hash(Math.floor(u * 90), 0, 55), n = fbm(u, v * 6, 3, 4, 56), t = 120 + st * 70 + n * 30, ring = (v * 9) % 1 < .08 ? -34 : 0;
    return [t + ring, t * .82 + ring, t * .5 + ring, .5 + st * .4 + (ring ? -.3 : 0), .96, 0];
  }).finish(3), { rough: .96 })),
  wood: () => once('wood', () => std(new Maps(S(128), S(256)).pix((u, v) => {
    const g = fbm(u * 8, v * .8, 4, 4, 61), t = 70 + g * 70; return [t * 1.2, t * .78, t * .5, g, .75, 0];
  }).finish(2), { rough: .75 })),
  textile: (color) => once('textile' + color, () => { const c = new THREE.Color(color); return track(new THREE.MeshStandardMaterial({ color: c, roughness: .9, side: THREE.DoubleSide, map: stripes(c) })); }),
  river: () => once('river', () => std(new Maps(S(256), S(256)).pix((u, v) => {
    const n = fbm(u, v, 5, 6, 201); return [24 + n * 30, 88 + n * 50, 118 + n * 50, n, .05 + n * .1, 0];
  }).finish(2.5), { rough: .08, transparent: true, opacity: .8, envMapIntensity: 1.8 })),
  // glass / water-like reflective surface without maps
  glass: (color = 0x7fa9c4) => once('glass' + color, () => track(new THREE.MeshStandardMaterial({ color, roughness: .06, metalness: .9, transparent: true, opacity: .55, envMapIntensity: 1.6 }))),
  water: () => once('water', () => track(new THREE.MeshStandardMaterial({ color: 0x1f5d7a, roughness: .04, metalness: .2, transparent: true, opacity: .85, envMapIntensity: 2 }))),
  plain: (color, rough = .7, metal = 0) => once('plain' + color + rough + metal, () => track(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }))),
};

// ---------- building facades ----------
// style: wall/glass colours, window proportions, lit probability. cols x rows = windows across x floors up.
const STYLES = {
  glass: { wall: [56, 64, 82], glass: [[132, 176, 214], [44, 76, 112]], padX: .05, padY: .1, metalWall: .85, lit: .26, frame: 96 },
  lab:   { wall: [212, 216, 222], glass: [[130, 170, 180], [50, 84, 96]], padX: .08, padY: .3, metalWall: .2, lit: .3, frame: 190 },
  stone: { wall: [196, 182, 156], glass: [[96, 120, 140], [34, 48, 62]], padX: .3, padY: .12, metalWall: 0, lit: .35, frame: 150 },
  royal: { wall: [34, 32, 44], glass: [[150, 120, 190], [38, 30, 70]], padX: .08, padY: .12, metalWall: .9, lit: .4, frame: 200 },
  tech:  { wall: [60, 66, 74], glass: [[110, 200, 210], [20, 70, 90]], padX: .05, padY: .08, metalWall: .8, lit: .55, frame: 150 },
  civic: { wall: [150, 148, 144], glass: [[100, 140, 160], [36, 56, 76]], padX: .1, padY: .22, metalWall: .1, lit: .3, frame: 110 },
};
export function facade(style, cols, rows, accent = '#35e0ff', seed = 1) {
  return once(`fac${style}${cols}x${rows}${seed}`, () => {
    const st = STYLES[style] || STYLES.civic, cell = Math.round(S(40)), W = cols * cell, H = rows * cell, m = new Maps(W, H), { c, h, o } = m.g;
    const wall = st.wall, rgb = a => `rgb(${a[0] | 0},${a[1] | 0},${a[2] | 0})`;
    c.fillStyle = rgb(wall); c.fillRect(0, 0, W, H);
    h.fillStyle = 'rgb(140,140,140)'; h.fillRect(0, 0, W, H);
    o.fillStyle = `rgb(255,${st.metalWall > .5 ? 90 : 200},${st.metalWall * 255 | 0})`; o.fillRect(0, 0, W, H);
    for (let i = 0; i < W * H / 60; i++) { const x = hash(i, 1, seed) * W, y = hash(i, 2, seed) * H, d = hash(i, 3, seed) * 14 - 7; c.fillStyle = `rgba(${d > 0 ? 255 : 0},${d > 0 ? 255 : 0},${d > 0 ? 255 : 0},.05)`; c.fillRect(x, y, 2, 2); }
    m.e = cv(W, H); const e = m.e.getContext('2d'); e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const ground = r === rows - 1, x = k * cell, y = r * cell;
      const px = ground ? .06 : st.padX, py = ground ? .06 : st.padY, wx = x + cell * px, wy = y + cell * py, ww = cell * (1 - 2 * px), wh = cell * (1 - 2 * py) * (ground ? 1 : 1);
      const t = hash(k, r, seed + 5), g1 = mix(st.glass[0], st.glass[1], t * .5), g2 = mix(st.glass[1], [10, 18, 30], t);
      const gr = c.createLinearGradient(0, wy, 0, wy + wh); gr.addColorStop(0, rgb(g1)); gr.addColorStop(1, rgb(g2)); c.fillStyle = gr; c.fillRect(wx, wy, ww, wh);
      h.fillStyle = 'rgb(60,60,60)'; h.fillRect(wx, wy, ww, wh);
      o.fillStyle = 'rgb(255,22,235)'; o.fillRect(wx, wy, ww, wh);            // glass: smooth + metallic (reflects env map)
      c.strokeStyle = rgb([st.frame, st.frame, st.frame + 6]); c.lineWidth = Math.max(1.5, cell * .05); c.strokeRect(wx, wy, ww, wh);
      h.strokeStyle = 'rgb(235,235,235)'; h.lineWidth = Math.max(2, cell * .07); h.strokeRect(wx, wy, ww, wh);          // raised frame
      if (ww > cell * .6) { c.beginPath(); c.moveTo(wx + ww / 2, wy); c.lineTo(wx + ww / 2, wy + wh); c.stroke(); h.beginPath(); h.moveTo(wx + ww / 2, wy); h.lineTo(wx + ww / 2, wy + wh); h.stroke(); }
      if (hash(k, r, seed + 9) < st.lit + (ground ? .3 : 0)) { const b = .35 + hash(k, r, seed + 11) * .65, warm = hash(k, r, seed + 13) > .35; e.fillStyle = warm ? `rgba(255,${190 + b * 40 | 0},${120 + b * 60 | 0},${b})` : accent; e.globalAlpha = warm ? 1 : .55 * b; e.fillRect(wx + 2, wy + 2, ww - 4, wh - 4); e.globalAlpha = 1; }
    }
    // floor slabs (spandrel lines)
    for (let r = 1; r < rows; r++) { c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(0, r * cell - 2, W, 3); h.fillStyle = 'rgb(210,210,210)'; h.fillRect(0, r * cell - 3, W, 5); }
    const mat = std(m.finish(2.2), { rough: .5, metal: .3 }); mat.emissiveIntensity = glowI(.95); mat.envMapIntensity = envNow; glow.push({ m: mat, base: .95 }); return { mat };
  }).mat;
}
