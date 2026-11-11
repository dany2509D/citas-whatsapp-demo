// Portada: el giro primero (cambia marca, servicios, profesionales y textos del bot), el titular y el botón
// para probar el asistente, y a la derecha una historia en bucle: el paciente escribe en el teléfono y su cita
// entra a la agenda de al lado. Todo con los datos reales de la demo (mismos horarios libres que el chat).
import { h, $ } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { flip, reducedMotion, timeline } from '../../shared/ui/motion.js';
import { statusIcons } from '../../shared/whatsapp-sim/phone.js';
import { DAYS, addDays, dateLong, dayOfWeek, now, time12, todayKey } from '../../shared/time/panama.js';
import { GIROS, TEMPLATES } from '../data/templates.js';
import { dayHours, getPro, getService, kpis, suggestSlots } from '../agenda.js';
import { respond } from '../bot.js';
import { emptyConversation } from '../data/seed.js';
import { fill } from '../format.js';
import { logoNode } from '../logos.js';
import { avatar, badge } from '../ui/common.js';
import { sortInbox } from './admin-inbox.js';

let refocusGiro = false; // al cambiar de giro se vuelve a dibujar la portada: se devuelve el foco a la opción elegida

/** El día de la historia (mañana, o el próximo día que la clínica atiende), el servicio y el primer horario libre real. */
function story(app) {
  const { store } = app;
  const T = store.profile();
  const c = store.clinic();
  const today = todayKey();
  let day = addDays(today, 1);
  for (let i = 0; i < 7 && !dayHours(c, day); i++) day = addDays(day, 1);
  const services = c.config.services.filter((s) => s.active !== false);
  const svc = services[1] || services[0] || c.config.services[0];
  const slot = suggestSlots(c, { serviceId: svc.id, from: `${day}T00:00`, dayKey: day }, 1)[0]
    || { start: `${day}T08:00`, professionalId: c.config.professionals[0].id };
  const pro = getPro(c, slot.professionalId) || c.config.professionals[0];
  const tomorrow = day === addDays(today, 1);
  return {
    T, c, day, svc, pro, start: slot.start, time: time12(slot.start.slice(11, 16)),
    when: tomorrow ? 'mañana' : `el ${DAYS[dayOfWeek(day)]}`,
    title: tomorrow ? 'Agenda de mañana' : `Agenda del ${DAYS[dayOfWeek(day)]}`,
  };
}

/** Una fila de la agenda: hora, nombre con servicio y estado. */
const apptRow = (t, name, sub, status, cls = '') => h('div', { class: `mock__row${cls ? ` ${cls}` : ''}` },
  h('span', { class: 't' }, t), h('span', { class: 'who' }, h('b', null, name), h('small', null, sub)), badge(status));

/** Teléfono + agenda. Devuelve { el, play }; play() arranca el guion animado y devuelve su cierre. */
function productMock(app, s) {
  const { store } = app;
  const { T, c, day, svc, pro, when } = s;
  const dayAppts = c.appointments.filter((a) => a.start.slice(0, 10) === day && a.status !== 'cancelada');
  const newRow = apptRow(s.time, 'Ana Pérez', 'Nueva · WhatsApp', 'pendiente', 'mock__row--new');
  // La cita nueva entra en su lugar cronológico entre las de ese día; se muestran seis filas con ella en medio.
  const list = [
    ...dayAppts.map((a) => ({ start: a.start, node: apptRow(time12(a.start.slice(11, 16)), a.name, getService(c, a.serviceId)?.name || '', a.status) })),
    { start: s.start, node: newRow },
  ].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const idx = list.findIndex((x) => x.node === newRow);
  const from = Math.max(0, Math.min(idx - 2, list.length - 6));
  const rows = list.slice(from, from + 6).map((x) => x.node);
  rows.forEach((n, i) => n.style.setProperty('--r', String(i))); // escalonado de la entrada

  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const bubbles = [
    ['out', `Hola, quiero una cita para ${when}`],
    ['in', `¡Hola! ¿Qué servicio desea agendar? ${svc.name} (${svc.minutes} min)`],
    ['out', svc.name],
    ['in', `${cap(when)} a las ${s.time} con ${pro.name} ✅ ¿Confirma?`],
    ['out', 'sí'],
    ['in', '✅ Listo, Ana. Su cita quedó agendada.'],
  ].map(([dir, text], i) => h('div', { class: `mock__b mock__b--${dir}`, 'data-flip': `b${i}` }, text));
  const typing = h('div', { class: 'mock__typing', 'data-flip': 't' }, h('i'), h('i'), h('i'));
  const link = h('span', { class: 'mock__link' }, icon('arrow-right', { size: 18, stroke: 2.4 }));
  const send = h('span', { class: 'mock__send' }, icon('arrow-right', { size: 13, stroke: 2.8 }));
  const chat = h('div', { class: 'mock__chat' }, bubbles, typing);

  const el = h('div', { class: 'mock', 'aria-hidden': 'true' },
    h('div', { class: 'mock__phone wa-device' },
      h('div', { class: 'mock__screen' }, h('span', { class: 'wa-island' }),
        h('div', { class: 'mock__status' }, h('span', null, '9:41'), statusIcons()),
        h('div', { class: 'mock__phone-head' }, logoNode(store.state.giro), h('div', null, h('b', null, T.name), h('small', null, 'Asistente virtual · en línea'))),
        chat,
        h('div', { class: 'mock__bar' }, h('span', { class: 'mock__field' }, 'Escriba un mensaje'), send))),
    link,
    h('div', { class: 'mock__agenda' },
      h('div', { class: 'mock__agenda-head' }, logoNode(store.state.giro), h('div', null, h('b', null, s.title), h('small', null, dateLong(day)))),
      h('div', { class: 'mock__table' }, rows),
      h('div', { class: 'mock__agenda-foot' }, icon('activity', { size: 15 }), 'Las citas que agenda el asistente entran aquí al instante')));

  const showAll = () => { bubbles.forEach((b) => b.classList.add('is-on')); newRow.classList.add('is-on'); };
  const reset = () => { bubbles.forEach((b) => b.classList.remove('is-on')); typing.classList.remove('is-on'); newRow.classList.remove('is-on'); link.classList.remove('is-fire'); };

  function play() {
    if (reducedMotion()) { showAll(); return () => {}; }
    const tl = timeline();
    // Cada burbuja nueva empuja a las anteriores, que se deslizan hacia arriba (FLIP); las del paciente «salen» del botón de enviar.
    const on = (i) => {
      flip(chat, () => bubbles[i].classList.add('is-on'), { ms: 300, enter: '' });
      if (bubbles[i].classList.contains('mock__b--out')) { send.classList.remove('is-tap'); void send.offsetWidth; send.classList.add('is-tap'); }
    };
    // Los puntos de «escribiendo…» se colocan justo donde saldrá la próxima burbuja del asistente.
    const type = (v, i) => flip(chat, () => { if (v) chat.insertBefore(typing, bubbles[i]); typing.classList.toggle('is-on', v); }, { ms: 260, enter: '' });
    // Causa → efecto: la flecha se dispara y el horario libre de la agenda se convierte en la cita.
    const book = () => { link.classList.remove('is-fire'); void link.offsetWidth; link.classList.add('is-fire'); newRow.classList.add('is-on'); };
    (async () => {
      reset();
      if (!(await tl.wait(1100))) return;
      while (tl.alive) {
        const script = [
          [500, () => on(0)], [900, () => type(true, 1)], [1000, () => { type(false); on(1); }], [1100, () => on(2)],
          [800, () => type(true, 3)], [1000, () => { type(false); on(3); }], [1200, () => on(4)],
          [800, () => type(true, 5)], [1000, () => { type(false); on(5); }],
          [520, book],
          [4800, () => { el.querySelector('.mock__chat').classList.add('is-out'); }],
          [450, () => { el.querySelector('.mock__chat').classList.remove('is-out'); reset(); }],
        ];
        for (const [ms, fn] of script) { if (!(await tl.wait(ms))) return; fn(); }
        if (!(await tl.wait(500))) return;
      }
    })();
    return () => tl.stop();
  }
  return { el, play };
}

/** «Cómo funciona»: tres pasos numerados, cada uno con un fragmento verdadero del chat o del panel. */
function howSteps(app, s) {
  const { T, c, day, svc, pro } = s;
  const bub = (dir, text) => h('div', { class: `snip__b snip__b--${dir}` }, text);
  const snip = (...kids) => h('div', { class: 'snip', 'aria-hidden': 'true' }, kids);
  const step = (n, title, text, demo) => h('article', { class: 'how__step', 'data-reveal': '' },
    h('div', { class: 'how__top' }, h('span', { class: 'how__n', 'aria-hidden': 'true' }, String(n)), h('h2', null, title)),
    h('p', null, text), demo);

  // Respuesta real del asistente (misma función que usa el chat) a la frase del paciente, sobre una conversación de mentira.
  const ask = 'necesito cita pa mañana';
  let reply = '¿Qué servicio desea agendar?';
  try {
    const out = respond(c, emptyConversation('how', Date.now()), ask, { now: now(), profile: T, log: () => {} }).out;
    if (out.length) reply = out[out.length - 1].text;
  } catch { /* se queda el texto de respaldo */ }
  const confirm = fill(c.config.messages.confirm, {
    nombre: 'Ana', fecha: dateLong(day), hora: s.time, servicio: svc.name, profesional: pro.name, mascota: 'Luna', clinica: T.name,
  });
  const dayAppt = c.appointments.find((a) => a.start.slice(0, 10) === day && a.status === 'confirmada' && a.professionalId !== pro.id)
    || c.appointments.find((a) => a.start.slice(0, 10) === day && a.status !== 'cancelada');

  return h('section', { class: 'how', 'aria-labelledby': 'how-h' },
    step(1, 'El paciente escribe', 'Por WhatsApp, como habla. El asistente entiende, pregunta lo que falta y ofrece horarios libres reales.',
      snip(bub('out', ask), bub('in', reply))),
    step(2, 'El asistente agenda, confirma y recuerda', 'Crea la cita, recuerda el día anterior, reprograma o cancela y libera el horario. Si hay una urgencia, no agenda: deriva.',
      snip(bub('in', confirm))),
    step(3, 'La clínica lo ve todo', 'Calendario por profesional, estados de cada cita, indicadores y una bandeja con lo que necesita a una persona.',
      snip(h('div', { class: 'snip__rows' },
        apptRow(s.time, 'Ana Pérez', 'Nueva · WhatsApp', 'pendiente', 'is-new'),
        dayAppt ? apptRow(time12(dayAppt.start.slice(11, 16)), dayAppt.name, getService(c, dayAppt.serviceId)?.name || '', dayAppt.status) : null))));
}

/** «Lo que ve su recepción»: una vista real del panel (indicadores y bandeja con los datos de la demo). */
function panelPreview(app) {
  const { store } = app;
  const T = store.profile();
  const c = store.clinic();
  const k = kpis(c, now());
  const tile = (label, value, extra) => h('div', { class: 'pv__kpi' }, h('small', null, label), h('b', null, String(value)), extra || null);
  const tag = (v) => (v.flags.urgent && !v.resolved ? h('span', { class: 'badge badge--urgente' }, icon('alert', { size: 12, stroke: 2.6 }), 'URGENTE')
    : v.flags.handoff && !v.resolved ? h('span', { class: 'badge badge--humano' }, icon('user-check', { size: 12, stroke: 2.6 }), 'Atención humana')
      : h('span', { class: 'badge badge--atendida' }, 'Al día'));
  const last = (v) => { const m = [...v.messages].reverse().find((x) => x.from !== 'system'); return m ? (/no guardado/i.test(m.text || '') ? 'Mensaje no guardado por privacidad' : (m.text || 'Archivo adjunto').replace(/\s+/g, ' ')) : ''; };
  const convs = sortInbox(c.conversations).slice(0, 3);
  const tick = (text) => h('li', null, icon('check-circle', { size: 19 }), h('span', null, text));
  return h('section', { class: 'pvsec', 'aria-labelledby': 'pv-h' },
    h('div', { class: 'pvsec__copy', 'data-reveal': '' },
      h('span', { class: 'eyebrow' }, icon('dashboard', { size: 14 }), 'Panel de recepción'),
      h('h2', { id: 'pv-h' }, 'Su recepción ve solo lo que necesita atención.'),
      h('p', null, 'El asistente resuelve lo repetitivo. Lo urgente y lo que pide una persona sube al primer lugar, con la agenda siempre al día.'),
      h('ul', { class: 'ticks' },
        tick('Calendario por profesional: mueva una cita arrastrándola y el paciente recibe el aviso.'),
        tick('Urgencias y casos para una persona, siempre arriba en la bandeja.'),
        tick('Indicadores de la semana calculados al instante con sus propias citas.')),
      h('button', { class: 'btn btn--lg btn--pill btn--go', type: 'button', onclick: () => { app.admin.enter(); app.navigate('#/admin/agenda'); } }, 'Entrar como administrador', icon('arrow-right', { size: 17 }))),
    h('div', { class: 'pv', 'aria-hidden': 'true', 'data-reveal': '' },
      h('div', { class: 'pv__bar' }, h('i'), h('i'), h('i'), h('span', null, `Panel de recepción · ${T.name}`)),
      h('div', { class: 'pv__kpis' },
        tile('Citas de la semana', k.total),
        tile('Confirmadas', `${k.pctConfirmed}%`, h('div', { class: 'kpi__bar' }, h('i', { style: { '--p': String(k.pctConfirmed / 100) } }))),
        tile('Ausencias evitadas', k.avoided),
        tile('Pasaron a una persona', k.humans)),
      h('div', { class: 'pv__list' }, convs.map((v) => h('div', { class: 'pv__row' },
        avatar(v.name || 'Chat'), h('div', null, h('b', null, v.name || 'Chat de la demo'), h('small', null, last(v))), tag(v))))));
}

export function mountHome(root, app) {
  const { store } = app;
  const s = story(app);

  const cards = GIROS.map((g) => {
    const T = TEMPLATES[g];
    const input = h('input', { type: 'radio', name: 'giro', value: g, ...(store.state.giro === g ? { checked: true } : {}), onchange: () => { refocusGiro = true; store.setGiro(g); } });
    return h('label', { class: 'giro-card' }, input, h('span', { class: 'giro-card__logo' }, logoNode(g)), h('strong', null, T.giro));
  });

  const mock = productMock(app, s);

  root.append(h('div', { class: 'wrap' },
    h('section', { class: 'hero', 'aria-labelledby': 'h1' },
      h('div', { class: 'hero__copy' },
        h('fieldset', { class: 'giro-picker' }, h('legend', null, 'Su clínica:'), h('div', { class: 'giro-cards' }, cards)),
        h('h1', { id: 'h1', tabindex: '-1' }, 'Sus pacientes agendan solos por ', h('span', { class: 'hl' }, 'WhatsApp'), '. ', h('span', { class: 'hero__sub' }, 'Su equipo atiende solo lo que necesita una persona.')),
        h('div', { class: 'cta-row' },
          h('a', { class: 'btn btn--accent btn--lg btn--pill', href: '#/demo', id: 'cta-demo' }, icon('message', { size: 18 }), 'Probar el asistente'),
          h('button', { class: 'btn btn--lg btn--pill btn--ghost', type: 'button', id: 'cta-admin', onclick: () => { app.admin.enter(); app.navigate('#/admin/agenda'); } }, 'Ver el panel de recepción', icon('arrow-right', { size: 17 }))),
        h('ul', { class: 'hero__facts', 'aria-label': 'Lo que hace el asistente' },
          h('li', null, icon('clock', { size: 17 }), 'Agenda a cualquier hora'),
          h('li', null, icon('activity', { size: 17 }), 'La cita llega al panel al instante'),
          h('li', null, icon('shield', { size: 17 }), 'No guarda datos clínicos'))),
      mock.el),

    h('header', { class: 'sec-head', 'data-reveal': '' },
      h('span', { class: 'eyebrow' }, icon('message', { size: 14 }), 'Cómo funciona'),
      h('h2', { id: 'how-h' }, 'De un mensaje a una cita confirmada, sin llamadas.')),

    howSteps(app, s),

    panelPreview(app),

    h('aside', { class: 'trust', 'data-reveal': '' },
      h('span', null, icon('shield', { size: 20 }), h('span', null, h('strong', null, 'Privacidad: '), 'solo nombre, teléfono, servicio y hora. Nunca síntomas ni diagnósticos.')),
      h('span', null, icon('user-check', { size: 20 }), h('strong', null, 'Una persona del equipo revisa los casos importantes.'))),

    h('section', { class: 'cta-band', 'data-reveal': '', 'aria-labelledby': 'cta-h' },
      h('div', null, h('h2', { id: 'cta-h' }, 'Pruébelo como lo haría un paciente.'), h('p', null, 'Escriba «necesito cita pa mañana» en el teléfono y vea la cita aparecer en el panel de la clínica.')),
      h('div', { class: 'cta-band__act' },
        h('a', { class: 'btn btn--lg btn--pill btn--light', href: '#/demo' }, icon('message', { size: 18 }), 'Probar el asistente'),
        h('button', { class: 'btn btn--lg btn--pill btn--line', type: 'button', onclick: () => app.presentation.start() }, icon('play', { size: 16 }), 'Ver la presentación guiada')))));

  if (refocusGiro) { refocusGiro = false; $('input[name="giro"]:checked', root)?.focus({ preventScroll: true }); }
  else $('#h1', root)?.focus({ preventScroll: true });
  const stopMock = mock.play();
  return () => stopMock();
}
