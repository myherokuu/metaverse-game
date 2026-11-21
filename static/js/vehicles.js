// Drivable vehicles (car, motorbike, bicycle, helicopter, plane), GTA style: walk up and press F to get in/out. Procedural models with
// clear-coat paint, glass, chrome, spinning wheels/rotors and a seated driver. A few AI-driven road vehicles follow the zone's path graph.
// Shortcut: arcade physics (bicycle-model steering, simple flight) and no vehicle damage; swap in licensed GLB models later via build*().
import * as THREE from 'three';
import { createHuman } from './humans.js';
import { resolveCollisions, roofAt, blockingAt } from './navigation.js';
import { input } from './player.js';

const rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[Math.floor(Math.random() * a.length)], clamp = THREE.MathUtils.clamp;
const angDiff = (a, b) => { const d = a - b; return Math.atan2(Math.sin(d), Math.cos(d)); };

// ---- shared materials / geometry (never disposed per vehicle) ----
const cache = new Map(), memo = (k, f) => { let v = cache.get(k); if (!v) { v = f(); cache.set(k, v); if (v.isBufferGeometry) v.userData.shared = true; } return v; };
const paint = c => memo('p' + c, () => new THREE.MeshPhysicalMaterial({ color: c, metalness: .55, roughness: .3, clearcoat: 1, clearcoatRoughness: .06 }));
const glass = () => memo('glass', () => new THREE.MeshPhysicalMaterial({ color: '#0a1118', metalness: .85, roughness: .05, clearcoat: 1 }));
const canopy = () => memo('canopy', () => new THREE.MeshPhysicalMaterial({ color: '#0d1822', metalness: .5, roughness: .05, transparent: true, opacity: .6 }));
const rubber = () => memo('rubber', () => new THREE.MeshStandardMaterial({ color: '#101010', roughness: .95 }));
const chrome = () => memo('chrome', () => new THREE.MeshStandardMaterial({ color: '#c9cdd3', metalness: 1, roughness: .18 }));
const dark = () => memo('dark', () => new THREE.MeshStandardMaterial({ color: '#1a1b1f', roughness: .6, metalness: .4 }));
const lamp = (c, i = 2) => memo('l' + c, () => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i }));
const BOX = () => memo('box', () => new THREE.BoxGeometry(1, 1, 1)), SPH = () => memo('sph', () => new THREE.SphereGeometry(1, 20, 14)), CYL = () => memo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 18));
const CONE = () => memo('cone', () => new THREE.CylinderGeometry(.3, 1, 1, 18));

const add = (p, geo, m, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = true; p.add(o); return o; };
const bar = (p, a, b, r, m) => { const d = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)), o = add(p, CYL(), m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, r, d.length(), r); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return o; };
const quad = (p, w, h, c, n, m) => { const o = new THREE.Mesh(memo('plane', () => new THREE.PlaneGeometry(1, 1)), m); o.scale.set(w, h, 1); o.position.set(...c); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...n).normalize()); p.add(o); return o; };
function extrude(key, w, bev, draw) {                   // side profile (x = length, y = up) -> solid with bevelled edges, length along +Z
  return memo(key, () => { const s = new THREE.Shape(); draw(s); const d = w - 2 * bev, g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 3, curveSegments: 20 }); g.translate(0, 0, -d / 2); g.rotateY(-Math.PI / 2); g.computeVertexNormals(); return g; });
}
// wheel: pivot (steering, rotation.y) > spin (rotation.x) > tyre + rim + spokes
function wheel(parent, x, y, z, r, w, steer) {
  const piv = new THREE.Group(), spin = new THREE.Group(); piv.position.set(x, y, z); piv.add(spin); parent.add(piv);
  add(spin, memo('tyre' + r + w, () => { const g = new THREE.CylinderGeometry(r, r, w, 28); g.rotateZ(Math.PI / 2); return g; }), rubber(), 0, 0, 0);
  add(spin, memo('rim' + r + w, () => { const g = new THREE.CylinderGeometry(r * .62, r * .62, w + .01, 24); g.rotateZ(Math.PI / 2); return g; }), chrome(), 0, 0, 0);
  for (let i = 0; i < 5; i++) { const sp = add(spin, BOX(), dark(), 0, 0, 0, w + .02, r * 1.0, r * .09); sp.rotation.x = i / 5 * Math.PI; }
  return { piv, spin, steer, r };
}
function thinWheel(parent, x, y, z, r, tube) {         // bicycle / bike wheel: slim tyre + spokes
  const piv = new THREE.Group(), spin = new THREE.Group(); piv.position.set(x, y, z); piv.add(spin); parent.add(piv);
  const t = add(spin, memo('tor' + r + tube, () => { const g = new THREE.TorusGeometry(r - tube, tube, 10, 32); g.rotateY(Math.PI / 2); return g; }), rubber(), 0, 0, 0);
  for (let i = 0; i < 4; i++) { const sp = add(spin, BOX(), chrome(), 0, 0, 0, .006, (r - tube) * 2, .006); sp.rotation.x = i / 4 * Math.PI; }
  return { piv, spin, steer: false, r };
}

// ---- models: z forward, y up, origin on the ground. Return {group, wheels, seat, pose, rotors} ----
function buildCar(color) {
  const g = new THREE.Group(), body = paint(color), W = 1.86;
  add(g, extrude('carBody', W, .05, s => { s.moveTo(-2.1, .3); s.lineTo(2.1, .3); s.lineTo(2.2, .55); s.quadraticCurveTo(2.2, .8, 1.9, .86); s.lineTo(.95, .95); s.quadraticCurveTo(.6, 1.2, .2, 1.42); s.lineTo(-.7, 1.44); s.quadraticCurveTo(-1.1, 1.4, -1.35, 1.02); s.lineTo(-1.95, .95); s.quadraticCurveTo(-2.2, .9, -2.2, .62); s.lineTo(-2.1, .3); }), body, 0, 0, 0);
  add(g, extrude('carGlass', W + .04, .01, s => { s.moveTo(-1.3, 1.03); s.quadraticCurveTo(-1.05, 1.36, -.7, 1.39); s.lineTo(.2, 1.38); s.quadraticCurveTo(.55, 1.17, .88, 1.0); s.lineTo(-1.3, 1.0); }), glass(), 0, 0, 0);
  quad(g, 1.66, .78, [0, 1.2, .56], [0, .66, .4], glass()).position.z += .015; quad(g, 1.6, .7, [0, 1.2, -1.03], [0, .6, -.37], glass());
  add(g, BOX(), body, 0, 1.2, -.33, W + .02, .4, .07);                                  // B-pillar
  add(g, BOX(), dark(), 0, .32, 0, W - .1, .1, 4.2);                                   // underbody
  add(g, BOX(), dark(), 0, .55, 2.17, 1.2, .16, .06);                                  // grille
  for (const s of [-1, 1]) {
    add(g, BOX(), lamp('#fff3c8'), s * .7, .74, 2.15, .36, .1, .08); add(g, BOX(), lamp('#ff2323', 1.2), s * .72, .72, -2.17, .4, .09, .06);
    add(g, BOX(), body, s * 1.0, 1.04, .48, .1, .09, .18);                              // mirrors
    for (const z of [.35, -.62]) add(g, BOX(), dark(), s * (W / 2 + .005), .78, z, .006, .5, .012);   // door shut lines
    add(g, BOX(), chrome(), s * (W / 2 + .02), .62, -.05, .01, .02, .16);                // handles
  }
  add(g, BOX(), new THREE.MeshStandardMaterial({ color: '#eee' }), 0, .5, -2.2, .5, .12, .01);   // plate
  const wheels = []; for (const z of [1.42, -1.38]) for (const s of [-1, 1]) wheels.push(wheel(g, s * .86, .34, z, .34, .24, z > 0));
  return { group: g, wheels, seat: [.4, .62, -.2], pose: { thigh: -1.45, shin: 1.35, arm: -.95, elbow: -.55, lean: 0 } };
}
function buildMoto(color) {
  const g = new THREE.Group(), body = paint(color), wheels = [];
  wheels.push(wheel(g, 0, .34, .72, .34, .13, true), wheel(g, 0, .34, -.72, .34, .16, false));
  add(g, SPH(), body, 0, .85, .15, .2, .2, .45);                                        // tank
  add(g, BOX(), dark(), 0, .78, -.35, .22, .1, .6);                                     // seat
  add(g, BOX(), dark(), 0, .5, 0, .28, .3, .5);                                         // engine
  add(g, BOX(), body, 0, .62, -.95, .2, .05, .4);                                       // rear fender
  bar(g, [0, .35, .72], [0, .95, .5], .025, chrome()); bar(g, [.05, .35, .72], [.05, .95, .5], .02, chrome());
  const hb = add(g, CYL(), chrome(), 0, 1.0, .46, .018, .72, .018); hb.rotation.z = Math.PI / 2;
  add(g, SPH(), lamp('#fff3c8'), 0, .98, .62, .09, .09, .07); add(g, SPH(), lamp('#ff2323', 1), 0, .72, -1.12, .05, .04, .03);
  const ex = add(g, CYL(), chrome(), .17, .38, -.45, .045, .9, .045); ex.rotation.x = Math.PI / 2;
  return { group: g, wheels, seat: [0, .8, -.3], pose: { thigh: -1.05, shin: 1.1, arm: -1.15, elbow: -.4, lean: .35 } };
}
function buildBike(color) {
  const g = new THREE.Group(), body = paint(color), wheels = [thinWheel(g, 0, .34, .55, .34, .025), thinWheel(g, 0, .34, -.55, .34, .025)];
  const bb = [0, .3, -.05], seat = [0, .82, -.22], head = [0, .86, .38], hub = [0, .34, -.55], fhub = [0, .34, .55];
  bar(g, bb, seat, .018, body); bar(g, bb, head, .02, body); bar(g, seat, head, .018, body); bar(g, seat, hub, .014, body); bar(g, bb, hub, .014, body); bar(g, head, fhub, .016, chrome());
  const hb = add(g, CYL(), dark(), 0, .98, .4, .014, .5, .014); hb.rotation.z = Math.PI / 2; add(g, BOX(), dark(), 0, .86, -.24, .12, .04, .22);
  for (const s of [-1, 1]) add(g, BOX(), dark(), s * .12, .3, -.05, .04, .02, .12);
  return { group: g, wheels, seat: [0, .8, -.2], pose: { thigh: -.85, shin: 1.15, arm: -1.15, elbow: -.35, lean: .45 } };
}
function buildHeli(color) {
  const g = new THREE.Group(), body = paint(color), rotors = [];
  add(g, SPH(), body, 0, 1.15, 0, .95, .95, 2.0); add(g, SPH(), canopy(), 0, 1.3, .85, .93, .8, 1.25);
  const boom = add(g, CONE(), body, 0, 1.45, -2.6, .3, 3.6, .3); boom.rotation.x = -Math.PI / 2;
  add(g, BOX(), body, 0, 1.75, -4.2, .07, .8, .6); 
  add(g, CYL(), dark(), 0, 2.15, -.2, .09, .6, .09);
  const main = new THREE.Group(); main.position.set(0, 2.45, -.2); g.add(main);
  for (let i = 0; i < 4; i++) { const b = add(main, BOX(), dark(), 0, 0, 0, 5.4, .04, .22); b.rotation.y = i * Math.PI / 2; } rotors.push({ o: main, axis: 'y', k: 38 });
  const tail = new THREE.Group(); tail.position.set(.15, 1.75, -4.2); g.add(tail);
  for (let i = 0; i < 2; i++) { const b = add(tail, BOX(), dark(), 0, 0, 0, .03, 1.1, .12); b.rotation.x = i * Math.PI / 2; } rotors.push({ o: tail, axis: 'x', k: 55 });
  for (const s of [-1, 1]) { const sk = add(g, CYL(), dark(), s * .8, .12, 0, .04, 3.0, .04); sk.rotation.x = Math.PI / 2; bar(g, [s * .8, .12, .8], [s * .55, .65, .6], .03, dark()); bar(g, [s * .8, .12, -.8], [s * .55, .65, -.6], .03, dark()); }
  add(g, SPH(), lamp('#fff3c8', 1.5), 0, .75, 1.85, .12, .1, .1);
  return { group: g, wheels: [], rotors, seat: [0, 1.0, .75], pose: { thigh: -1.5, shin: 1.45, arm: -.9, elbow: -.4, lean: 0 } };
}
function buildPlane(color) {
  const g = new THREE.Group(), body = paint(color), rotors = [];
  const fus = add(g, memo('fus', () => { const c = new THREE.CapsuleGeometry(.55, 4.2, 6, 16); c.rotateX(Math.PI / 2); return c; }), body, 0, .95, 0, 1, .92, 1);
  add(g, BOX(), body, 0, .85, .35, 11, .1, 1.6); add(g, BOX(), paint('#d33'), 5.5, .85, .35, .1, .12, 1.62).scale.x = .6; add(g, BOX(), paint('#d33'), -5.5, .85, .35, .1, .12, 1.62).scale.x = .6;
  add(g, BOX(), body, 0, 1.0, -3.4, 3.6, .08, 1.0); add(g, BOX(), body, 0, 1.55, -3.4, .08, 1.2, 1.1);
  add(g, SPH(), canopy(), 0, 1.55, .35, .5, .42, 1.0);
  add(g, CONE(), chrome(), 0, .95, 2.95, .2, .35, .2).rotation.x = Math.PI / 2;
  const prop = new THREE.Group(); prop.position.set(0, .95, 3.15); g.add(prop); for (let i = 0; i < 2; i++) { const b = add(prop, BOX(), dark(), 0, 0, 0, .14, 2.3, .04); b.rotation.z = i * Math.PI / 2 + .3; } rotors.push({ o: prop, axis: 'z', k: 70 });
  const wheels = [wheel(g, 0, .28, 1.9, .28, .14, false), wheel(g, .95, .28, .2, .3, .16, false), wheel(g, -.95, .28, .2, .3, .16, false)];
  bar(g, [0, .8, 1.7], [0, .3, 1.9], .03, dark()); for (const s of [-1, 1]) bar(g, [s * .35, .75, .2], [s * .95, .3, .2], .035, dark());
  add(g, BOX(), lamp('#ff2323', 1), -5.5, .85, .35, .08, .1, .18); add(g, BOX(), lamp('#2ad46a', 1), 5.5, .85, .35, .08, .1, .18);
  return { group: g, wheels, rotors, seat: [0, .62, .25], pose: { thigh: -1.45, shin: 1.35, arm: -.9, elbow: -.5, lean: 0 } };
}

const SPEC = {
  car:   { name: 'Car', build: buildCar, r: 1.3, max: 34, acc: 10, wb: 2.8, steer: .55, cam: 8, colors: ['#b5121b', '#16466e', '#e8e8ea', '#16191f', '#c9a227', '#2e6b4f'] },
  moto:  { name: 'Motorbike', build: buildMoto, r: .75, max: 38, acc: 14, wb: 1.45, steer: .6, cam: 5, colors: ['#d02b1c', '#1a1d22', '#2a62c4', '#e8e8ea'] },
  bike:  { name: 'Bicycle', build: buildBike, r: .6, max: 9, acc: 3.2, wb: 1.1, steer: .75, cam: 4, colors: ['#1f7a8c', '#c9302c', '#2a2f3a', '#e0a526'] },
  heli:  { name: 'Helicopter', build: buildHeli, r: 2.6, max: 38, air: true, cam: 14, colors: ['#e8e8ea', '#16466e', '#b5121b'] },
  plane: { name: 'Plane', build: buildPlane, r: 3.2, max: 62, air: true, cam: 16, colors: ['#e8e8ea', '#f0c030', '#2a62c4'] },
};

export class Vehicle {
  constructor(kind, x, z, heading, zone, ai = false, color = null) {
    this.kind = kind; this.s = SPEC[kind]; this.zone = zone; this.ai = ai; this.color = color || pick(this.s.colors);
    const m = this.s.build(this.color); Object.assign(this, m); this.group.rotation.order = 'YXZ';
    this.pos = new THREE.Vector3(x, zone.groundAt(x, z), z); this.heading = heading; this.speed = 0; this.steer = 0; this.vy = 0; this.throttle = 0; this.rotor = 0; this.lean = 0;
    this.driver = null; this.player = false; this.route = null; this.prev = null; this.sync();
  }
  seatDriver(h) { this.driver = h; h.seat = this.pose; h.group.position.set(this.seat[0], this.seat[1] - .96, this.seat[2]); this.group.add(h.group); }
  unseat() { const h = this.driver; this.driver = null; if (h) { h.seat = null; this.group.remove(h.group); } return h; }
  support() { const z = this.zone, g = z.groundAt(this.pos.x, this.pos.z); return this.s.air ? Math.max(g, roofAt(z.collidersFor(this.pos.x, this.pos.z), this.pos.x, this.pos.z, this.pos.y)) : g; }   // ground or a roof under us
  get airborne() { return this.s.air && this.pos.y - this.support() > .3; }

  // ctl: {thr:-1..1, steer:-1..1 (left +), up:-1..1, brake:0..1}
  update(dt, ctl) {
    const z = this.zone, s = this.s, ox = this.pos.x, oz = this.pos.z;
    if (s.air) this.fly(dt, ctl); else this.drive(dt, ctl);
    if (!this.ai || s.air) {                                                 // buildings + terrain (AI follows the path graph, so it skips these)
      if (!s.air || this.pos.y < 45) { const px = this.pos.x, pz = this.pos.z; resolveCollisions(this.pos, s.r, blockingAt(z.collidersFor(px, pz), this.pos.y), z.bound - 2); if (Math.hypot(this.pos.x - px, this.pos.z - pz) > .04 && Math.abs(this.speed) > 3) this.speed *= .55; }
      if (!s.air && z.blocked(this.pos.x, this.pos.z, ox, oz, this.pos.y)) { this.pos.x = ox; this.pos.z = oz; this.speed *= -.2; }
    }
    this.sync(dt, ctl);
  }
  drive(dt, c) {
    const s = this.s, tgt = c.thr >= 0 ? c.thr * s.max : c.thr * s.max * .3;
    if (c.brake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 26 * dt);
    else if (tgt * this.speed < 0) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 18 * dt);     // pedal opposes motion: brake first
    else if (Math.abs(tgt) > Math.abs(this.speed) - .01 && c.thr) this.speed += Math.sign(tgt) * Math.min(Math.abs(tgt - this.speed), s.acc * dt * (1 - Math.abs(this.speed) / (s.max * 1.15)));
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 3.2 * dt);                                  // coast
    this.steer += (c.steer - this.steer) * Math.min(1, dt * 6);
    this.heading += this.speed / s.wb * Math.tan(this.steer * s.steer / (1 + Math.abs(this.speed) / 22)) * dt;
    this.pos.x += Math.sin(this.heading) * this.speed * dt; this.pos.z += Math.cos(this.heading) * this.speed * dt;
    this.pos.y = this.zone.groundAt(this.pos.x, this.pos.z);
  }
  fly(dt, c) {
    const z = this.zone, gy = this.support(), s = this.s, air = this.pos.y - gy > .15;
    this.steer += (c.steer - this.steer) * Math.min(1, dt * 4);
    if (this.kind === 'heli') {
      const want = c.thr * (c.thr > 0 ? s.max : 12); this.speed += (want - this.speed) * Math.min(1, dt * 1.2);
      this.vy += (c.up * 9 - this.vy) * Math.min(1, dt * 2.2); if (this.rotor < .5 && c.up <= 0) this.vy = Math.min(this.vy, 0);
      this.heading += this.steer * 1.3 * dt * (air ? 1 : .3);
    } else {                                                                   // plane: throttle sets airspeed, needs ~24 m/s to climb
      this.throttle = clamp(this.throttle + c.thr * dt * .45, 0, 1); this.speed += (this.throttle * s.max - this.speed) * Math.min(1, dt * .6);
      const lift = this.speed > 24;
      if (air) { this.vy += ((lift ? c.up * 11 : -10) - this.vy) * Math.min(1, dt * 1.6); this.heading += this.steer * .85 * dt * Math.min(1, this.speed / 30); }
      else { this.vy = lift && c.up > 0 ? 5 : 0; if (this.throttle < .05) this.speed *= 1 - Math.min(1, dt * 1.2); this.heading += this.steer * .5 * dt * Math.min(1, this.speed / 8); if (c.brake) this.speed *= 1 - Math.min(1, dt * 1.5); }
    }
    this.pos.x += Math.sin(this.heading) * this.speed * dt; this.pos.z += Math.cos(this.heading) * this.speed * dt; this.pos.y += this.vy * dt;
    if (this.pos.y <= gy) { this.pos.y = gy; if (this.vy < 0) this.vy = 0; if (this.kind === 'heli') this.speed *= 1 - Math.min(1, dt * 3); }
  }
  sync(dt = 0, c = { thr: 0, steer: 0 }) {
    const s = this.s, z = this.zone, g = this.group, x = this.pos.x, zz = this.pos.z, sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    g.position.copy(this.pos); g.rotation.y = this.heading;
    if (!s.air) {
      const f = s.wb / 2, tw = this.kind === 'car' ? .9 : .3, fy = z.groundAt(x + sh * f, zz + ch * f), by = z.groundAt(x - sh * f, zz - ch * f), ly = z.groundAt(x + ch * tw, zz - sh * tw), ry = z.groundAt(x - ch * tw, zz + sh * tw);
      this.lean += ((this.kind === 'car' ? 0 : -this.steer * Math.min(1, Math.abs(this.speed) / 14) * .5) - this.lean) * Math.min(1, dt * 6);
      g.rotation.x = -Math.atan2(fy - by, s.wb); g.rotation.z = Math.atan2(ly - ry, tw * 2) + this.lean;
    } else if (this.kind === 'heli') { g.rotation.x = this.speed / s.max * .22 * Math.sign(c.thr || 0); g.rotation.z = -this.steer * .25 * Math.min(1, Math.abs(this.speed) / 10 + .3); }
    else { g.rotation.x = -clamp(this.vy / Math.max(this.speed, 10), -.5, .5) * .8; g.rotation.z = -this.steer * .5 * (this.airborne ? 1 : 0); }
    for (const w of this.wheels) { w.spin.rotation.x += this.speed * dt / w.r; if (w.steer) w.piv.rotation.y = this.steer * (s.steer || 0); }
    const on = this.driver ? 1 : 0; this.rotor += (on - this.rotor) * Math.min(1, dt * (on ? .8 : .4));
    for (const r of this.rotors || []) r.o.rotation[r.axis] += dt * r.k * this.rotor;
    if (this.driver) this.driver.update(dt, 0);
  }
}

export class VehicleManager {
  constructor(zone, scene, center, parked = true) {
    this.zone = zone; this.scene = scene; this.group = new THREE.Group(); scene.add(this.group); this.list = []; this.driving = null; this.t = 0; this.trafficT = 2;
    const nodes = zone.mapData && zone.mapData.nodes ? zone.mapData.nodes : null; this.nodes = nodes ? Object.entries(nodes) : [];
    this.adj = new Map(); for (const [a, b] of (zone.mapData && zone.mapData.edges) || []) { (this.adj.get(a) || this.adj.set(a, []).get(a)).push(b); (this.adj.get(b) || this.adj.set(b, []).get(b)).push(a); }
    if (parked) for (const [kind, rmin, rmax, clear] of [['car', 7, 12, 3], ['moto', 5, 9, 1.5], ['bike', 4, 7, 1.2], ['heli', 24, 38, 4], ['plane', 30, 46, 7]]) {
      for (let i = 0; i < 12; i++) {
        const a = rnd(0, 6.283), r = rnd(rmin, rmax), x = center.x + Math.sin(a) * r, zz = center.z + Math.cos(a) * r;
        if (this.free(x, zz, clear)) { this.add(new Vehicle(kind, x, zz, rnd(0, 6.283), zone)); break; }
      }
    }
  }
  free(x, z, r) { if (!this.zone.walkable(x, z) || this.list.some(v => Math.hypot(v.pos.x - x, v.pos.z - z) < v.s.r + r + 1)) return false; for (let i = 0; i < 8; i++) if (!this.zone.walkable(x + Math.sin(i * .785) * r, z + Math.cos(i * .785) * r)) return false; return true; }
  add(v) { this.list.push(v); this.group.add(v.group); return v; }
  remove(v) { this.list.splice(this.list.indexOf(v), 1); this.group.remove(v.group); }
  dispose() { this.driving = null; this.group.removeFromParent(); this.list = []; }
  nearest(pos, r = 4.5) { let b = null, bd = r; for (const v of this.list) { if (v.driver || v.player) continue; const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z) - v.s.r * .6; if (d < bd) { bd = d; b = v; } } return b; }

  // F key: get in the nearest free vehicle, or out of the current one. Returns a message for the UI toast.
  toggle(player) {
    if (this.driving) {
      const v = this.driving;
      if (v.s.air && (v.airborne || Math.abs(v.speed) > 6)) return 'Land and stop before getting out.';
      const l = [Math.cos(v.heading), -Math.sin(v.heading)], r = v.s.r + .9;
      for (const [sx, sz] of [[l[0], l[1]], [-l[0], -l[1]], [-Math.sin(v.heading), -Math.cos(v.heading)]]) {
        const x = v.pos.x + sx * r, zz = v.pos.z + sz * r, roof = v.s.air ? v.support() : 0, onRoof = roof > this.zone.groundAt(v.pos.x, v.pos.z) + 1;
        if (onRoof ? roofAt(this.zone.collidersFor(x, zz), x, zz, roof + .1) < roof - .01 : !this.zone.walkable(x, zz)) continue;   // on a roof the exit spot must still be on that roof
        v.unseat(); v.player = false; v.speed = 0; v.throttle = 0; this.driving = null; player.avatar.visible = true; player.teleport(x, onRoof ? roof : this.zone.groundAt(x, zz), zz, v.heading); return 'Exited ' + v.s.name;
      }
      return 'No room to get out here.';
    }
    const v = this.nearest(player.pos); return v ? this.mount(v, player) : null;
  }
  mount(v, player) {
    v.seatDriver(this.myDriver || (this.myDriver = createHuman(4242, { hat: 'none' }))); v.player = true; this.driving = v; player.avatar.visible = false; player.cancelPath(); if (player.setEmote) player.setEmote(null);
    return 'Driving ' + v.s.name + (v.s.air ? ' — W/S throttle, Space climb, C descend (slow down + hold C to land), F exit once landed' : ' — WASD drive, Space brake, F exit');
  }
  // keep driving across a zone border: re-create the vehicle under the player in the new zone
  carry(player, c) {
    const v = new Vehicle(c.kind, player.pos.x, player.pos.z, c.heading, this.zone, false, c.color); v.speed = c.speed; v.throttle = c.throttle || 0;
    v.pos.y = Math.max(this.zone.groundAt(v.pos.x, v.pos.z), this.zone.groundAt(v.pos.x, v.pos.z) + c.alt); this.add(v); this.mount(v, player); v.sync(0);
  }

  update(dt, player, enabled) {
    this.t += dt; const dv = this.driving;
    if (dv) {
      const f = input.forward - input.back, st = input.left - input.right;
      dv.update(dt, enabled ? { thr: f, steer: st, up: input.jump - input.down, brake: dv.s.air ? input.down && !dv.airborne : input.jump } : { thr: 0, steer: 0, up: 0, brake: 1 });
      player.pos.copy(dv.pos); player.heading = dv.heading; player.vel.set(0, 0, 0); player.onGround = true; player.vy = 0; player.avatar.position.copy(dv.pos);
    }
    for (const v of this.list) { if (v === dv) continue; if (v.ai) this.drive(v, dt, player); else if (v.rotor > .01 || Math.abs(v.speed) > .05) v.update(dt, { thr: 0, steer: 0, up: 0, brake: 1 }); }
    this.trafficT -= dt; if (this.trafficT <= 0) { this.trafficT = 2; this.traffic(player.pos); }
  }

  // ---- ambient AI traffic along the path graph ----
  traffic(pos) {
    const ai = this.list.filter(v => v.ai);
    for (const v of ai) if (Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z) > 95) { v.unseat(); this.remove(v); }
    if (ai.length >= 5 || this.nodes.length < 4) return;
    const cand = this.nodes.filter(([, p]) => { const d = Math.hypot(p[0] - pos.x, p[1] - pos.z); return d > 32 && d < 75; }); if (!cand.length) return;
    const [id, p] = pick(cand), kind = pick(['car', 'car', 'moto', 'bike']), v = new Vehicle(kind, p[0], p[1], rnd(0, 6.28), this.zone, true);
    v.seatDriver(createHuman(Math.floor(rnd(1, 1e6)), {}, '')); v.at = id; v.prev = null; v.cruise = kind === 'bike' ? 4 : kind === 'moto' ? 10 : 9; this.add(v); this.pickNext(v);
  }
  pickNext(v) { const n = (this.adj.get(v.at) || []).filter(x => x !== v.prev); const nx = n.length ? pick(n) : (this.adj.get(v.at) || [])[0]; if (!nx) { v.route = null; return; } v.prev = v.at; v.at = nx; const p = this.zone.mapData.nodes[nx]; v.route = { x: p[0], z: p[1] }; }
  drive(v, dt, player) {
    if (!v.route) { this.pickNext(v); if (!v.route) return; }
    const dx = v.route.x - v.pos.x, dz = v.route.z - v.pos.z; if (Math.hypot(dx, dz) < 3.5) { this.pickNext(v); return; }
    const err = angDiff(Math.atan2(dx, dz), v.heading), steer = clamp(err * 2, -1, 1);
    let blocked = false;                                                     // stop for the player or another vehicle straight ahead
    for (const o of [...this.list, { pos: player.pos, s: { r: .5 }, driver: 1 }]) { if (o === v) continue; const ox = o.pos.x - v.pos.x, oz = o.pos.z - v.pos.z, d = Math.hypot(ox, oz); if (d < 7 && Math.abs(angDiff(Math.atan2(ox, oz), v.heading)) < .5) { blocked = true; break; } }
    v.jam = blocked ? (v.jam || 0) + dt : 0; if (v.jam > 3) { blocked = false; if (v.jam > 6) v.jam = 0; }   // gridlock breaker: after 3 s, creep through
    const thr = blocked ? 0 : (Math.abs(err) > .9 ? .25 : 1) * v.cruise / v.s.max;
    v.update(dt, { thr, steer, up: 0, brake: blocked ? 1 : 0 });
  }
}
