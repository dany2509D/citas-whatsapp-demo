// Panel · Seguimiento: avisos por giro y pacientes.
import { h, clear } from '../../shared/ui/dom.js';
import { toast } from '../../shared/ui/ui.js';
import { dateLong, todayKey } from '../../shared/time/panama.js';
import { computeFollowups, lastService, STATE_LABEL } from '../followups.js';
import { getService } from '../agenda.js';
import { cardHead, fmtPhone } from '../ui/common.js';

export function mount(root, app) {
  const { store, controller: ctl } = app;
  const c = () => store.clinic();
  const box = h('div', { class: 'cfg' });
  root.append(box);

  function paint() {
    const cl = c(); const T = store.profile(); const today = todayKey();
    const items = computeFollowups(cl, store.state.giro, today);
    const due = items.filter((i) => i.state === 'por_enviar').length;
    clear(box).append(
      h('section', { class: 'card' },
        cardHead('bell', 'Seguimiento automático'),
        h('p', null, `${T.followupRule}. ${due ? `Hoy toca avisar a ${due} ${due === 1 ? 'paciente' : 'pacientes'}.` : 'No hay avisos por enviar hoy.'}`),
        h('p', { class: 'field__hint' }, 'El aviso lo envía el asistente por WhatsApp (aquí, simulado) y, si la persona responde «1», agenda con los datos que ya conoce.')),
      h('section', { class: 'card', 'aria-labelledby': 'fu-h' },
        cardHead('list', 'Avisos de seguimiento', null, 'fu-h'),
        h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', null, h('tr', null, ['Paciente', 'Detalle', 'Corresponde', 'Estado', ''].map((x) => h('th', { scope: 'col' }, x)))),
          h('tbody', null, items.map((i) => h('tr', null,
            h('th', { scope: 'row' }, i.name),
            h('td', null, i.label),
            h('td', null, i.state === 'agendada' ? `Agendada: ${i.bookedLabel}` : i.due ? (i.due <= today ? 'Ya corresponde' : dateLong(i.due)) : 'Al quedar 2 sesiones'),
            h('td', null, h('span', { class: `badge badge--${i.state === 'por_enviar' ? 'pendiente' : i.state === 'agendada' ? 'confirmada' : i.state === 'enviado' ? 'reprogramada' : 'info'}` }, STATE_LABEL[i.state])),
            h('td', null, i.state === 'por_enviar' || i.state === 'programado'
              ? h('button', { class: `btn btn--sm${i.state === 'por_enviar' ? ' btn--accent' : ''}`, type: 'button', onclick: () => { ctl.simulateFollowup({ patientId: i.patientId }); toast('Aviso enviado (simulado). Véalo en el chat de la demo.', { kind: 'ok' }); } }, 'Enviar aviso')
              : null)))))),
        items.length ? null : h('p', { class: 'empty' }, 'Todavía no hay seguimientos.')),
      h('section', { class: 'card', 'aria-labelledby': 'pt-h' },
        cardHead('users', `Pacientes (${cl.patients.length})`, null, 'pt-h'),
        h('p', { class: 'field__hint' }, 'Personas ficticias. Solo nombre, teléfono, última visita y, en veterinaria, la mascota.'),
        h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', null, h('tr', null, ['Paciente', 'Teléfono', store.state.giro === 'vet' ? 'Mascota' : store.state.giro === 'fisio' ? 'Paquete' : 'Última limpieza', 'Última visita'].map((x) => h('th', { scope: 'col' }, x)))),
          h('tbody', null, cl.patients.map((p) => {
            const last = [...(p.history || [])].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
            const extra = store.state.giro === 'vet' ? (p.pet ? `${p.pet.name} (${p.pet.species}, ${p.pet.age})` : '—')
              : store.state.giro === 'fisio' ? (p.package ? `${p.package.used} de ${p.package.total} sesiones` : '—')
                : (lastService(p, 'limpieza') ? dateLong(lastService(p, 'limpieza')) : '—');
            return h('tr', null, h('th', { scope: 'row' }, p.name), h('td', null, fmtPhone(p.phone)), h('td', null, extra), h('td', null, last ? `${getService(cl, last.serviceId)?.name || last.serviceId} · ${dateLong(last.date)}` : '—'));
          }))))));
  }
  paint();
  return store.subscribe((e) => { if (e.type === 'change') paint(); });
}
