import * as THREE from 'three';
import { createCharacter } from './characters.js';
import { resolveCollisions, roofAt, blockingAt } from './navigation.js';

export const input = { forward: 0, back: 0, left: 0, right: 0, run: 0, jump: 0, down: 0 };
const MAP = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run', Space: 'jump', KeyC: 'down' };
// Only real text-entry fields swallow game keys. A focused checkbox / range slider / select / button (e.g. after touching Settings) must not.
export const isTyping = () => { const e = document.activeElement; return !!e && (e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && /^(text|password|search|number|email|url|tel|)$/i.test(e.type))); };
const typing = isTyping;
export function initInput(onKey) {
  addEventListener('keydown', e => { if (typing()) return; if (MAP[e.code]) { input[MAP[e.code]] = 1; if (e.code === 'Space') e.preventDefault(); } if (!e.repeat) onKey(e.code); });
  addEventListener('keyup', e => { if (MAP[e.code]) input[MAP[e.code]] = 0; });
  addEventListener('blur', () => Object.keys(input).forEach(k => input[k] = 0));
}

export class Player {
  constructor(scene, pos) {
    this.char = createCharacter('player', 0xdfe8ff); this.avatar = this.char.group; scene.add(this.avatar);
    this.pos = new THREE.Vector3(pos.x, pos.y || 0, pos.z); this.vel = new THREE.Vector3(); this.vy = 0;
    this.onGround = true; this.heading = pos.rot || 0; this.state = 'idle'; this.path = null; this.stuck = { t: 0, x: 0, z: 0 }; this.emote = null;
  }
  setPath(pts) { this.path = pts.slice(); this.stuck = { t: 0, x: this.pos.x, z: this.pos.z }; }
  cancelPath() { this.path = null; }
  // sit on a bench seat: snap onto it, face out from the backrest, skip collision (the bench's own collider would push us off)
  sitAt(seat, ground) { this.seat = seat; this.pos.set(seat.x, ground + seat.y - .49, seat.z); this.heading = seat.heading; this.vel.set(0, 0, 0); this.vy = 0; this.onGround = true; this.setEmote('bench'); }
  standUp() { const s = this.seat; this.seat = null; if (s) { this.pos.x += Math.sin(s.heading) * 1.4; this.pos.z += Math.cos(s.heading) * 1.4; } this.setEmote(null); }
  setEmote(name) { this.emote = name && this.emote !== name ? name : null; this.path = null; this.char.emote(this.emote); }   // same key again = stand up
  teleport(x, y, z, heading) { this.seat = null; if (this.emote) this.setEmote(null); this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.vy = 0; this.onGround = true; this.path = null; if (heading !== undefined) this.heading = heading; }
  update(dt, yaw, zone, enabled) {
    if (this.emote && enabled && (input.forward || input.back || input.left || input.right || input.jump)) { if (this.seat) this.standUp(); else this.setEmote(null); }   // moving stands you up
    if (this.seat) { this.avatar.position.copy(this.pos); this.avatar.rotation.y = this.heading; this.char.update(dt, 0, false); return; }
    if (this.emote) enabled = false;
    const manual = enabled && (input.forward || input.back || input.left || input.right);
    if (manual) this.path = null;                                              // WASD cancels click-to-move
    let wx = 0, wz = 0, speed = input.run ? 7 : 3.4;
    if (this.path && enabled) {
      const t = this.path[0], dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < .9) { this.path.shift(); if (!this.path.length) this.path = null; } else { wx = dx / d; wz = dz / d; speed = input.run ? 7 : 4.2; }
      this.stuck.t += dt; if (this.stuck.t > 1.5) { if (Math.hypot(this.pos.x - this.stuck.x, this.pos.z - this.stuck.z) < .6) this.path = null; this.stuck = { t: 0, x: this.pos.x, z: this.pos.z }; }
    } else if (enabled) {
      const f = input.forward - input.back, r = input.right - input.left;
      wx = -Math.sin(yaw) * f + Math.cos(yaw) * r; wz = -Math.cos(yaw) * f - Math.sin(yaw) * r;
      const len = Math.hypot(wx, wz); if (len > 0) { wx /= len; wz /= len; }
    }
    const a = 1 - Math.exp(-dt * 14), ox = this.pos.x, oz = this.pos.z;
    this.vel.x += (wx * speed - this.vel.x) * a; this.vel.z += (wz * speed - this.vel.z) * a;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    const cols = zone.collidersFor(this.pos.x, this.pos.z);
    resolveCollisions(this.pos, .5, blockingAt(cols, this.pos.y), zone.bound - 2);
    const nx = this.pos.x, nz = this.pos.z;                                    // terrain: cliffs and deep water block movement
    if (zone.blocked(nx, nz, ox, oz, this.pos.y)) {
      if (!zone.blocked(nx, oz, ox, oz, this.pos.y)) this.pos.z = oz; else if (!zone.blocked(ox, nz, ox, oz, this.pos.y)) this.pos.x = ox; else { this.pos.x = ox; this.pos.z = oz; this.vel.set(0, 0, 0); }
    }
    const gy = Math.max(zone.groundAt(this.pos.x, this.pos.z), roofAt(cols, this.pos.x, this.pos.z, this.pos.y));   // roofs count as ground                       // terrain following + gravity
    if (enabled && input.jump && this.onGround) { this.vy = 5.2; this.onGround = false; }
    this.vy -= 16 * ((zone.cfg && zone.cfg.gravity) || 1) * dt; this.pos.y += this.vy * dt;           // Mars: 0.38 g
    if (this.pos.y <= gy) { this.pos.y = gy; this.vy = 0; this.onGround = true; }
    else if (this.onGround && this.vy <= 0 && this.pos.y - gy < .7) { this.pos.y = gy; this.vy = 0; }   // stick to the ground going downhill
    else if (this.pos.y - gy >= .7) this.onGround = false;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > .5) { let d = Math.atan2(this.vel.x, this.vel.z) - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d)); this.heading += d * Math.min(1, dt * 12); }
    this.state = !this.onGround ? 'jumping' : sp > 5.2 ? 'running' : sp > .5 ? 'walking' : 'idle';
    this.avatar.position.copy(this.pos); this.avatar.rotation.y = this.heading;
    this.char.update(dt, sp, !this.onGround);
  }
}
