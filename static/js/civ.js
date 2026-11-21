// Civilization client layer: shared simulation clock (zone-local day/night), construction sites and citizens for the active zone.
import * as THREE from 'three';
import { api } from './api.js';
import { buildSite } from './civic.js';
import { disposeGroup, makeLabel } from './world.js';
import { createHuman } from './humans.js';
import { AmbientLife, disposePerson } from './ambient.js';

// ---------- clock ----------
const clk = { snap: null, at: 0 };
export function syncClock() { return api('GET', '/api/civilization/clock').then(s => { clk.snap = s; clk.at = performance.now(); return s; }); }
export function startClock() { syncClock(); setInterval(syncClock, 4000); }
export const clockSnap = () => clk.snap;
export function simTs() { return clk.snap ? clk.snap.sim_ts + (clk.snap.running ? (performance.now() - clk.at) / 1000 * clk.snap.speed : 0) : null; }
const pad = n => String(n).padStart(2, '0');
export function fmtLocal(lts) { const d = Math.floor(lts / 86400), s = lts % 86400; return `${2100 + Math.floor(d / 360)}-${pad(Math.floor((d % 360) / 30) + 1)}-${pad(d % 30 + 1)} ${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`; }
// local time of a zone, interpolated between server syncs
export function zoneClock(zoneId) {
  const t = simTs(), z = clk.snap && clk.snap.zones.find(x => x.zone_id === zoneId); if (t === null || !z) return null;
  const lts = t + z.tz_offset_min * 60, hour = (lts % 86400) / 3600;
  return { hour, label: fmtLocal(lts), isDay: hour >= z.sunrise_h && hour < z.sunset_h, working: hour >= z.work_start_h && hour < z.work_end_h, speed: clk.snap.speed, running: clk.snap.running };
}

// ---------- per-zone layer ----------
export class CivLayer {
  constructor(zone, zoneId, theme) {
    this.zone = zone; this.zoneId = zoneId; this.theme = theme; this.group = new THREE.Group(); zone.group.add(this.group);
    this.sites = new Map(); this.siteT = 0; this.citT = 0; this.alive = true; this.targets = []; this.cur = []; this.people = new Map(); this.ambient = new AmbientLife(zone, this.group);
    const body = new THREE.CapsuleGeometry(.24, .75, 3, 8), head = new THREE.SphereGeometry(.2, 10, 8);
    this.MAX = 160;
    this.body = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: .8 }), this.MAX); this.head = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ color: 0xd2a98c, roughness: .7 }), this.MAX);
    for (const m of [this.body, this.head]) { m.count = 0; m.castShadow = true; m.frustumCulled = false; this.group.add(m); }
    this.m4 = new THREE.Matrix4(); this.col = new THREE.Color(); this.t = 0;
  }
  update(dt, pos) {
    if (!this.alive) return;
    this.t += dt; this.siteT -= dt; this.citT -= dt; this.ambient.update(dt, pos);
    if (this.siteT <= 0) { this.siteT = 4; this.pollSites(); }
    if (this.citT <= 0) { this.citT = 1.5; this.pollCitizens(); }
    // Nearest citizens (<= NEAR_MAX within NEAR_R m) are full humans with their own face/outfit; the rest stay cheap instanced stand-ins.
    const n = this.targets.length, k = 1 - Math.exp(-dt * 4), NEAR_R = 40, NEAR_MAX = 16, ord = [];
    for (let i = 0; i < n; i++) { const t = this.targets[i], c = this.cur[i] || (this.cur[i] = { x: t.x, z: t.z }), d = Math.hypot(c.x - pos.x, c.z - pos.z); if (d < NEAR_R) ord.push([d, i]); }
    ord.sort((a, b) => a[0] - b[0]); const near = new Set(ord.slice(0, NEAR_MAX).map(e => this.targets[e[1]].id));
    for (const [id, p] of this.people) if (!near.has(id)) { disposePerson(p.h); this.people.delete(id); }
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = this.targets[i], c = this.cur[i], ox = c.x, oz = c.z, dx = t.x - c.x, dz = t.z - c.z, moving = Math.hypot(dx, dz) > .05; c.x += dx * k; c.z += dz * k;
      const gy = this.zone.groundAt(c.x, c.z);
      if (near.has(t.id)) {
        let p = this.people.get(t.id);
        if (!p) { p = { h: createHuman(t.id, {}, t.occupation || ''), rot: 0 }; this.people.set(t.id, p); this.group.add(p.h.group); }
        if (moving) { let d = Math.atan2(dx, dz) - p.rot; d = Math.atan2(Math.sin(d), Math.cos(d)); p.rot += d * Math.min(1, dt * 8); }
        const dd = Math.hypot(c.x - pos.x, c.z - pos.z);
        if (dd < 10 && !p.lab) { p.lab = makeLabel(t.name || 'Citizen', t.occupation || '', '#35e0ff', 2.4); p.lab.position.set(0, 2.05, 0); p.h.group.add(p.lab); }
        if (p.lab) p.lab.visible = dd < 10;
        p.h.group.position.set(c.x, gy, c.z); p.h.group.rotation.y = p.rot; p.h.update(dt, Math.hypot(c.x - ox, c.z - oz) / Math.max(dt, 1e-3));
        continue;
      }
      const y = gy + (moving ? Math.abs(Math.sin(this.t * 7 + i)) * .06 : 0), ang = Math.atan2(dx, dz);
      this.m4.makeRotationY(moving ? ang : 0).setPosition(c.x, y + .65, c.z); this.body.setMatrixAt(j, this.m4); this.m4.setPosition(c.x, y + 1.35, c.z); this.head.setMatrixAt(j, this.m4);
      this.body.setColorAt(j, this.col.setHSL((t.color % 360) / 360, .45, .45)); j++;
    }
    this.body.count = this.head.count = j;
    this.body.instanceMatrix.needsUpdate = this.head.instanceMatrix.needsUpdate = true; if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
  pollCitizens() {
    api('GET', `/api/civilization/zones/${this.zoneId}/citizens`).done(list => {
      if (!this.alive) return;
      const vis = list.filter(c => c.visible).slice(0, this.MAX); const old = new Map(this.targets.map((t, i) => [t.id, this.cur[i]]));
      this.targets = vis; this.cur = vis.map(c => old.get(c.id) || { x: c.x, z: c.z });
      this.info = list.length;
    });
  }
  pollSites() {
    api('GET', `/api/civilization/zones/${this.zoneId}/sites`).done(list => {
      if (!this.alive) return;
      const seen = new Set();
      for (const s of list) {
        seen.add(s.project_id); const key = s.stage + ':' + Math.floor(s.progress / 4), have = this.sites.get(s.project_id);
        if (have && have.key === key) continue;
        if (have) { disposeGroup(have.group); }
        const g = buildSite(s, this.theme); g.position.y = this.zone.groundAt(s.x, s.z); this.group.add(g); this.sites.set(s.project_id, { group: g, key });
      }
      for (const [id, v] of this.sites) if (!seen.has(id)) { disposeGroup(v.group); this.sites.delete(id); }
    });
  }
  dispose() { this.alive = false; this.ambient.dispose(); for (const p of this.people.values()) disposePerson(p.h); disposeGroup(this.group); }
}
