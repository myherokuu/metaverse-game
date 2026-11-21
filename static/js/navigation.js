// Collision against the colliders + radar map + "which place am I in".
export function resolveCollisions(pos, radius, colliders, bound) {
  for (const c of colliders) {
    const cx = Math.max(c.x0, Math.min(pos.x, c.x1)), cz = Math.max(c.z0, Math.min(pos.z, c.z1));
    const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-6) { const d = Math.sqrt(d2), k = (radius - d) / d; pos.x += dx * k; pos.z += dz * k; }
      else { // centre inside box: exit through the nearest face
        const o = [pos.x - c.x0, c.x1 - pos.x, pos.z - c.z0, c.z1 - pos.z], i = o.indexOf(Math.min(...o));
        if (i === 0) pos.x = c.x0 - radius; else if (i === 1) pos.x = c.x1 + radius; else if (i === 2) pos.z = c.z0 - radius; else pos.z = c.z1 + radius;
      }
    }
  }
  pos.x = Math.max(-bound, Math.min(bound, pos.x)); pos.z = Math.max(-bound, Math.min(bound, pos.z));
}

// Flat roofs you can stand/land on: colliders may carry a top height h. Returns the highest roof under (x,z) that is at or below y+0.6, else 0.
export function roofAt(cols, x, z, y) {
  let best = 0;
  for (const c of cols) if (c.h !== undefined && c.h <= y + .6 && c.h > best && x > c.x0 + .2 && x < c.x1 - .2 && z > c.z0 + .2 && z < c.z1 - .2) best = c.h;
  return best;
}
// colliders that actually block something at height y (a roof you are already above does not)
export const blockingAt = (cols, y) => cols.filter(c => !c.lid && (c.h === undefined || y < c.h - .3));   // lid = landing surface only (canopies, floating islands): never blocks

export function locationAt(x, z, locs) {
  for (const l of locs) {
    if (l.kind === 'plaza') { if (Math.hypot(x - l.x, z - l.z) < 14) return l; }
    else if (Math.abs(x - l.x) < l.w / 2 + 4 && Math.abs(z - l.z) < l.d / 2 + 4) return l;
  }
  return null;
}

// Radar for any zone. map = { bound, nodes, edges, locations, river?, aether? }
export function drawRadar(canvas, map, playerPos, heading, agents) {
  // Aether City is large: the radar then follows the player over a fixed 130 m radius instead of showing the whole map.
  const g = canvas.getContext('2d'), S = canvas.width, R = map.aether ? 130 : map.bound, cx = map.aether ? playerPos.x : 0, cz = map.aether ? playerPos.z : 0, k = S / (2 * R), X = v => S / 2 + (v - cx) * k, Z = v => S / 2 + (v - cz) * k;
  g.clearRect(0, 0, S, S); g.fillStyle = '#050912'; g.fillRect(0, 0, S, S);
  if (map.river) { g.strokeStyle = '#1d5d80'; g.lineWidth = map.river.w * k; g.lineJoin = 'round'; g.beginPath(); map.river.pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))); g.stroke(); }
  g.strokeStyle = '#3a4a70'; g.lineWidth = Math.max(1.5, 5 * k);
  for (const [a, b] of map.edges) { g.beginPath(); g.moveTo(X(map.nodes[a][0]), Z(map.nodes[a][1])); g.lineTo(X(map.nodes[b][0]), Z(map.nodes[b][1])); g.stroke(); }
  g.font = Math.max(9, (map.aether ? 9 : 36) * k) + 'px sans-serif'; g.textAlign = 'center';
  for (const l of map.locations) {
    if (l.kind === 'plaza') { g.strokeStyle = l.color; g.lineWidth = 1; g.beginPath(); g.arc(X(0), Z(0), 13 * k, 0, 7); g.stroke(); }
    else if (l.kind === 'district') { g.fillStyle = l.color + '30'; g.strokeStyle = l.color; g.lineWidth = 1; g.beginPath(); g.arc(X(l.x), Z(l.z), Math.max(l.w, l.d) / 2 * k, 0, 7); g.fill(); g.stroke(); }
    else { g.fillStyle = l.color + (l.kind === 'residential' ? '33' : '99'); g.fillRect(X(l.x - l.w / 2), Z(l.z - l.d / 2), l.w * k, l.d * k); }
    g.fillStyle = '#fff'; g.fillText(l.name.replace('AI ', '').replace('Advanced ', '').replace('Waterfall & ', ''), X(l.x), Z(l.z) + 3);
  }
  for (const a of agents) { g.fillStyle = a.color; g.beginPath(); g.arc(X(a.x), Z(a.z), 3.2, 0, 7); g.fill(); }
  g.save(); g.translate(X(playerPos.x), Z(playerPos.z)); g.rotate(-heading + Math.PI); g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(-4, 5); g.fill(); g.restore();
}

// ---------- click-to-move: grid A* over zone.walkable, then string-pulling ----------
// Returns [{x,z}...] (excluding the start) or null when no route exists. Never cuts through colliders, cliffs or deep water.
export function findPath(zone, sx, sz, gx, gz) {
  const dist = Math.hypot(gx - sx, gz - sz); if (dist < 1.2) return [{ x: gx, z: gz }];
  const auto = Math.min(6, Math.max(1.5, dist / 70));
  // coarse grid first (fast); long routes that must squeeze over a bridge retry with finer cells
  return search(zone, sx, sz, gx, gz, auto) || (auto > 3 ? search(zone, sx, sz, gx, gz, 3) : null) || (auto > 2 ? search(zone, sx, sz, gx, gz, 2) : null);
}
function search(zone, sx, sz, gx, gz, cs) {
  const pad = 36, B = zone.bound - 3;
  const minx = Math.max(-B, Math.min(sx, gx) - pad), minz = Math.max(-B, Math.min(sz, gz) - pad), maxx = Math.min(B, Math.max(sx, gx) + pad), maxz = Math.min(B, Math.max(sz, gz) + pad);
  const W = Math.ceil((maxx - minx) / cs) + 1, H = Math.ceil((maxz - minz) / cs) + 1, N = W * H;
  const cx = i => minx + (i % W) * cs, cz = i => minz + Math.floor(i / W) * cs, cell = (x, z) => Math.max(0, Math.min(H - 1, Math.round((z - minz) / cs))) * W + Math.max(0, Math.min(W - 1, Math.round((x - minx) / cs)));
  const walk = new Int8Array(N), ok = i => walk[i] ? walk[i] === 1 : (walk[i] = zone.walkable(cx(i), cz(i)) ? 1 : 2) === 1;
  const nearest = (x, z) => {                                   // closest walkable cell to a point (goal may be on a wall)
    const c0 = cell(x, z); if (ok(c0)) return c0;
    for (let r = 1; r <= 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const i = c0 % W + di, j = Math.floor(c0 / W) + dj; if (i < 0 || j < 0 || i >= W || j >= H) continue; if (ok(j * W + i)) return j * W + i; }
    return -1;
  };
  const start = cell(sx, sz), goal = nearest(gx, gz); if (goal < 0) return null;
  const g = new Float32Array(N).fill(1e9), prev = new Int32Array(N).fill(-1), closed = new Uint8Array(N), heap = [];
  const hh = i => { const dx = Math.abs(cx(i) - cx(goal)), dz = Math.abs(cz(i) - cz(goal)); return (Math.max(dx, dz) + .414 * Math.min(dx, dz)); };
  const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (; ;) { let l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  g[start] = 0; push(hh(start), start); let iter = 0;
  while (heap.length && iter++ < 60000) {
    const [, i] = pop(); if (closed[i]) continue; closed[i] = 1; if (i === goal) break;
    const ci = i % W, cj = Math.floor(i / W);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni; if (closed[n] || !ok(n)) continue; if (di && dj && !(ok(cj * W + ni) && ok(nj * W + ci))) continue;   // no corner cutting
      const slope = Math.abs(zone.groundAt(cx(n), cz(n)) - zone.groundAt(cx(i), cz(i))), ng = g[i] + (di && dj ? 1.414 : 1) * cs + slope * 3;
      if (ng < g[n]) { g[n] = ng; prev[n] = i; push(ng + hh(n), n); }
    }
  }
  if (g[goal] >= 1e9) return null;
  let pts = []; for (let i = goal; i !== -1; i = prev[i]) pts.push({ x: cx(i), z: cz(i) }); pts.reverse();
  pts[pts.length - 1] = zone.walkable(gx, gz) ? { x: gx, z: gz } : pts[pts.length - 1];
  const clear = (a, b) => { const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .8); for (let k = 1; k < n; k++) { const t = k / n; if (!zone.walkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false; } return true; };
  const out = [], cur = { x: sx, z: sz }; let i = 0;                    // string pulling: skip waypoints that have a clear straight line
  while (i < pts.length) { let j = pts.length - 1; while (j > i && !clear(cur, pts[j])) j--; out.push(pts[j]); cur.x = pts[j].x; cur.z = pts[j].z; i = j + 1; }
  return out;
}
