// Asset loading with graceful fallback. Nothing here is required: if a file is missing or fails, callers get null
// and use the procedural version. Add GLB buildings by listing them in static/assets.json, e.g. "buildings": {"hq": "/static/models/hq.glb"}.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const QUALITY = {
  high:     { name: 'high', shadows: true, shadowSize: 2048, bloom: true, models: true, dpr: 1.5, fallback: false, detail: 1 },
  medium:   { name: 'medium', shadows: true, shadowSize: 1024, bloom: false, models: true, dpr: 1.25, fallback: false, detail: .75 },
  low:      { name: 'low', shadows: false, shadowSize: 0, bloom: false, models: true, dpr: 1, fallback: false, detail: .5 },
  fallback: { name: 'fallback', shadows: false, shadowSize: 0, bloom: false, models: false, dpr: 1, fallback: true, detail: .5 },
};
export function chooseQuality() {
  const want = new URLSearchParams(location.search).get('q') || (() => { try { return localStorage.getItem('quality'); } catch (e) { return null; } })() || 'high';
  return QUALITY[want] || QUALITY.high;
}
export function saveQuality(n) { try { localStorage.setItem('quality', n); } catch (e) { } }

const loaded = { characters: {}, buildings: {}, ok: false };
export const getCharacter = k => loaded.characters[k] || null;
export const getBuilding = k => loaded.buildings[k] || null;
export const assetsOk = () => loaded.ok;

const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

export async function loadAssets(quality, onProgress = () => { }) {
  if (!quality.models) return loaded;                                   // fallback mode: procedural only
  let manifest = {};
  try { manifest = await (await fetch('/static/assets.json', { cache: 'no-cache' })).json(); } catch (e) { console.warn('assets.json missing - using procedural assets'); }
  const loader = new GLTFLoader(), jobs = [];
  const add = (group, key, url) => jobs.push(timeout(loader.loadAsync(url), 20000).then(g => { loaded[group][key] = g; onProgress(key); })
    .catch(e => console.warn('asset failed (fallback used):', key, e.message)));
  for (const [k, u] of Object.entries(manifest.characters || {})) add('characters', k, u);
  for (const [k, u] of Object.entries(manifest.buildings || {})) add('buildings', k, u);
  await Promise.all(jobs);
  loaded.ok = Object.keys(loaded.characters).length > 0;
  return loaded;
}

// Scale/position a loaded model so it fits a footprint (w x d) and height h, sitting on y=0 and centred on x/z.
export function fitModel(root, w, d, h) {
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = Math.min(w / size.x, d / size.z, h ? h / size.y : 1e9);
  root.scale.multiplyScalar(k); root.position.set(-c.x * k, -box.min.y * k, -c.z * k);
  return root;
}
