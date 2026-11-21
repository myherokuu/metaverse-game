// Chat panel. All model/AI text is inserted with .text() (never as HTML).
import { api, errMsg } from './api.js';

let agent = null, busy = false, keep = null, ollamaUp = true, hooks = {};
const $log = () => $('#chLog');

function bubble(cls, text) {
  const el = $('<div>').addClass('msg ' + cls).text(text); $log().append(el); $log().scrollTop($log()[0].scrollHeight); return el;
}
export const isOpen = () => !$('#rightPanel').prop('hidden');
export const currentAgent = () => agent;
export function setOllamaUp(v) { ollamaUp = v; $('#chInput').prop('placeholder', v ? 'Say something…' : 'Ollama offline — chat disabled'); $('#chSend').prop('disabled', !v); }

export function initChat(h) {
  hooks = h;
  $('#chForm').on('submit', e => { e.preventDefault(); send(); });
  $('#chClose').on('click', close);
  $('#chFollow').on('click', () => cmd({ type: 'follow' }, 'follows you now'));
  $('#chStop').on('click', () => cmd({ type: 'stop' }, 'stopped'));
  $(document).on('keydown', e => { if (e.key === 'Escape' && isOpen() && $('#chInput').is(':focus')) $('#chInput').blur(); });
}

function cmd(body, note) {
  if (!agent) return;
  api('POST', `/api/agents/${agent.id}/command`, body).done(() => bubble('sys', `${agent.name} ${note}`)).fail(x => bubble('err', errMsg(x)));
}

export function open(a) {
  if (agent && agent.id !== a.id) api('POST', `/api/agents/${agent.id}/talk`, { on: false });  // release the previous agent
  agent = a; api('POST', `/api/agents/${a.id}/talk`, { on: true });
  clearInterval(keep); keep = setInterval(() => api('POST', `/api/agents/${a.id}/talk`, { on: true }), 8000);
  $('#rightPanel').prop('hidden', false); $log().empty();
  $('#chName').text(a.name); $('#chRole').text(a.role || ''); $('#chStatus').text(a.state || ''); $('#chModel').text('…');
  api('GET', `/api/agents/${a.id}`).done(d => {
    $('#chModel').text(d.effective_model || '(none)'); $('#chRole').text(d.role); $('#chStatus').text(d.activity);
    const dl = $('#chInfo').empty(), row = (k, v) => dl.append($('<dt>').text(k), $('<dd>').text(v || '—'));
    row('Personality', d.personality); row('Goals', (d.goals || []).join('; ')); row('Home', d.home_location);
    row('Current task', d.current_task ? d.current_task.description + ' (' + d.current_task.status + ')' : 'none');
    row('Activity', d.activity); row('Last interaction', d.last_interaction_at);
  });
  api('GET', `/api/agents/${a.id}/messages`).done(ms => {
    if (!ms.length) bubble('sys', `You approach ${a.name}.`);
    ms.forEach(m => bubble(m.role === 'user' ? 'me' : 'ai', m.content));
  });
  hooks.onOpen && hooks.onOpen();
  setTimeout(() => $('#chInput').trigger('focus'), 50);
}

export function close() {
  clearInterval(keep); if (agent) api('POST', `/api/agents/${agent.id}/talk`, { on: false });
  $('#rightPanel').prop('hidden', true); agent = null; $('#chInput').blur(); hooks.onClose && hooks.onClose();
}

function send() {
  const text = $('#chInput').val().trim();
  if (!text || busy || !agent) return;
  const a = agent; $('#chInput').val(''); bubble('me', text); busy = true;
  $('#chThinking').text(`${a.name} is thinking…`).prop('hidden', false); $('#chSend').prop('disabled', true);
  api('POST', `/api/agents/${a.id}/chat`, { message: text }).done(r => {
    if (r.delegation) bubble('sys', `↪ ${r.delegation.from} asked ${r.delegation.to}: “${r.delegation.question}”`);
    if (r.delegation) bubble('ai', `${r.delegation.to}: ${r.delegation.answer}`);
    bubble('ai', r.reply); hooks.onGesture && hooks.onGesture(a.id, r.gesture); if (r.model) $('#chModel').text(r.model);
    if (r.action) bubble('sys', `${a.name} → ${r.action.type}${r.action.location ? ' ' + r.action.location : ''}`);
  }).fail(x => bubble('err', errMsg(x))).always(() => {
    busy = false; $('#chThinking').prop('hidden', true); $('#chSend').prop('disabled', !ollamaUp); $('#chInput').trigger('focus');
  });
}
