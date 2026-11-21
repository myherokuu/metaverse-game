// Avatars (procedural; swap makeAvatar for a GLB clone later) and live NPC sync from the server.
import * as THREE from 'three';
import { scene, makeLabel } from './world.js';
import { createCharacter } from './characters.js';
import { api } from './api.js';

export const npcs = new Map();   // id -> {group, tx,tz, rot, state, ...info}
let onList = () => { };

function ensure(a) {
  let n = npcs.get(a.id);
  if (!n) {
    const char = createCharacter('agent', new THREE.Color(a.color), a.look), group = char.group;
    const label = makeLabel(a.name, a.role, '#35e0ff', 3.4); label.position.set(0, 2.45, 0); group.add(label);
    group.position.set(a.x, 0, a.z); scene.add(group);
    n = { id: a.id, group, char, label, speed: 0, rot: a.rot, acc: 0 }; npcs.set(a.id, n);
  }
  return n;
}

let zoneId = null;
export function pollAgents() {
  if (!zoneId) return;
  const asked = zoneId;
  api('GET', '/api/world/agents/state?zone=' + asked).then(list => {
    if (asked !== zoneId) return;               // answer for a zone we already left
    list = list.filter(a => a.zone === asked);  // never show another zone's agents, whatever the server sent
    const seen = new Set();
    for (const a of list) {
      seen.add(a.id); const n = ensure(a);
      Object.assign(n, { zone: a.zone, tx: a.x, tz: a.z, trot: a.rot, state: a.state, name: a.name, role: a.role, moving: a.moving, color: a.color });
    }
    for (const [id, n] of npcs) if (!seen.has(id)) { scene.remove(n.group); npcs.delete(id); }
    onList(list);
  });
}
export function startAgentPolling(cb) { onList = cb; setInterval(pollAgents, 700); }
export function setAgentZone(id) { zoneId = id; pollAgents(); }
export function clearAgents() { zoneId = null; for (const n of npcs.values()) scene.remove(n.group); npcs.clear(); }

export function agentGesture(id, gesture) { const n = npcs.get(id); if (n && gesture && gesture !== 'none') n.char.gesture(gesture); }

const FAR = 30;   // m: beyond this an NPC's animation is stepped at ~10 Hz instead of every frame
export function updateAgents(dt, groundAt = () => 0, from = null) {
  const k = 1 - Math.exp(-dt * 5);
  for (const n of npcs.values()) {
    if (n.tx === undefined) continue;
    const p = n.group.position, ox = p.x, oz = p.z;
    p.x += (n.tx - p.x) * k; p.z += (n.tz - p.z) * k; p.y = groundAt(p.x, p.z);
    n.speed = Math.hypot(p.x - ox, p.z - oz) / Math.max(dt, 1e-3);
    let d = n.trot - n.rot; d = Math.atan2(Math.sin(d), Math.cos(d)); n.rot += d * Math.min(1, dt * 8); n.group.rotation.y = n.rot;
    n.acc += dt;
    if (from && Math.hypot(p.x - from.x, p.z - from.z) > FAR && n.acc < .1) continue;
    n.char.update(n.acc, n.speed, false); n.acc = 0;
  }
}

export function nearestAgent(pos, r = 4.5) {
  let best = null, bd = r;
  for (const n of npcs.values()) { const d = Math.hypot(n.group.position.x - pos.x, n.group.position.z - pos.z); if (d < bd) { bd = d; best = n; } }
  return best;
}
