// Third-person follow camera (smooth, zoomable) and free-fly observer camera. Yaw convention: forward = (-sin yaw, -cos yaw).
import * as THREE from 'three';

export class CameraRig {
  constructor(camera) {
    this.cam = camera; this.yaw = 0; this.pitch = .35; this.dist = 5; this.mode = 'explore'; this.sens = 1; this.extra = 0;   // extra = added follow distance while in a vehicle
    this.free = new THREE.Vector3(0, 30, 40); this.fyaw = 0; this.fpitch = -.4; this.tmp = new THREE.Vector3();
  }
  rotate(dx, dy) {
    const s = .0025 * this.sens;
    if (this.mode === 'explore') { this.yaw -= dx * s; this.pitch = Math.max(.05, Math.min(1.35, this.pitch + dy * s)); }
    else { this.fyaw -= dx * s; this.fpitch = Math.max(-1.5, Math.min(1.5, this.fpitch - dy * s)); }
  }
  zoom(delta) { this.dist = Math.max(2.2, Math.min(14, this.dist * (1 + delta * .001))); }
  setMode(m) { this.mode = m; if (m === 'observer') { this.free.copy(this.cam.position); this.fyaw = this.yaw; this.fpitch = -.4; } }
  update(dt, target, input, groundAt = () => 0) {
    const c = this.cam;
    if (this.mode === 'explore') {
      const D = this.dist + this.extra, cp = Math.cos(this.pitch), want = this.tmp.set(target.x + Math.sin(this.yaw) * D * cp, target.y + 1.7 + Math.sin(this.pitch) * D, target.z + Math.cos(this.yaw) * D * cp);
      want.y = Math.max(groundAt(want.x, want.z) + .7, want.y);
      c.position.lerp(want, 1 - Math.exp(-dt * 12)); c.lookAt(target.x, target.y + 1.5, target.z);
    } else {
      const sp = (input.run ? 60 : 24) * dt, fx = -Math.sin(this.fyaw), fz = -Math.cos(this.fyaw), cp = Math.cos(this.fpitch);
      const f = input.forward - input.back, r = input.right - input.left;
      this.free.x += (fx * cp * f + Math.cos(this.fyaw) * r) * sp; this.free.z += (fz * cp * f - Math.sin(this.fyaw) * r) * sp;
      this.free.y += (Math.sin(this.fpitch) * f + input.jump - input.down) * sp; this.free.y = Math.max(groundAt(this.free.x, this.free.z) + 1.5, this.free.y);
      c.position.copy(this.free); c.rotation.set(this.fpitch, this.fyaw, 0, 'YXZ');
    }
  }
}
