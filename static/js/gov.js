// Government / civilization interface: dashboard, development (parcels + projects), finance, civilization, observer map.
// All dynamic text is inserted with .text(). Write actions need the admin token (kept in sessionStorage for this tab only).
import { api, errMsg } from './api.js';
import { zoneClock, clockSnap, syncClock } from './civ.js';

let ui = null, zoneId = 'aether_city', gids = {}, timer = null, tab = 'dash', govs = [], mapCache = {}, sel = null, obsZone = 'aether_city';
const $m = () => $('#govModal');
const tok = () => $('#govToken').val().trim();
const adm = (m, u, b) => api(m, u, b, tok()).fail(x => ui.toast(errMsg(x)));
const cr = (minor, cur) => `${cur || ''} ${Math.round(minor / 100).toLocaleString()}`.trim();
const el = (tag, cls, text) => { const e = $('<' + tag + '>'); if (cls) e.addClass(cls); if (text !== undefined) e.text(text); return e; };
const kv = (k, v) => el('div', 'd-flex justify-content-between small border-bottom border-secondary py-1').append(el('span', 'text-secondary', k), el('span', '', v));
const card = (title, big, sub) => el('div', 'col-6 col-md-3').append(el('div', 'glass p-2 h-100').append(el('div', 'small text-secondary', title), el('div', 'fs-5 fw-bold', big), sub ? el('div', 'small text-secondary', sub) : ''));
const bar = (pct, cls) => el('div', 'progress').css('height', '8px').append(el('div', 'progress-bar ' + (cls || '')).css('width', Math.min(100, pct) + '%'));
const STATUS_COL = { vacant: '#3a4a70', reserved: '#e0b020', under_construction: '#ff8c1a', developed: '#2ecc71' };

export function init(h) {
  ui = h.ui;
  $('#govToken').val(sessionStorage.getItem('adm') || '').on('change', e => sessionStorage.setItem('adm', e.target.value));
  $('#govTabs a').on('shown.bs.tab', e => { tab = $(e.target).data('tab'); load(); });
  $m().on('hidden.bs.modal', () => { clearInterval(timer); timer = null; });
  $('#obsCanvas').on('click', e => pick(e));
}

export function open(zid, t) {
  zoneId = zid; obsZone = zid; tab = t || 'dash';
  api('GET', '/api/civilization/governments').done(gs => {
    govs = gs; gs.forEach(g => gids[g.zone_id] = g.id);
    const sw = $('#govZoneSwitch').empty();
    gs.forEach(g => sw.append(el('button', 'btn btn-outline-info' + (g.zone_id === zoneId ? ' active' : ''), g.name).on('click', ev => { zoneId = g.zone_id; obsZone = g.zone_id; sw.find('.btn').removeClass('active'); $(ev.currentTarget).addClass('active'); load(); })));
    $('#govTabs a[data-tab=' + tab + ']').tab('show');
    bootstrap.Modal.getOrCreateInstance('#govModal').show(); load();
    clearInterval(timer); timer = setInterval(load, 3500);
  });
}

function load() {
  const gid = gids[zoneId]; if (!gid || !$m().hasClass('show')) return;
  syncClock();
  if (tab === 'dash') api('GET', `/api/civilization/governments/${gid}`).done(d => renderDash(d));
  if (tab === 'dev') api('GET', `/api/civilization/governments/${gid}`).done(d => renderDev(d));
  if (tab === 'fin') $.when(api('GET', `/api/civilization/governments/${gid}/finance`), api('GET', `/api/civilization/governments/${gid}/transactions?limit=25`), api('GET', `/api/civilization/trade`)).done((f, t, tr) => renderFin(f, t, tr));
  if (tab === 'civ') api('GET', `/api/civilization/zones/${zoneId}/civilization`).done(d => renderCiv(d));
  if (tab === 'observer') loadObserver();
}

// ---------------- Dashboard ----------------
function renderDash(d) {
  const g = d.government, f = d.finance, c = g.currency_code, root = $('#gDash').empty();
  $('#govTitle').text(g.name + ' — ' + g.gov_type);
  root.append(el('div', 'd-flex flex-wrap align-items-center gap-3 mb-3').append(
    el('div', '', '').append(el('div', 'fs-5', g.leader_title + (d.leader ? ': ' + d.leader.name : '')), el('div', 'small text-secondary', g.economy + ' · currency ' + g.currency_name + ' (' + c + ') · simulated')),
    el('div', 'ms-auto d-flex gap-2 align-items-center').append(el('span', 'small text-secondary', 'Autonomy'),
      $('<select class="form-select form-select-sm w-auto">').append(['manual', 'semi', 'auto'].map(m => $('<option>').val(m).text({ manual: 'Manual – every project needs approval', semi: 'Semi-autonomous (default)', auto: 'Autonomous – within limits' }[m]))).val(g.autonomy)
        .on('change', e => adm('POST', `/api/civilization/governments/${g.id}/autonomy`, { mode: e.target.value }).done(() => ui.toast('Autonomy set to ' + e.target.value))),
      el('button', 'btn btn-sm btn-outline-warning', g.status === 'active' ? 'Pause government' : 'Resume').on('click', () => adm('POST', `/api/civilization/governments/${g.id}/status`, { status: g.status === 'active' ? 'paused' : 'active' }).done(load)))));
  root.append(el('div', 'row g-2 mb-3').append(
    card('Local time', d.clock ? d.clock.local_time : '—', d.clock ? (d.clock.is_day ? 'Day' : 'Night') + (d.clock.working_hours ? ' · working hours' : ' · off hours') : ''),
    card('Population (simulated citizens)', d.population, `housing ${d.housing_capacity}`), card('Employment', Math.round(d.employment_rate * 100) + '%', `jobs capacity ${d.jobs_capacity}`),
    card('Treasury', cr(f.treasury_minor, c), `escrow ${cr(f.escrow_minor, c)}`), card('Revenue this month', cr(f.revenue_minor, c)), card('Expenses this month', cr(f.expenses_minor, c)),
    card('Buildings completed', d.buildings_completed), card('Active projects', d.initiatives.filter(p => ['active', 'approved'].includes(p.status)).length)));
  const dep = el('table', 'table table-sm align-middle').append(el('thead').append(el('tr').append(['Department', 'Head (in-world agent)', 'Doing now', 'Sub-agents'].map(t => el('th', '', t)))));
  const tb = el('tbody'); d.departments.forEach(x => tb.append(el('tr').append(el('td', '', x.name), el('td', '', x.head ? x.head.name + ' — ' + x.head.role : '—'), el('td', '', x.head ? x.head.activity.replace(/_/g, ' ') : ''), el('td', 'small', x.sub_agents.map(s => s.name).join(', ') || '—'))));
  root.append(el('h6', '', 'Departments'), dep.append(tb));
  root.append(el('h6', 'mt-3', 'Needs identified by the Development Ministry'), d.needs.length ? el('ul', 'small').append(d.needs.map(n => el('li', '', n.kind + ' — ' + n.reason))) : el('div', 'small text-secondary', 'No urgent needs.'));
  root.append(el('h6', 'mt-3', 'Current initiatives'), projTable(d.initiatives, c, false));
}

function projTable(list, cur, withActions) {
  const t = el('table', 'table table-sm align-middle small').append(el('thead').append(el('tr').append(['Project', 'Parcel', 'Cost', 'Stage', 'Progress', 'Status', 'Contractor', withActions ? '' : ''].map(x => el('th', '', x)))));
  const b = el('tbody');
  list.forEach(p => {
    const tr = el('tr').append(el('td', '', p.name).attr('title', p.rationale || ''), el('td', '', p.parcel ? p.parcel.code : ''), el('td', '', cr(p.estimated_cost_minor, cur)), el('td', '', p.stage),
      el('td', '').css('min-width', '90px').append(bar(p.progress, p.status === 'blocked' ? 'bg-danger' : '')), el('td', '', p.status.replace(/_/g, ' ') + (p.blocked_reason ? ' (' + p.blocked_reason + ')' : '')), el('td', '', p.contractor || '—'));
    if (withActions) {
      const a = el('td', 'text-nowrap');
      if (['awaiting_approval', 'awaiting_budget'].includes(p.status)) a.append(el('button', 'btn btn-sm btn-success py-0 me-1', 'Approve').on('click', () => adm('POST', `/api/civilization/projects/${p.id}/approve`).done(() => { ui.toast('Approved'); load(); })),
        el('button', 'btn btn-sm btn-outline-danger py-0 me-1', 'Reject').on('click', () => adm('POST', `/api/civilization/projects/${p.id}/reject`, { reason: 'rejected by user' }).done(load)));
      if (['awaiting_approval', 'awaiting_budget', 'approved', 'active', 'blocked'].includes(p.status)) a.append(el('button', 'btn btn-sm btn-outline-warning py-0', 'Cancel').on('click', () => { if (confirm('Cancel this project and release the unspent funds?')) adm('POST', `/api/civilization/projects/${p.id}/cancel`).done(load); }));
      tr.append(a);
    }
    b.append(tr);
  });
  return t.append(b);
}

// ---------------- Development ----------------
function drawParcels(canvas, parcels, w, h) {
  const g = canvas.getContext('2d'); canvas.width = w; canvas.height = h; g.fillStyle = '#060b18'; g.fillRect(0, 0, w, h);
  if (!parcels.length) return null;
  const x0 = Math.min(...parcels.map(p => p.x0)) - 10, x1 = Math.max(...parcels.map(p => p.x1)) + 10, z0 = Math.min(...parcels.map(p => p.z0)) - 10, z1 = Math.max(...parcels.map(p => p.z1)) + 10, k = Math.min(w / (x1 - x0), h / (z1 - z0));
  const X = v => (v - x0) * k, Z = v => (v - z0) * k; g.font = '11px sans-serif'; g.textAlign = 'center';
  parcels.forEach(p => {
    g.fillStyle = STATUS_COL[p.status] + (p.status === 'vacant' ? '88' : 'cc'); g.fillRect(X(p.x0), Z(p.z0), (p.x1 - p.x0) * k, (p.z1 - p.z0) * k);
    g.strokeStyle = p.permission === 'approved' ? '#35e0ff' : '#ff5c6c'; g.lineWidth = p.permission === 'approved' ? 1 : 2; g.strokeRect(X(p.x0), Z(p.z0), (p.x1 - p.x0) * k, (p.z1 - p.z0) * k);
    g.fillStyle = '#fff'; g.fillText(p.code, X((p.x0 + p.x1) / 2), Z((p.z0 + p.z1) / 2) - 2); g.fillStyle = '#cde'; g.fillText(p.current_building || p.classification, X((p.x0 + p.x1) / 2), Z((p.z0 + p.z1) / 2) + 11);
  });
  return { X, Z, k, x0, z0 };
}
function renderDev(d) {
  const root = $('#gDev').empty(), c = d.government.currency_code;
  root.append(el('div', 'row g-3').append(
    el('div', 'col-lg-5').append(el('h6', '', 'Land ownership map — ' + d.government.name), $('<canvas id="parcelCanvas" class="w-100 border border-secondary rounded">'),
      el('div', 'small text-secondary mt-1', 'Grey vacant · yellow reserved · orange under construction · green developed · red outline = restricted land'),
      el('h6', 'mt-3', 'Propose a project (administrator)'), propForm(d),
      el('h6', 'mt-3', 'Expand the map: annex 6 new parcels (administrator)'), expandForm(d),
      el('h6', 'mt-3', 'Build a connected road (administrator)'), roadForm(d)),
    el('div', 'col-lg-7').append(el('h6', '', 'Projects and contractor assignments'), projTable(d.initiatives, c, true),
      el('h6', 'mt-3', 'Contractors with a permit for this zone'), el('div', 'small').append(d.contractors.map(k => kv(k.name + (k.is_private ? ' (private)' : ' (state)'), `${k.workers} workers · skill ${k.skill} · rating ${k.rating}`))))));
  drawParcels(document.getElementById('parcelCanvas'), d.parcels, 520, 340);
}
function expandForm(d) {
  const f = el('div', 'd-flex gap-2 flex-wrap align-items-center'), dirs = $('<select class="form-select form-select-sm w-auto">').append(['east', 'west', 'north', 'south'].map(x => $('<option>').val(x).text(x)));
  return f.append(dirs, el('button', 'btn btn-sm btn-info', 'Annex land').on('click', () => adm('POST', `/api/civilization/governments/${d.government.id}/expand`, { direction: dirs.val() }).done(r => { ui.toast('Annexed ' + r.parcels.join(', ')); load(); })),
    el('span', 'small text-secondary', 'Pays for land from the construction budget; new parcels can then be developed above.'));
}
function roadForm(d) {
  const f = el('div', 'd-flex gap-2 flex-wrap align-items-center'), from = $('<select class="form-select form-select-sm w-auto">'), dirs = $('<select class="form-select form-select-sm w-auto">').append(['east', 'west', 'north', 'south'].map(x => $('<option>').val(x).text(x)));
  const len = $('<select class="form-select form-select-sm w-auto">').append([40, 60, 80, 100, 150, 200].map(x => $('<option>').val(x).text(x + ' m'))), cost = el('span', 'small text-secondary', '');
  api('GET', `/api/civilization/governments/${d.government.id}/road_options`).done(o => {
    from.append(o.nodes.map(n => $('<option>').val(n.key).text(`${n.key} (${n.x}, ${n.z})`)));
    const upd = () => cost.text(`≈ ${(len.val() * o.cost_per_m).toLocaleString()} ${d.government.currency_code || ''}`); len.on('change', upd); upd();
  });
  return f.append(from, dirs, len, el('button', 'btn btn-sm btn-info', 'Propose road').on('click', () => adm('POST', `/api/civilization/governments/${d.government.id}/road`, { from: from.val(), direction: dirs.val(), length: +len.val() }).done(r => { ui.toast('Road proposal: ' + r.status.replace(/_/g, ' ')); load(); })), cost);
}
function propForm(d) {
  const kinds = ['house', 'apartment', 'office', 'workshop', 'clinic', 'research_lab'], vac = d.parcels.filter(p => p.status === 'vacant' && p.permission === 'approved' && !/^RD-/.test(p.code));
  const f = el('div', 'd-flex gap-2 flex-wrap'), ks = $('<select class="form-select form-select-sm w-auto">').append(kinds.map(k => $('<option>').val(k).text(k.replace('_', ' ')))), ps = $('<select class="form-select form-select-sm w-auto">').append(vac.map(p => $('<option>').val(p.code).text(p.code + ' · ' + p.classification)));
  return f.append(ks, ps, el('button', 'btn btn-sm btn-info', 'Propose').on('click', () => adm('POST', `/api/civilization/governments/${d.government.id}/propose`, { kind: ks.val(), parcel: ps.val() }).done(r => { ui.toast('Proposal: ' + r.status.replace(/_/g, ' ')); load(); })));
}

// ---------------- Finance ----------------
function renderFin(f, txns, trade) {
  const root = $('#gFin').empty(), c = f.currency;
  root.append(el('div', 'row g-2 mb-3').append(card('Treasury', cr(f.treasury_minor, c)), card('Project escrow (reserved)', cr(f.escrow_minor, c)), card('Revenue · ' + f.period, cr(f.revenue_minor, c)), card('Expenses · ' + f.period, cr(f.expenses_minor, c))));
  const split = (title, obj, col) => el('div', 'col-md-6').append(el('h6', '', title), Object.keys(obj).length ? Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => el('div', 'small mb-1').append(el('div', 'd-flex justify-content-between').append(el('span', '', k.replace(/_/g, ' ')), el('span', '', cr(v, c))), bar(v / Math.max(...Object.values(obj)) * 100, col))) : el('div', 'small text-secondary', 'Nothing yet'));
  root.append(el('div', 'row g-3 mb-3').append(split('Revenue by source', f.revenue_by_source, 'bg-success'), split('Expenses by category', f.expenses_by_category, 'bg-warning')));
  const bt = el('table', 'table table-sm small').append(el('thead').append(el('tr').append(['Budget category', 'Allocated', 'Committed', 'Spent', 'Free'].map(x => el('th', '', x)))));
  bt.append(el('tbody').append(f.budgets.map(b => el('tr').append(el('td', '', b.category.replace(/_/g, ' ')), el('td', '', cr(b.allocated_minor, c)), el('td', '', cr(b.committed_minor, c)), el('td', '', cr(b.spent_minor, c)), el('td', '', cr(b.allocated_minor - b.committed_minor - b.spent_minor, c))))));
  root.append(el('h6', '', 'Budget (this fiscal period)'), bt, el('h6', 'mt-3', 'Revenue vs expenditure by fiscal period'), $('<canvas id="trendCanvas" class="w-100 border border-secondary rounded" height="150">'));
  trend(document.getElementById('trendCanvas'), f.history);
  const tt = el('table', 'table table-sm small align-middle').append(el('thead').append(el('tr').append(['#', 'Sim time', 'Type', 'Memo', 'Amount', ''].map(x => el('th', '', x)))));
  tt.append(el('tbody').append(txns.map(t => { const amt = t.lines.reduce((s, l) => s + l.debit_minor, 0); return el('tr').toggleClass('text-decoration-line-through', t.status === 'reversed').append(el('td', '', t.id), el('td', '', t.local_time), el('td', '', t.kind), el('td', '', t.memo).attr('title', t.lines.map(l => (l.debit_minor ? 'Dr ' : 'Cr ') + l.name + ' ' + (l.debit_minor || l.credit_minor) / 100).join('\n')), el('td', '', cr(amt, c)),
    el('td', '').append(t.status === 'posted' && !t.reversed_of ? el('button', 'btn btn-sm btn-outline-secondary py-0', 'Reverse').on('click', () => { if (confirm('Reverse transaction #' + t.id + '?')) adm('POST', `/api/civilization/transactions/${t.id}/reverse`, { reason: 'administrator reversal' }).done(() => { ui.toast('Reversed'); load(); }); }) : '')); })));
  root.append(el('h6', 'mt-3', 'Recent journal entries (double-entry ledger)'), tt);
  root.append(el('h6', 'mt-3', 'Intergovernmental trade agreements'), el('div', 'small').append(trade.agreements.map(a => kv(`${a.seller} → ${a.buyer}: ${a.quantity} × ${a.resource}`, `${Math.round(a.unit_price_minor / 100).toLocaleString()} each every ${a.period_days} days (${a.status})`))));
}
function trend(cv, hist) {
  const g = cv.getContext('2d'), W = cv.width = cv.clientWidth || 600, H = cv.height; g.fillStyle = '#060b18'; g.fillRect(0, 0, W, H);
  if (!hist.length) return; const mx = Math.max(1, ...hist.map(h => Math.max(h.rev, h.exp))), bw = W / hist.length;
  hist.forEach((h, i) => { g.fillStyle = '#2ecc71'; g.fillRect(i * bw + 6, H - 18 - (H - 30) * h.rev / mx, bw / 2 - 8, (H - 30) * h.rev / mx); g.fillStyle = '#ffb347'; g.fillRect(i * bw + bw / 2, H - 18 - (H - 30) * h.exp / mx, bw / 2 - 8, (H - 30) * h.exp / mx); g.fillStyle = '#cde'; g.font = '10px sans-serif'; g.fillText(h.label, i * bw + 6, H - 5); });
  g.fillStyle = '#2ecc71'; g.fillText('■ revenue', 8, 12); g.fillStyle = '#ffb347'; g.fillText('■ expenses', 70, 12);
}

// ---------------- Civilization ----------------
function renderCiv(d) {
  const root = $('#gCiv').empty(), zc = zoneClock(zoneId), snap = clockSnap();
  root.append(el('div', 'row g-2 mb-3').append(card('Local date & time', zc ? zc.label : d.clock.local_time, zc ? (zc.isDay ? 'Day' : 'Night') + (zc.working ? ' · working hours' : '') : ''), card('Population', d.population), card('Employment', Math.round(d.employment_rate * 100) + '%'),
    card('Public services', `${d.public_services.clinics} clinics · ${d.public_services.research_labs} labs`)));
  root.append(el('div', 'row g-3').append(
    el('div', 'col-md-4').append(el('h6', '', 'Citizen activities now'), Object.entries(d.activities).map(([k, v]) => kv(k.replace(/_/g, ' '), v)),
      el('h6', 'mt-3', 'Zone timezone (administrator)'), el('div', 'input-group input-group-sm').append($('<input type="number" step="0.5" class="form-control" id="tzIn">').val(d.clock.tz_offset_min / 60), el('span', 'input-group-text', 'hours from base'),
        el('button', 'btn btn-info', 'Set').on('click', () => adm('POST', '/api/civilization/clock', { zone: { id: zoneId, tz_offset_min: Math.round(parseFloat($('#tzIn').val()) * 60) } }).done(() => { ui.toast('Timezone updated'); load(); })))),
    el('div', 'col-md-4').append(el('h6', '', 'Government agents'), d.agents.map(a => kv(a.name + ' — ' + a.role, a.activity.replace(/_/g, ' ')))),
    el('div', 'col-md-4').append(el('h6', '', 'Government events'), el('div', 'small').css({ maxHeight: '260px', overflow: 'auto' }).append(d.events.map(e => el('div', 'border-bottom border-secondary py-1', '').append(el('span', 'text-secondary', zoneLocal(e.sim_ts) + ' '), document.createTextNode(e.message)))))));
}
function zoneLocal(ts) { const z = clockSnap() && clockSnap().zones.find(x => x.zone_id === zoneId); return z ? zoneClockFmt(ts + z.tz_offset_min * 60) : ''; }
function zoneClockFmt(l) { const d = Math.floor(l / 86400), s = l % 86400, p = n => String(n).padStart(2, '0'); return `${p(d % 30 + 1)}/${p(Math.floor((d % 360) / 30) + 1)} ${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}`; }

// ---------------- Civilization Observer (map of the whole world) ----------------
function loadObserver() {
  const snap = clockSnap(), ctl = $('#obsClock').empty();
  if (snap) {
    ctl.append(el('span', 'small text-secondary me-2', 'Simulation speed'), snap.speeds.map(s => el('button', 'btn btn-sm ' + (snap.speed === s ? 'btn-info' : 'btn-outline-info') + ' me-1', s + '×').on('click', () => adm('POST', '/api/civilization/clock', { speed: s }).done(() => { syncClock().then(load); }))),
      el('button', 'btn btn-sm btn-outline-warning ms-2', snap.running ? '⏸ Pause world' : '▶ Resume').on('click', () => adm('POST', '/api/civilization/clock', { running: !snap.running }).done(() => { syncClock().then(load); })));
    snap.zones.forEach(z => ctl.append(el('span', 'chip ms-2', z.zone_id.replace('_', ' ') + ' ' + (z.is_day ? '☀' : '🌙') + ' ' + z.local_time.slice(11))));
  }
  const sw = $('#obsZones').empty(); govs.forEach(g => sw.append(el('button', 'btn btn-sm ' + (g.zone_id === obsZone ? 'btn-info' : 'btn-outline-info') + ' me-1', g.name).on('click', () => { obsZone = g.zone_id; sel = null; loadObserver(); })));
  const z = obsZone, getMap = mapCache[z] ? $.Deferred().resolve(mapCache[z]) : api('GET', `/api/world/zones/${z}/map`).done(m => mapCache[z] = m);
  $.when(getMap, api('GET', `/api/civilization/zones/${z}/parcels`), api('GET', `/api/civilization/zones/${z}/sites`), api('GET', `/api/civilization/zones/${z}/citizens`)).done((m, parcels, sites, cits) => drawObserver(m, parcels, sites, cits));
}
let obsView = null;
function drawObserver(m, parcels, sites, cits) {
  const cv = document.getElementById('obsCanvas'), g = cv.getContext('2d'), W = cv.width = cv.clientWidth || 900, H = cv.height = 540, b = m.bound, k = Math.min(W, H) / (2 * b) * .98, X = v => W / 2 + v * k, Z = v => H / 2 + v * k;
  g.fillStyle = '#050912'; g.fillRect(0, 0, W, H); g.strokeStyle = 'rgba(53,224,255,.08)'; g.lineWidth = 1;
  for (let v = -b; v <= b; v += 50) { g.beginPath(); g.moveTo(X(v), Z(-b)); g.lineTo(X(v), Z(b)); g.moveTo(X(-b), Z(v)); g.lineTo(X(b), Z(v)); g.stroke(); }
  if (m.river) { g.strokeStyle = '#1d5d80'; g.lineWidth = m.river.w * k; g.lineJoin = 'round'; g.beginPath(); m.river.pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))); g.stroke(); }
  g.strokeStyle = '#3a4a70'; g.lineWidth = Math.max(1.5, 5 * k); m.edges.forEach(([a, c]) => { g.beginPath(); g.moveTo(X(m.nodes[a][0]), Z(m.nodes[a][1])); g.lineTo(X(m.nodes[c][0]), Z(m.nodes[c][1])); g.stroke(); });
  g.textAlign = 'center'; g.font = '12px sans-serif';
  m.locations.forEach(l => { if (l.kind === 'plaza') return; g.fillStyle = l.color + (l.kind === 'district' ? '22' : '66'); g.strokeStyle = l.color; g.lineWidth = 1; if (l.kind === 'district') { g.beginPath(); g.arc(X(l.x), Z(l.z), Math.max(l.w, l.d) / 2 * k, 0, 7); g.fill(); g.stroke(); } else g.fillRect(X(l.x - l.w / 2), Z(l.z - l.d / 2), l.w * k, l.d * k); g.fillStyle = '#9fb4e0'; g.fillText(l.name, X(l.x), Z(l.z) + 4); });
  const sp = Object.fromEntries(sites.map(s => [s.pad.join(), s]));
  parcels.forEach(p => { const s = sp[[p.x0, p.x1, p.z0, p.z1].join()]; g.fillStyle = STATUS_COL[p.status] + 'dd'; g.fillRect(X(p.x0), Z(p.z0), (p.x1 - p.x0) * k, (p.z1 - p.z0) * k); g.strokeStyle = p === sel ? '#fff' : p.permission === 'approved' ? '#35e0ff' : '#ff5c6c'; g.lineWidth = p === sel ? 3 : 1; g.strokeRect(X(p.x0), Z(p.z0), (p.x1 - p.x0) * k, (p.z1 - p.z0) * k);
    if (s) { g.fillStyle = '#000a'; g.fillRect(X(p.x0), Z(p.z1) - 4, (p.x1 - p.x0) * k, 4); g.fillStyle = '#ffd24a'; g.fillRect(X(p.x0), Z(p.z1) - 4, (p.x1 - p.x0) * k * s.progress / 100, 4); } });
  cits.filter(c => c.visible).forEach(c => { g.fillStyle = `hsl(${c.color % 360},60%,60%)`; g.beginPath(); g.arc(X(c.x), Z(c.z), 2.2, 0, 7); g.fill(); });
  obsView = { X, Z, k, parcels, sites };
  $('#obsInfo').empty().append(sel ? parcelInfo(sel, sites.find(s => s.pad.join() === [sel.x0, sel.x1, sel.z0, sel.z1].join())) : el('div', 'small text-secondary', `Click a parcel. ${cits.filter(c => c.visible).length} of ${cits.length} citizens are outdoors · ${sites.length} construction site(s) · ${parcels.filter(p => p.status === 'developed').length} developed parcels.`));
}
function parcelInfo(p, s) { return el('div', 'small').append(el('b', '', p.code + ' · ' + p.classification), kv('Permission', p.permission), kv('Status', p.status.replace(/_/g, ' ')), kv('Building', p.current_building || '—'), kv('Land value', Math.round(p.land_value_minor / 100).toLocaleString()), s ? kv('Construction', `${s.name}: ${s.stage} ${s.progress}%`) : ''); }
function pick(e) {
  if (!obsView) return; const r = e.target.getBoundingClientRect(), x = (e.clientX - r.left) * (e.target.width / r.width), y = (e.clientY - r.top) * (e.target.height / r.height);
  sel = obsView.parcels.find(p => x >= obsView.X(p.x0) && x <= obsView.X(p.x1) && y >= obsView.Z(p.z0) && y <= obsView.Z(p.z1)) || null; loadObserver();
}
