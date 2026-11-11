// Panel · Configuración: horario de atención, servicios (duración y precio), profesionales,
// mensajes del bot y palabras de urgencia. Cada cambio válido se guarda y el bot lo usa en su
// siguiente respuesta; los vacíos o inválidos se rechazan con un mensaje claro.
import { h, clear } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { confirmDialog, toast } from '../../shared/ui/ui.js';
import { DAYS, addDays, dateLong, todayKey } from '../../shared/time/panama.js';
import { reducedMotion } from '../../shared/ui/motion.js';
import { UPCOMING, newId } from '../agenda.js';
import { fill, hoursSummary } from '../format.js';
import { cardHead } from '../ui/common.js';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MSG = {
  greeting: ['Saludo', '{clinica}'],
  pricesIntro: ['Precios: introducción', ''],
  pricesOutro: ['Precios: cierre (formas de pago)', ''],
  location: ['Ubicación', '{direccion} {telefono} {horario} {clinica}'],
  confirm: ['Cita confirmada', '{nombre} {fecha} {hora} {servicio} {profesional} {mascota} {clinica}'],
  reminder: ['Recordatorio del día anterior', '{nombre} {hora} {fecha} {servicio} {profesional}'],
  followup: ['Seguimiento', '{nombre} {mascota} {clinica}'],
  handoff: ['Pasar a una persona', '{clinica}'],
  urgent: ['Urgencia', '{telefono} {clinica}'],
};

/** Teléfono de emergencias: 911 o un número de 7 a 12 dígitos (con +, espacios o guiones). */
export const validEmergencyPhone = (v) => {
  const s = String(v).trim();
  const digits = s.replace(/\D/g, '');
  if (!s) return 'El teléfono de emergencias no puede quedar vacío.';
  if (!/^\+?[\d\s().-]+$/.test(s)) return 'Use solo números, espacios, guiones o +. Ej.: 911 o +507 6000-1234.';
  if (digits === '911' || digits === '112' || digits === '103') return null;
  return digits.length >= 7 && digits.length <= 12 ? null : 'Escriba 911 o un número de 7 a 12 dígitos. Ej.: +507 6000-1234.';
};

let pageKey = 'datos'; // última sección vista

export function mount(root, app) {
  const { store } = app;
  const c = () => store.clinic();
  let savedTimer = null;
  const saved = () => {
    store.commit({ type: 'config' });
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => toast('Cambios guardados: el asistente ya los usa.', { kind: 'ok', ms: 1800 }), 250);
  };

  /** Campo de una línea: valida al terminar de editar; si es válido guarda, si no, muestra el error. */
  function field({ id, label, value, type = 'text', hint, validate, save, attrs = {}, multiline = false, hideLabel = false, preview = null }) {
    const err = h('span', { class: 'field__error', id: `${id}-err`, hidden: true });
    const input = multiline
      ? h('textarea', { id, rows: attrs.rows || 4, 'aria-describedby': `${id}-err` }, value ?? '')
      : h('input', { id, type, value: value ?? '', 'aria-describedby': `${id}-err`, ...attrs });
    // Vista previa: la burbuja de WhatsApp tal como la verá el paciente, con datos de ejemplo en las {variables}
    let bubble = null;
    if (preview) {
      bubble = h('div', { class: 'wa-prev' }, h('small', null, 'Así lo verá el paciente en WhatsApp'), h('div', { class: 'wa-prev__b', 'aria-live': 'off' }, preview(value ?? '')));
      input.addEventListener('input', () => { bubble.querySelector('.wa-prev__b').textContent = preview(input.value); });
    }
    input.addEventListener('change', () => {
      const msg = validate ? validate(input.value) : null;
      if (msg) { input.setAttribute('aria-invalid', 'true'); err.textContent = msg; err.hidden = false; return; }
      input.removeAttribute('aria-invalid'); err.hidden = true;
      save(input.value); saved();
    });
    return h('div', { class: 'field' }, h('label', hideLabel ? { for: id, class: 'sr-only' } : { for: id }, label), input, hint ? h('span', { class: 'field__hint' }, hint) : null, err, bubble);
  }
  const required = (what) => (v) => (String(v).trim() ? null : `${what} no puede quedar vacío.`);
  const toggle = (id, label, checked, onChange) => h('label', { class: 'check', for: id }, h('input', { id, type: 'checkbox', ...(checked ? { checked: true } : {}), onchange: (e) => { onChange(e.target.checked); saved(); } }), label);

  // 1. Datos de la clínica
  const datos = () => h('section', { class: 'card', 'aria-labelledby': 'cfg-datos' },
    cardHead('map', 'Datos de la clínica', null, 'cfg-datos'),
    h('p', { class: 'field__hint' }, 'El asistente responde ubicación y teléfono con estos datos. Si los deja vacíos, dirá que no están configurados y ofrecerá pasar a una persona.'),
    h('div', { class: 'cfg__grid' },
      field({ id: 'cfg-phone', label: 'Teléfono de la clínica (se da en las urgencias)', value: c().config.phone, type: 'tel', save: (v) => { c().config.phone = v.trim(); } }),
      field({ id: 'cfg-phone-emerg', label: 'Teléfono de emergencias fuera de horario', value: c().config.telefonoEmergenciasFueraDeHorario ?? store.profile().telefonoEmergenciasFueraDeHorario ?? '', type: 'tel',
        hint: 'Con la clínica cerrada, las urgencias reciben este número (p. ej. 911 o una veterinaria 24 h) en lugar del teléfono de la clínica.',
        validate: validEmergencyPhone, save: (v) => { c().config.telefonoEmergenciasFueraDeHorario = v.trim(); } }),
      field({ id: 'cfg-address', label: 'Dirección', value: c().config.address, save: (v) => { c().config.address = v.trim(); } })));

  // 2. Horario
  function hoursRow(d) {
    const cfg = c().config; const cur = cfg.hours[d];
    const wrap = h('div', { class: 'hours-row' });
    const times = h('div', { class: 'times' });
    const err = h('span', { class: 'field__error', hidden: true, role: 'alert' });
    const paint = () => {
      const hr = cfg.hours[d];
      clear(times);
      if (!hr) { times.append(h('span', { class: 'field__hint' }, 'Cerrado')); return; }
      const open = h('input', { type: 'time', id: `h-o-${d}`, value: hr.open, 'aria-label': `${DAYS[d]}: abre` });
      const close = h('input', { type: 'time', id: `h-c-${d}`, value: hr.close, 'aria-label': `${DAYS[d]}: cierra` });
      const apply = () => {
        if (!open.value || !close.value || open.value >= close.value) { err.textContent = `${DAYS[d]}: la hora de cierre debe ser posterior a la de apertura.`; err.hidden = false; open.setAttribute('aria-invalid', 'true'); close.setAttribute('aria-invalid', 'true'); return; }
        err.hidden = true; open.removeAttribute('aria-invalid'); close.removeAttribute('aria-invalid');
        cfg.hours[d] = { open: open.value, close: close.value }; saved();
      };
      open.addEventListener('change', apply); close.addEventListener('change', apply);
      times.append(open, h('span', null, 'a'), close);
    };
    wrap.append(h('strong', null, DAYS[d].charAt(0).toUpperCase() + DAYS[d].slice(1)),
      toggle(`h-t-${d}`, 'Abierto', !!cur, (on) => { cfg.hours[d] = on ? { open: '08:00', close: '17:00' } : null; err.hidden = true; paint(); }),
      h('div', null, times, err));
    paint();
    return wrap;
  }
  const horario = () => {
    const cfg = c().config; const L = cfg.lunch || { start: '', end: '' };
    return h('section', { class: 'card', 'aria-labelledby': 'cfg-hor' },
      cardHead('clock', 'Horario de atención', null, 'cfg-hor'),
      DAY_ORDER.map(hoursRow),
      h('div', { class: 'cfg__grid', style: { marginTop: '12px' } },
        field({ id: 'cfg-ls', label: 'Almuerzo: desde (no se agenda)', type: 'time', value: L.start, validate: (v) => (v && cfg.lunch?.end && v >= cfg.lunch.end ? 'Debe ser antes de la hora final del almuerzo.' : null), save: (v) => { cfg.lunch = { ...(cfg.lunch || {}), start: v }; } }),
        field({ id: 'cfg-le', label: 'Almuerzo: hasta', type: 'time', value: L.end, validate: (v) => (v && cfg.lunch?.start && v <= cfg.lunch.start ? 'Debe ser después de la hora inicial del almuerzo.' : null), save: (v) => { cfg.lunch = { ...(cfg.lunch || {}), end: v }; } }),
        h('div', { class: 'field' }, h('label', { for: 'cfg-slot' }, 'Bloques de agenda'),
          h('select', { id: 'cfg-slot', onchange: (e) => { cfg.slotMinutes = +e.target.value; saved(); } }, [15, 20, 30, 45, 60].map((m) => h('option', { value: m, ...(cfg.slotMinutes === m ? { selected: true } : {}) }, `Cada ${m} min`)))),
        field({ id: 'cfg-lead', label: 'Anticipación mínima para agendar (minutos)', type: 'number', value: cfg.leadMinutes ?? 60, attrs: { min: 0, max: 1440, step: 15 }, validate: (v) => (v !== '' && +v >= 0 && +v <= 1440 ? null : 'Escriba un número entre 0 y 1440.'), save: (v) => { cfg.leadMinutes = +v; } })));
  };

  // 3. Servicios
  const servicios = () => h('section', { class: 'card', 'aria-labelledby': 'cfg-svc' },
    cardHead('list', 'Servicios: duración y precio', null, 'cfg-svc'),
    h('p', { class: 'field__hint' }, 'Precios en balboas (B/.). Marque ITBMS 7% solo en los servicios que lo cobren; el asistente lo indica en los precios.'),
    c().config.services.map((s, i) => h('div', { class: 'svc-row' },
      field({ id: `sv-n-${s.id}`, label: 'Servicio', hideLabel: i > 0, value: s.name, validate: required('El nombre'), save: (v) => { s.name = v.trim(); } }),
      field({ id: `sv-m-${s.id}`, label: 'Minutos', hideLabel: i > 0, type: 'number', value: s.minutes, attrs: { min: 5, max: 480, step: 5 }, validate: (v) => (+v >= 5 && +v <= 480 ? null : 'Entre 5 y 480 minutos.'), save: (v) => { s.minutes = +v; } }),
      field({ id: `sv-p-${s.id}`, label: 'Precio (B/.)', hideLabel: i > 0, type: 'number', value: s.price, attrs: { min: 0, step: '0.01' }, validate: (v) => (v !== '' && +v >= 0 ? null : 'Escriba un precio válido.'), save: (v) => { s.price = Math.round(+v * 100) / 100; } }),
      toggle(`sv-i-${s.id}`, 'ITBMS 7%', !!s.itbms, (on) => { s.itbms = on; }),
      toggle(`sv-a-${s.id}`, 'Activo', s.active !== false, (on) => { s.active = on; }))));

  // 4. Profesionales
  const prosBox = h('div', { class: 'cfg' });
  function paintPros() {
    const cfg = c().config;
    clear(prosBox).append(h('section', { class: 'card', 'aria-labelledby': 'cfg-pro' },
      cardHead('users', 'Profesionales', null, 'cfg-pro'),
      h('div', { class: 'cfg' }, cfg.professionals.map((p) => {
        const hasFuture = c().appointments.some((a) => a.professionalId === p.id && UPCOMING.has(a.status));
        return h('fieldset', { class: 'pro-card' }, h('legend', null, p.name || 'Profesional'),
          h('div', { class: 'cfg__grid' },
            field({ id: `pr-n-${p.id}`, label: 'Nombre', value: p.name, validate: required('El nombre'), save: (v) => { p.name = v.trim(); } }),
            field({ id: `pr-s-${p.id}`, label: 'Especialidad', value: p.specialty, save: (v) => { p.specialty = v.trim(); } })),
          h('div', { class: 'field' }, h('span', { class: 'label' }, 'Días que atiende'),
            h('div', { class: 'checks' }, DAY_ORDER.map((d) => toggle(`pr-d-${p.id}-${d}`, DAYS[d].slice(0, 3), p.days.includes(d), (on) => { p.days = on ? [...new Set([...p.days, d])] : p.days.filter((x) => x !== d); })))),
          h('div', { class: 'field' }, h('span', { class: 'label' }, 'Servicios que ofrece'),
            h('div', { class: 'checks' }, cfg.services.map((s) => toggle(`pr-v-${p.id}-${s.id}`, s.name, p.serviceIds.includes(s.id), (on) => { p.serviceIds = on ? [...new Set([...p.serviceIds, s.id])] : p.serviceIds.filter((x) => x !== s.id); })))),
          h('div', { class: 'row' },
            toggle(`pr-a-${p.id}`, 'Activo', p.active !== false, (on) => { p.active = on; }),
            h('button', { class: 'btn btn--sm btn--danger-soft', type: 'button', disabled: hasFuture, title: hasFuture ? 'Tiene citas próximas: muévalas o cancélelas primero.' : '', onclick: async () => {
              if (!(await confirmDialog({ title: 'Quitar profesional', text: `¿Quitar a ${p.name} de la agenda?`, confirmLabel: 'Quitar', danger: true }))) return;
              cfg.professionals = cfg.professionals.filter((x) => x.id !== p.id); saved(); paintPros();
            } }, 'Quitar'),
            hasFuture ? h('span', { class: 'field__hint' }, 'Tiene citas próximas: no se puede quitar.') : null));
      })),
      h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn btn--sm', type: 'button', disabled: cfg.professionals.length >= 6, onclick: () => {
        cfg.professionals.push({ id: newId('p'), name: 'Nuevo profesional', specialty: '', days: [1, 2, 3, 4, 5], serviceIds: cfg.services.map((s) => s.id), active: true });
        saved(); paintPros();
      } }, 'Agregar profesional'))));
  }

  // 5. Mensajes del bot
  const mensajes = () => {
    const cfg = c().config; const T = store.profile();
    const sample = () => ({
      clinica: T.name, nombre: 'Ana', fecha: dateLong(addDays(todayKey(), 1)), hora: '8:00 a. m.', servicio: cfg.services[0]?.name || '', profesional: cfg.professionals[0]?.name || '',
      mascota: 'Luna', direccion: cfg.address, telefono: cfg.phone, horario: hoursSummary(c()),
    });
    return h('section', { class: 'card', 'aria-labelledby': 'cfg-msg' },
      cardHead('message', 'Mensajes del bot', null, 'cfg-msg'),
      h('p', { class: 'vars' }, 'Puede usar variables entre llaves; el asistente las reemplaza. Ej.: ', h('code', null, '{nombre}'), ', ', h('code', null, '{fecha}'), ', ', h('code', null, '{hora}'), '.'),
      h('div', { class: 'cfg' }, Object.entries(MSG).map(([key, [label, vars]]) => field({
        id: `msg-${key}`, label, multiline: true, value: cfg.messages[key], hint: vars ? `Variables: ${vars}` : null, preview: (v) => fill(v, sample()),
        validate: required('Este mensaje'), save: (v) => { cfg.messages[key] = v.trim(); },
      }))),
      h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn btn--sm', type: 'button', onclick: () => { cfg.messages = { ...T.messages }; saved(); toast('Mensajes restablecidos.'); app.navigate('#/admin/configuracion'); } }, 'Restablecer mensajes')));
  };

  // 6. Urgencias
  const urgencias = () => {
    const cfg = c().config; const T = store.profile();
    return h('section', { class: 'card', 'aria-labelledby': 'cfg-urg' },
      cardHead('alert', 'Palabras de urgencia', null, 'cfg-urg'),
      h('p', { class: 'field__hint' }, 'Si el mensaje contiene alguna, el asistente no agenda: da el teléfono de la clínica (o, fuera del horario de atención, el de emergencias), marca la conversación como URGENTE y ofrece pasar a una persona. Una por línea; termine con * para una raíz (envenen*).'),
      field({ id: 'cfg-urgent', label: 'Palabras o frases', multiline: true, value: cfg.urgentWords.join('\n'), attrs: { rows: 7 },
        validate: (v) => (v.split('\n').some((l) => l.trim()) ? null : 'Escriba al menos una palabra de urgencia.'),
        save: (v) => { cfg.urgentWords = v.split('\n').map((l) => l.trim()).filter(Boolean); } }),
      h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn btn--sm', type: 'button', onclick: () => { cfg.urgentWords = [...T.urgent]; saved(); toast('Palabras restablecidas.'); app.navigate('#/admin/configuracion'); } }, 'Restablecer palabras')));
  };

  // Menú fijo por secciones: salta a cada bloque y marca en cuál se está leyendo
  const sections = [['datos', 'Clínica', 'map', datos()], ['horario', 'Horario', 'clock', horario()], ['servicios', 'Servicios', 'list', servicios()],
    ['profesionales', 'Profesionales', 'users', prosBox], ['mensajes', 'Mensajes', 'message', mensajes()], ['urgencias', 'Urgencias', 'alert', urgencias()]];
  // Una sola sección a la vez (paginada): el menú cambia de página y recuerda en cuál se estaba.
  let current = pageKey;
  if (!sections.some((x) => x[0] === current)) current = 'datos';
  const show = (key, focus = false) => {
    current = key; pageKey = key;
    sections.forEach(([k, , , node]) => { node.hidden = k !== key; });
    nav.querySelectorAll('.cfg-nav__a').forEach((b) => b.setAttribute('aria-current', String(b.dataset.sec === key)));
    pager.replaceChildren(...pagerButtons(key));
    if (focus) { window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); }
  };
  const pagerButtons = (key) => {
    const i = sections.findIndex((x) => x[0] === key);
    const prev = sections[i - 1]; const next = sections[i + 1];
    return [
      prev ? h('button', { class: 'btn', type: 'button', onclick: () => show(prev[0], true) }, icon('arrow-left', { size: 16 }), prev[1]) : h('span'),
      h('span', { class: 'cfg-pager__n' }, `Sección ${i + 1} de ${sections.length}`),
      next ? h('button', { class: 'btn btn--accent', type: 'button', onclick: () => show(next[0], true) }, next[1], icon('arrow-right', { size: 16 })) : h('span'),
    ];
  };
  const pager = h('div', { class: 'cfg-pager' });
  const nav = h('nav', { class: 'cfg-nav', 'aria-label': 'Secciones de la configuración' }, sections.map(([key, label, ic, node]) => {
    node.id = `sec-${key}`;
    return h('button', { type: 'button', class: 'cfg-nav__a', dataset: { sec: key }, onclick: () => show(key, true) }, icon(ic, { size: 17 }), label);
  }));
  root.append(h('div', { class: 'cfg' }, h('p', { class: 'autosave' }, icon('check-circle', { size: 17 }), 'Los cambios se guardan solos: cada cambio válido se aplica al instante en el asistente.'),
    h('div', { class: 'cfg-layout' }, nav, h('div', { class: 'cfg' }, sections.map((x) => x[3]), pager))));
  paintPros();
  show(current);
  return () => { clearTimeout(savedTimer); };
}
