// Panel · Agenda: indicadores y calendario semanal por profesional. Las citas se mueven
// arrastrando o con botones (en la ventana de la cita); todo se valida contra la agenda real.
import { h, clear, replace } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { toast } from '../../shared/ui/ui.js';
import { rollTo } from '../../shared/ui/motion.js';
import {
  addDays, clock, dateLong, dateShort, dayOfWeek, fromMin, mondayOf, now, stampShort, time12, toMin, todayKey, weekDays,
} from '../../shared/time/panama.js';
import { REASONS, STATUS_KEYS, dayHours, getAppt, getPro, getService, kpis, moveAppointment, notifyPatient, weekAppts } from '../agenda.js';
import { firstName } from '../format.js';
import { stampLong } from '../../shared/time/panama.js';
import { openApptModal, openNewApptModal } from '../ui/appt-modal.js';
import { STATUS_ICON, apptSummary, avatar, badge, chipIcon, initials, statusInline } from '../ui/common.js';

const PX = 2.3; // píxeles por minuto (con esta escala una cita de 45 min tiene sitio para nombre, servicio, hora y estado)
const ALL = 'all'; // «Todos»: la semana con las citas de todos los profesionales, un color por profesional
const ui = { mode: null, modeChosen: false, proId: null, anchor: todayKey(), notice: true, showCanceled: false };
let prevK = null;
let lastView = null; // última vista dibujada: al cambiarla, el calendario baja a la primera cita

const hourLabel = (m) => { const hh = Math.floor(m / 60); return `${hh % 12 === 0 ? 12 : hh % 12} ${hh < 12 ? 'a. m.' : 'p. m.'}`; };

/** Reparte las citas de un día en carriles: las que se solapan quedan lado a lado (cada una con su ancho), las demás a todo el ancho. */
function lanesFor(list) {
  const sorted = [...list].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const out = []; let cluster = []; let ends = []; let clusterEnd = -1;
  const flush = () => { const n = ends.length; cluster.forEach((x) => out.push({ ...x, lanes: n })); cluster = []; ends = []; clusterEnd = -1; };
  for (const a of sorted) {
    const s = toMin(a.start.slice(11, 16)); const e = s + a.minutes;
    if (cluster.length && s >= clusterEnd) flush();
    let lane = ends.findIndex((end) => end <= s);
    if (lane === -1) { lane = ends.length; ends.push(e); } else ends[lane] = e;
    cluster.push({ a, lane }); clusterEnd = Math.max(clusterEnd, e);
  }
  if (cluster.length) flush();
  return out;
}

export function mount(root, app) {
  const { store } = app;
  const c = () => store.clinic();
  // Sin elección expresa de la persona: en móvil (<760 px) abre en «Día» (lista de tarjetas); en pantallas anchas, en «Semana».
  const defaultMode = () => (window.innerWidth < 760 ? 'dia' : 'semana');
  if (!ui.modeChosen) ui.mode = defaultMode();
  prevK = null; lastView = null; // cada visita a la pestaña vuelve a «entrar»: cifras que cuentan y citas que aparecen
  const activePros = () => c().config.professionals.filter((p) => p.active !== false);
  // Primer profesional que se muestra: el de la semana con más citas (el calendario no arranca vacío).
  const busiest = () => { const w = weekAppts(c(), todayKey()); return [...activePros()].sort((a, b) => w.filter((x) => x.professionalId === b.id).length - w.filter((x) => x.professionalId === a.id).length)[0]?.id; };
  if (ui.proId !== ALL && !activePros().some((p) => p.id === ui.proId)) ui.proId = busiest();

  const kpiBox = h('div', { class: 'kpis', role: 'group', 'aria-label': 'Indicadores de la semana' });
  const bar = h('div', { class: 'cal-bar' });
  const legend = h('div', { class: 'legend', 'aria-label': 'Estados de las citas' }, STATUS_KEYS.map((k) => badge(k)));
  const proLegend = h('div', { class: 'legend legend--pros', 'aria-label': 'Color de cada profesional' });
  const scroller = h('div', { class: 'cal-scroll', tabindex: '0', role: 'region', 'aria-label': 'Calendario por profesional' });
  let flash = new Set(); let flashTimer = null;

  root.append(kpiBox,
    h('details', { class: 'help' }, h('summary', null, 'Cómo se calculan los indicadores'),
      h('p', null, 'Citas de la semana: todas las de esta semana menos las canceladas. % confirmado: citas Confirmadas o Atendidas entre las citas de la semana (sin canceladas). Reprogramadas con aviso: citas movidas con aviso por WhatsApp, un cambio que evitó una ausencia. Conversaciones a una persona: las que el paciente pidió pasar a recepción o que recepción tomó.')),
    bar, proLegend, legend, scroller);

  // ---- Indicadores ----
  function paintKpis() {
    const k = kpis(c(), now());
    const cards = [
      ['Citas de la semana', k.total, `${k.canceled} canceladas aparte`, 'calendar', 'brand'],
      ['Confirmadas', `${k.pctConfirmed}%`, `${k.confirmed} de ${k.total} confirmadas o atendidas`, 'check-circle', 'ok'],
      ['Reprogramadas con aviso', k.avoided, 'ausencias evitadas', 'refresh', 'indigo'],
      ['Pasaron a una persona', k.humans, `${k.urgent} ${k.urgent === 1 ? 'urgente' : 'urgentes'} sin atender`, 'user-check', 'amber', k.urgent > 0],
    ];
    const first = !prevK;
    clear(kpiBox).append(...cards.map(([label, value, sub, ic, tone, alert], i) => {
      const val = h('div', { class: 'kpi__value' }, String(value));
      rollTo(val, String(value), first ? null : prevK[i]);
      return h('div', { class: 'kpi' },
        chipIcon(ic, tone, 22), h('div', { class: 'kpi__label' }, label), val, h('div', { class: `kpi__sub${alert ? ' kpi__sub--alert' : ''}` }, sub),
        i === 1 ? h('div', { class: 'kpi__bar', 'aria-hidden': 'true' }, h('i', { style: { '--p': String(k.pctConfirmed / 100) } })) : null);
    }));
    prevK = cards.map((x) => x[1]);
  }

  // ---- Barra de herramientas ----
  function rangeLabel() {
    if (ui.mode === 'dia') return dateLong(ui.anchor);
    const w = weekDays(ui.anchor);
    return `${dateShort(w[0])} – ${dateShort(w[6])}`;
  }
  function paintBar() {
    const shift = (n) => { ui.anchor = addDays(ui.anchor, ui.mode === 'dia' ? n : n * 7); paintBar(); paintCal(); };
    replace(bar,
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Vista del calendario' },
        h('button', { type: 'button', 'aria-pressed': String(ui.mode === 'semana'), onclick: () => { ui.mode = 'semana'; ui.modeChosen = true; paintBar(); paintCal(); } }, 'Semana'),
        h('button', { type: 'button', 'aria-pressed': String(ui.mode === 'dia'), onclick: () => { ui.mode = 'dia'; ui.modeChosen = true; paintBar(); paintCal(); } }, 'Día')),
      ui.mode === 'semana' ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Profesional' },
        h('button', { type: 'button', 'aria-pressed': String(ui.proId === ALL), onclick: () => { ui.proId = ALL; paintBar(); paintCal(); } }, 'Todos'),
        activePros().map((p) => h('button', { type: 'button', 'aria-pressed': String(p.id === ui.proId), onclick: () => { ui.proId = p.id; paintBar(); paintCal(); } }, p.name))) : null,
      h('div', { class: 'daynav' },
        h('button', { class: 'btn btn--sm btn--icon', type: 'button', 'aria-label': 'Anterior', onclick: () => shift(-1) }, icon('chevron-left', { size: 17 })),
        h('button', { class: 'btn btn--sm', type: 'button', onclick: () => { ui.anchor = todayKey(); paintBar(); paintCal(); } }, 'Hoy'),
        h('button', { class: 'btn btn--sm btn--icon', type: 'button', 'aria-label': 'Siguiente', onclick: () => shift(1) }, icon('chevron-right', { size: 17 })),
        h('span', { 'aria-live': 'polite', style: { marginLeft: '6px' } }, rangeLabel())),
      h('span', { class: 'grow' }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', ...(ui.notice ? { checked: true } : {}), onchange: (e) => { ui.notice = e.target.checked; } }), 'Avisar al mover'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', ...(ui.showCanceled ? { checked: true } : {}), onchange: (e) => { ui.showCanceled = e.target.checked; paintCal(); } }), 'Ver canceladas'),
      h('button', { class: 'btn btn--accent btn--sm', type: 'button', id: 'btn-new-appt', onclick: () => openNewApptModal(app, { dayKey: ui.mode === 'dia' ? ui.anchor : null, proId: ui.mode === 'semana' && ui.proId !== ALL ? ui.proId : null }) }, icon('plus', { size: 16, stroke: 2.6 }), 'Nueva cita'));
    // Con «Todos» hay un color por profesional: la leyenda dice cuál es cuál (en las otras vistas no hace falta).
    const showPros = allMode();
    proLegend.hidden = !showPros;
    replace(proLegend, showPros ? activePros().map((p) => h('span', { class: `pro-key pro-c${proIndex(p.id) % 6}` }, h('i', { 'aria-hidden': 'true' }), p.name)) : []);
  }

  // ---- Calendario ----
  const allMode = () => ui.mode === 'semana' && ui.proId === ALL;
  const proIndex = (id) => Math.max(0, c().config.professionals.findIndex((p) => p.id === id));
  const narrowMq = typeof matchMedia === 'function' ? matchMedia('(max-width: 759px)') : null;
  const asList = () => !!narrowMq?.matches && ui.mode === 'dia'; // en móvil el día es una lista de tarjetas, no una cuadrícula de horas

  function columns() {
    const cl = c();
    if (ui.mode === 'dia') return activePros().map((p) => ({ dayKey: ui.anchor, proId: p.id, title: p.name, sub: p.specialty, who: p.name, today: ui.anchor === todayKey() }));
    const p = ui.proId === ALL ? null : (getPro(cl, ui.proId) || activePros()[0]);
    return weekDays(ui.anchor)
      .filter((k) => dayHours(cl, k) || cl.appointments.some((a) => a.start.slice(0, 10) === k && (!p || a.professionalId === p.id)))
      .map((k) => ({ dayKey: k, proId: p ? p.id : ALL, title: dateShort(k).split(' ')[0].replace(/^./, (x) => x.toUpperCase()), sub: dateShort(k).split(' ').slice(1).join(' '), dnum: Number(k.slice(8, 10)), today: k === todayKey() }));
  }

  /** Línea roja con la hora actual (solo en el día de hoy, dentro del horario que se dibuja). */
  function nowLine(minM, maxM) {
    const m = toMin(clock(now()));
    if (m < minM || m > maxM) return null;
    return h('div', { class: 'cal__now', 'aria-hidden': 'true', style: { top: `${(m - minM) * PX}px` }, dataset: { min: String(minM) } }, h('span', null, time12(clock(now()))));
  }
  const moveNowLines = () => scroller.querySelectorAll('.cal__now').forEach((el) => {
    const m = toMin(clock(now())); el.style.top = `${(m - Number(el.dataset.min)) * PX}px`; el.firstChild.textContent = time12(clock(now()));
  });

  /** Contenido de un bloque del calendario según el alto que tiene: nombre, servicio completo y, si cabe, hora y estado. */
  function apptBody(cl, a, { tall, lanes, all }) {
    const narrow = lanes > 1;
    // Citas lado a lado (varios profesionales a la misma hora): poco ancho, solo lo esencial; el detalle sale al pasar el cursor y al abrir la cita.
    if (lanes > 2) return [h('b', null, initials(a.name)), h('span', { class: 'cal-appt__ic' }, icon(STATUS_ICON[a.status], { size: 12, stroke: 2.6 }))];
    if (lanes === 2) return [h('b', null, firstName(a.name)), h('span', { class: 'cal-appt__svc' }, icon(STATUS_ICON[a.status], { size: 11, stroke: 2.6 }), ` ${time12(a.start.slice(11, 16)).replace(' a. m.', '').replace(' p. m.', '')}`)];
    const name = all ? h('b', null, icon(STATUS_ICON[a.status], { size: 12, stroke: 2.8 }), ` ${a.name}`) : h('b', null, a.name);
    if (a.minutes < 30) return h('b', null, icon(STATUS_ICON[a.status], { size: 11, stroke: 2.8 }), ` ${time12(a.start.slice(11, 16))} · ${a.name}`);
    return [name, h('span', { class: 'cal-appt__svc' }, getService(cl, a.serviceId)?.name || ''),
      tall && !narrow ? h('span', { class: 'cal-appt__when' }, h('span', { class: 'cal-appt__t' }, time12(a.start.slice(11, 16))), ' ', statusInline(a.status)) : null];
  }

  function paintList() {
    const cl = c();
    const list = cl.appointments.filter((a) => a.start.slice(0, 10) === ui.anchor && (ui.showCanceled || a.status !== 'cancelada')).sort((a, b) => (a.start < b.start ? -1 : 1));
    clear(scroller).append(h('div', { class: 'day-list' }, list.length
      ? list.map((a) => h('button', { class: `day-card st-${a.status}`, type: 'button', 'aria-label': `${apptSummary(cl, a)}. Abrir cita`, onclick: () => openApptModal(app, a.id) },
        h('span', { class: 'day-card__time' }, time12(a.start.slice(11, 16))),
        h('span', { class: 'day-card__body' }, h('b', null, a.name), h('small', null, getService(cl, a.serviceId)?.name || ''), h('small', null, getPro(cl, a.professionalId)?.name || '')),
        badge(a.status)))
      : h('p', { class: 'empty' }, dayHours(cl, ui.anchor) ? 'No hay citas este día.' : 'La clínica no atiende este día.')));
  }

  function paintCal() {
    scroller.classList.toggle('is-list', asList());
    if (asList()) { paintList(); lastView = null; return; }
    const cl = c();
    const cols = columns();
    const hrs = cols.map((x) => dayHours(cl, x.dayKey)).filter(Boolean);
    const minM = Math.floor(Math.min(...(hrs.length ? hrs.map((x) => toMin(x.open)) : [480])) / 60) * 60;
    const maxM = Math.ceil(Math.max(...(hrs.length ? hrs.map((x) => toMin(x.close)) : [1020])) / 60) * 60;
    const total = (maxM - minM) * PX;
    const step = cl.config.slotMinutes || 30;
    const topOf = (m) => (m - minM) * PX;
    const all = allMode();

    const grid = h('div', { class: 'cal', style: { '--cols': cols.length || 1, '--px': `${PX}px` }, role: 'group', 'aria-label': ui.mode === 'dia' ? `Citas del ${dateLong(ui.anchor)} por profesional` : all ? 'Citas de la semana de todos los profesionales' : `Citas de la semana de ${getPro(cl, ui.proId)?.name || ''}` });
    grid.append(h('div', { class: 'cal__corner' }));
    for (const col of cols) grid.append(h('div', { class: `cal__head${col.today ? ' is-today' : ''}` }, col.dnum != null ? h('span', { class: 'cal__dnum' }, String(col.dnum)) : avatar(col.who), h('div', null, h('b', null, col.title), h('small', null, col.dnum != null ? col.sub : col.sub))));
    const times = h('div', { class: 'cal__times', style: { height: `${total}px` }, 'aria-hidden': 'true' });
    for (let m = minM; m < maxM; m += 60) times.append(h('span', { style: { top: `${Math.max(topOf(m), 8)}px` } }, hourLabel(m)));
    grid.append(times);

    const viewKey = `${ui.mode}|${ui.proId}|${ui.anchor}`;
    const entering = viewKey !== lastView;
    let enterN = 0;
    let drag = null;
    let earliest = Infinity;
    for (const col of cols) {
      const hours = dayHours(cl, col.dayKey);
      const pro = all ? null : getPro(cl, col.proId);
      const el = h('div', { class: `cal__col${col.today ? ' is-today' : ''}`, style: { height: `${total}px` }, dataset: { day: col.dayKey, pro: col.proId } });
      const off = (from, to, label) => { if (to > from) el.append(h('div', { class: 'cal__off', style: { top: `${topOf(from)}px`, height: `${(to - from) * PX}px` } }, label)); };
      if (!hours) off(minM, maxM, 'Cerrado');
      else if (!all && !pro?.days.includes(dayOfWeek(col.dayKey))) off(minM, maxM, 'No atiende');
      else {
        off(minM, toMin(hours.open), ''); off(toMin(hours.close), maxM, '');
        const L = cl.config.lunch;
        if (L?.start && L?.end) off(Math.max(toMin(L.start), toMin(hours.open)), Math.min(toMin(L.end), toMin(hours.close)), 'Almuerzo');
      }
      const live = new Set(activePros().map((p) => p.id));
      const mine = cl.appointments.filter((a) => a.start.slice(0, 10) === col.dayKey && (all ? live.has(a.professionalId) : a.professionalId === col.proId) && (ui.showCanceled || a.status !== 'cancelada'));
      for (const { a, lane, lanes } of lanesFor(mine)) {
        const startM = toMin(a.start.slice(11, 16));
        const hpx = Math.max(a.minutes * PX - 2, 30);
        const style = { top: `${topOf(startM)}px`, height: `${hpx}px`, '--e': Math.min(enterN++, 14) };
        if (lanes > 1) { style.left = `calc(${lane} * (100% - 8px) / ${lanes} + 4px)`; style.width = `calc((100% - 8px) / ${lanes} - 2px)`; style.right = 'auto'; }
        const block = h('button', {
          class: `cal-appt st-${a.status}${all ? ` is-pro pro-c${proIndex(a.professionalId) % 6}` : ''}${lanes > 1 ? ' is-narrow' : ''}${hpx >= 96 ? ' is-tall' : ''}${flash.has(a.id) ? ' flash' : ''}${entering ? ' is-enter' : ''}`, type: 'button', draggable: 'true', style,
          title: apptSummary(cl, a), 'aria-label': `${apptSummary(cl, a)}. Abrir cita para ver o mover`, onclick: () => openApptModal(app, a.id),
        }, apptBody(cl, a, { tall: hpx >= 96, lanes, all }));
        earliest = Math.min(earliest, startM);
        block.addEventListener('dragstart', (e) => {
          drag = { id: a.id, grab: e.clientY - block.getBoundingClientRect().top, pro: a.professionalId, h: hpx };
          e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', a.id);
          requestAnimationFrame(() => { if (drag) block.classList.add('is-dragging'); }); // un cuadro después: la imagen que arrastra el cursor conserva el aspecto normal
        });
        block.addEventListener('dragend', () => { block.classList.remove('is-dragging'); drag = null; grid.querySelectorAll('.cal__drop').forEach((x) => x.remove()); grid.querySelectorAll('.is-over').forEach((x) => x.classList.remove('is-over')); });
        el.append(block);
      }
      if (col.today) { const line = nowLine(minM, maxM); if (line) el.append(line); }
      const snap = (e) => {
        const raw = minM + (e.clientY - el.getBoundingClientRect().top - (drag?.grab ?? 0)) / PX;
        return Math.min(maxM - step, Math.max(minM, Math.round(raw / step) * step));
      };
      el.addEventListener('dragover', (e) => {
        if (!drag) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        el.classList.add('is-over');
        let line = el.querySelector('.cal__drop');
        if (!line) { line = h('div', { class: 'cal__drop', style: { height: `${drag.h}px` } }); el.append(line); }
        const m = snap(e); line.style.top = `${topOf(m)}px`; line.dataset.t = time12(fromMin(m));
      });
      el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) { el.classList.remove('is-over'); el.querySelector('.cal__drop')?.remove(); } });
      el.addEventListener('drop', (e) => {
        if (!drag) return;
        e.preventDefault();
        const id = drag.id; const m = snap(e); const proId = all ? drag.pro : col.proId; drag = null;
        el.classList.remove('is-over'); el.querySelector('.cal__drop')?.remove();
        moveByDrop(id, `${col.dayKey}T${fromMin(m)}`, proId);
      });
      grid.append(el);
    }
    clear(scroller).append(grid);
    // Al abrir o cambiar de vista, el calendario baja a la primera cita (menos media hora de aire).
    if (entering) { lastView = viewKey; scroller.scrollTop = Number.isFinite(earliest) ? Math.max(0, (earliest - minM - 30) * PX) : 0; }
  }

  function moveByDrop(id, start, proId) {
    const cl = c(); const a = getAppt(cl, id); if (!a) return;
    if (start === a.start && proId === a.professionalId) return;
    const old = a.start;
    const res = moveAppointment(cl, id, { start, professionalId: proId }, { notice: ui.notice, actor: 'panel' });
    if (!res.ok) { toast(REASONS[res.reason] || 'No se pudo mover la cita.', { kind: 'error' }); return; }
    if (ui.notice) notifyPatient(cl, a, `Hola ${firstName(a.name)}, su cita de ${getService(cl, a.serviceId).name} fue movida al ${stampLong(a.start)}. Si no le sirve, responda aquí para reprogramar.`);
    store.logEvent('estado', `Cita movida desde el panel · ${a.name} · ${stampShort(old)} → ${stampShort(a.start)} · el horario anterior quedó libre${ui.notice ? ' · aviso por WhatsApp (simulado)' : ''}`, id);
    store.commit({ type: 'change', touched: [id] });
    toast(ui.notice ? 'Cita movida. Se avisó al paciente por WhatsApp (simulado).' : 'Cita movida (sin aviso).', { kind: 'ok' });
  }

  paintKpis(); paintBar(); paintCal();
  const nowTimer = setInterval(moveNowLines, 60000); // la línea de la hora actual avanza sola
  const onNarrow = () => { if (!ui.modeChosen) ui.mode = defaultMode(); paintBar(); paintCal(); }; // al cruzar el ancho de un teléfono, el día cambia entre cuadrícula y lista
  narrowMq?.addEventListener?.('change', onNarrow);
  const unsub = store.subscribe((e) => {
    if (e.type === 'conv') return;
    if (e.type === 'change') {
      flash = new Set(e.touched || []);
      const t = (e.touched || []).map((id) => getAppt(c(), id)).find(Boolean);
      if (t) { const d = t.start.slice(0, 10); if (ui.mode === 'dia' ? false : mondayOf(d) !== mondayOf(ui.anchor)) { ui.anchor = d; paintBar(); } if (ui.mode === 'semana' && ui.proId !== ALL) ui.proId = t.professionalId; }
      clearTimeout(flashTimer); flashTimer = setTimeout(() => { flash = new Set(); }, 2400);
    }
    paintKpis(); paintCal(); if (e.type === 'change') paintBar();
  });
  return () => { unsub(); clearTimeout(flashTimer); clearInterval(nowTimer); narrowMq?.removeEventListener?.('change', onNarrow); };
}
