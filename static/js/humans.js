// Parametric human generator: every person gets their own skin, face, hair, body build and wardrobe, built from shared
// geometry + cached materials (cheap to clone/dispose). createHuman(seed) -> {group, update(dt,speed), gesture(name), equip(slot,value), outfit}.
// equip() lets anything change what a person wears/looks like at runtime, e.g. h.equip('hat','cap'); h.equip('top', {kind:'jacket', color:'#223'}).
// Faces +Z, feet at y=0, ~1.75 m at height=1. Shortcut: stylised-realistic from primitives (no photoreal skin/rig) - swap in GLB humans when licensed ones exist.
import * as THREE from 'three';

export const WARDROBE = {
  top: ['tee', 'shirt', 'hoodie', 'jacket', 'suit', 'coat', 'tank', 'dress'],
  bottom: ['pants', 'shorts', 'skirt'],
  hair: ['bald', 'buzz', 'short', 'long', 'bob', 'bun', 'ponytail', 'afro', 'mohawk'],
  hat: ['none', 'cap', 'beanie', 'hardhat', 'helmet'],
  glasses: [false, true], accessory: ['none', 'backpack', 'scarf', 'tie'], beard: [false, true],
};
const SKIN = ['#f5d0b5', '#e8b995', '#d49b73', '#bb7c55', '#9a5d3b', '#7a452b', '#5a3320', '#f0c8a8'];
const HAIR = ['#0e0b0a', '#2b1b12', '#4a3020', '#7a5230', '#b88a4a', '#d9c07a', '#8a2f1c', '#6c6c70', '#e6e6e6', '#2a3a6a'];
const EYES = ['#3b2a1a', '#5a3a1e', '#2d5a3a', '#3a5f8a', '#6b6b6b'];
const CLOTH = ['#2f3e5c', '#8c2f39', '#2e6b4f', '#caa24a', '#4b3b6b', '#d8d8d4', '#222428', '#a45a2a', '#3a7d9c', '#6f7d4a', '#b86a8a', '#55585e'];

// ---- seeded RNG so a citizen id always yields the same person (appearance persists across reloads) ----
function rng(seed) { let a = (seed * 2654435761 + 1013904223) >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];

export function randomOutfit(seed, occupation = '') {
  const r = rng(seed), occ = occupation.toLowerCase(), fem = r() < .5;
  const o = {
    skin: pick(r, SKIN), eyes: pick(r, EYES), hairColor: pick(r, HAIR), hair: pick(r, fem ? ['long', 'bob', 'bun', 'ponytail', 'short', 'afro'] : ['short', 'buzz', 'bald', 'short', 'mohawk', 'afro']),
    top: { kind: pick(r, fem ? ['tee', 'shirt', 'hoodie', 'tank', 'dress', 'jacket'] : ['tee', 'shirt', 'hoodie', 'jacket']), color: pick(r, CLOTH) },
    bottom: { kind: fem && r() < .35 ? 'skirt' : r() < .15 ? 'shorts' : 'pants', color: pick(r, CLOTH) },
    shoes: pick(r, ['#1b1b1d', '#e8e8e8', '#5a3a22', '#8c2f39']), hat: r() < .12 ? pick(r, ['cap', 'beanie']) : 'none', glasses: r() < .22,
    accessory: pick(r, ['none', 'none', 'backpack', 'scarf']), beard: !fem && r() < .3,
    height: .92 + r() * .16, width: .9 + r() * .22, shoulder: fem ? .85 + r() * .1 : .98 + r() * .12, eyeSize: .9 + r() * .25, nose: .8 + r() * .5, brow: .8 + r() * .5, mouth: .85 + r() * .4,
  };
  if (/(colonial|life-support|mars scientist|colony|miner|greenhouse|rover)/.test(occ)) Object.assign(o, { top: { kind: 'jacket', color: /miner|rover/.test(occ) ? '#e07a1f' : '#e8e6e0' }, bottom: { kind: 'pants', color: '#d6d3cc' }, hat: 'helmet', accessory: 'backpack', shoes: '#2a2d34', glasses: false, hair: 'short', beard: false });
  else if (/(forager|weaver|reef trader|sky rider|healer|grove guardian|organic architect|frontier hunter)/.test(occ)) Object.assign(o, { top: { kind: fem ? 'tank' : 'tee', color: pick(r, ['#7a5a3a', '#2f6f6a', '#6d4f8f', '#a8793c']) }, bottom: { kind: fem ? 'skirt' : 'shorts', color: pick(r, ['#4a3a2a', '#3a2f55', '#2a4a48']) }, accessory: 'scarf', hat: 'none', glasses: false, shoes: '#5a3a22' });   // Pandora tribal wear
  else if (/(police|security|guard)/.test(occ)) Object.assign(o, { top: { kind: 'shirt', color: '#27407a' }, bottom: { kind: 'pants', color: '#1a2036' }, hat: 'cap', hatColor: '#1a2036', accessory: 'tie', shoes: '#111', glasses: false, beard: false, badge: true, hair: o.hair === 'long' ? 'bun' : o.hair, width: Math.max(o.width, 1) });
  else if (/(courier|driver|deliver)/.test(occ)) Object.assign(o, { top: { kind: 'hoodie', color: '#d9622b' }, bottom: { kind: 'shorts', color: '#2b2f3a' }, accessory: 'backpack', hat: 'cap', hatColor: '#d9622b' });
  else if (/(teacher|journalist|vendor|shop)/.test(occ)) Object.assign(o, { top: { kind: 'shirt', color: pick(r, ['#d8d8d4', '#a8c4d8', '#c9a24a']) }, bottom: { kind: 'pants', color: '#3b4252' }, glasses: r() < .6 });
  else if (/(thug|brawler)/.test(occ)) Object.assign(o, { top: { kind: 'hoodie', color: '#222428' }, bottom: { kind: 'pants', color: '#2b2f3a' }, hat: 'beanie', accessory: 'none' });
  else if (/(engineer|developer|builder|worker|construct)/.test(occ)) Object.assign(o, { top: { kind: 'jacket', color: '#c9792a' }, hat: 'hardhat', bottom: { kind: 'pants', color: '#3b4252' }, hair: o.hair === 'long' ? 'bun' : o.hair });
  else if (/(doctor|nurse|scien|research|medic)/.test(occ)) Object.assign(o, { top: { kind: 'coat', color: '#ececea' }, bottom: { kind: 'pants', color: '#2f3e5c' } });
  else if (/(minister|official|govern|clerk|admin|bank|finance|officer)/.test(occ)) Object.assign(o, { top: { kind: 'suit', color: pick(r, ['#22262e', '#2f3e5c', '#3a3a3e']) }, bottom: { kind: 'pants', color: '#22262e' }, accessory: 'tie', shoes: '#1b1b1d' });
  return o;
}

// ---- shared geometry / materials (never disposed per person; disposeGroup skips userData.shared geometry) ----
const geos = new Map(), mats = new Map();
function geo(key, make) { let g = geos.get(key); if (!g) { g = make(); g.userData.shared = true; geos.set(key, g); } return g; }
const SPH = () => geo('sph', () => new THREE.SphereGeometry(1, 16, 12));
const cap = (r, l) => geo(`cap${r}_${l}`, () => new THREE.CapsuleGeometry(r, l, 4, 10));
const BOX = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const CONE = () => geo('cone', () => new THREE.ConeGeometry(1, 1, 12));
const CYL = () => geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 16, 1, true));
const DISC = () => geo('disc', () => new THREE.CylinderGeometry(1, 1, 1, 16));
const TORUS = () => geo('torus', () => new THREE.TorusGeometry(1, .12, 6, 16));
function mat(color, rough = .8, metal = 0) {
  const k = color + rough + metal; let m = mats.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); mats.set(k, m); }
  return m;
}

function build(o) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body); body.scale.setScalar(o.height);
  const skin = mat(o.skin, .62), top = mat(o.top.color, .85), bot = mat(o.bottom.color, .85), hairM = mat(o.hairColor, .55), shoeM = mat(o.shoes, .7);
  const M = (g, m, x, y, z, sx, sy, sz, p = body) => { const e = new THREE.Mesh(g, m); e.position.set(x, y, z); e.scale.set(sx, sy, sz); e.castShadow = true; p.add(e); return e; };
  const piv = (x, y, p = body) => { const g = new THREE.Group(); g.position.set(x, y, 0); p.add(g); return g; };
  const kind = o.top.kind, longSleeve = !['tee', 'tank', 'dress'].includes(kind), W = o.width, SH = o.shoulder;
  const longLeg = o.bottom.kind === 'pants', thighCover = o.bottom.kind !== 'skirt', dress = kind === 'dress';

  // torso + pelvis
  M(cap(.15, .2), top, 0, 1.2, 0, 1.12 * W * SH, 1, .74 * W);
  M(cap(.15, .06), dress ? top : bot, 0, .98, 0, 1.08 * W, 1, .78 * W);
  if (kind === 'coat') M(CYL(), top, 0, .72, 0, .21 * W, .5, .14 * W);                                   // long coat skirt
  if (kind === 'coat' || kind === 'suit' || kind === 'jacket') { M(BOX(), mat('#e9e9e6', .8), 0, 1.3, .105 * W, .07, .26, .01); }  // shirt front
  if (kind === 'hoodie') M(DISC(), top, 0, 1.46, -.09, .1, .05, .06);
  if (o.badge) M(BOX(), mat('#d9b44a', .3, .8), -.07, 1.32, .108 * W, .03, .035, .008);
  if (o.accessory === 'tie') M(BOX(), mat('#7a1d2a', .6), 0, 1.24, .115 * W, .035, .22, .01);
  if (o.accessory === 'scarf') M(TORUS(), mat('#b8442e', .9), 0, 1.47, 0, .11, .11, .11).rotation.x = Math.PI / 2;
  if (o.accessory === 'backpack') M(BOX(), mat('#3a3a40', .9), 0, 1.22, -.16 * W, .24, .32, .12);
  if (dress || o.bottom.kind === 'skirt') M(CONE(), dress ? top : bot, 0, .74, 0, .27 * W, .42, .2 * W);
  // neck + head (ellipsoid) + face
  M(cap(.045, .06), skin, 0, 1.5, 0, 1, 1, 1);
  const head = piv(0, 1.66); head.scale.setScalar(1);
  M(SPH(), skin, 0, 0, 0, .105, .13, .115, head);
  M(SPH(), skin, -.105, -.005, 0, .02, .035, .02, head); M(SPH(), skin, .105, -.005, 0, .02, .035, .02, head);   // ears
  const ex = .04, es = .017 * o.eyeSize;
  for (const s of [-1, 1]) {
    M(SPH(), mat('#f4f1ec', .3), s * ex, .018, .104, es * 1.25, es, es * .6, head);
    M(SPH(), mat(o.eyes, .25), s * ex, .018, .112, es * .65, es * .65, es * .3, head);
    M(SPH(), mat('#050505', .2), s * ex, .018, .1145, es * .3, es * .3, es * .2, head);
    M(BOX(), hairM, s * ex, .052, .108, .034, .007 * o.brow, .012, head).rotation.z = s * -.12;                   // eyebrows
  }
  M(SPH(), skin, 0, -.012, .12, .017 * o.nose, .03 * o.nose, .028 * o.nose, head);                              // nose
  M(SPH(), mat('#a8585a', .5), 0, -.058, .108, .03 * o.mouth, .008, .012, head);                               // lips
  if (o.beard) M(SPH(), hairM, 0, -.06, .02, .1, .085, .1, head);
  // hair / headwear
  const h = o.hair;
  if (h !== 'bald') {
    if (h === 'buzz') M(SPH(), hairM, 0, .012, -.004, .108, .132, .118, head);
    else if (h === 'afro') M(SPH(), hairM, 0, .045, -.015, .165, .17, .165, head);
    else { M(SPH(), hairM, 0, .02, -.012, .113, .135, .12, head); }
    if (h === 'long') M(cap(.1, .14), hairM, 0, -.1, -.05, 1, 1, .7, head);
    if (h === 'bob') M(cap(.108, .04), hairM, 0, -.04, -.025, 1, 1, .85, head);
    if (h === 'bun') M(SPH(), hairM, 0, .13, -.06, .05, .05, .05, head);
    if (h === 'ponytail') M(cap(.03, .16), hairM, 0, -.08, -.14, 1, 1, 1, head).rotation.x = -.35;
    if (h === 'mohawk') M(BOX(), hairM, 0, .15, -.01, .018, .05, .15, head);
  }
  if (o.hat === 'cap') { const hc = mat(o.hatColor || '#22262e'); M(DISC(), hc, 0, .075, .004, .12, .06, .125, head); M(DISC(), hc, 0, .06, .1, .1, .008, .06, head); }
  if (o.hat === 'beanie') M(SPH(), mat('#8c2f39', .95), 0, .05, -.005, .12, .12, .13, head);
  if (o.hat === 'helmet') { const hm = new THREE.Mesh(SPH(), new THREE.MeshPhysicalMaterial({ color: '#9fd6ff', transparent: true, opacity: .22, roughness: .05, depthWrite: false })); hm.position.set(0, .01, .005); hm.scale.set(.165, .18, .17); head.add(hm); M(TORUS(), mat('#bfc3c9', .35, .6), 0, -.1, 0, .115, .115, .12, head); }
  if (o.hat === 'hardhat') { M(SPH(), mat('#e8b923', .4), 0, .06, 0, .125, .105, .13, head); M(DISC(), mat('#e8b923', .4), 0, .045, .02, .15, .012, .15, head); }
  if (o.glasses) for (const s of [-1, 1]) M(TORUS(), mat('#15151a', .3, .6), s * ex, .018, .115, .026, .026, .02, head);

  // limbs with elbow/knee joints
  const limb = (x, y, upR, upL, loR, loL, upM, loM, endM, footLen) => {
    const a = piv(x, y), b = piv(0, -(upL + upR * 2) * .98, a);
    M(cap(upR, upL), upM, 0, -(upL + upR * 2) / 2, 0, 1, 1, 1, a); M(cap(loR, loL), loM, 0, -(loL + loR * 2) / 2, 0, 1, 1, 1, b);
    if (footLen) { M(BOX(), shoeM, 0, -(loL + loR * 2) - .02, .05, .1 * W, .07, footLen, b); } else M(SPH(), skin, 0, -(loL + loR * 2) - .02, 0, .042, .05, .025, b);
    return { a, b };
  };
  const armX = .2 * SH * W, arms = [limb(-armX, 1.4, .04 * W, .2, .035 * W, .19, longSleeve || kind === 'tee' ? top : skin, longSleeve ? top : skin, skin, 0), limb(armX, 1.4, .04 * W, .2, .035 * W, .19, longSleeve || kind === 'tee' ? top : skin, longSleeve ? top : skin, skin, 0)];
  const legX = .085 * W, legs = [limb(-legX, .96, .068 * W, .3, .05 * W, .32, thighCover ? bot : skin, longLeg ? bot : skin, skin, .24), limb(legX, .96, .068 * W, .3, .05 * W, .32, thighCover ? bot : skin, longLeg ? bot : skin, skin, .24)];
  return { root, body, head, arms, legs };
}

export function createHuman(seed = 1, overrides = {}, occupation = '') {
  let outfit = { ...randomOutfit(seed, occupation), ...overrides }, parts = build(outfit);
  const group = new THREE.Group(); group.add(parts.root);
  let phase = Math.random() * 6, mv = 0, g = null; const t0 = Math.random() * 10; let clock = t0;
  const api = {
    group, seat: null, get outfit() { return outfit; },   // seat = {thigh,shin,arm,elbow,lean}: seated pose for vehicles
    // equip('hat','cap') | equip('top',{kind:'coat',color:'#fff'}) | equip({skin:'#...', hair:'afro'}) - any key of the outfit
    equip(slot, value) {
      outfit = { ...outfit, ...(typeof slot === 'object' ? slot : { [slot]: value }) };
      group.remove(parts.root); parts.root.traverse(o => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); }); parts = build(outfit); group.add(parts.root);
    },
    gesture(name, dur = 2) { if (['wave', 'nod', 'shake', 'talk', 'sad', 'punch', 'fight', 'handsup', 'point'].includes(name)) g = { name, t: 0, dur }; },
    update(dt, speed) {
      clock += dt; mv += ((speed > .15 ? 1 : 0) - mv) * Math.min(1, dt * 8);
      phase += dt * speed / .7 * Math.PI;                                    // stride ~0.7 m/step, so feet keep pace with the ground
      const { arms, legs, head, body } = parts, s = Math.sin(phase), amp = Math.min(speed / 1.4, 1.5) * .55 * mv, br = Math.sin(clock * 1.6);
      legs[0].a.rotation.x = s * amp; legs[1].a.rotation.x = -s * amp;
      legs[0].b.rotation.x = Math.max(0, -Math.sin(phase - .6)) * amp * 1.3; legs[1].b.rotation.x = Math.max(0, Math.sin(phase - .6)) * amp * 1.3;
      arms[0].a.rotation.x = -s * amp * .8; arms[1].a.rotation.x = s * amp * .8; arms[0].b.rotation.x = arms[1].b.rotation.x = -.15 - amp * .5;
      arms[0].a.rotation.z = .05 + br * .01; arms[1].a.rotation.z = -.05 - br * .01;
      body.position.y = Math.abs(s) * .025 * mv; body.rotation.x = mv * .04; body.rotation.y = 0; head.rotation.set(Math.sin(clock * .5) * .03, Math.sin(clock * .3) * .08, 0);
      if (api.seat) {
        const q = api.seat; legs[0].a.rotation.x = legs[1].a.rotation.x = q.thigh; legs[0].b.rotation.x = legs[1].b.rotation.x = q.shin;
        arms[0].a.rotation.x = arms[1].a.rotation.x = q.arm; arms[0].b.rotation.x = arms[1].b.rotation.x = q.elbow; body.position.y = 0; body.rotation.x = q.lean || 0;
      }
      if (g) {
        g.t += dt; const k = Math.sin(Math.min(g.t / g.dur, 1) * Math.PI), env = Math.min(g.t * 4, 1) * Math.min((g.dur - g.t) * 4, 1), T = g.t * 9;
        if (g.name === 'wave') { arms[1].a.rotation.z = -2.5 * k; arms[1].a.rotation.x = 0; arms[1].b.rotation.x = -.3 + Math.sin(T) * .4 * k; }
        else if (g.name === 'nod') head.rotation.x = Math.sin(g.t * 8) * .25 * k;
        else if (g.name === 'shake') head.rotation.y = Math.sin(g.t * 9) * .5 * k;
        else if (g.name === 'sad') head.rotation.x = .35 * k;
        else if (g.name === 'handsup') { arms[0].a.rotation.x = arms[1].a.rotation.x = -2.7 * env; arms[0].b.rotation.x = arms[1].b.rotation.x = -.4 * env; head.rotation.x = .15 * env; }
        else if (g.name === 'point') { arms[1].a.rotation.x = -1.5 * env; arms[1].b.rotation.x = -.1; head.rotation.y += .0; }
        else if (g.name === 'punch' || g.name === 'fight') {
          const L = Math.max(0, Math.sin(T * 1.3)), R = Math.max(0, Math.sin(T * 1.3 + Math.PI));                 // alternating jabs, guard up in between
          arms[0].a.rotation.x = (-1.2 - L * .5) * env; arms[1].a.rotation.x = (-1.2 - R * .5) * env; arms[0].b.rotation.x = (-1.9 + L * 1.7) * env; arms[1].b.rotation.x = (-1.9 + R * 1.7) * env;
          body.rotation.x = .12 * env; body.rotation.y = Math.sin(T * 1.3) * .3 * env; legs[0].a.rotation.x = -.3 * env; legs[1].a.rotation.x = .3 * env;
        }
        else { arms[0].a.rotation.x = -.6 * k + Math.sin(T) * .2 * k; arms[1].a.rotation.x = -.6 * k - Math.sin(T * .8) * .2 * k; arms[0].b.rotation.x = arms[1].b.rotation.x = -1 * k; }
        if (g.t > g.dur) g = null;
      }
    },
  };
  return api;
}
