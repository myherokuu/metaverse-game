// GTA-style street life around the player: people chatting, strolling with their jobs, police patrols, and the odd brawl that police
// run in to break up. Purely client-side and cosmetic (nothing is written to the server). Total people bounded by CAP.
import * as THREE from 'three';
import { createHuman } from './humans.js';
import { makeLabel, disposeGroup } from './world.js';

const CAP = 14, JOBS = ['Shopkeeper', 'Courier', 'Teacher', 'Doctor', 'Engineer', 'Street Vendor', 'Journalist', 'Security Guard', 'Student'];
const NAMES = ['Aiman', 'Sara', 'Hakim', 'Mei', 'Ravi', 'Zara', 'Daniel', 'Aisha', 'Omar', 'Lina', 'Kofi', 'Nadia', 'Yusuf', 'Ines', 'Jun', 'Farah'];
let seedN = 50000;
const rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[Math.floor(Math.random() * a.length)];

// Free the label texture (disposeGroup only handles geometry) and remove the person from the scene.
export function disposePerson(h) { h.group.traverse(o => { if (o.isSprite) { o.material.map && o.material.map.dispose(); o.material.dispose(); } }); disposeGroup(h.group); }

export class AmbientLife {
  constructor(zone, parent) { this.zone = zone; this.group = new THREE.Group(); parent.add(this.group); this.scenes = []; this.people = new Set(); this.spawnT = 3; this.fightCool = 25; }
  dispose() { for (const p of this.people) disposePerson(p.h); this.people.clear(); this.scenes = []; this.group.removeFromParent(); }

  person(job, x, z, name, occ) {
    const h = createHuman(seedN++, {}, occ || job), p = { h, job, name: name || pick(NAMES), x, z, rot: Math.random() * 6.28, speed: 0, dest: null, lab: null, sp: 1.3 };
    h.group.position.set(x, this.zone.groundAt(x, z), z); this.group.add(h.group); this.people.add(p); return p;
  }
  drop(p) { disposePerson(p.h); this.people.delete(p); }
  spot(pos, rmin, rmax, avoid = 6) {
    for (let i = 0; i < 12; i++) {
      const a = rnd(0, 6.283), r = rnd(rmin, rmax), x = pos.x + Math.sin(a) * r, z = pos.z + Math.cos(a) * r;
      if (this.zone.walkable(x, z) && !this.scenes.some(s => Math.hypot(s.x - x, s.z - z) < avoid)) return { x, z };
    }
    return null;
  }
  // move toward p.dest at p.sp m/s with axis-wise collision against buildings; returns true when there is no destination left
  step(p, dt) {
    let moved = 0;
    if (p.dest) {
      const dx = p.dest.x - p.x, dz = p.dest.z - p.z, d = Math.hypot(dx, dz);
      if (d < .25) p.dest = null;
      else {
        const m = Math.min(d, p.sp * dt), nx = p.x + dx / d * m, nz = p.z + dz / d * m;
        if (this.zone.walkable(nx, nz)) { p.x = nx; p.z = nz; moved = m; } else if (this.zone.walkable(nx, p.z)) { p.x = nx; moved = m * .7; } else if (this.zone.walkable(p.x, nz)) { p.z = nz; moved = m * .7; } else p.dest = null;
        let a = Math.atan2(dx, dz) - p.rot; a = Math.atan2(Math.sin(a), Math.cos(a)); p.rot += a * Math.min(1, dt * 8);
      }
    }
    p.speed = moved / Math.max(dt, 1e-3); return !p.dest;
  }
  face(p, x, z, dt) { let a = Math.atan2(x - p.x, z - p.z) - p.rot; a = Math.atan2(Math.sin(a), Math.cos(a)); p.rot += a * Math.min(1, dt * 6); }

  spawnScene(pos) {
    const kinds = [], n = k => this.scenes.filter(s => s.kind === k).length;
    if (n('chat') < 2) kinds.push('chat'); if (n('patrol') < 1) kinds.push('patrol'); if (n('stroll') < 3) kinds.push('stroll', 'stroll');
    if (n('fight') < 1 && this.fightCool <= 0) kinds.push('fight');
    if (!kinds.length) return;
    const kind = pick(kinds), need = { chat: 3, patrol: 1, stroll: 1, fight: 4 }[kind];
    if (this.people.size + need > CAP) return;
    const sp = this.spot(pos, 12, 34); if (!sp) return;
    const s = { kind, x: sp.x, z: sp.z, t: 0, ph: 'act', m: [], cd: 0, life: rnd(45, 90) };
    if (kind === 'chat') { const k = Math.random() < .3 ? 3 : 2; for (let i = 0; i < k; i++) { const a = i / k * 6.283, p = this.person(pick(JOBS), sp.x + Math.sin(a) * .85, sp.z + Math.cos(a) * .85); p.rot = a + Math.PI; s.m.push(p); } }
    else if (kind === 'patrol') { const p = this.person('Police Officer', sp.x, sp.z, pick(NAMES), 'police'); p.sp = 1.4; s.m.push(p); }
    else if (kind === 'stroll') { const p = this.person(pick(JOBS), sp.x, sp.z); p.sp = rnd(1.1, 1.6); s.m.push(p); }
    else { for (let i = 0; i < 2; i++) { const p = this.person('Civilian', sp.x + (i ? .55 : -.55), sp.z, pick(NAMES), 'thug'); s.m.push(p); } s.life = rnd(14, 20); this.fightCool = 120; }
    this.scenes.push(s);
  }

  update(dt, pos) {
    this.spawnT -= dt; this.fightCool -= dt;
    if (this.spawnT <= 0) { this.spawnT = 2.5; this.spawnScene(pos); }
    for (const s of this.scenes) this.tick(s, dt, pos);
    this.scenes = this.scenes.filter(s => !s.done);
    for (const p of this.people) {
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      p.h.group.position.set(p.x, this.zone.groundAt(p.x, p.z), p.z); p.h.group.rotation.y = p.rot; p.h.update(dt, p.speed);
      if (d < 11 && !p.lab) { p.lab = makeLabel(p.name, p.job, p.job === 'Police Officer' ? '#4d8dff' : '#35e0ff', 2.4); p.lab.position.set(0, 2.05, 0); p.h.group.add(p.lab); }
      if (p.lab) p.lab.visible = d < 11;
    }
  }

  tick(s, dt, pos) {
    s.t += dt; s.cd -= dt;
    if (s.ph === 'gone' || Math.hypot(s.m[0].x - pos.x, s.m[0].z - pos.z) > 55) { s.m.forEach(p => this.drop(p)); s.done = true; return; }
    if (s.kind === 'chat') {
      s.m.forEach(p => { const o = s.m.find(q => q !== p); this.face(p, o.x, o.z, dt); if (s.ph === 'act') p.speed = 0; });
      if (s.ph === 'act' && s.cd <= 0) { s.cd = rnd(2.5, 4); const sp = pick(s.m), o = pick(s.m.filter(q => q !== sp)); sp.h.gesture('talk', 3); s.react = { p: o, g: Math.random() < .5 ? 'nod' : 'shake', at: s.t + 1.5 }; }
      if (s.react && s.t > s.react.at) { s.react.p.h.gesture(s.react.g, 1.2); s.react = null; }
      if (s.ph === 'act' && s.t > s.life) { s.ph = 'leave'; s.t = 0; s.m.forEach(p => { p.dest = this.spot(p, 20, 30, 0) || { x: p.x + 25, z: p.z }; p.sp = 1.3; }); }
      if (s.ph === 'leave') { s.m.forEach(p => this.step(p, dt)); if (s.t > 25) s.ph = 'gone'; }
    } else if (s.kind === 'stroll' || s.kind === 'patrol') {
      const p = s.m[0];
      if (s.cd > 0) p.speed = 0;
      else if (!p.dest) { p.dest = this.spot(p, 8, 25, 0); s.cd = p.dest ? 0 : 2; }
      const wasMoving = !!p.dest; this.step(p, dt);
      if (wasMoving && !p.dest) { s.cd = rnd(2, 6); p.h.gesture(pick(s.kind === 'patrol' ? ['point', 'talk'] : ['wave', 'talk', 'nod']), 2.5); }
      if (s.t > s.life * 2) s.ph = 'gone';
    } else this.fight(s, dt);
  }

  fight(s, dt) {
    const [a, b] = s.m;
    if (s.ph === 'act') {
      this.face(a, b.x, b.z, dt); this.face(b, a.x, a.z, dt); a.speed = b.speed = 0;
      if (s.cd <= 0) { s.cd = 4; a.h.gesture('fight', 4); b.h.gesture('fight', 4); }
      if (s.t > s.life) {                                            // witnesses call it in: two officers run in from afar
        s.ph = 'respond'; s.t = 0; s.cops = [];
        for (let i = 0; i < 2; i++) { const o = this.spot(s, 26, 34, 0); if (!o) continue; const c = this.person('Police Officer', o.x, o.z, pick(NAMES), 'police'); c.sp = 4.2; c.dest = { x: s.x + (i ? 1.6 : -1.6), z: s.z + 1.4 }; s.cops.push(c); s.m.push(c); }
        if (!s.cops.length) s.ph = 'gone';
      }
    } else if (s.ph === 'respond') {
      s.cops.forEach(c => this.step(c, dt));
      if (s.cd <= 0) { s.cd = 1; a.h.gesture('fight', 1.2); b.h.gesture('fight', 1.2); }
      if (s.cops.every(c => !c.dest) || s.t > 14) {
        s.ph = 'arrest'; s.t = 0; s.cops.forEach(c => { c.speed = 0; c.sp = 1.4; c.h.gesture('point', 5); }); [a, b].forEach(p => p.h.gesture('handsup', 6));
      }
    } else if (s.ph === 'arrest') {
      s.cops.forEach((c, i) => { const t = i ? b : a; this.face(c, t.x, t.z, dt); c.speed = 0; });
      this.face(a, s.cops[0].x, s.cops[0].z, dt); this.face(b, s.cops[s.cops.length - 1].x, s.cops[s.cops.length - 1].z, dt); a.speed = b.speed = 0;
      if (s.t > 6) { s.ph = 'leave'; s.t = 0; const o = this.spot(s, 26, 34, 0) || { x: s.x + 30, z: s.z }; s.m.forEach(p => { p.dest = { x: o.x + rnd(-1, 1), z: o.z + rnd(-1, 1) }; p.sp = 1.3; }); }   // escorted off together
    } else if (s.ph === 'leave') { s.m.forEach(p => this.step(p, dt)); if (s.t > 25) s.ph = 'gone'; }
  }
}
