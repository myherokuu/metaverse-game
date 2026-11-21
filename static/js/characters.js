// Humanoid characters. Uses the GLB models from assets.js (skinned, idle/walk/run via AnimationMixer); when no model is
// available it builds a procedural humanoid so the game still works (fallback mode).
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { getCharacter } from './assets.js';

const HEIGHT = 1.8;   // metres - real-world scale

// look = server appearance config {model_key, texture_variant, scale, ...}; unknown model_key falls back to the shared 'agent' model.
export function createCharacter(kind, color, look = {}) {
  const gltf = (look.model_key && getCharacter(look.model_key)) || getCharacter(kind);
  return gltf ? modelCharacter(gltf, kind, look.texture_variant || color, look.scale || 1, look.outfit, look.outfit_variant) : proceduralCharacter(color);
}


// ---- procedural emotes (sit / lie / sleep / dance) on Mixamo rigs: no clips needed ----
// Each emote lists [bone, axis, angle] rotations about CHARACTER axes (x = left, y = up, z = forward), parents first; 'L'/'R' bones get the
// angle mirrored for z/y rotations. Applied on top of the playing idle clip, blended in/out with weight w.
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const BOTH = (bone, axis, a) => [[`Left${bone}`, axis, a], [`Right${bone}`, axis, axis === 'x' ? a : -a]];
const EMOTES = {                                                          // baseline = bind (T) pose, so arms must be brought down explicitly
  bench: t => ({ drop: 1, hipsY: .6, bones: [['Spine', 'x', .03], ...BOTH('UpLeg', 'x', -1.45), ...BOTH('Leg', 'x', 1.5), ...BOTH('Arm', 'z', -1.2), ...BOTH('Arm', 'x', -.4), ...BOTH('ForeArm', 'x', -.9)] }),
  sit: t => ({ drop: 1, hipsY: .11, bones: [['Spine', 'x', .06], ...BOTH('UpLeg', 'x', -2.1), ...BOTH('Leg', 'x', .95), ...BOTH('Arm', 'z', -1.25), ...BOTH('Arm', 'x', -.35), ...BOTH('ForeArm', 'x', -.5)] }),
  lie: t => ({ lieBack: 1, bones: [...BOTH('Arm', 'z', -1.3), ['Spine2', 'x', Math.sin(t * 1.6) * .02]] }),
  sleep: t => ({ lieSide: 1, zzz: 1, bones: [['Spine1', 'x', .25 + Math.sin(t * 1.4) * .02], ['Head', 'x', .2], ...BOTH('UpLeg', 'x', -1.2), ...BOTH('Leg', 'x', 1.8), ...BOTH('Arm', 'z', -1.3), ...BOTH('Arm', 'x', -.2), ...BOTH('ForeArm', 'x', -1.5)] }),
  dance: t => {
    const b = t * 12.5, k = Math.sin(b), h = Math.sin(b / 2), stepL = Math.max(0, h), stepR = Math.max(0, -h);
    return { bounce: Math.abs(k) * .05, bones: [['Hips', 'y', h * .4], ['Hips', 'z', h * .12], ['Spine', 'y', -h * .3], ['Spine2', 'x', k * .08],
      ['LeftUpLeg', 'x', -stepL * .6], ['LeftLeg', 'x', stepL * .8], ['RightUpLeg', 'x', -stepR * .6], ['RightLeg', 'x', stepR * .8],
      ...BOTH('Arm', 'z', .9 + k * .3), ...BOTH('ForeArm', 'y', -.6 - k * .3), ['Head', 'z', h * .15]] };
  },
  dance2: t => {
    const b = t * 12.5, k = Math.sin(b), h = Math.sin(b / 2);
    return { bounce: Math.abs(k) * .07, bones: [['Hips', 'y', Math.sin(b / 4) * .6], ['Spine', 'z', h * .2], ['Spine2', 'y', h * .3],
      ['LeftArm', 'z', .4 + Math.max(0, k) * 1.0], ['RightArm', 'z', -(.4 + Math.max(0, -k) * 1.0)], ...BOTH('ForeArm', 'y', -.8),
      ...BOTH('UpLeg', 'x', -Math.abs(h) * .35), ...BOTH('Leg', 'x', Math.abs(h) * .5), ['Head', 'x', k * .12]] };
  },
};
function zzzSprite() {                                                    // floating "z Z z" over a sleeper
  const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
  g.font = 'bold 44px system-ui,sans-serif'; g.fillStyle = '#bfe6ff'; g.fillText('z', 6, 52); g.font = 'bold 30px system-ui'; g.fillText('Z', 52, 36); g.font = 'bold 22px system-ui'; g.fillText('z', 90, 22);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, fog: false })); spr.scale.set(.9, .45, 1); return spr;
}

function modelCharacter(gltf, kind, color, scale, outfit, variant) {
  const root = cloneSkinned(gltf.scene), group = new THREE.Group(), pose = new THREE.Group(); group.scale.setScalar(scale); group.add(pose);
  const bind = []; root.traverse(o => { if (o.isBone) bind.push([o, o.position.clone(), o.quaternion.clone()]); });   // bind pose = baseline for emotes
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true), k = HEIGHT / (box.max.y - box.min.y);   // precise=true applies skinning (Mixamo rigs are in cm)
  root.scale.multiplyScalar(k); root.position.y = -box.min.y * k; pose.add(root);   // pose = wrapper moved/rotated by emotes (sit/lie)
  if (kind === 'player') root.rotation.y = Math.PI;   // Soldier.glb faces -Z, Xbot.glb faces +Z; game heading convention is +Z = forward
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true; o.frustumCulled = false;       // skinned bounds are bind-pose only
    o.material = o.material.clone();
    if (kind === 'agent' && color && /surface/i.test(o.material.name)) { const hsl = {}; o.material.color.set(color).getHSL(hsl); o.material.color.setHSL(hsl.h, .3, .66); o.material.metalness = .65; o.material.roughness = .38; }   // per-agent tint, brushed-metal look
    o.material.envMapIntensity = 1;
  });
  if (outfit) applyOutfit(root, group, outfit);
  if (variant && variant.startsWith('wakanda_')) applyCostume(root, group, variant.slice(8));
  else if (variant === 'pandora_tribal') applyTribal(root);
  else if (variant === 'mars_suit') applySpacesuit(root);
  else if (variant === 'mars_robot') applyRobot(root);     // 'guard' | 'royal'
  const mixer = new THREE.AnimationMixer(root), acts = {};
  for (const c of gltf.animations) { const n = c.name.toLowerCase(); for (const key of ['idle', 'walk', 'run']) if (n === key) acts[key] = mixer.clipAction(c); }
  acts.idle = acts.idle || mixer.clipAction(gltf.animations[0]); acts.walk = acts.walk || acts.idle; acts.run = acts.run || acts.walk;
  // whitelisted gestures -> clip names present in the model; a gesture with no clip is silently skipped
  const GESTURE_CLIP = { nod: 'agree', talk: 'agree', shake: 'headShake', sad: 'sad_pose' }, byName = Object.fromEntries(gltf.animations.map(c => [c.name.toLowerCase(), c]));
  let cur = 'idle', busy = false; acts.idle.play();
  mixer.update(Math.random() * 2);                                         // de-sync identical idles
  if (variant === 'wakanda_guard') { mixer.update(0); holdSpear(root, group); }   // grip the spear in the idle pose
  // ---- emotes ----
  const bone = n => root.getObjectByName('mixamorig' + n) || root.getObjectByName('mixamorig:' + n);
  const hips = bone('Hips'); root.updateMatrixWorld(true);
  const hipH = (hips ? hips.getWorldPosition(new THREE.Vector3()).y : .95) / scale;   // hip height in the group's own units
  let emo = null, emoT = 0, w = 0, target = 0, zzz = null; const vh = new THREE.Vector3(), vg = new THREE.Vector3(), qa = new THREE.Quaternion(), qp = new THREE.Quaternion(), qg = new THREE.Quaternion(), ax = new THREE.Vector3();
  function applyEmote(dt) {
    if (!emo && w < .01) return;
    w += (target - w) * Math.min(1, dt * 5); emoT += dt;
    if (!emo || (target === 0 && w < .02)) { w = 0; emo = null; pose.position.set(0, 0, 0); pose.rotation.set(0, 0, 0); if (zzz) zzz.visible = false; return; }
    for (const [b, p0, q0] of bind) { b.position.lerp(p0, w); b.quaternion.slerp(q0, w); }   // idle clip -> bind pose as the emote fades in
    const d = EMOTES[emo](emoT);
    pose.position.set((d.lieSide ? -.85 : 0) * w, (d.drop ? -(hipH - .04) : d.lieBack || d.lieSide ? .2 : (d.bounce || 0)) * w, (d.lieBack ? .85 : 0) * w);
    pose.rotation.set(d.lieBack ? -Math.PI / 2 * w : 0, 0, d.lieSide ? -Math.PI / 2 * w : 0);
    pose.updateMatrixWorld(true); pose.getWorldQuaternion(qg);   // axes follow the body, so a sleeper's legs still bend along their own side
    for (const [name, axis, ang] of d.bones) {
      const b = bone(name); if (!b || !b.parent) continue;
      b.parent.getWorldQuaternion(qp); ax.copy(AXES[axis]).applyQuaternion(qg);
      qa.setFromAxisAngle(ax, ang * w);                                    // world rotation about the character's own axis...
      b.quaternion.premultiply(qp).premultiply(qa).premultiply(qp.invert());   // ...expressed in the bone's local frame: P^-1 R P q
      b.updateMatrixWorld(true);
    }
    if (d.drop && hips) {                                                  // sitting: put the hips at the emote's height (floor ~11 cm, bench ~60 cm) whatever the rig's proportions
      pose.updateMatrixWorld(true); hips.getWorldPosition(vh); group.getWorldPosition(vg); pose.position.y += (d.hipsY - (vh.y - vg.y) / scale) * w;
    }
    if (d.zzz) { if (!zzz) { zzz = zzzSprite(); group.add(zzz); } zzz.visible = true; zzz.position.set(.85, .7 + Math.sin(emoT * 2) * .08, 0); zzz.material.opacity = .6 + Math.sin(emoT * 2) * .3; }
    else if (zzz) zzz.visible = false;
  }
  return {
    group, isModel: true,
    get emoting() { return target ? emo : null; },
    emote(name) { if (!name || !EMOTES[name]) { target = 0; return; } if (emo !== name) emoT = 0; emo = name; target = 1; },
    gesture(name) {
      if (name === 'dance' || name === 'sit') { this.emote(name); setTimeout(() => this.emote(null), 6000); return; }
      const clip = byName[GESTURE_CLIP[name]]; if (!clip || busy) return;
      const g = mixer.clipAction(clip), back = acts[cur]; busy = true;
      g.reset().setLoop(THREE.LoopOnce, 1); g.clampWhenFinished = true; g.play(); g.crossFadeFrom(back, .25, true);
      const done = e => { if (e.action !== g) return; mixer.removeEventListener('finished', done); back.reset().play(); back.crossFadeFrom(g, .3, true); busy = false; };
      mixer.addEventListener('finished', done);
    },
    update(dt, speed) {
      if (busy) { mixer.update(dt); applyEmote(dt); return; }
      const want = speed < .3 ? 'idle' : speed < 4.4 ? 'walk' : 'run';
      if (want !== cur) { const a = acts[want], b = acts[cur]; a.reset().setEffectiveWeight(1).play(); a.crossFadeFrom(b, .25, true); cur = want; }
      if (cur === 'walk') acts.walk.timeScale = THREE.MathUtils.clamp(speed / 1.7, .5, 1.9);
      if (cur === 'run') acts.run.timeScale = THREE.MathUtils.clamp(speed / 4.6, .8, 1.5);
      mixer.update(dt); applyEmote(dt);
    },
  };
}

// outfit = {color?, metalness?, roughness?, scale?}: recolours the armour surfaces (never the visor/joints) and optionally rescales the model.
function applyOutfit(root, group, outfit) {
  root.traverse(o => {
    if (!o.isMesh || !/surface|body/i.test(o.material.name)) return;
    if (outfit.color) o.material.color.set(outfit.color);
    if (outfit.metalness !== undefined) o.material.metalness = outfit.metalness;
    if (outfit.roughness !== undefined) o.material.roughness = outfit.roughness;
  });
  if (outfit.scale) group.scale.multiplyScalar(outfit.scale);
}

// ---- original Afrofuturist costumes for Wakanda agents (attached to skeleton bones; sizes in metres) ----
function armorTexture(base, gold) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128); g.strokeStyle = gold; g.lineWidth = 5;
  for (let y = 0; y < 128; y += 32) { g.beginPath(); g.moveTo(0, y + 24); g.lineTo(64, y); g.lineTo(128, y + 24); g.stroke(); }
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2; g.strokeRect(2, 2, 124, 124);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function applyCostume(root, group, style) {
  root.traverse(o => { if (o.isMesh && !/joint|visor|eye/i.test(o.material.name)) { o.material.color.set(0x1d1511); o.material.metalness = .05; o.material.roughness = .55; } });   // deep black-brown body (Xbot's body material is 'Beta_HighLimbsGeoSG2')
  const bones = {}; root.traverse(o => { if (o.isBone) bones[o.name.replace(/^mixamorig:?/i, '').toLowerCase()] = o; });
  root.updateMatrixWorld(true);
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a93a, metalness: .95, roughness: .3 });
  const guard = style === 'guard', cloth = new THREE.MeshStandardMaterial({ map: armorTexture(guard ? '#a82a2d' : '#7b5a2c', guard ? '#e0b24a' : '#f0cf6a'), roughness: guard ? .65 : .5, metalness: guard ? 0 : .35 });
  const put = (bone, mesh, x = 0, y = 0, z = 0) => {               // metres -> the bone's local scale
    if (!bone) return; const s = new THREE.Vector3(); bone.getWorldScale(s); const k = 1 / (s.x || 1);
    mesh.scale.setScalar(k); mesh.position.set(x * k, y * k, z * k); mesh.castShadow = true; bone.add(mesh);
  };
  for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(.085 + i * .008, .012, 8, 24), gold); r.rotation.x = Math.PI / 2; put(bones.neck, r, 0, .02 + i * .022, 0); }   // stacked gold collar
  put(bones.spine2, new THREE.Mesh(new THREE.BoxGeometry(.34, .36, .22), cloth), 0, .06, .01);               // chest plate
  put(bones.hips, new THREE.Mesh(new THREE.BoxGeometry(.2, .55, .03), cloth), 0, -.2, .12);                  // front tabard
  put(bones.hips, new THREE.Mesh(new THREE.BoxGeometry(.22, .06, .24), gold), 0, .02, 0);                    // belt
  for (const [side, sx] of [['left', .22], ['right', -.22]]) {
    put(bones.spine2, new THREE.Mesh(new THREE.SphereGeometry(.085, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), gold), sx, .2, 0);   // pauldron
    put(bones[side + 'forearm'], new THREE.Mesh(new THREE.CylinderGeometry(.05, .045, .17, 12), gold), 0, 0, 0);               // bracer
  }
}

// Pandora tribal look (original): deep teal-indigo body, glowing bead necklace and a feather crest.
function applyTribal(root) {
  root.traverse(o => { if (o.isMesh && !/joint|visor|eye/i.test(o.material.name)) { o.material.color.set(0x1f4f70); o.material.metalness = .05; o.material.roughness = .5; o.material.emissive = new THREE.Color(0x0b3a50); o.material.emissiveIntensity = .6; } });
  const bones = {}; root.traverse(o => { if (o.isBone) bones[o.name.replace(/^mixamorig:?/i, '').toLowerCase()] = o; });
  root.updateMatrixWorld(true);
  const put = (bone, mesh, x = 0, y = 0, z = 0) => { if (!bone) return; const s = new THREE.Vector3(); bone.getWorldScale(s); const k = 1 / (s.x || 1); mesh.scale.setScalar(k); mesh.position.set(x * k, y * k, z * k); bone.add(mesh); };
  const bead = new THREE.MeshStandardMaterial({ color: 0x5ff0c8, emissive: 0x2affd0, emissiveIntensity: 1.4 }), feather = new THREE.MeshStandardMaterial({ color: 0xb06cff, emissive: 0x7a3cff, emissiveIntensity: .8 });
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI - Math.PI / 2 - .9; put(bones.neck, new THREE.Mesh(new THREE.SphereGeometry(.022, 8, 6), bead), Math.cos(a + 1.5) * .1, -.05 + Math.abs(Math.sin(i / 9 * Math.PI)) * -.06, .09); }
  for (let i = 0; i < 5; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(.025, .22, 5), feather); f.rotation.z = (i - 2) * .22; put(bones.head, f, (i - 2) * .05, .2, -.02); }
  put(bones.hips, new THREE.Mesh(new THREE.BoxGeometry(.24, .35, .03), new THREE.MeshStandardMaterial({ color: 0x6d4f8f, roughness: .8 })), 0, -.18, .12);
}

// Mars colonists (original): white pressure suit with a glass helmet bubble, life-support backpack and an orange chest panel.
function boneKit(root) {
  const bones = {}; root.traverse(o => { if (o.isBone) bones[o.name.replace(/^mixamorig:?/i, '').toLowerCase()] = o; });
  root.updateMatrixWorld(true);
  const put = (bone, mesh, x = 0, y = 0, z = 0) => { if (!bone) return; const s = new THREE.Vector3(); bone.getWorldScale(s); const k = 1 / (s.x || 1); mesh.scale.setScalar(k); mesh.position.set(x * k, y * k, z * k); bone.add(mesh); };
  return { bones, put };
}
function tintBody(root, hex, metal, rough) { root.traverse(o => { if (o.isMesh && !/joint|visor|eye/i.test(o.material.name)) { o.material.color.set(hex); o.material.metalness = metal; o.material.roughness = rough; } }); }
function applySpacesuit(root) {
  tintBody(root, 0xe8e6e0, .15, .55);
  const { bones, put } = boneKit(root), orange = new THREE.MeshStandardMaterial({ color: 0xff8a4c, emissive: 0xff6a20, emissiveIntensity: .7 }), grey = new THREE.MeshStandardMaterial({ color: 0xbfc3c9, metalness: .6, roughness: .35 });
  put(bones.head, new THREE.Mesh(new THREE.SphereGeometry(.17, 20, 14), new THREE.MeshPhysicalMaterial({ color: 0x9fd6ff, transparent: true, opacity: .22, roughness: .05, metalness: .3, depthWrite: false })), 0, .1, .02);
  put(bones.neck, new THREE.Mesh(new THREE.TorusGeometry(.1, .025, 8, 20), grey), 0, .02, 0);
  put(bones.spine2, new THREE.Mesh(new THREE.BoxGeometry(.3, .42, .15), grey), 0, .05, -.17);
  put(bones.spine2, new THREE.Mesh(new THREE.BoxGeometry(.13, .09, .02), orange), .06, .02, .14);
  for (const side of ['left', 'right']) put(bones[side + 'arm'], new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, .04, 12), orange), 0, .06, 0);
}
function applyRobot(root) {
  tintBody(root, 0x9aa3ad, .9, .3);
  const { bones, put } = boneKit(root), eye = new THREE.MeshStandardMaterial({ color: 0xff8a4c, emissive: 0xff8a4c, emissiveIntensity: 2 });
  put(bones.head, new THREE.Mesh(new THREE.BoxGeometry(.13, .035, .02), eye), 0, .07, .11);
  put(bones.head, new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .16, 6), new THREE.MeshStandardMaterial({ color: 0x24272e })), .06, .24, 0);
  put(bones.spine2, new THREE.Mesh(new THREE.BoxGeometry(.18, .12, .02), eye), 0, .02, .14);
}

// Spear gripped in the right hand: parented to the hand bone, oriented so it is upright in the idle pose, grip at the palm.
function holdSpear(root, group) {
  let hand = null; root.traverse(o => { if (o.isBone && /^(mixamorig:?)?righthand$/i.test(o.name)) hand = o; });
  if (!hand) return;
  root.updateMatrixWorld(true);
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a93a, metalness: .95, roughness: .3 }), dark = new THREE.MeshStandardMaterial({ color: 0x2a1c18, roughness: .8 });
  const sp = new THREE.Group();                                    // metres; origin = grip point, shaft runs from -0.85 to +1.25
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.016, .016, 2.1, 8), dark); shaft.position.y = .2; sp.add(shaft);
  const blade = new THREE.Mesh(new THREE.ConeGeometry(.05, .32, 8), gold); blade.scale.z = .5; blade.position.y = 1.41; sp.add(blade);
  for (const y of [1.22, -.84]) { const ring = new THREE.Mesh(new THREE.CylinderGeometry(.024, .024, .05, 8), gold); ring.position.y = y; sp.add(ring); }
  sp.traverse(m => { m.castShadow = true; });
  const ws = new THREE.Vector3(); hand.getWorldScale(ws); sp.scale.setScalar(1 / (ws.x || 1));
  const child = hand.children.find(c => c.isBone); if (child) sp.position.copy(child.position).multiplyScalar(.5);   // palm, halfway to the fingers
  const hq = new THREE.Quaternion(), gq = new THREE.Quaternion(); hand.getWorldQuaternion(hq); group.getWorldQuaternion(gq);
  sp.quaternion.copy(hq.invert().multiply(gq));                     // world-upright in the character's frame (idle pose)
  hand.add(sp);
}

// ---- fallback: simple articulated humanoid (1.8 m) ----
function proceduralCharacter(color) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const cloth = new THREE.MeshStandardMaterial({ color: color || 0x6b7a99, roughness: .8 }), dark = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: .9 }), skin = new THREE.MeshStandardMaterial({ color: 0xc9a58a, roughness: .7 });
  const part = (geo, m, x, y, z, p) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; (p || body).add(o); return o; };
  part(new THREE.CapsuleGeometry(.22, .45, 4, 10), cloth, 0, 1.2, 0);                  // torso
  part(new THREE.CylinderGeometry(.07, .08, .1, 8), skin, 0, 1.58, 0);                // neck
  part(new THREE.SphereGeometry(.12, 16, 12), skin, 0, 1.7, 0);                       // head
  const limb = (w, h, x, y, m) => { const p = new THREE.Group(); p.position.set(x, y, 0); part(new THREE.CapsuleGeometry(w, h, 3, 8), m, 0, -h / 2 - w, 0, p); body.add(p); return p; };
  const u = { legL: limb(.085, .7, -.1, .88, dark), legR: limb(.085, .7, .1, .88, dark), armL: limb(.06, .5, -.31, 1.45, cloth), armR: limb(.06, .5, .31, 1.45, cloth), t: Math.random() * 9 };
  return {
    group: g, isModel: false, gesture() { }, emote() { }, emoting: null,
    update(dt, speed, air) {
      u.t += dt * (3 + speed * 1.4); const s = Math.sin(u.t), amp = Math.min(speed / 4, 1.2) * .8;
      u.legL.rotation.x = s * amp; u.legR.rotation.x = -s * amp;
      u.armL.rotation.x = air ? -2.6 : -s * amp * .8; u.armR.rotation.x = air ? -2.6 : s * amp * .8;
      body.position.y = speed < .2 ? Math.sin(u.t * .6) * .01 : Math.abs(s) * .03;
    },
  };
}
