// Deterministic terrain for open zones. The height field is built from stored features (mountain, hill, plateau, pool,
// river, bridge), so server data fully defines the landscape. Meshes are built per 100 m chunk and streamed.
import * as THREE from 'three';
import { M } from './materials.js';

export const CHUNK = 100;
export const WATER = -0.15;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function hash(x, y, s) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function noise(x, y, s) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, s, o = 4) => { let t = 0, a = .5, f = 1, n = 0; for (let i = 0; i < o; i++) { t += a * noise(x * f, y * f, s + i); n += a; a *= .5; f *= 2; } return t / n; };

export function createHeightField(objs, bound, seed) {
  const by = k => objs.filter(o => o.kind === k).map(o => Object.assign({ x: o.x, z: o.z, rot: o.rot }, o.data));
  const mountains = by('mountain'), hills = by('hill'), plateaus = by('plateau'), pools = by('pool'), bridges = by('bridge'), coasts = by('coast'), docks = by('dock');
  const rivers = by('river').map(r => { const segs = []; for (let i = 0; i < r.pts.length - 1; i++) segs.push([r.pts[i], r.pts[i + 1]]); return { segs, hw: r.w / 2, depth: r.depth }; });
  const sd = seed | 0;
  const distSeg = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); };

  function heightAt(x, z) {
    let h = (fbm(x * .009, z * .009, sd) - .5) * 8 + (fbm(x * .04, z * .04, sd + 7, 3) - .5) * 2.2;
    if (h < .3) h = .3 + (h - .3) * .08;                                                        // soft floor: no natural pits below the water line (ponds only via river/pool features)
    const r = Math.max(Math.abs(x), Math.abs(z)), e = sm(bound - 100, bound - 8, r);
    if (e > 0) h += e * e * (46 + 80 * fbm(x * .012, z * .012, sd + 3));                       // mountain wall around the kingdom
    for (const m of mountains) {
      const d = Math.hypot(x - m.x, z - m.z);
      if (d > m.r * 1.9) continue;
      if (m.mesa) { const t = sm(m.r, m.r - 14, d); h = Math.max(h, m.h * (.94 + .06 * noise(x * .05, z * .05, sd + 5)) * t); h += m.h * .3 * Math.exp(-Math.pow(d / (m.r * 1.5), 2)); }
      else h += m.h * Math.exp(-Math.pow(d / m.r, 2) * 1.3) * (.65 + .6 * fbm(x * .02, z * .02, sd + 9));
    }
    for (const q of hills) { const d = Math.hypot(x - q.x, z - q.z); if (d < q.r * 2.2) h += q.h * Math.exp(-Math.pow(d / q.r, 2) * 2); }
    for (const p of plateaus) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r + p.blend) h = lerp(h, p.h, 1 - sm(p.r, p.r + p.blend, d)); }
    for (const p of pools) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r + 8) h = lerp(h, -p.depth, 1 - sm(p.r * .6, p.r + 8, d)); }
    for (const c of coasts) if (z > c.z0 - 40) h -= c.depth * sm(c.z0 - 40, c.z0 + 55, z) * (1 + .4 * sm(c.z0 + 55, c.z0 + 160, z));   // shelving sea floor
    for (const rv of rivers) {
      let d = 1e9; for (const s of rv.segs) { const dd = distSeg(x, z, s[0], s[1]); if (dd < d) d = dd; }
      if (d < rv.hw + 9) { const t = 1 - sm(rv.hw, rv.hw + 9, d), bed = d < rv.hw ? -rv.depth * (1 - Math.pow(d / rv.hw, 2)) - .2 : 0; h = lerp(h, bed, t); }
    }
    return h;
  }
  // arched bridge decks: returns deck height at (x,z) or null
  const cosS = bridges.map(b => [Math.cos(b.rot), Math.sin(b.rot)]);
  function deckAt(x, z, margin = 0) {           // margin narrows the deck (route planning keeps to its middle)
    for (let i = 0; i < bridges.length; i++) {
      const b = bridges[i], dx = x - b.x, dz = z - b.z, u = dx * cosS[i][0] + dz * cosS[i][1], v = -dx * cosS[i][1] + dz * cosS[i][0];
      if (Math.abs(u) < b.len / 2 && Math.abs(v) < b.w / 2 - margin) return .1 + b.arch * Math.sin(Math.PI * (u / b.len + .5));
    }
    for (const k of docks) if (Math.abs(x - k.x) < k.w / 2 - margin && Math.abs(z - k.z) < k.d / 2 - margin) return k.y;   // flat floating docks over the water
    return null;
  }
  const groundAt = (x, z) => { const h = heightAt(x, z), d = deckAt(x, z); return d === null ? h : Math.max(h, d); };
  const normalAt = (x, z, e = 1.5) => { const nx = heightAt(x - e, z) - heightAt(x + e, z), nz = heightAt(x, z - e) - heightAt(x, z + e), l = Math.hypot(nx, 2 * e, nz); return [nx / l, 2 * e / l, nz / l]; };
  const riverDist = (x, z) => { let d = 1e9; for (const rv of rivers) for (const s of rv.segs) d = Math.min(d, distSeg(x, z, s[0], s[1])); return d; };
  return { heightAt, groundAt, deckAt, normalAt, riverDist, bridges, bound };
}

const mat = () => { const m = M.terrain(); return m; };
const col = new THREE.Color(), PALETTE_CACHE = new Map(), ROCK = new THREE.Color(0x58524a), SAND = new THREE.Color(0x7a6a45), DRY = new THREE.Color(0x7a6a30), MUD = new THREE.Color(0x1c1f1a);
function pal(P) {                                              // optional per-zone colour palette (Pandora: teal moss, violet rock, pale sand)
  if (!P) return null; let c = PALETTE_CACHE.get(P); if (!c) { c = { alt: new THREE.Color(P.alt), rock: new THREE.Color(P.rock), sand: new THREE.Color(P.sand) }; PALETTE_CACHE.set(P, c); } return c;
}
export function buildTerrainChunk(hf, cx, cz, seg = 40) {
  const b = hf.bound, x0 = -b + cx * CHUNK, z0 = -b + cz * CHUNK;
  const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, seg, seg); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv, colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const wx = x0 + CHUNK / 2 + p.getX(i), wz = z0 + CHUNK / 2 + p.getZ(i), h = hf.heightAt(wx, wz), nn = hf.normalAt(wx, wz), slope = Math.sqrt(nn[0] * nn[0] + nn[2] * nn[2]) / nn[1];
    p.setXYZ(i, wx, h, wz); n.setXYZ(i, nn[0], nn[1], nn[2]); uv.setXY(i, wx / 12, wz / 12);
    const v = noise(wx * .05, wz * .05, 3), v2 = noise(wx * .013, wz * .013, 4);
    const P = hf.palette, PC = pal(P);
    if (P) { col.setHSL(P.hue + v * .06 - v2 * .04, P.sat - v2 * .1, P.light + v * .08 + v2 * .04); if (v2 > .6) col.lerp(PC.alt, (v2 - .6) * 2.4); }
    else { col.setHSL(.27 + v * .05 - v2 * .03, .55 - v2 * .1, .17 + v * .09 + v2 * .04); if (v2 > .62) col.lerp(DRY, (v2 - .62) * 2.2); }   // lush grass, patchy                                    // dry savanna patches
    const rd = hf.riverDist(wx, wz); if (h < .5 && h > -1.2 && rd < 20) col.lerp(SAND, .7);
    if (P && !P.dry && h < 1.6 && h > -2.5 && wz > 300) col.lerp(PC.sand, .85);                                          // beach   // river banks: mud/sand
    if (h <= WATER && !(P && P.dry)) { if (P) { col.copy(PC.sand).multiplyScalar(.35 + .65 * sm(-7, -.2, h)); col.lerp(new THREE.Color(0x0b3a52), sm(-.2, -6, h) * .6); } else col.copy(MUD); }   // sea floor: sand fading to deep teal
    const rock = sm(.45, .9, slope) + sm(40, 85, h) * .5; if (rock > 0) col.lerp(P ? PC.rock : ROCK, Math.min(1, rock));
    colors.set([col.r, col.g, col.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const m = new THREE.Mesh(geo, mat()); m.receiveShadow = true; m.userData.chunk = [cx, cz]; m.matrixAutoUpdate = false;
  return m;
}
