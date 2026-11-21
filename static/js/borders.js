// Zone borders. Aether City and Wakanda sit side by side on the world map (Wakanda to the east); driving or flying past the edge
// carries you into the neighbouring zone (see app.js). Each edge gets a line of beacons and a sign so the border is visible.
import * as THREE from 'three';
import { makeLabel } from './world.js';

// dir: +x east, -x west. A zone lists the neighbour that lies beyond each edge.
export const NEIGHBORS = { aether_city: { east: 'wakanda', west: 'mars' }, wakanda: { west: 'aether_city', east: 'pandora' }, pandora: { west: 'wakanda' }, mars: { east: 'aether_city' } };
export const ZONE_NAMES = { aether_city: 'Aether City', wakanda: 'Wakanda', pandora: 'Pandora Nature World', mars: 'Mars Colony' };
export const ZONE_BOUNDS = { aether_city: 250, wakanda: 400, pandora: 500, mars: 500 };
const SIDE = { east: [1, 0], west: [-1, 0], north: [0, -1], south: [0, 1] };

export function borderCrossing(zoneId, bound, pos) {            // -> {dir, to} when pos is within 6 m of an edge that has a neighbour
  for (const [dir, to] of Object.entries(NEIGHBORS[zoneId] || {})) { const [sx, sz] = SIDE[dir]; if (pos.x * sx + pos.z * sz > bound - 6) return { dir, to }; }
  return null;
}
export function addBorders(zone, zoneId, scene) {
  if (zone._borders) return; zone._borders = true;
  const g = new THREE.Group(), glow = new THREE.MeshBasicMaterial({ color: 0x35e0ff }), pole = new THREE.MeshStandardMaterial({ color: 0x20283a, roughness: .5, metalness: .6 });
  for (const [dir, to] of Object.entries(NEIGHBORS[zoneId] || {})) {
    const [sx, sz] = SIDE[dir], B = zone.bound - 3, span = Math.min(zone.bound, 300);
    for (let t = -span; t <= span; t += 30) {
      const x = sx ? sx * B : t, z = sz ? sz * B : t, y = zone.groundAt(x, z);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(.25, .35, 14, 8), pole); p.position.set(x, y + 7, z); g.add(p);
      const b = new THREE.Mesh(new THREE.SphereGeometry(.7, 12, 8), glow); b.position.set(x, y + 14.5, z); g.add(b);
    }
    const x = sx * B, z = sz * B, l = makeLabel('BORDER', '→ ' + (ZONE_NAMES[to] || to), '#35e0ff', 22); l.position.set(x, zone.groundAt(x, z) + 22, z); g.add(l);
  }
  zone.group.add(g);
}
