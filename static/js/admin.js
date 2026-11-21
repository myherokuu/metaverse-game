// Admin dashboard (classic script). All dynamic text goes through .text().
const tok = () => $('#token').val().trim();
const call = (m, u, b) => $.ajax({ url: u, method: m, dataType: 'json', contentType: 'application/json', data: b === undefined ? undefined : JSON.stringify(b), headers: { 'X-Admin-Token': tok() } }).then(r => r.data);
const fail = x => { $('#alert').text((x.responseJSON && x.responseJSON.error.message) || 'Request failed').prop('hidden', false); setTimeout(() => $('#alert').prop('hidden', true), 5000); };
let agents = [], models = [], locs = [];

function fillSelects() {
  const opts = (sel, list, blank) => { const s = $(sel).empty(); if (blank !== undefined) s.append($('<option>').val('').text(blank)); list.forEach(v => s.append($('<option>').val(v[0]).text(v[1]))); };
  opts('#f_model', models.map(m => [m.name, m.name]), '(default model)'); opts('#c_model', models.map(m => [m.name, m.name]));
  opts('#f_home', locs.map(l => [l.key, l.zone + ' · ' + l.name]));
  opts('#monSel', agents.map(a => [a.id, a.name])); opts('#t_to', agents.filter(a => a.status === 'active').map(a => [a.name, a.name]), '(none – agent does it itself)');
}

function load() {
  $.getJSON('/api/agents').done(r => { agents = r.data; renderDir(); fillSelects(); });
  $.getJSON('/api/ollama/status').done(r => $('#ollama').text(r.data.connected ? 'Ollama ✓ ' + r.data.model_count + ' models (default: ' + r.data.default_model + ')' : 'Ollama offline'));
}
function renderDir() {
  const b = $('#rows').empty();
  agents.forEach(a => b.append($('<tr>').append(
    $('<td>').text(a.name), $('<td>').text(a.role), $('<td>').text(a.zone + ' / ' + a.home_location + ' · ' + a.activity + ' (' + a.x + ', ' + a.z + ')'),
    $('<td>').append($('<code>').text(a.effective_model || '—')),
    $('<td>').append($('<span class="badge">').addClass(a.status === 'active' ? 'text-bg-success' : 'text-bg-secondary').text(a.status)),
    $('<td class="text-end">').append(
      $('<button class="btn btn-sm btn-outline-info me-1">').text('Edit').on('click', () => editAgent(a.id)),
      $('<button class="btn btn-sm btn-outline-light me-1">').text('Monitor').on('click', () => { $('#monSel').val(a.id); $('[href="#mon"]').tab('show'); monitor(); }),
      $('<button class="btn btn-sm btn-outline-warning">').text(a.status === 'active' ? 'Deactivate' : 'Activate').on('click', () =>
        call('PUT', '/api/agents/' + a.id, { status: a.status === 'active' ? 'inactive' : 'active' }).done(load).fail(fail))))));
}
function editAgent(id) {
  call('GET', '/api/agents/' + id).done(a => {
    $('#f_id').val(a.id); $('#f_name').val(a.name); $('#f_role').val(a.role); $('#f_home').val(a.home_location); $('#f_model').val(a.model);
    $('#f_auto').prop('checked', a.autonomous); $('#f_active').prop('checked', a.status === 'active');
    $('#f_pers').val(a.personality); $('#f_prompt').val(a.system_prompt); $('#f_goals').val((a.goals || []).join('\n'));
    $('#editTab').tab('show');
  }).fail(fail);
}
$('#newBtn').on('click', () => { $('#form')[0].reset(); $('#f_id').val(''); });
$('#form').on('submit', e => {
  e.preventDefault();
  const id = $('#f_id').val(), body = { name: $('#f_name').val(), role: $('#f_role').val(), home_location: $('#f_home').val(), model: $('#f_model').val(),
    autonomous: $('#f_auto').is(':checked'), status: $('#f_active').is(':checked') ? 'active' : 'inactive', personality: $('#f_pers').val(),
    system_prompt: $('#f_prompt').val(), goals: $('#f_goals').val().split('\n').map(s => s.trim()).filter(Boolean) };
  call(id ? 'PUT' : 'POST', '/api/agents' + (id ? '/' + id : ''), body).done(() => { load(); $('[href="#dir"]').tab('show'); }).fail(fail);
});

function monitor() {
  const id = $('#monSel').val(); if (!id) return;
  call('GET', '/api/agents/' + id).done(a => {
    const i = $('#monInfo').empty(), row = (k, v) => i.append($('<div>').append($('<b>').text(k + ': '), $('<span class="pre">').text(v == null || v === '' ? '—' : v)));
    row('Activity', a.activity); row('Position', a.x + ', ' + a.z); row('Model', a.effective_model); row('Status', a.status);
    row('Current task', a.current_task ? a.current_task.description + ' [' + a.current_task.status + ']' : 'none');
    row('Last Ollama request', a.last_ollama_at); row('Error', a.last_error); row('Goals', (a.goals || []).join('; '));
    row('Relationships', (a.relationships || []).map(r => r.other + ' (' + r.affinity + ')').join(', '));
    row('Recent tasks', (a.tasks || []).map(t => '#' + t.id + ' ' + t.status).join(', '));
    const m = $('#monMsgs').empty(); (a.recent_interactions || []).forEach(x => m.append($('<div class="mb-1">').text((x.kind === 'agent' ? '[agent] ' : '') + x.sender + ': ' + x.content)));
  }).fail(fail);
  call('GET', '/api/agents/' + id + '/memory').done(ms => { const m = $('#monMem').empty(); ms.forEach(x => m.append($('<div class="mb-1">').text('★'.repeat(x.importance) + ' ' + x.content))); }).fail(fail);
}
$('#monSel').on('change', monitor); $('#monRefresh').on('click', monitor);
$('#taskForm').on('submit', e => {
  e.preventDefault();
  call('POST', '/api/agents/' + $('#monSel').val() + '/task', { description: $('#t_desc').val(), delegate_to: $('#t_to').val() || undefined })
    .done(() => { $('#t_desc').val(''); setTimeout(monitor, 1500); }).fail(fail);
});
$('#cSave').on('click', () => call('PUT', '/api/settings', { default_model: $('#c_model').val(), ollama_url: $('#c_url').val() }).done(load).fail(fail));

function events() { $.getJSON('/api/world/events?limit=100').done(r => { const l = $('#evList').empty(); r.data.slice().reverse().forEach(e => l.append($('<div>').text(e.created_at + '  ' + e.type + '  ' + e.message))); }); }
$('[href="#evt"]').on('shown.bs.tab', events); setInterval(() => { if ($('#evt').hasClass('active')) events(); }, 3000);

$('#token').val(sessionStorage.getItem('adm') || '').on('change', e => sessionStorage.setItem('adm', e.target.value));
$.getJSON('/api/world/locations').done(r => { locs = r.data; load(); });
$.getJSON('/api/ollama/models').done(r => { models = r.data.models; fillSelects(); });
setInterval(() => { if ($('#dir').hasClass('active')) load(); }, 4000);
