import { api } from './api.js';

let lastEvent = 0, hooks = {}, zoneId = 'aether_city', mapEl = null;
const act = s => (s || '').replace(/_/g, ' ');

export function initUI(h) {
  hooks = h;
  $('#togLeft').on('click', () => $('#leftPanel').toggleClass('open'));
  $('#togRight').on('click', () => $('#rightPanel').prop('hidden', (_, v) => !v));
  $('#ollamaChip').on('click', pollStatus);
  $('#modeBtn').on('click', () => h.setMode($('#modeBtn').text() === 'Explore' ? 'observer' : 'explore'));
  $('[data-mode]').on('click', e => h.setMode($(e.currentTarget).data('mode')));
  $('#todRange').on('input', e => h.setTime(+e.target.value));
  $('#sensRange').on('input', e => h.setSens(+e.target.value));
  $('#mapBtn').on('click', () => h.openMap());
  $('#govBtn').on('click', () => h.openGov('dash'));
  $('#obsBtn').on('click', () => h.openGov('observer'));
  $('#followClock').on('change', e => h.followClock(e.target.checked));
  $('#returnBtn').on('click', () => h.back());
  $('#wmClose').on('click', closeMap);
  $('#infoClose').on('click', hideInfo);
  $(document).on('keydown', e => { if (e.key === 'Escape') closeMap(); });
  setInterval(pollStatus, 6000); pollStatus();
  setInterval(pollEvents, 2000);
}

export function setModeLabel(m) { $('#modeBtn').text(m === 'explore' ? 'Explore' : 'Observer'); $('[data-mode]').removeClass('active').filter(`[data-mode=${m}]`).addClass('active'); }
export function setTodLabel(t) { $('#todRange').val(t); const h = Math.floor(t), m = Math.round((t - h) * 60); $('#todLabel').text(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`); }
export function setClockChip(zc) { $('#clockText').text((zc.isDay ? '☀ ' : '🌙 ') + zc.label.slice(5) + (zc.running ? '' : ' ⏸') + (zc.speed !== 1 ? ' · ' + zc.speed + '×' : '')); $('#clockChip').attr('title', 'Simulated local time. Working hours: ' + (zc.working ? 'yes' : 'no')); }
export function setLocation(name) { $('#locName').text(name || 'Open ground'); }

// ---- loading overlay ----
export function showLoading(msg) { $('#loadMsg').text(msg); $('#loading').stop(true).show().css('opacity', 1); }
export function setLoading(msg) { $('#loadMsg').text(msg); }
export function hideLoading() { $('#loading').fadeOut(350); }

// ---- zone HUD: name, return button, districts with two clearly different travel actions ----
export function setZone(info, zone, h) {
  zoneId = info.id; $('#worldName').text(info.name); $('#zoneChip').text(info.name);
  $('#returnBtn').prop('hidden', info.id === 'aether_city');
  const box = $('#placeList').empty();
  zone.locations.forEach(l => box.append($('<div class="item">').append(
    $('<span>').text(l.name), $('<small>').text(l.kind === 'district' ? 'district' : l.kind),
    $('<div class="d-flex gap-1 mt-1">').append(
      $('<button class="btn btn-sm btn-outline-info py-0" title="Walk there along a route (click-to-move; WASD cancels)">').text('Walk there').on('click', () => h.walk(l)),
      $('<button class="btn btn-sm btn-outline-warning py-0" title="Instant move inside this zone">').text('Fast travel').on('click', () => h.fast(l))))));
  lastEvent = 0; $('#eventList').empty(); pollEvents(true);
}

export function renderAgents(list, openInfo) {
  $('#agentCount').text(list.length);
  const box = $('#agentList').empty();
  list.forEach(a => box.append($('<div class="item">').append(
    $('<span class="badge-act">').text(act(a.state)), $('<b>').css('color', a.color).text(a.name), $('<small>').text(a.role))
    .on('click', () => openInfo(a))));
}

function pollStatus() {
  api('GET', '/api/ollama/status').done(s => {
    $('#ollamaChip .dot').attr('class', 'dot ' + (s.connected ? 'on' : 'off'));
    $('#ollamaText').text(s.connected ? `Ollama · ${s.model_count} models` : 'Ollama offline (click to retry)').attr('title', s.error || s.default_model || '');
    $('#aiBusy').prop('hidden', !(s.active || s.waiting)); $('#aiBusyN').text(s.waiting ? `(+${s.waiting} queued)` : '');
    hooks.onOllama && hooks.onOllama(s.connected);
  }).fail(() => { $('#ollamaChip .dot').attr('class', 'dot off'); $('#ollamaText').text('Server unreachable'); });
}

function pollEvents(first) {
  const z = zoneId;
  api('GET', `/api/world/events?limit=30&zone=${z}` + (lastEvent ? '&after=' + lastEvent : '')).done(evs => {
    if (z !== zoneId) return;
    for (const e of evs) {
      lastEvent = Math.max(lastEvent, e.id);
      $('#eventList').prepend($('<div class="item">').append($('<span>').text(e.message), $('<small>').text(e.created_at + ' · ' + e.type)));
      if (!first) { $('#ticker').text(e.message); if (/agent_(arrived|requested|completed|chat)$|agent_chat$/.test(e.type) || e.type === 'agent_requested_assistance') toast(e.message); }
    }
    $('#eventList .item:gt(59)').remove();
  });
}

export function toast(msg) {
  const t = $('<div class="toast align-items-center text-bg-dark border-info show" role="alert">').append($('<div class="d-flex">').append($('<div class="toast-body">').text(msg)));
  $('#toasts').append(t); setTimeout(() => t.remove(), 5000);
}

// ---- information points (E) ----
export function showInfo(p) { $('#infoTitle').text(p.title); $('#infoText').text(p.text); $('#infoCard').prop('hidden', false); }
export function hideInfo() { $('#infoCard').prop('hidden', true); }

// ---- global world map ----
const PINS = [[24, 58], [66, 36], [48, 80], [80, 70], [30, 24]];
export const mapOpen = () => !$('#worldMap').prop('hidden');
export function closeMap() { $('#worldMap').prop('hidden', true); }
export function openMap(currentId, onTravel) {
  $('#worldMap').prop('hidden', false);
  const pins = $('#wmPins').empty().append('<svg class="wm-lines" viewBox="0 0 100 100" preserveAspectRatio="none"></svg>'), cards = $('#wmCards').empty().append('<div class="text-secondary small">Loading zones…</div>');
  api('GET', '/api/world/zones').done(zs => {
    cards.empty(); const sv = [];
    zs.forEach((z, i) => {
      const [x, y] = PINS[i % PINS.length], here = z.id === currentId, ok = z.status === 'active';
      sv.push([x, y]);
      pins.append($('<button class="wm-pin">').toggleClass('here', here).css({ left: x + '%', top: y + '%' }).append($('<span class="wm-dot">'), $('<span class="wm-name">').text(z.name))
        .on('click', () => $('#wmCard' + i)[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' })));
      const c = $(`<div class="wm-card glass" id="wmCard${i}">`).toggleClass('here', here);
      c.append($('<div class="d-flex align-items-center gap-2">').append($('<h5 class="m-0">').text(z.name),
        $('<span class="badge">').addClass(here ? 'text-bg-success' : z.visited ? 'text-bg-secondary' : 'text-bg-info').text(here ? 'You are here' : z.visited ? 'Visited' : 'New')));
      c.append($('<p class="small text-secondary my-2">').text(z.description));
      c.append($('<div class="small mb-2">').append($('<b>').text('Agents: '), document.createTextNode(z.agents.join(', ') || '—')));
      c.append($('<div class="mb-2">').append(z.districts.map(d => $('<span class="chip me-1 mb-1 d-inline-block">').text(d.name))));
      if (z.visited && z.last_position) c.append($('<div class="small text-secondary mb-2">').text(`Your last position here: ${Math.round(z.last_position.x)}, ${Math.round(z.last_position.z)}`));
      c.append($('<button class="btn btn-sm btn-info">').text(here ? 'Current zone' : z.id === 'aether_city' ? 'Return to Aether City' : 'Travel to ' + z.name).prop('disabled', here || !ok).on('click', () => onTravel(z.id)));
      cards.append(c);
    });
    const lines = pins.find('.wm-lines').empty()[0];
    for (let i = 0; i < sv.length - 1; i++) lines.insertAdjacentHTML('beforeend', `<line x1="${sv[i][0]}" y1="${sv[i][1]}" x2="${sv[i + 1][0]}" y2="${sv[i + 1][1]}" />`);
    lines.innerHTML = lines.innerHTML;
  }).fail(() => cards.text('Could not load zones.'));
}
