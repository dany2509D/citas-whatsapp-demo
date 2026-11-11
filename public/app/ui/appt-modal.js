// Ventanas de la cita: ver, cambiar estado, mover (botones o fecha y hora), registrar pago
// simulado y revisar el historial. También "Nueva cita" (origen: panel).
import { h } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { openDialog, toast } from '../../shared/ui/ui.js';
import { parseName, parsePhone } from '../../shared/chat-engine/nlu.js';
import { addDays, addMin, dateLong, nowStamp, stampLong, stampShort, time12, todayKey } from '../../shared/time/panama.js';
import {
  REASONS, STATUS, STATUS_KEYS, activeServices, createAppointment, freeSlots, getAppt, getPro, getService, moveAppointment, notifyPatient, setStatus,
} from '../agenda.js';
import { ITBMS, money, withItbms, firstName } from '../format.js';
import { badge, fmtPhone, whenLabel, REMINDER_LABEL } from './common.js';

const METHODS = ['Yappy', 'Tarjeta', 'ACH', 'Efectivo'];

/** '2026-11-12' -> 'jueves 12 de noviembre' (el selector de fecha del navegador muestra 11/12/2026, sin el día de la semana). */
export const dateWords = (key) => (/^\d{4}-\d{2}-\d{2}$/.test(key || '') ? dateLong(key) : '');

function slotChoices(c, { serviceId, professionalId, dayKey, ignoreId }) {
  const from = dayKey > todayKey() ? `${dayKey}T00:00` : nowStamp();
  return freeSlots(c, { serviceId, professionalId, dayKey, from, ignoreId });
}

export function openApptModal(app, apptId) {
  const { store } = app;
  const c = () => store.clinic();
  const get = () => getAppt(c(), apptId);
  let dlg;
  const draft = { date: null, pro: null, time: null, notice: true };

  const commit = (touched = [apptId]) => store.commit({ type: 'change', touched });
  const fail = (reason) => toast(REASONS[reason] || 'No se pudo hacer el cambio.', { kind: 'error' });

  function doMove(start, professionalId) {
    const a = get(); const old = a.start;
    const res = moveAppointment(c(), apptId, { start, professionalId }, { notice: draft.notice, actor: 'panel' });
    if (!res.ok) return fail(res.reason);
    if (draft.notice) notifyPatient(c(), a, `Hola ${firstName(a.name)}, su cita de ${getService(c(), a.serviceId).name} fue movida al ${stampLong(a.start)}. Si no le sirve, responda aquí para reprogramar.`);
    store.logEvent('estado', `Cita movida desde el panel · ${a.name} · ${stampShort(old)} → ${stampShort(a.start)} · el horario anterior quedó libre${draft.notice ? ' · aviso por WhatsApp (simulado)' : ''}`, apptId);
    commit();
    draft.date = null; draft.time = null;
    refresh();
    toast(draft.notice ? 'Cita movida. Se avisó al paciente por WhatsApp (simulado).' : 'Cita movida (sin aviso al paciente).', { kind: 'ok' });
  }

  function quick(label, ic, makeStart) {
    return h('button', { class: 'btn btn--sm', type: 'button', onclick: () => { const a = get(); doMove(makeStart(a.start), a.professionalId); } }, icon(ic, { size: 15 }), label);
  }

  function body() {
    const a = get();
    if (!a) return h('p', null, 'Esta cita ya no existe.');
    const cl = c(); const svc = getService(cl, a.serviceId); const pro = getPro(cl, a.professionalId);
    const movable = ['pendiente', 'confirmada', 'reprogramada'].includes(a.status);
    draft.date = draft.date || a.start.slice(0, 10);
    draft.pro = draft.pro || a.professionalId;

    const dateText = h('span', { class: 'field__hint date-text', id: 'mv-date-txt', 'aria-live': 'polite' }, dateWords(draft.date));
    const dateInput = h('input', {
      type: 'date', id: 'mv-date', value: draft.date, min: todayKey(), 'aria-describedby': 'mv-date-txt',
      oninput: (e) => { dateText.textContent = dateWords(e.target.value); },
      onchange: (e) => { draft.date = e.target.value; draft.time = null; refresh(); },
    });
    const proSelect = h('select', { id: 'mv-pro', onchange: (e) => { draft.pro = e.target.value; draft.time = null; refresh(); } },
      cl.config.professionals.filter((p) => p.active !== false && p.serviceIds.includes(a.serviceId)).map((p) => h('option', { value: p.id, ...(p.id === draft.pro ? { selected: true } : {}) }, p.name)));
    const slots = draft.date ? slotChoices(cl, { serviceId: a.serviceId, professionalId: draft.pro, dayKey: draft.date, ignoreId: a.id }) : [];
    const timeSelect = h('select', { id: 'mv-time', onchange: (e) => { draft.time = e.target.value; } },
      slots.length ? slots.map((s) => h('option', { value: s.start, ...(s.start === (draft.time || slots[0].start) ? { selected: true } : {}) }, time12(s.start.slice(11, 16)))) : h('option', { value: '' }, 'Sin horarios libres'));
    if (slots.length && !draft.time) draft.time = slots[0].start;

    const statusSelect = h('select', { id: 'st-sel' }, STATUS_KEYS.map((k) => h('option', { value: k, ...(k === a.status ? { selected: true } : {}) }, STATUS[k])));
    const price = svc.price; const total = svc.itbms ? withItbms(price) : price;
    const methodSel = h('select', { id: 'pay-sel' }, METHODS.map((m) => h('option', { value: m }, m)));

    return h('div', null,
      h('dl', { class: 'dl' },
        h('dt', null, 'Paciente'), h('dd', null, a.name),
        h('dt', null, 'Teléfono'), h('dd', null, fmtPhone(a.phone)),
        a.pet ? [h('dt', null, 'Mascota'), h('dd', null, `${a.pet.name} (${a.pet.species}, ${a.pet.age})`)] : null,
        h('dt', null, 'Servicio'), h('dd', null, `${svc.name} · ${a.minutes} min`),
        h('dt', null, 'Profesional'), h('dd', null, pro?.name || '—'),
        h('dt', null, 'Cuándo'), h('dd', null, stampLong(a.start)),
        h('dt', null, 'Estado'), h('dd', null, badge(a.status)),
        h('dt', null, 'Origen'), h('dd', null, a.origin === 'chat' ? 'Chat de WhatsApp' : 'Panel de recepción'),
        h('dt', null, 'Recordatorio'), h('dd', null, REMINDER_LABEL[a.reminder] || 'Programado')),
      h('p', { class: 'field__hint' }, 'Solo se guardan nombre, teléfono, servicio y hora: nunca datos clínicos.'),

      h('section', { class: 'sec', 'aria-labelledby': 'sec-estado' },
        h('h3', { id: 'sec-estado' }, 'Estado de la cita'),
        h('div', { class: 'row' },
          h('div', { class: 'field' }, h('label', { for: 'st-sel' }, 'Cambiar a'), statusSelect),
          h('button', { class: 'btn btn--accent', type: 'button', onclick: () => {
            const res = setStatus(c(), apptId, statusSelect.value, { actor: 'panel' });
            if (!res.ok) return fail(res.reason);
            if (!res.same) { store.logEvent('estado', `Estado cambiado desde el panel · ${a.name} · ${stampShort(a.start)} → ${STATUS[statusSelect.value]}`, apptId); commit(); refresh(); toast(`Estado: ${STATUS[statusSelect.value]}.`, { kind: 'ok' }); }
          } }, 'Guardar estado'))),

      h('section', { class: 'sec', 'aria-labelledby': 'sec-mover' },
        h('h3', { id: 'sec-mover' }, 'Mover la cita'),
        movable ? [
          h('div', { class: 'row' },
            quick('Un día antes', 'arrow-left', (s) => `${addDays(s.slice(0, 10), -1)}T${s.slice(11)}`), quick('Un día después', 'arrow-right', (s) => `${addDays(s.slice(0, 10), 1)}T${s.slice(11)}`),
            quick('30 min antes', 'clock', (s) => addMin(s, -30)), quick('30 min después', 'clock', (s) => addMin(s, 30))),
          h('div', { class: 'row' },
            h('div', { class: 'field' }, h('label', { for: 'mv-date' }, 'Fecha'), dateInput, dateText),
            h('div', { class: 'field' }, h('label', { for: 'mv-pro' }, 'Profesional'), proSelect),
            h('div', { class: 'field' }, h('label', { for: 'mv-time' }, 'Hora libre'), timeSelect)),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', ...(draft.notice ? { checked: true } : {}), onchange: (e) => { draft.notice = e.target.checked; } }), 'Avisar al paciente por WhatsApp (simulado)'),
          h('div', null, h('button', { class: 'btn btn--accent', type: 'button', disabled: !slots.length, onclick: () => doMove(draft.time || slots[0].start, draft.pro) }, 'Mover cita')),
        ] : h('p', { class: 'field__hint' }, 'Solo se pueden mover citas pendientes, confirmadas o reprogramadas.')),

      h('section', { class: 'sec', 'aria-labelledby': 'sec-pago' },
        h('h3', { id: 'sec-pago' }, 'Pago (simulado)'),
        a.payment
          ? h('p', { class: 'badge badge--ok', style: { justifySelf: 'start' } }, icon('check-circle', { size: 14 }), `Pago registrado: ${a.payment.method} · ${money(a.payment.amount)} · ${whenLabel(a.payment.at)}`)
          : h('div', { class: 'row' },
            h('div', { class: 'field' }, h('label', { for: 'pay-sel' }, 'Forma de pago'), methodSel),
            h('button', { class: 'btn', type: 'button', onclick: () => {
              a.payment = { method: methodSel.value, amount: total, at: Date.now(), simulated: true };
              store.logEvent('estado', `Pago simulado registrado · ${a.name} · ${methodSel.value} · ${money(total)}`, apptId);
              commit(); refresh(); toast('Pago simulado registrado. No se procesó ningún pago real.', { kind: 'ok' });
            } }, `Registrar ${money(total)}`)),
        h('p', { class: 'field__hint' }, svc.itbms ? `${money(price)} + ITBMS 7% (${money(price * ITBMS)}) = ${money(total)}. ` : `${money(price)}. `, 'Es solo una simulación: no se conecta con Yappy, tarjetas ni bancos.')),

      h('section', { class: 'sec', 'aria-labelledby': 'sec-hist' },
        h('h3', { id: 'sec-hist' }, 'Historial'),
        h('ol', { class: 'hist' }, a.history.map((x) => h('li', null, `${whenLabel(x.ts)} — ${x.text}`)))));
  }

  function refresh() { dlg.setBody(body()); const a = get(); if (a) dlg.setTitle(`Cita de ${a.name}`); }
  dlg = openDialog({ title: `Cita de ${get()?.name || ''}`, body: body(), wide: true });
  return dlg;
}

export function openNewApptModal(app, { dayKey = null, proId = null } = {}) {
  const { store } = app;
  const c = () => store.clinic();
  const cl = c();
  const svcs = activeServices(cl);
  const st = { serviceId: svcs[0]?.id, proId, date: dayKey && dayKey >= todayKey() ? dayKey : addDays(todayKey(), 1), time: null, name: '', phone: '' };
  const errs = {};
  let dlg;

  const prosFor = (sid) => cl.config.professionals.filter((p) => p.active !== false && p.serviceIds.includes(sid));
  function body() {
    if (!prosFor(st.serviceId).some((p) => p.id === st.proId)) st.proId = prosFor(st.serviceId)[0]?.id;
    const slots = slotChoices(cl, { serviceId: st.serviceId, professionalId: st.proId, dayKey: st.date });
    if (!slots.some((s) => s.start === st.time)) st.time = slots[0]?.start || null;
    const field = (id, label, input, key) => h('div', { class: 'field' }, h('label', { for: id }, label), input, errs[key] ? h('span', { class: 'field__error', id: `${id}-err` }, errs[key]) : null);
    const name = h('input', { id: 'nc-name', type: 'text', value: st.name, autocomplete: 'off', placeholder: 'Ej.: Ana Pérez', ...(errs.name ? { 'aria-invalid': 'true', 'aria-describedby': 'nc-name-err' } : {}), oninput: (e) => { st.name = e.target.value; } });
    const phone = h('input', { id: 'nc-phone', type: 'tel', value: st.phone, autocomplete: 'off', placeholder: '6000-0000', ...(errs.phone ? { 'aria-invalid': 'true', 'aria-describedby': 'nc-phone-err' } : {}), oninput: (e) => { st.phone = e.target.value; } });
    return h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
      h('p', { class: 'field__hint' }, 'Datos ficticios: no escriba información real. Solo nombre, teléfono, servicio y hora; nunca datos clínicos.'),
      h('div', { class: 'cfg__grid' },
        field('nc-name', 'Nombre', name, 'name'), field('nc-phone', 'Teléfono', phone, 'phone'),
        field('nc-svc', 'Servicio', h('select', { id: 'nc-svc', onchange: (e) => { st.serviceId = e.target.value; refresh(); } }, svcs.map((s) => h('option', { value: s.id, ...(s.id === st.serviceId ? { selected: true } : {}) }, `${s.name} (${s.minutes} min)`)))),
        field('nc-pro', 'Profesional', h('select', { id: 'nc-pro', onchange: (e) => { st.proId = e.target.value; refresh(); } }, prosFor(st.serviceId).map((p) => h('option', { value: p.id, ...(p.id === st.proId ? { selected: true } : {}) }, p.name)))),
        field('nc-date', 'Fecha', h('div', { class: 'date-field' },
          h('input', { id: 'nc-date', type: 'date', value: st.date, min: todayKey(), 'aria-describedby': 'nc-date-txt', oninput: (e) => { const t = e.target.parentNode.querySelector('.date-text'); if (t) t.textContent = dateWords(e.target.value); }, onchange: (e) => { st.date = e.target.value; refresh(); } }),
          h('span', { class: 'field__hint date-text', id: 'nc-date-txt', 'aria-live': 'polite' }, dateWords(st.date)))),
        field('nc-time', 'Hora libre', h('select', { id: 'nc-time', onchange: (e) => { st.time = e.target.value; } }, slots.length ? slots.map((s) => h('option', { value: s.start, ...(s.start === st.time ? { selected: true } : {}) }, time12(s.start.slice(11, 16)))) : h('option', { value: '' }, 'Sin horarios libres')))),
      h('div', { class: 'dlg__actions' }, h('button', { class: 'btn btn--accent', type: 'submit', disabled: !slots.length }, 'Crear cita')));
  }
  function submit() {
    errs.name = parseName(st.name) ? null : 'Escriba un nombre válido, por ejemplo: Ana Pérez.';
    errs.phone = parsePhone(st.phone) ? null : 'Escriba un teléfono de 7 u 8 dígitos, por ejemplo: 6000-0000.';
    if (errs.name || errs.phone) return refresh();
    const res = createAppointment(cl, { name: parseName(st.name), phone: parsePhone(st.phone), serviceId: st.serviceId, professionalId: st.proId, start: st.time, origin: 'panel' });
    if (!res.ok) { toast(REASONS[res.reason] || 'No se pudo crear la cita.', { kind: 'error' }); return refresh(); }
    store.logEvent('cita', `Cita creada desde el panel · ${res.appt.name} · ${getService(cl, st.serviceId).name} · ${stampShort(st.time)} · ${getPro(cl, st.proId).name}`, res.appt.id);
    store.commit({ type: 'change', touched: [res.appt.id] });
    dlg.close();
    toast('Cita creada.', { kind: 'ok' });
  }
  function refresh() { dlg.setBody(body()); }
  dlg = openDialog({ title: 'Nueva cita', body: body(), wide: true, labelledBy: 'dlg-new' });
  return dlg;
}
