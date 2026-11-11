// Panel "En vivo": lo que ve la clínica mientras el paciente escribe. Muestra los últimos cambios,
// un resumen del día, la agenda del día y de la semana por profesional, y los recordatorios programados.
import { h, clear } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { flip, rollTo } from '../../shared/ui/motion.js';
import {
  addDays, dateLong, dateShort, dayOfWeek, mondayOf, nowStamp, stampShort, time12, todayKey, weekDays,
} from '../../shared/time/panama.js';
import { dayBeforeList, getAppt, getService } from '../agenda.js';
import { computeFollowups, STATE_LABEL } from '../followups.js';
import { openApptModal } from './appt-modal.js';
import { REMINDER_LABEL, apptSummary, avatar, badge, chipIcon, feedChip, whenLabel } from './common.js';

export const REMINDER_PREVIEW = 6;

/**
 * Recordatorios "día anterior" para el panel (CIT-HU5.5). Con `all` devuelve todos; si no, los primeros
 * REMINDER_PREVIEW en orden de envío, pero los de las citas recién agendadas o movidas (`pinned`) siempre
 * entran, así que agregar uno nuevo nunca lo deja oculto. Los vencidos (envío ayer o antes) cuentan como
 * "de hoy" para el orden, de modo que no tapen los que salen hoy a las 9:00 a. m. para las citas de mañana.
 */
export function reminderRows(c, nowS, { all = false, pinned = [], limit = REMINDER_PREVIEW } = {}) {
  const floor = `${nowS.slice(0, 10)}T00:00`;
  const rows = dayBeforeList(c, nowS, Infinity)
    .sort((x, y) => { const a = x.due < floor ? floor : x.due; const b = y.due < floor ? floor : y.due; return a < b ? -1 : a > b ? 1 : x.start < y.start ? -1 : 1; });
  if (all || rows.length <= limit) return { rows, total: rows.length };
  const keep = new Set(rows.slice(0, limit).map((r) => r.apptId));
  const pins = rows.filter((r) => pinned.includes(r.apptId));
  pins.forEach((r) => keep.add(r.apptId));
  return { rows: rows.filter((r) => keep.has(r.apptId)), total: rows.length };
}

export function createLivePanel(app, { onShowChat } = {}) {
  const { store } = app;
  const el = h('section', { class: 'live', 'aria-label': 'Panel de la clínica en vivo' });
  const ui = { view: 'dia', dayKey: todayKey(), flash: new Set(), pinned: [], allRem: false, seenTs: Date.now(), newEv: new Set() };
  let flashTimer = null;
  let prevStats = null;

  const c = () => store.clinic();
  const pros = () => c().config.professionals.filter((p) => p.active !== false);
  const open = (id) => openApptModal(app, id);

  function chip(a) {
    const cl = c();
    return h('button', { class: `appt-chip st-${a.status}${ui.flash.has(a.id) ? ' flash' : ''}`, 'data-flip': `ap:${a.id}`, type: 'button', 'aria-label': `${apptSummary(cl, a)}. Abrir cita`, onclick: () => open(a.id) },
      h('span', { class: 'appt-chip__time' }, time12(a.start.slice(11, 16))),
      h('span', { class: 'appt-chip__who' }, a.name),
      h('span', { class: 'appt-chip__svc' }, getService(cl, a.serviceId)?.name || '', badge(a.status)));
  }

  /** Resumen de hoy: citas, confirmadas, pendientes. */
  function statsRow() {
    const today = c().appointments.filter((a) => a.start.slice(0, 10) === todayKey() && a.status !== 'cancelada');
    const confirmed = today.filter((a) => a.status === 'confirmada' || a.status === 'atendida').length;
    const pending = today.filter((a) => a.status === 'pendiente' || a.status === 'reprogramada').length;
    const values = [today.length, confirmed, pending];
    // Las cifras ruedan dígito a dígito: desde cero la primera vez y, después, solo los dígitos que cambian.
    const stat = (iconName, tone, value, label, i) => {
      const b = h('b', null, String(value));
      rollTo(b, String(value), prevStats ? prevStats[i] : null);
      return h('div', { class: 'stat' }, chipIcon(iconName, tone, 19), h('div', null, b, h('small', null, label)));
    };
    const row = h('div', { class: 'stats', role: 'group', 'aria-label': 'Resumen de hoy' },
      stat('calendar', 'brand', values[0], 'Citas hoy', 0), stat('check-circle', 'ok', values[1], 'Confirmadas', 1), stat('clock', 'amber', values[2], 'Por confirmar', 2));
    prevStats = values;
    return row;
  }

  function feedCard() {
    const real = c().events.filter((e) => e.kind !== 'sistema');
    const items = (real.length ? real : c().events).slice(0, 4);
    return h('section', { class: 'card panel-card', 'aria-labelledby': 'feed-h', 'data-flip': 'feed' },
      h('div', { class: 'panel-card__head' }, h('h3', { id: 'feed-h' }, icon('activity', { size: 18 }), 'Lo que acaba de pasar')),
      h('ul', { class: 'feed', 'aria-label': 'Últimos cambios', 'aria-live': 'polite' }, items.map((e) => h('li', { class: `${ui.newEv.has(e.id) ? 'is-new ' : ''}${e.kind === 'urgente' ? 'is-urgent' : ''}`, 'data-flip': `ev:${e.id}` },
        feedChip(e.kind), h('span', { class: 'feed__txt' }, e.text), h('time', null, whenLabel(e.ts))))));
  }

  function dayView() {
    const list = c().appointments.filter((a) => a.start.slice(0, 10) === ui.dayKey);
    const closed = !c().config.hours[dayOfWeek(ui.dayKey)];
    return h('div', null,
      closed ? h('p', { class: 'empty' }, 'La clínica no atiende este día.') : null,
      h('div', { class: 'pro-cols' }, pros().map((p) => {
        const mine = list.filter((a) => a.professionalId === p.id).sort((x, y) => (x.start < y.start ? -1 : 1));
        return h('div', { class: 'pro-col' }, h('h4', null, avatar(p.name), h('span', null, p.name, h('small', null, p.specialty))),
          mine.length ? mine.map(chip) : h('p', { class: 'empty' }, p.days.includes(dayOfWeek(ui.dayKey)) && !closed ? 'Sin citas: día libre.' : 'No atiende este día.'));
      })));
  }

  function weekView() {
    const days = weekDays(ui.dayKey).filter((k) => c().config.hours[dayOfWeek(k)] || c().appointments.some((a) => a.start.slice(0, 10) === k));
    const first = days[0]; const last = days.at(-1);
    const today = todayKey();
    return h('div', { class: 'week-wrap' }, h('table', { class: 'week' },
      h('caption', { class: 'sr-only' }, `Semana del ${dateLong(first)} al ${dateLong(last)}, por profesional`),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Profesional'), days.map((k) => h('th', { scope: 'col', class: k === today ? 'is-today' : '' }, dateShort(k).split(' ')[0], h('small', null, dateShort(k).split(' ').slice(1).join(' ')))))),
      h('tbody', null, pros().map((p) => h('tr', null,
        h('th', { scope: 'row' }, p.name, h('small', null, p.specialty)),
        days.map((k) => {
          const mine = c().appointments.filter((a) => a.professionalId === p.id && a.start.slice(0, 10) === k).sort((x, y) => (x.start < y.start ? -1 : 1));
          return h('td', { class: k === today ? 'is-today' : '' }, mine.map((a) => h('button', {
            class: `mini st-${a.status}${ui.flash.has(a.id) ? ' flash' : ''}`, type: 'button', title: apptSummary(c(), a), 'aria-label': `${apptSummary(c(), a)}. Abrir cita`, onclick: () => open(a.id),
          }, time12(a.start.slice(11, 16)).replace(' ', ' '))));
        }))))));
  }

  function agendaCard() {
    const isDay = ui.view === 'dia';
    const shift = (n) => { ui.dayKey = addDays(ui.dayKey, isDay ? n : n * 7); render(); };
    return h('section', { class: 'card panel-card', 'aria-labelledby': 'ag-h', 'data-flip': 'agenda' },
      h('div', { class: 'panel-card__head' },
        h('h3', { id: 'ag-h' }, icon('calendar', { size: 18 }), isDay ? `Agenda del día · ${dateLong(ui.dayKey)}` : `Agenda de la semana · ${dateShort(weekDays(ui.dayKey)[0])}`),
        h('div', { class: 'row' },
          h('div', { class: 'daynav' },
            h('button', { class: 'btn btn--sm btn--icon', type: 'button', 'aria-label': isDay ? 'Día anterior' : 'Semana anterior', onclick: () => shift(-1) }, icon('chevron-left', { size: 17 })),
            h('button', { class: 'btn btn--sm', type: 'button', onclick: () => { ui.dayKey = todayKey(); render(); } }, 'Hoy'),
            h('button', { class: 'btn btn--sm btn--icon', type: 'button', 'aria-label': isDay ? 'Día siguiente' : 'Semana siguiente', onclick: () => shift(1) }, icon('chevron-right', { size: 17 }))),
          h('div', { class: 'seg', role: 'group', 'aria-label': 'Vista de la agenda' },
            h('button', { type: 'button', 'aria-pressed': String(isDay), onclick: () => { ui.view = 'dia'; render(); } }, 'Día'),
            h('button', { type: 'button', 'aria-pressed': String(!isDay), onclick: () => { ui.view = 'semana'; render(); } }, 'Semana')))),
      isDay ? dayView() : weekView());
  }

  function remindersCard() {
    const cl = c();
    const { rows: dayBefore, total } = reminderRows(cl, nowStamp(), { all: ui.allRem, pinned: ui.pinned });
    const followAll = computeFollowups(cl, store.state.giro, todayKey()).filter((f) => f.state === 'por_enviar' || f.state === 'programado');
    const follow = ui.allRem ? followAll : followAll.slice(0, 3);
    const simulate = (fn) => { fn(); onShowChat?.(); };
    const stateBadge = (s) => (s === 'confirmo' ? 'confirmada' : s === 'enviado' ? 'reprogramada' : 'pendiente');
    return h('section', { class: 'card panel-card', 'aria-labelledby': 'rem-h', 'data-flip': 'rem' },
      h('div', { class: 'panel-card__head' }, h('h3', { id: 'rem-h' }, icon('bell', { size: 18 }), 'Recordatorios programados')),
      h('ul', { class: 'rem-list' },
        dayBefore.map((r) => h('li', { class: ui.flash.has(r.apptId) ? 'flash' : '', 'data-flip': `rm:${r.apptId}` },
          chipIcon('clock', 'brand', 17),
          h('span', null, h('b', null, `${r.kind === 'horas-antes' ? 'Horas antes' : 'Día anterior'} · ${r.patient}`), h('small', null, `Se envía ${dateShort(r.due.slice(0, 10))} ${time12(r.due.slice(11, 16))} · cita ${stampShort(r.start)}`)),
          h('span', { class: 'rem-list__act' }, h('span', { class: `badge badge--${stateBadge(r.state)}` }, REMINDER_LABEL[r.state] || 'Programado'),
            r.state === 'programado' || r.state === 'enviado' ? h('button', { class: 'btn btn--sm', type: 'button', onclick: () => simulate(() => app.controller.simulateDayBefore({ apptId: r.apptId })) }, 'Simular envío') : null))),
        follow.map((f) => h('li', { 'data-flip': `fu:${f.patientId}` },
          chipIcon('bell', 'amber', 17),
          h('span', null, h('b', null, `Seguimiento · ${f.name}`), h('small', null, f.label)),
          h('span', { class: 'rem-list__act' }, h('span', { class: `badge badge--${f.state === 'por_enviar' ? 'pendiente' : 'info'}` }, STATE_LABEL[f.state]),
            h('button', { class: 'btn btn--sm', type: 'button', onclick: () => simulate(() => app.controller.simulateFollowup({ patientId: f.patientId })) }, 'Simular envío'))))),
      total > REMINDER_PREVIEW || followAll.length > follow.length ? h('div', { class: 'rem-more' },
        h('span', { class: 'field__hint', 'aria-live': 'polite' }, ui.allRem ? `Mostrando los ${total + followAll.length} recordatorios.` : `Mostrando ${dayBefore.length + follow.length} de ${total + followAll.length} recordatorios.`),
        h('button', { class: 'btn btn--sm', type: 'button', id: 'rem-all', 'aria-expanded': String(ui.allRem), onclick: () => { ui.allRem = !ui.allRem; render(); } }, ui.allRem ? 'Ver menos' : `Ver todos (${total + followAll.length})`)) : null,
      !dayBefore.length && !follow.length ? h('p', { class: 'empty' }, 'No hay recordatorios pendientes.') : null);
  }

  // El redibujado es el de siempre, envuelto en FLIP: lo que ya estaba se desliza a su sitio nuevo y lo nuevo entra
  // (solo cuando el cambio viene de los datos; al navegar de día o de vista no hay entrada).
  function render(fromData = false) {
    const scroll = el.scrollTop;
    flip(el, () => clear(el).append(
      h('div', { class: 'live__head' }, h('h2', null, h('span', { class: 'pulse', 'aria-hidden': 'true' }), 'En vivo: panel de la clínica'),
        h('a', { class: 'btn btn--sm btn--ghost btn--go', href: '#/admin/agenda', onclick: () => app.admin.enter() }, 'Ver el panel completo', icon('arrow-right', { size: 15 }))),
      statsRow(), feedCard(), agendaCard(), remindersCard()), { enter: fromData ? 'flip-in' : '' });
    el.scrollTop = scroll;
  }

  const unsub = store.subscribe((e) => {
    if (e.type === 'conv') return;
    if (e.type === 'change') {
      const evs = c().events.filter((x) => x.ts > ui.seenTs);
      ui.newEv = new Set(evs.map((x) => x.id));
      if (evs.length) ui.seenTs = Math.max(...evs.map((x) => x.ts));
      (e.touched || []).forEach((id) => { ui.flash.add(id); ui.pinned = [id, ...ui.pinned.filter((x) => x !== id)].slice(0, 3); });
      // Si la cita nueva o movida cae en otro día, la agenda se desplaza para que se vea de inmediato.
      const t = (e.touched || []).map((id) => getAppt(c(), id)).find(Boolean);
      if (t) {
        const d = t.start.slice(0, 10);
        if (ui.view === 'dia' ? d !== ui.dayKey : mondayOf(d) !== mondayOf(ui.dayKey)) ui.dayKey = d;
      }
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { ui.flash.clear(); ui.newEv.clear(); }, 2400);
      if (evs.length) app.demo?.markPanelNew?.();
    }
    render(e.type === 'change');
  });
  render();
  return { el, destroy() { unsub(); clearTimeout(flashTimer); } };
}
