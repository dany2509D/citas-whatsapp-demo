// Panel · Conversaciones: bandeja con las urgentes y las que pasaron a una persona arriba.
import { h, clear, replace } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { toast } from '../../shared/ui/ui.js';
import { clockOfEpoch, dateKeyOfEpoch, dateShort, todayKey } from '../../shared/time/panama.js';
import { avatar, fmtPhone, whenLabel } from '../ui/common.js';

const ui = { selected: null, view: 'list' };

export const needsAttention = (v) => (v.flags?.urgent || v.flags?.handoff) && !v.resolved;

/** Urgentes primero, luego las de atención humana, luego por actividad reciente. */
export function sortInbox(list) {
  const rank = (v) => (v.flags.urgent && !v.resolved ? 0 : v.flags.handoff && !v.resolved ? 1 : 2);
  return [...list].filter((v) => v.messages.length).sort((a, b) => rank(a) - rank(b) || b.lastTs - a.lastTs);
}

export function mount(root, app) {
  const { store, controller: ctl } = app;
  const c = () => store.clinic();
  const split = h('div', { class: 'split', 'data-view': ui.view });
  const listPane = h('div', { class: 'list-pane' });
  const threadPane = h('div', { class: 'thread-pane' });
  split.append(listPane, threadPane);
  root.append(split);

  const snippet = (v) => {
    const rev = [...v.messages].reverse().filter((m) => m.from !== 'system');
    const m = ((v.flags.urgent || v.flags.handoff) && rev.find((x) => x.from === 'user')) || rev[0];
    if (!m) return '';
    const who = m.from === 'user' ? 'Paciente: ' : m.from === 'staff' ? 'Recepción: ' : 'Asistente: ';
    const text = /no guardado/.test(m.text || '') ? 'mensaje no guardado por privacidad' : (m.text || 'archivo adjunto');
    return `${who}${text.replace(/\s+/g, ' ')}`;
  };
  const name = (v) => v.name || (v.id === 'live' ? 'Chat de la demo (en vivo)' : 'Visitante de la demo');

  function paintList() {
    const list = sortInbox(c().conversations);
    if (!list.some((v) => v.id === ui.selected)) ui.selected = list[0]?.id ?? null;
    replace(listPane,
      h('h2', { class: 'sr-only' }, 'Lista de conversaciones'),
      h('ul', { class: 'inbox' }, list.map((v) => h('li', null, h('button', {
        type: 'button', class: `${v.flags.urgent && !v.resolved ? 'is-urgent' : v.flags.handoff && !v.resolved ? 'is-human' : ''}`, 'aria-current': String(v.id === ui.selected), dataset: { id: v.id },
        onclick: () => { ui.selected = v.id; ui.view = 'thread'; v.unread = 0; split.dataset.view = 'thread'; paintList(); paintThread(); },
      },
      v.flags.urgent && !v.resolved ? h('span', { class: 'initials initials--urgent', 'aria-hidden': 'true' }, icon('alert', { size: 20, stroke: 2.4 })) : avatar(name(v)),
      h('span', { class: 'inbox__top' }, h('span', null, name(v)), h('time', { class: 'field__hint' }, whenLabel(v.lastTs))),
      h('span', { class: 'inbox__snip' }, snippet(v)),
      h('span', { class: 'inbox__tags' },
        v.flags.urgent && !v.resolved ? h('span', { class: 'badge badge--urgente' }, icon('alert', { size: 12, stroke: 2.6 }), 'URGENTE') : null,
        v.flags.handoff && !v.resolved ? h('span', { class: 'badge badge--humano' }, icon('user-check', { size: 12, stroke: 2.6 }), 'Atención humana') : null,
        v.resolved ? h('span', { class: 'badge badge--atendida' }, icon('check-circle', { size: 12, stroke: 2.6 }), 'Atendida') : null,
        v.id === 'live' && !(v.flags.urgent || v.flags.handoff) ? h('span', { class: 'badge badge--info' }, 'En vivo') : null))))),
      list.length ? null : h('p', { class: 'empty' }, 'Aún no hay conversaciones.'));
  }

  function paintThread() {
    const v = c().conversations.find((x) => x.id === ui.selected);
    if (!v) { clear(threadPane).append(h('p', { class: 'empty' }, 'Seleccione una conversación.')); return; }
    let lastDay = null;
    const msgs = h('div', { class: 'thread__msgs', role: 'log', 'aria-label': `Conversación con ${name(v)}`, tabindex: '0' });
    for (const m of v.messages) {
      const day = dateKeyOfEpoch(m.ts);
      if (day !== lastDay) { lastDay = day; msgs.append(h('div', { class: 'tmsg tmsg--sys' }, day === todayKey() ? 'Hoy' : dateShort(day))); }
      if (m.from === 'system') { msgs.append(h('div', { class: 'tmsg tmsg--sys' }, m.text)); continue; }
      // El mensaje que no se guardó por privacidad se ve distinto (gris, con candado): no es un mensaje normal del paciente.
      const redacted = /no guardado/i.test(m.text || '');
      msgs.append(h('div', { class: `tmsg tmsg--${m.from}${redacted ? ' tmsg--redacted' : ''}` },
        m.from !== 'user' ? h('small', null, m.from === 'staff' ? 'Recepción' : 'Asistente virtual') : null,
        redacted ? [icon('lock', { size: 14 }), ' Mensaje no guardado por privacidad (posible dato de salud)'] : m.attachment ? `📎 ${m.attachment.name}` : (m.text || ''),
        h('time', null, clockOfEpoch(m.ts))));
    }
    const input = h('input', { id: 'reply-input', class: 'input', type: 'text', autocomplete: 'off', maxlength: 500, placeholder: 'Escriba la respuesta de recepción' });
    const form = h('form', { class: 'row', onsubmit: (e) => {
      e.preventDefault();
      if (ctl.staffReply(v.id, input.value)) { input.value = ''; toast(v.id === 'live' ? 'Respuesta enviada: aparece en el teléfono de la demo.' : 'Respuesta registrada (simulada).', { kind: 'ok' }); }
    } },
      h('div', { class: 'field', style: { flex: '1 1 260px' } }, h('label', { for: 'reply-input' }, 'Responder desde recepción (simulado)'), input),
      h('button', { class: 'btn btn--accent', type: 'submit' }, 'Enviar'));
    clear(threadPane).append(h('div', { class: 'thread card' },
      h('button', { class: 'btn btn--sm back-link', type: 'button', onclick: () => { ui.view = 'list'; split.dataset.view = 'list'; } }, icon('arrow-left', { size: 15 }), 'Volver a la lista'),
      h('div', { class: 'inbox__top' }, h('h2', { style: { fontSize: '18px' } }, name(v)), v.phone ? h('span', { class: 'field__hint' }, fmtPhone(v.phone)) : null),
      h('div', { class: 'inbox__tags' },
        v.flags.urgent && !v.resolved ? h('span', { class: 'badge badge--urgente' }, icon('alert', { size: 12, stroke: 2.6 }), 'URGENTE') : null,
        v.flags.handoff ? h('span', { class: 'badge badge--humano' }, icon('user-check', { size: 12, stroke: 2.6 }), v.mode === 'humano' ? 'Con una persona' : 'Pasó a una persona') : null),
      msgs, form,
      h('div', { class: 'row' },
        h('button', { class: 'btn btn--sm', type: 'button', disabled: !needsAttention(v), onclick: () => { ctl.resolveConv(v.id); toast('Conversación marcada como atendida.', { kind: 'ok' }); } }, icon('check', { size: 15 }), 'Marcar como atendida'),
        h('button', { class: 'btn btn--sm', type: 'button', disabled: v.mode !== 'humano', onclick: () => { ctl.returnToBot(v.id); toast('El asistente vuelve a responder esta conversación.', { kind: 'ok' }); } }, icon('bot', { size: 15 }), 'Devolver al asistente')),
      h('p', { class: 'field__hint' }, 'Por privacidad, los mensajes con posibles datos de salud no se guardan: aparecen como «mensaje no guardado».')));
    msgs.scrollTop = msgs.scrollHeight;
  }

  paintList(); paintThread();
  const unsub = store.subscribe((e) => { if (e.type === 'conv' || e.type === 'change') { const keep = threadPane.querySelector('#reply-input')?.value; paintList(); paintThread(); if (keep) { const i = threadPane.querySelector('#reply-input'); if (i) { i.value = keep; } } } });
  return unsub;
}
