// World Manager (client): one active zone scene at a time. A zone object implements:
//   load({api,progress}) preload(pos,progress) update(dt,pos) groundAt blocked collidersFor walkable pickTargets
//   locationAt nearestInfo targetFor fog dispose   + fields group, bound, locations, mapData, spawn, cacheable
// Register a new zone type in ZONE_TYPES (keyed by world_zones.builder) - the manager itself never changes.
import { scene, buildWorld, updateWorld, disposeGroup } from './world.js';
import { WakandaZone } from './wakanda.js';
import { makePandoraZone } from './pandora.js';
import { makeMarsZone } from './mars.js';
import { locationAt } from './navigation.js';
import * as THREE from 'three';
import { civicBuilders } from './civic.js';

class AetherZone {
  constructor() { this.id = 'aether_city'; this.cacheable = true; this.bound = 248; }
  async load({ api, progress }) {
    progress('Building Aether City…');
    const [L0, parcels, objs] = await Promise.all([api('GET', '/api/world/state'), api('GET', '/api/civilization/zones/aether_city/parcels'), api('GET', '/api/world/zones/aether_city/objects')]);
    const L = this.L = Object.assign(L0, { parcels }), h = buildWorld(L);
    this.api = api; this.civicB = civicBuilders('aether_city'); this.lastObjId = 0; this.pollT = 3;
    Object.assign(this, { group: h.group, colliders: h.colliders, anim: h.animated, ground: h.ground, seats: h.seats, locations: L.locations, timeOfDay: L.time_of_day, spawn: { x: 0, y: 0, z: 8, rot: Math.PI } });
    this.mapData = { bound: 250, nodes: L.nodes, edges: L.edges, locations: L.locations, aether: true };
    this.addCivic(objs);                                // finished government buildings from earlier simulation
    return this;
  }
  async preload() { }
  addCivic(objs) {                                    // finished government buildings (kind civic_*) appear as world objects
    for (const o of objs) {
      this.lastObjId = Math.max(this.lastObjId, o.id);
      const b = this.civicB[o.kind]; if (!b) continue;
      const g = new THREE.Group(); g.add(b(o, this)); g.position.set(o.x, 0, o.z); this.group.add(g);
      const bb = o.data.box; if (bb) this.colliders.push({ x0: o.x - bb[0] / 2, x1: o.x + bb[0] / 2, z0: o.z - bb[1] / 2, z1: o.z + bb[1] / 2, h: o.data.h ? o.data.h + .6 : undefined });   // h = flat roof you can land on
    }
  }
  update(dt) {
    updateWorld(dt, this.anim);
    this.pollT -= dt; if (this.pollT <= 0 && !this.polling) { this.pollT = 4; this.polling = true; this.api('GET', `/api/world/zones/aether_city/objects?after=${this.lastObjId}`).then(o => this.addCivic(o)).always(() => { this.polling = false; }); }
  }
  groundAt() { return 0; }
  blocked() { return false; }
  collidersFor() { return this.colliders; }
  walkable(x, z) { return Math.abs(x) < this.bound - 1 && Math.abs(z) < this.bound - 1 && !this.colliders.some(c => x > c.x0 - .7 && x < c.x1 + .7 && z > c.z0 - .7 && z < c.z1 + .7); }
  pickTargets() { return [this.ground]; }
  locationAt(x, z) { return locationAt(x, z, this.locations); }
  nearestInfo() { return null; }
  targetFor(l) { const n = this.L.nodes[l.node]; return n ? { x: n[0], z: n[1] } : { x: l.x, z: l.z }; }
  fog() { return [70, 260]; }
  dispose() { disposeGroup(this.group); }
}
WakandaZone.prototype.targetFor = function (l) {
  const sp = this.map.spawn_points.find(s => s.district_key === l.key), n = this.map.nodes[l.node];
  return sp ? { x: sp.x, z: sp.z } : n ? { x: n[0], z: n[1] } : { x: l.x, z: l.z };
};

export const ZONE_TYPES = { aether_city: () => new AetherZone(), wakanda: () => new WakandaZone(), pandora: () => makePandoraZone(), mars: () => makeMarsZone() };

export class ZoneManager {
  constructor() { this.current = null; this.cache = new Map(); }
  async load(info, ctx) {
    let z = this.cache.get(info.id);
    if (!z) { const make = ZONE_TYPES[info.builder]; if (!make) throw new Error('No scene builder for zone ' + info.id); z = make(); await z.load(ctx); }
    scene.add(z.group); this.current = z; return z;
  }
  unload() {            // cacheable zones are only detached from the scene; big ones are disposed and rebuilt from SQLite later
    const z = this.current; if (!z) return;
    scene.remove(z.group);
    if (z.cacheable) this.cache.set(z.id, z); else { z.dispose(); this.cache.delete(z.id); }
    this.current = null;
  }
}
