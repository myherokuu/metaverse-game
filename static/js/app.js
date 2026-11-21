import * as THREE from 'three';
import { scene } from './world.js';
import { chooseQuality, saveQuality, loadAssets } from './assets.js';
import { opts } from './materials.js';
import { createLighting } from './lighting.js';
import { Player, input, initInput, isTyping } from './player.js';
import { CameraRig } from './camera.js';
import { startAgentPolling, setAgentZone, clearAgents, updateAgents, nearestAgent, agentGesture, npcs } from './agents.js';
import { drawRadar, findPath } from './navigation.js';
import { ZoneManager } from './zones.js';
import * as chat from './chat.js';
import { VehicleManager } from './vehicles.js';
import { borderCrossing, addBorders, NEIGHBORS, ZONE_NAMES, ZONE_BOUNDS } from './borders.js';
import * as ui from './ui.js';
import { api, errMsg } from './api.js';
import { startClock, zoneClock, CivLayer } from './civ.js';
import * as gov from './gov.js';

const canvas = document.getElementById('scene');
const q = chooseQuality();                       // high | medium | low | fallback  (?q=… or Settings)
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !q.bloom });   // bloom path uses an MSAA render target instead
renderer.setPixelRatio(Math.min(devicePixelRatio, q.dpr));
opts.fallback = q.fallback; opts.detail = q.detail; opts.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const camera = new THREE.PerspectiveCamera(60, 1, .1, 900);
const light = createLighting(scene, renderer, camera, q);
const rig = new CameraRig(camera);
const zones = new ZoneManager(), raycaster = new THREE.Raycaster();
let zone = null, zoneInfo = null, player = null, ready = false, traveling = false, civLayer = null, vehicles = null, followClock = true, lastHour = -1, clockT = 0;
let mode = 'explore', tod = 17, liveList = [], suppressSettings = false, curLoc = null, nearest = null, nearInfo = null, marker = null;

function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); light.resize(innerWidth, innerHeight); }
addEventListener('resize', resize); resize();

function setMode(m) { mode = m; rig.setMode(m); ui.setModeLabel(m); if (m === 'observer' && chat.isOpen()) chat.close(); }
function setTime(t, manual) { tod = t; if (manual) { followClock = false; $('#followClock').prop('checked', false); } light.setTimeOfDay(t); ui.setTodLabel(t); }

// ---------- mouse: short click = click-to-move, drag = look, M = pointer-lock mouse-look ----------
function lockPointer() { if (document.pointerLockElement !== canvas && !chat.isOpen()) canvas.requestPointerLock && canvas.requestPointerLock(); }
function unlockPointer() { suppressSettings = true; if (document.pointerLockElement) document.exitPointerLock(); setTimeout(() => suppressSettings = false, 150); }
let drag = null;
canvas.addEventListener('mousedown', e => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now() }; document.activeElement.blur(); $('#clickHint').prop('hidden', true); });
addEventListener('mousemove', e => {
  const locked = document.pointerLockElement === canvas;
  if (drag) drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
  if (locked || drag) rig.rotate(e.movementX, e.movementY);
});
addEventListener('mouseup', e => {
  const d = drag; drag = null;
  if (d && d.moved < 6 && performance.now() - d.t < 350 && e.target === canvas && document.pointerLockElement !== canvas) clickToMove(e.clientX, e.clientY);
});
canvas.addEventListener('wheel', e => { e.preventDefault(); rig.zoom(e.deltaY); }, { passive: false });
$(document).on('hidden.bs.modal hidden.bs.offcanvas', () => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });   // closing a panel returns the keyboard to the game
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && !suppressSettings && !chat.isOpen() && !ui.mapOpen()) bootstrap.Modal.getOrCreateInstance('#settingsModal').show();  // ESC -> settings
});

// ---------- click-to-move: raycast ground -> A* route -> follow; WASD cancels ----------
function clickToMove(cx, cy) {
  if (!ready || mode !== 'explore' || chat.isOpen() || ui.mapOpen() || (vehicles && vehicles.driving)) return;
  raycaster.setFromCamera(new THREE.Vector2(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1), camera);
  const hit = raycaster.intersectObjects(zone.pickTargets(), false)[0];
  if (!hit) return;
  walkTo(hit.point.x, hit.point.z);
}
function walkTo(x, z, label) {
  const path = findPath(zone, player.pos.x, player.pos.z, x, z);
  if (!path) { ui.toast("Can't find a walkable route there."); return false; }
  player.setPath(path); showMarker(path, label); return true;
}
function showMarker(path, label) {
  clearMarker(); const g = new THREE.Group(), end = path[path.length - 1];
  const ring = new THREE.Mesh(new THREE.RingGeometry(.6, .85, 28), new THREE.MeshBasicMaterial({ color: 0x35e0ff, side: THREE.DoubleSide, transparent: true, opacity: .9, depthTest: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(end.x, zone.groundAt(end.x, end.z) + .15, end.z); ring.renderOrder = 10; g.add(ring);
  const pts = [new THREE.Vector3(player.pos.x, player.pos.y + .2, player.pos.z), ...path.map(p => new THREE.Vector3(p.x, zone.groundAt(p.x, p.z) + .2, p.z))];
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x35e0ff, transparent: true, opacity: .55, depthTest: false })); line.renderOrder = 10; g.add(line);
  scene.add(g); marker = g;
}
function clearMarker() { if (marker) { marker.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); scene.remove(marker); marker = null; } }

function openChat(n) { unlockPointer(); chat.open({ id: n.id, name: n.name, role: n.role, state: n.state }); }
initInput(code => {
  if (code === 'KeyE' && mode === 'explore' && ready) { if (nearest) openChat(nearest); else if (nearInfo) ui.showInfo(nearInfo); }   // E also switches agent while chatting
  if (code === 'KeyF' && mode === 'explore' && ready && !chat.isOpen() && !ui.mapOpen()) { if (player.seat) player.standUp(); const m = vehicles && vehicles.toggle(player); if (m) ui.toast(m); }   // GTA-style get in / out
  const EMO = { KeyZ: 'sit', KeyX: 'lie', KeyV: 'sleep', KeyB: 'dance' };   // GTA-style emotes; same key again stands up, B cycles dance styles
  if (EMO[code] && mode === 'explore' && ready && !chat.isOpen() && !ui.mapOpen() && !(vehicles && vehicles.driving) && player.onGround) {
    if (player.seat) player.standUp();                                          // any emote key while seated: stand first
    else if (code === 'KeyZ' && player.emote !== 'sit') {                       // Z next to a bench sits on it, otherwise on the floor
      let best = null, bd = 2.6; for (const s of zone.seats || []) { const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z); if (d < bd) { bd = d; best = s; } }
      if (best) player.sitAt(best, zone.groundAt(best.x, best.z)); else player.setEmote('sit');
    } else player.setEmote(code === 'KeyB' && player.emote === 'dance' ? 'dance2' : EMO[code]);
  }
  if (code === 'KeyO') setMode(mode === 'explore' ? 'observer' : 'explore');
  if (code === 'KeyN') openMap();
  if (code === 'KeyM') { if (document.pointerLockElement === canvas) unlockPointer(); else lockPointer(); }
  if (code === 'Escape') ui.hideInfo();
});
chat.initChat({ onOpen: () => { }, onClose: () => { }, onGesture: agentGesture });

function post(path, body) { return api('POST', path, body); }
function emit(type, message) { post('/api/world/events', { type, message }); }

// ---------- zones ----------
async function enterZone(info, pos, carry = null) {
  ready = false; ui.showLoading(`Loading ${info.name}…`);
  chat.close(); ui.hideInfo(); clearMarker(); clearAgents(); liveList = []; curLoc = null;
  if (player) player.cancelPath();
  zones.unload(); zone = null;
  await new Promise(r => setTimeout(r, 30));                      // let the loading overlay paint before heavy work
  zone = await zones.load(info, { api, progress: ui.setLoading });
  zoneInfo = info; light.setFog(...zone.fog()); light.setTint(zone.cfg && zone.cfg.sky); light.setTimeOfDay(tod);
  setMarsHud(info.id === 'mars');
  { const nf = zone.cfg && zone.cfg.nightFill; light.setFill(nf ? nf[0] : .12, nf ? nf[1] : 0x1a2448); }       // zone-specific moonlight
  if (civLayer) { civLayer.dispose(); civLayer = null; }
  if (vehicles) { vehicles.dispose(); vehicles = null; rig.extra = 0; if (player) player.avatar.visible = true; }
  if (carry) pos = clearSpot(zone, pos);                          // border arrival: nudge off cliffs / water / walls
  addBorders(zone, info.id, scene);
  const y = zone.groundAt(pos.x, pos.z);
  if (!player) player = new Player(scene, { x: pos.x, y, z: pos.z, rot: pos.rot });
  player.teleport(pos.x, y, pos.z, pos.rot || 0);
  rig.yaw = player.heading - Math.PI; camera.position.set(player.pos.x + Math.sin(rig.yaw) * 6, y + 4, player.pos.z + Math.cos(rig.yaw) * 6);
  await zone.preload(player.pos, ui.setLoading);
  ui.setZone(info, zone, { walk: (l) => { const t = zone.targetFor(l); walkTo(t.x, t.z); }, fast: (l) => fastTravel(zone.targetFor(l)), back: () => travelTo('aether_city') });
  civLayer = new CivLayer(zone, info.id, info.id); lastHour = -1; vehicles = new VehicleManager(zone, scene, player.pos, !carry); if (carry) vehicles.carry(player, carry);
  setAgentZone(info.id);
  post('/api/world/position', { x: player.pos.x, y: player.pos.y, z: player.pos.z, rot: player.heading });
  ui.hideLoading(); ready = true;
}
function fastTravel(t) { if (!ready) return; clearMarker(); player.teleport(t.x, zone.groundAt(t.x, t.z), t.z); ui.toast('Fast-traveled within ' + zoneInfo.name); }
function clearSpot(z, p) {
  for (let r = 0; r < 160; r += 6) for (let a = 0; a < (r ? 12 : 1); a++) { const x = p.x + Math.sin(a * .524) * r, zz = p.z + Math.cos(a * .524) * r; if (z.walkable(x, zz)) return { ...p, x, z: zz }; }
  return p;
}
async function travelTo(zoneId, spawn, at, carry) {
  if (traveling || !ready) return; traveling = true; ui.closeMap();
  const prev = zoneInfo, here = { x: player.pos.x, y: player.pos.y, z: player.pos.z, rot: player.heading };
  try {
    const res = await post('/api/world/travel', { zone_id: zoneId, spawn, here, at });
    await enterZone(res.zone, res.position, carry);
    ui.toast(`Welcome to ${res.zone.name}`);
  } catch (x) {
    ui.toast('Travel failed: ' + (x && x.responseJSON ? errMsg(x) : (x && x.message) || 'unknown error'));
    if (!ready && prev) { try { const res = await post('/api/world/travel', { zone_id: prev.id, here }); await enterZone(res.zone, res.position); } catch (e) { /* stays on loading screen, reload page */ } }
  } finally { traveling = false; }
}
// Past the edge of a zone: continue into the neighbour at the matching edge, keeping the vehicle, speed and altitude.
// ---------- Mars life-support monitor (only in the Mars zone) ----------
let marsHud = null, marsT = 0;
function setMarsHud(on) {
  if (!on) { if (marsHud) { marsHud.remove(); marsHud = null; } return; }
  if (!marsHud) marsHud = $('<div id="marsHud" class="glass" style="position:fixed;right:12px;bottom:76px;z-index:20;padding:8px 11px;min-width:200px;border-radius:10px;font-size:12px"></div>').appendTo('body');
  marsT = 0;
}
function pollMars() {
  api('GET', '/api/civilization/mars/status').then(st => {
    if (!marsHud) return;
    const col = v => v < 30 ? '#ff4d4d' : v < 50 ? '#ffb347' : '#2ecc71', box = $('<div>');
    box.append($('<div class="mb-1">').css({ fontWeight: 600 }).text(`Mars Life Support · Sol ${st.sol}`));
    for (const [k, v] of Object.entries(st.levels)) box.append($('<div class="d-flex align-items-center gap-2 mb-1">').append($('<span>').css({ width: 52, textTransform: 'capitalize' }).text(k),
      $('<div>').css({ flex: 1, height: 6, background: '#1b2238', borderRadius: 3 }).append($('<div>').css({ width: v + '%', height: 6, background: col(v), borderRadius: 3 })), $('<span>').css({ width: 32, textAlign: 'right' }).text(v + '%')));
    box.append($('<div class="text-secondary">').text(`${st.population} citizens · ${st.robots} robots · ${st.buildings} buildings`));
    if (st.alerts.length) box.append($('<div>').css({ color: '#ffb347', marginTop: 4 }).text(st.alerts.join(' · ')));
    marsHud.empty().append(box);
  }, () => { });
}
let lastCross = 0;
function crossBorder({ dir, to }) {
  if (performance.now() - lastCross < 6000) return; lastCross = performance.now();   // no retry storm if travel fails
  const dv = vehicles && vehicles.driving, nb = ZONE_BOUNDS[to] || 250, west = dir === 'west', rot = west ? -Math.PI / 2 : Math.PI / 2;
  const at = { x: (west ? 1 : -1) * (nb - 14), y: 0, z: THREE.MathUtils.clamp(player.pos.z, -(nb - 20), nb - 20), rot };
  const carry = dv ? { kind: dv.kind, color: dv.color, heading: rot, speed: dv.speed, throttle: dv.throttle, alt: dv.pos.y - zone.groundAt(dv.pos.x, dv.pos.z) } : null;
  ui.toast(`Crossing the border into ${ZONE_NAMES[to] || to}…`); travelTo(to, undefined, at, carry);
}
function openMap() { if (!ready) return; unlockPointer(); ui.openMap(zoneInfo.id, id => travelTo(id)); }

// ---------- frame loop ----------
const perf = { n: 0, t: 0 };
const angleDiff = (a, b) => { const d = a - b; return Math.atan2(Math.sin(d), Math.cos(d)); };
function loop() {
  const clock = new THREE.Clock(); let acc = 0, acc2 = 0;
  renderer.setAnimationLoop(() => {   // all per-frame work is plain Three.js; jQuery only touches the DOM a few times a second
    const dt = Math.min(clock.getDelta(), .05);
    if (ready) {
      const typing = isTyping();
      const on = mode === 'explore' && !typing && !ui.mapOpen(), dv = vehicles && vehicles.driving;
      if (vehicles) vehicles.update(dt, player, on);
      if (!traveling) { const bc = borderCrossing(zoneInfo.id, zone.bound, player.pos); if (bc) crossBorder(bc); }
      if (!dv) player.update(dt, rig.yaw, zone, on);
      else if (!drag) rig.yaw += angleDiff(dv.heading + Math.PI, rig.yaw) * Math.min(1, dt * 2.2);   // chase camera swings in behind the vehicle
      rig.extra += ((dv ? dv.s.cam : 0) - rig.extra) * Math.min(1, dt * 3);
      rig.update(dt, player.pos, typing ? {} : input, zone.groundAt.bind(zone));
      updateAgents(dt, zone.groundAt.bind(zone), player.pos); zone.update(dt, mode === 'observer' ? camera.position : player.pos); light.follow(player.pos);
      if (civLayer) civLayer.update(dt, player.pos);
      if (marsHud) { marsT -= dt; if (marsT <= 0) { marsT = 6; pollMars(); } }
      clockT -= dt;
      if (clockT <= 0) { clockT = 1; const zc = zoneClock(zoneInfo.id); if (zc) { ui.setClockChip(zc); if (followClock && Math.abs(zc.hour - lastHour) > .02) { lastHour = zc.hour; setTime(zc.hour); } } }   // day/night follows the zone's simulated local time
      if (marker && !player.path) clearMarker();

      acc += dt; acc2 += dt;
      if (acc > .15) { acc = 0;
        nearest = mode === 'explore' && !(vehicles && vehicles.driving) ? nearestAgent(player.pos) : null;
        if (nearest && chat.isOpen() && chat.currentAgent() && chat.currentAgent().id === nearest.id) nearest = null;  // already talking to them
        nearInfo = !nearest && mode === 'explore' ? zone.nearestInfo(player.pos) : null;
        const t = chat.isOpen() && typing ? 'Esc, then E' : 'Press E';
        const dvv = vehicles && vehicles.driving, nv = !dvv && !nearest && !nearInfo && mode === 'explore' && vehicles ? vehicles.nearest(player.pos) : null;
        if (dvv) $('#prompt').prop('hidden', false).text(`${dvv.s.name} · ${Math.round(Math.abs(dvv.speed) * 3.6)} km/h${dvv.s.air ? ' · alt ' + Math.round(dvv.pos.y - zone.groundAt(dvv.pos.x, dvv.pos.z)) + ' m · C descend' + (dvv.kind === 'plane' ? ' · S slow down' : '') : ''} · F to exit`);
        else if (!nearest && !nearInfo && !nv && mode === 'explore' && !player.seat && (zone.seats || []).some(s => Math.hypot(s.x - player.pos.x, s.z - player.pos.z) < 2.6)) $('#prompt').prop('hidden', false).text('Press Z to sit');
        else if (nv) $('#prompt').prop('hidden', false).text(`Press F to drive the ${nv.s.name}`);
        else $('#prompt').prop('hidden', !(nearest || nearInfo)).text(nearest ? `${t} to talk to ${nearest.name}` : nearInfo ? `Press E to read: ${nearInfo.title}` : '');
        if (nearest && nearest.id !== loop.lastNear) emit('player_approached_agent', `Player approached ${nearest.name}`);
        loop.lastNear = nearest ? nearest.id : null;
        if (!nearInfo) ui.hideInfo();
        const loc = zone.locationAt(player.pos.x, player.pos.z), bld = l => l && l.kind !== 'plaza' && l.kind !== 'residential';
        if (loc !== curLoc) {
          if (bld(curLoc)) emit('player_exited_building', `Player left ${curLoc.name}`);
          if (bld(loc)) emit('player_entered_building', `Player entered ${loc.name}`);
          curLoc = loc; ui.setLocation(loc && loc.name);
        }
        drawRadar(document.getElementById('radar'), zone.mapData, player.pos, player.heading, liveList);
      }
      if (acc2 > 2) { acc2 = 0; post('/api/world/position', { x: player.pos.x, y: player.pos.y, z: player.pos.z, rot: player.heading }); }
    }
    light.render();
    perf.n++; perf.t += dt;                         // adaptive quality: drop bloom, then shadows, if the frame rate is poor
    if (perf.t > 4) { const fps = perf.n / perf.t; perf.n = perf.t = 0; if (fps < 22) { const r = light.degrade(); if (r) ui.toast(`Low frame rate (${fps.toFixed(0)} fps): ${r}`); } }
  });
}

$('#qualitySel').val(q.name).on('change', e => { saveQuality(e.target.value); location.href = location.pathname; });
ui.initUI({ setMode, setTime: t => setTime(t, true), followClock: v => { followClock = v; lastHour = -1; }, openGov: tab => gov.open(zoneInfo ? zoneInfo.id : 'aether_city', tab), setSens: v => rig.sens = v, onOllama: chat.setOllamaUp, openMap, back: () => travelTo('aether_city') });
startAgentPolling(list => { liveList = list; ui.renderAgents(list, openChat); });
startClock(); gov.init({ ui });
loadAssets(q, k => $('#loadMsg').text('Loaded ' + k)).then(() => api('GET', '/api/world/player-location')).then(async loc => {
  loop();
  await enterZone(loc.zone, loc.position);
  emit('player_entered_world', 'Player entered the world');
  addEventListener('pagehide', () => fetch('/api/world/events', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ type: 'player_exited_world', message: 'Player left the world' }) }));
  window.__metaverse = { get vehicles() { return vehicles; }, get player() { return player; }, get zone() { return zone; }, rig, npcs, setMode, q, renderer, light, scene, setTime, travelTo, walkTo, camera };   // handy for debugging
}).catch(x => { $('#loadMsg').text('Failed to start: ' + ((x && x.message) || errMsg(x))); console.error(x); });
