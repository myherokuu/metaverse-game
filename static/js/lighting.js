// Lighting rig: sun with following shadow frustum, moon, hemisphere fill, procedural sky dome, environment map for PBR
// reflections, optional bloom. Everything degrades by quality level.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { setNight, setEnvIntensity } from './materials.js';

const C = (h) => new THREE.Color(h);

export function createLighting(scene, renderer, camera, q) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .95;
  renderer.shadowMap.enabled = q.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x2a2f36, .6); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3); sun.castShadow = q.shadows; scene.add(sun, sun.target);
  if (q.shadows) {
    sun.shadow.mapSize.set(q.shadowSize, q.shadowSize); const s = sun.shadow.camera; s.left = s.bottom = -55; s.right = s.top = 55; s.near = 1; s.far = 320;
    sun.shadow.bias = -.0004; sun.shadow.normalBias = .06;
  }
  const moon = new THREE.DirectionalLight(0x8fa8ff, 0); scene.add(moon);

  // environment map (procedural studio-like HDR) -> reflections on glass / metal / wet asphalt
  if (!q.fallback) { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture; pm.dispose(); }

  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: C(0x3d7bd6) }, bottom: { value: C(0xbcd8f2) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: C(0xffe2b0) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: [
      'uniform vec3 top, bottom, sunCol, sunDir; varying vec3 vP;',
      'void main(){ vec3 d = normalize(vP); float h = clamp(d.y, 0., 1.); vec3 c = mix(bottom, top, pow(h, .5));',
      '  float s = max(dot(d, sunDir), 0.); c += sunCol * (pow(s, 90.) * .9 + pow(s, 7.) * .18); gl_FragColor = vec4(c, 1.);',
      '#include <tonemapping_fragment>', '#include <colorspace_fragment>', '}'].join('\n'),
  }));
  sky.renderOrder = -2; scene.add(sky);
  const sp = new Float32Array(1500); for (let i = 0; i < 500; i++) { const a = Math.random() * 6.283, b = Math.acos(Math.random() * .95); sp.set([440 * Math.sin(b) * Math.cos(a), 440 * Math.cos(b), 440 * Math.sin(b) * Math.sin(a)], i * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false })); stars.renderOrder = -1; scene.add(stars);
  scene.fog = new THREE.Fog(0xbcd8f2, 70, 260);

  // post: MSAA render target + (optional) bloom + tone-mapped output
  let composer = null, bloom = null;
  if (q.bloom) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), .3, .55, .92); composer.addPass(bloom); composer.addPass(new OutputPass());
  }

  const lerpC = (a, b, t) => a.clone().lerp(b, t);
  let fill = .12, fillColor = C(0x1a2448);   // night ambient: a zone can be moonlit (Pandora) or dark
  function setFill(f, hex) { fill = f; fillColor = C(hex); }
  let tint = null;                                                        // planet sky tint {top, bot, k, sun}: Mars is butterscotch, not blue
  function setTint(t) { tint = t || null; }
  function setTimeOfDay(h) {
    const ang = (h - 6) / 12 * Math.PI, el = Math.sin(ang), day = THREE.MathUtils.clamp(el * 1.6 + .25, 0, 1), dusk = THREE.MathUtils.clamp(1 - Math.abs(el) * 3.2, 0, 1) * (el > -.25 ? 1 : 0);
    const dir = new THREE.Vector3(Math.cos(ang), Math.max(.06, el), .35).normalize();
    sun.userData.dir = dir; sun.intensity = Math.max(0, el) * 4 + .02; sun.color.copy(lerpC(C(0xff8a4a), C(0xfff2e0), THREE.MathUtils.clamp(el * 2.2, 0, 1)));
    moon.position.copy(dir).multiplyScalar(-100); moon.intensity = (1 - day) * (.35 + (fill - .12));
    hemi.intensity = fill + (.54 - fill) * day; hemi.color.copy(lerpC(fillColor, C(0xcfe3ff), day));
    const top = lerpC(C(0x02040e), C(0x3d7bd6), day), bot = lerpC(lerpC(C(0x0b1226), C(0xbcd8f2), day), C(0xff8f5c), dusk * .75);
    if (tint) { top.lerp(C(tint.top), tint.k * (.35 + .65 * day)); bot.lerp(C(tint.bot), tint.k * (.35 + .65 * day)); if (tint.sun) sun.color.lerp(C(tint.sun), .55); }
    sky.material.uniforms.top.value.copy(top); sky.material.uniforms.bottom.value.copy(bot);
    sky.material.uniforms.sunDir.value.set(Math.cos(ang), el, .35).normalize(); sky.material.uniforms.sunCol.value.copy(sun.color).multiplyScalar(day);
    scene.fog.color.copy(bot); stars.material.opacity = 1 - day; stars.visible = day < .95;
    setNight(1 - day); setEnvIntensity(.1 + .9 * day);
    renderer.toneMappingExposure = .75 + .25 * day;
    if (bloom) bloom.strength = .2 + .35 * (1 - day);
  }
  const snap = new THREE.Vector3();
  function follow(pos) {   // keep the shadow frustum centred on the player; snap to metres to stop shimmering
    snap.set(Math.round(pos.x), Math.round(pos.y), Math.round(pos.z));
    sun.target.position.copy(snap); sun.position.copy(snap).addScaledVector(sun.userData.dir || new THREE.Vector3(0, 1, 0), 140);
    sky.position.copy(camera.position); stars.position.copy(camera.position);
  }
  return {
    sun, setTimeOfDay, setFill, setTint, follow, setFog(n, f) { scene.fog.near = n; scene.fog.far = f; }, hasComposer: () => !!composer,
    render: () => composer ? composer.render() : renderer.render(scene, camera),
    resize(w, h) { if (composer) { composer.setSize(w, h); } },
    // runtime degradation when the frame rate is poor: bloom -> shadows
    degrade() { if (composer) { composer = null; return 'bloom off'; } if (renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; sun.castShadow = false; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); return 'shadows off'; } return null; },
  };
}
