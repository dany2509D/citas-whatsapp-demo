// Asistente en modo guion: reglas y respuestas predefinidas que entienden variaciones simples
// del texto (tildes, mayúsculas, "pa mañana", números, "la segunda"). No usa IA.
//
// respond() recibe el texto, cambia los datos (cita creada, estado, banderas) y devuelve los
// mensajes del bot. Los datos se cambian en el acto: el panel lo ve antes de que el bot "termine de escribir".
//
// Flujo del guion (el modo IA real usa este mismo flujo como instrucciones; ver api/chat.js):
//   a) saludo con menú · b) agendar · c) recordatorio · d) reprogramar y cancelar · e) urgencias · f) seguimiento
import {
  MOBILE_HINT, compile, extractName, has, hasClockMention, hasHealthWords, isPanamaMobile, matchesAny, norm, parseAge, parseChoice, parseClock, parseDayPref,
  parseName, parsePhone, parsePrefsWeek, parseTimeOfDay, parseYesNo, phoneDisplay, stripNegatedPain, titleCase,
} from '../shared/chat-engine/nlu.js';
import { DAYS, DAYS_SHORT, addDays, dateLong, dateShort, dayOfWeek, stamp, stampLong, stampShort, time12, todayKey } from '../shared/time/panama.js';
import {
  REASONS, activeServices, closureOf, dayHours, earliestStart, upcomingClosures, freeSlots, getAppt, getPatient, getPro, getService, moveAppointment, patientByPhone, patientConflict,
  setStatus, slotProblem, upcomingForPhone, createAppointment, UPCOMING,
} from './agenda.js';
import { fill, firstName, hoursSummary, priceLabel } from './format.js';
import { PRIVACY_TIP, looksClinical } from './privacy.js';
import { FOLLOWUP_KIND, FOLLOWUP_SERVICE, computeFollowups, markFollowupSent } from './followups.js';

/** Evita el doble punto cuando una hora ("8:00 a. m.") cierra una frase. */
export const tidy = (t) => String(t).replace(/\b([ap])\. m\.\./g, '$1. m.');

export const MENU_TEXT = '1. Agendar cita\n2. Precios y horarios\n3. Ubicación\n4. Reprogramar o cancelar\n5. Hablar con una persona';
export const MENU_CHIPS = [
  { label: 'Agendar cita', text: 'Agendar cita' },
  { label: 'Precios y horarios', text: 'Precios y horarios' },
  { label: 'Ubicación', text: 'Ubicación' },
  { label: 'Reprogramar o cancelar', text: 'Reprogramar o cancelar' },
  { label: 'Hablar con una persona', text: 'Hablar con una persona' },
];
const MENU_ONLY = [{ label: 'Menú', text: 'menú' }];
export const HUMAN_CHIP = { label: 'Pasar a una persona', text: 'Hablar con una persona', kind: 'warn' };

const INTENTS = {
  persona: ['persona', 'humano', 'agente', 'asesor*', 'operador*', 'recepcionista', 'alguien', 'representante', 'hablar con recepcion'],
  cancelar: ['cancelar', 'cancela', 'cancelo', 'anular', 'anula', 'ya no voy a poder', 'no voy a poder ir', 'no podre asistir', 'no puedo ir', 'no voy a ir', 'dar de baja', 'no podre ir'],
  reprogramar: ['reprogramar', 'reprograma', 'reprogramo', 'reagendar', 'reagenda', 'cambiar mi cita', 'cambiar la cita', 'cambio de cita', 'mover mi cita', 'mover la cita', 'cambiar el horario', 'cambiar la hora', 'cambiar hora', 'otra fecha para mi cita', 'pasar mi cita', 'posponer'],
  precios: ['precio*', 'cuesta*', 'costo*', 'cuanto', 'cuantos', 'tarifa*', 'valor', 'cobran', 'horario', 'horarios', 'horario de atencion', 'horarios de atencion', 'hora de atencion', 'a que hora abren', 'a que hora cierran', 'abren', 'abre', 'cierran', 'cierra', 'abierto*', 'abierta*', 'atienden', 'atiende', 'hay atencion', 'dias de atencion', 'hasta que hora', 'lista de precios', 'servicios'],
  ubicacion: ['ubicacion', 'direccion', 'donde estan', 'donde queda', 'donde se encuentran', 'como llegar', 'mapa', 'donde'],
  agendar: ['agendar', 'agenda*', 'cita', 'citas', 'reservar', 'reserva*', 'turno', 'apartar', 'programar', 'sacar cita', 'pedir cita', 'solicitar cita', 'necesito una consulta', 'quiero una consulta', 'disponibilidad', 'cupo*'],
  menu: ['menu', 'inicio', 'opciones', 'volver', 'principal', 'empezar', 'empezar de nuevo', 'salir', 'asistente'],
  gracias: ['gracias', 'muchas gracias', 'agradezco'],
  saludo: ['hola', 'buenas', 'buenos dias', 'buen dia', 'buenas tardes', 'buenas noches', 'saludos', 'hey', 'hi'],
};
const MORE_SLOTS = ['otros horarios', 'otro horario', 'otras opciones', 'mas horarios', 'mas opciones', 'ninguno', 'ninguna', 'no me sirve', 'otra hora', 'otro dia', 'otra fecha', 'mas tarde', 'otros'];
const ANY_PRO = ['primero disponible', 'primer disponible', 'el primero', 'cualquiera', 'cualquier', 'el que sea', 'indiferente', 'no importa', 'me da igual', 'el que este'];
const BOOKING_STEPS = new Set(['svc', 'pro', 'slots', 'name', 'phone', 'alt_phone', 'pet_name', 'pet_species', 'pet_age', 'confirm']);
/** Molestias leves de la boca que conviene evaluar (no urgencia): el bot ofrece una evaluación en vez de la lista de precios. */
const EVAL_CONCERN = [/\bsangr\w*\b.*\bencia\w*\b|\bencia\w*\b.*\bsangr\w*\b/, /\bsensibilidad\b/, /\bcaries\b/, /\bmal aliento\b/];
const MENU_MAP = { 1: 'agendar', 2: 'precios', 3: 'ubicacion', 4: 'cambiar', 5: 'persona' };

/**
 * Palabras de urgencia (configurables en el panel) más una regla general de dolor intenso
 * ("dolor fuerte", "me duele muchísimo"). Antes de comparar se descartan las frases que NIEGAN el dolor
 * ("ya no tengo dolor", "no me duele mucho"), para no tratar como urgencia a quien dice que ya mejoró.
 * Criterio: un dolor leve ("dolor de cabeza leve, quiero una cita") no es urgencia y agenda;
 * "me duele mucho ..." sí lo es en los tres giros, aunque pida cita en la misma frase (se prefiere el falso positivo).
 */
const PAIN_RULES = [
  /\bdolor\b.*\b(fuerte|intenso|insoportable|terrible|muchisimo)\b|\b(fuerte|intenso|insoportable|terrible)\b.*\bdolor\b/,
  /\bduel(e|en)\b.*\b(fuerte|intenso|insoportable|terrible|muchisimo|demasiado)\b/,
];
export function isUrgent(c, text) {
  const t = stripNegatedPain(text);
  if (matchesAny(t, c.config.urgentWords || [], false)) return true;
  return PAIN_RULES.some((re) => re.test(t));
}
export const wantsHuman = (text) => matchesAny(text, INTENTS.persona);

function detectIntent(text) {
  const t = norm(text);
  const hit = (k) => INTENTS[k].some((p) => has(t, compile(p)));
  if (hit('persona')) return { name: 'persona' };
  const cancel = hit('cancelar'); const resched = hit('reprogramar');
  if (cancel || resched) return { name: 'cambiar', action: cancel && resched ? null : cancel ? 'cancelar' : 'reprogramar' };
  for (const k of ['precios', 'ubicacion', 'agendar', 'menu', 'gracias', 'saludo']) if (hit(k)) return { name: k };
  return null;
}

function detectService(c, text) {
  const t = norm(text);
  let best = null; let bestLen = 0;
  for (const s of activeServices(c)) {
    for (const k of [s.name, ...(s.kw || [])]) {
      const p = compile(k);
      if (typeof p === 'string' && has(t, p) && p.length > bestLen) { best = s; bestLen = p.length; }
    }
  }
  return best;
}

const TITLES = new Set(['lcda', 'lcdo', 'dr', 'dra', 'sra', 'sr']);
function detectPro(c, text) {
  if (matchesAny(text, ANY_PRO)) return 'any';
  const t = norm(text);
  for (const p of c.config.professionals.filter((x) => x.active !== false)) {
    const parts = norm(p.name).split(' ').filter((w) => w.length >= 4 && !TITLES.has(w));
    if (parts.some((w) => has(t, w))) return p.id;
  }
  return null;
}

/**
 * Identidad del chat: quién escribe por WhatsApp. Es el teléfono del chat (CIT-RF-03): el bot NO lo pide.
 * Si la conversación ya tiene teléfono / nombre (porque agendó antes o el bot le escribió primero), se usan;
 * si no, la persona ficticia del giro (conv.persona, o T.persona en estados antiguos).
 */
export function chatIdentity(conv, T) {
  const p = conv?.persona || T?.persona || null;
  return { name: conv?.name || p?.name || '', phone: conv?.phone || p?.phone || '', persona: p };
}
const chatPhone = (e) => chatIdentity(e.conv, e.T).phone;

const prosFor = (c, serviceId) => c.config.professionals.filter((p) => p.active !== false && p.serviceIds.includes(serviceId));
const isVet = (c) => c.giro === 'vet';
/**
 * Modo demo (solo la demo comercial): muestra la «pista» con un paciente ficticio y deja buscar citas con un número escrito en el chat.
 * En producción (modoDemo distinto de true) la identidad es SOLO el número de WhatsApp que escribe: nadie ve ni toca citas de otro número.
 */
export const isDemo = (c) => c?.config?.modoDemo === true;

function parsePrefs(text, today) {
  const prefs = {};
  const day = parseDayPref(text, today); if (day) prefs.day = day;
  const part = parseTimeOfDay(text); if (part) prefs.part = part;
  if (hasClockMention(text)) { const k = parseClock(text); if (k) prefs.clockAt = k; }
  if (!prefs.day) { const wk = parsePrefsWeek(text, today); if (wk) prefs.fromDay = wk; }
  return prefs;
}
const hasPrefs = (p) => !!(p && (p.day || p.part || p.clockAt || p.fromDay));
/** Desde cuándo buscar: lo más pronto posible, o desde el día pedido («la próxima semana»), lo que sea más tarde. */
const fromWithPrefs = (from, p) => (p?.fromDay && `${p.fromDay}T00:00` > from ? `${p.fromDay}T00:00` : from);
const prefsText = (p) => [p.fromDay && !p.day ? `a partir del ${dateLong(p.fromDay)}` : '', p.day ? `para el ${dateLong(p.day)}` : '', p.part ? `por la ${p.part === 'manana' ? 'mañana' : p.part}` : '', p.clockAt ? `a las ${time12(p.clockAt)}` : ''].filter(Boolean).join(' ');

// ---------------------------------------------------------------------------------------------

export function respond(c, conv, text, ctx) {
  const out = [];
  const e = {
    c, conv, ctx, T: ctx.profile, out, touched: new Set(),
    nowS: stamp(ctx.now), today: todayKey(),
    say(t, chips) { out.push(chips ? { text: tidy(t), chips } : { text: tidy(t) }); },
    log: (...a) => ctx.log?.(...a),
  };
  conv.script = conv.script || { step: 'menu', data: {}, misses: 0 };
  conv.resolved = false;
  run(e, String(text ?? ''));
  if (looksClinical(text) && !conv.script.tipShown && !conv.flags.urgent && conv.mode !== 'humano') {
    conv.script.tipShown = true;
    out.unshift({ text: PRIVACY_TIP });
  }
  return { out, touched: [...e.touched] };
}

function reset(e) { e.conv.script.step = 'menu'; e.conv.script.data = {}; e.conv.script.misses = 0; }

function run(e, text) {
  const { conv, c } = e;
  const S = conv.script;
  const t = norm(text);

  if (conv.mode === 'humano') return humanMode(e, t);
  if (isUrgent(c, text)) return urgentFlow(e);
  if (wantsHuman(text)) return handoffFlow(e);

  const short = t.split(' ').length <= 3;
  if (short && matchesAny(text, INTENTS.menu) && S.step !== 'name' && S.step !== 'pet_name') { reset(e); return greeting(e, 'Claro, volvamos al inicio.'); }
  if (BOOKING_STEPS.has(S.step) && matchesAny(text, ['cancelar', 'cancela', 'dejalo', 'olvidalo', 'no quiero agendar', 'ya no'], false) && short) {
    reset(e);
    return e.say('Listo, no agendé nada. ¿Puedo ayudarle con algo más?', MENU_CHIPS);
  }

  const handler = STEPS[S.step] || stepMenu;
  handler(e, text, t);
}

function greeting(e, intro) {
  const msg = fill(e.c.config.messages.greeting, { clinica: e.T.name });
  e.say(`${intro ? `${intro}\n` : ''}${msg}\n\n${MENU_TEXT}`, MENU_CHIPS);
}

// --- b) Menú y atajos ---------------------------------------------------------------------

function stepMenu(e, text) {
  const { c, conv } = e;
  const S = conv.script;
  const num = /^\s*([1-5])\s*[.)]?\s*$/.exec(text);
  const concern = !num && EVAL_CONCERN.some((re) => re.test(norm(text))) ? evalService(c) : null;
  if (concern) return evalOffer(e, text, concern);
  let intent = num ? { name: MENU_MAP[num[1]] } : detectIntent(text);
  // «Hola, quiero una limpieza…»: el saludo (o un «gracias») no tapa el servicio pedido en la misma frase.
  if ((!intent || intent.name === 'saludo' || intent.name === 'gracias') && detectService(c, text)) intent = { name: 'agendar' };
  if (!intent && hasHealthWords(text)) return healthOffer(e);
  if (!intent) {
    S.misses = (S.misses || 0) + 1;
    const extra = S.misses >= 2 ? '\nSi prefiere, una persona del equipo puede ayudarle.' : '';
    return e.say(`No estoy seguro de haber entendido 🤔. Puedo ayudarle con:\n${MENU_TEXT}${extra}`, S.misses >= 2 ? [...MENU_CHIPS.slice(0, 4), HUMAN_CHIP] : MENU_CHIPS);
  }
  S.misses = 0;
  switch (intent.name) {
    case 'agendar': return startBooking(e, text);
    case 'precios': return pricesFlow(e, text);
    case 'ubicacion': return locationFlow(e);
    case 'cambiar': return startChange(e, text, intent.action);
    case 'persona': return handoffFlow(e);
    case 'gracias': return e.say('¡Con gusto! Si necesita algo más, aquí estoy.', MENU_CHIPS);
    default: return greeting(e);
  }
}

const evalService = (c) => activeServices(c).find((s) => s.id === 'evaluacion') || activeServices(c).find((s) => s.id === 'consulta') || null;

/** Molestia leve: no es urgencia ni se promete un diagnóstico; se ofrece una evaluación y se sigue con el agendamiento. */
function evalOffer(e, text, svc) {
  e.conv.script.misses = 0;
  e.say(`Gracias por avisar. Eso conviene que lo revise un profesional; por este medio no puedo valorar síntomas, pero le ofrezco agendar una ${svc.name.toLowerCase()}.`);
  return startBooking(e, text, { serviceId: svc.id });
}

/** Mensaje de salud que no encaja en ninguna intención: en vez de «no entendí», se ofrece pasar a una persona. */
function healthOffer(e) {
  const { conv } = e;
  conv.script.misses = 0;
  conv.script.step = 'offer_human'; conv.script.data = {};
  e.say('Gracias por contarme. Por este medio no puedo valorar síntomas ni dar indicaciones de salud, pero una persona del equipo puede orientarle. ¿Desea que le contacte?',
    [HUMAN_CHIP, { label: 'Agendar cita', text: 'Agendar cita' }, ...MENU_ONLY]);
}

// --- Precios, horarios y preguntas puntuales (CIT-RF-09) --------------------------------------------
// Todo se responde desde la configuración (c.config); nada se inventa. La lista completa solo si la piden.

const PRICE_WORDS = ['precio*', 'cuesta*', 'costo*', 'cuanto', 'cuantos', 'tarifa*', 'valor', 'cobran', 'cobra'];
const HOURS_WORDS = ['horario*', 'hora de atencion', 'horas de atencion', 'abren', 'abre', 'abrir', 'apertura', 'cierran', 'cierra', 'cierre', 'abierto*', 'abierta*',
  'atienden', 'atiende', 'hay atencion', 'dias de atencion', 'hasta que hora'];
const WEEKDAY_NAMES = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 0 };
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/** Servicios activos que el texto menciona (por nombre o palabras clave), en el orden de la configuración. */
function mentionedServices(c, text) {
  const t = norm(text);
  return activeServices(c).filter((s) => [s.name, ...(s.kw || [])].some((k) => { const p = compile(k); return typeof p === 'string' && has(t, p); }));
}

/**
 * Días que el texto menciona: hoy, mañana, pasado mañana, una fecha («el 28 de noviembre»), un día de la semana o el fin de semana.
 * Si se refiere a un día concreto (no «los sábados» en general) lleva `key` ('YYYY-MM-DD') para revisar feriados y cierres.
 */
function mentionedDays(text, today) {
  const t = norm(text);
  const out = [];
  const add = (dow, label, key = null) => { if (!out.some((d) => d.dow === dow)) out.push({ dow, key, label: `${label}${label === 'El' ? ' ' : ' ('}${DAYS[dow]}${label === 'El' ? '' : ')'}` }); };
  if (/\bhoy\b/.test(t)) add(dayOfWeek(today), 'Hoy', today);
  if (/\bpasado manana\b/.test(t)) add(dayOfWeek(addDays(today, 2)), 'Pasado mañana', addDays(today, 2));
  else if (/\bmanana\b/.test(t.replace(/\b(en|por|de|a|durante|para) la manana\b/g, ' '))) add(dayOfWeek(addDays(today, 1)), 'Mañana', addDays(today, 1));
  // Una fecha con número («el 28», «28 de noviembre», «el lunes 16»).
  const exact = /\d/.test(t) ? parseDayPref(text, today) : null;
  if (exact && !out.some((d) => d.key === exact)) out.push({ dow: dayOfWeek(exact), key: exact, label: `El ${dateLong(exact)}` });
  for (const [name, dow] of Object.entries(WEEKDAY_NAMES)) {
    if (out.some((d) => d.dow === dow)) continue;
    if (new RegExp(`\\b${name}\\b`).test(t)) { let k = today; while (dayOfWeek(k) !== dow) k = addDays(k, 1); add(dow, 'El', k); } // «el sábado»: el próximo
    else if (new RegExp(`\\b${name}s\\b`).test(t)) add(dow, 'El'); // «los sábados»: en general
  }
  if (/\bfines? de semana\b/.test(t)) { add(6, 'El'); add(0, 'El'); }
  return out;
}

/** «es feriado (Navidad)» o «la clínica estará cerrada (vacaciones)». */
const closureWhy = (z) => (z.kind === 'propio' ? `la clínica estará cerrada (${z.name})` : `es feriado (${z.name})`);
/** Aviso cuando el día pedido está cerrado por feriado o por un cierre propio; null si abre normal. */
function closedNote(c, day) {
  const z = day && closureOf(c, day);
  if (!z) return null;
  return z.kind === 'propio' ? `El ${dateLong(day)} la clínica estará cerrada (${z.name})` : `El ${dateLong(day)} es feriado (${z.name}) y no atendemos`;
}

function dayHoursLine(c, d, text) {
  const z = d.key && closureOf(c, d.key);
  if (z) return `${d.label} no atendemos: ${closureWhy(z)}.`;
  const h = c.config.hours[d.dow];
  if (!h) return `${d.label} no atendemos.`;
  const t = norm(text);
  const asksOpen = /\b(abren|abre|abrir|apertura|abierto|abierta)\b/.test(t); const asksClose = /\b(cierran|cierra|cierre)\b/.test(t);
  if (asksOpen || asksClose) return `${d.label} abrimos a las ${time12(h.open)} y cerramos a las ${time12(h.close)}.`;
  return `${d.label} atendemos de ${time12(h.open)} a ${time12(h.close)}.`;
}

const serviceLine = (s) => `${s.name}: ${priceLabel(s)} (${s.minutes} min)${s.sessions ? ` · incluye ${s.sessions} sesiones` : ''}`;
/** Horario semanal y, si hay, los próximos feriados o cierres (30 días) que caen en días en que normalmente se abre. */
function hoursBlock(c) {
  if (Object.values(c.config.hours).every((h) => !h)) return 'Horario de atención:\nAún no tengo el horario de atención configurado.';
  const next = upcomingClosures(c, todayKey(), 30).slice(0, 3);
  const extra = next.length ? `\n\nPróximos feriados y cierres (no atendemos):\n${next.map((x) => `• ${cap(dateLong(x.date))}: ${x.name}`).join('\n')}` : '';
  return `Horario de atención:\n${hoursSummary(c)}${extra}`;
}

function pricesFlow(e, text = '') {
  const { c } = e;
  const svcs = activeServices(c);
  if (!svcs.length) return e.say('Aún no tengo los servicios y precios configurados. ¿Desea que una persona del equipo le ayude?', [HUMAN_CHIP, ...MENU_ONLY]);
  const asksPrice = matchesAny(text, PRICE_WORDS);
  const asksHours = matchesAny(text, HOURS_WORDS);
  const days = asksHours ? mentionedDays(text, e.today) : [];
  const mentioned = asksPrice ? mentionedServices(c, text) : [];
  const priceLinesFor = mentioned.length && mentioned.length < svcs.length;
  const book = [{ label: 'Agendar cita', text: 'Agendar cita' }];
  const more = [{ label: 'Lista de precios', text: 'lista de precios' }, ...MENU_ONLY];

  // Pregunta sobre una lesión o un síntoma ("¿atienden lesiones de rodilla?"): sin afirmar nada clínico, se ofrece una evaluación o una persona.
  if (hasHealthWords(text) && !mentioned.length) return evalAnswer(e, days.length ? days.map((d) => dayHoursLine(c, d, text)).join('\n') : '');

  const parts = [];
  if (days.length) parts.push(days.map((d) => dayHoursLine(c, d, text)).join('\n'));
  if (priceLinesFor) parts.push(mentioned.map(serviceLine).join('\n'));
  if (parts.length) {
    if (asksHours && !days.length) parts.push(hoursBlock(c));
    const chips = mentioned.length === 1 && priceLinesFor ? [{ label: `Agendar ${mentioned[0].name.toLowerCase()}`, text: mentioned[0].name }] : book;
    return e.say(parts.join('\n\n'), [...chips, ...(priceLinesFor ? more : [{ label: 'Ubicación', text: 'Ubicación' }, ...MENU_ONLY])]);
  }
  if (asksHours && !asksPrice) return e.say(hoursBlock(c), [...book, { label: 'Ubicación', text: 'Ubicación' }, ...MENU_ONLY]);

  const lines = svcs.map((s) => `• ${s.name} — ${s.minutes} min — ${priceLabel(s)}`);
  e.say(`${c.config.messages.pricesIntro}\n${lines.join('\n')}\n\n${hoursBlock(c)}\n\n${c.config.messages.pricesOutro}`,
    [...book, { label: 'Ubicación', text: 'Ubicación' }, ...MENU_ONLY]);
}

/** Lesión o síntoma mencionado en una pregunta: no se valora nada por aquí; se ofrece una evaluación o una persona del equipo. */
function evalAnswer(e, before = '') {
  const { c, conv } = e;
  const svc = evalService(c);
  conv.script.misses = 0;
  conv.script.data = {};
  const intro = `${before ? `${before}\n\n` : ''}Por este medio no puedo valorar lesiones ni síntomas, ni dar indicaciones de salud.`;
  if (!svc) { conv.script.step = 'offer_human'; return e.say(`${intro} Una persona del equipo puede orientarle. ¿Desea que le contacte?`, [HUMAN_CHIP, ...MENU_ONLY]); }
  conv.script.step = 'offer_eval'; conv.script.data = { serviceId: svc.id };
  e.say(`${intro} Con «${svc.name}» un profesional puede revisarlo (${svc.minutes} min · ${priceLabel(svc)}). ¿Desea agendarla o prefiere que una persona del equipo le contacte?`,
    [{ label: `Agendar ${svc.name.toLowerCase()}`, text: svc.name }, HUMAN_CHIP, ...MENU_ONLY]);
}

function stepOfferEval(e, text, t) {
  const { conv } = e;
  const d = conv.script.data;
  const yn = parseYesNo(text);
  if (yn === 'si' && t.split(' ').length <= 3) return startBooking(e, '', { serviceId: d.serviceId });
  if (yn === 'no' && t.split(' ').length <= 3) { reset(e); return e.say('Entendido. Si cambia de opinión, aquí estoy. ¿Puedo ayudarle con algo más?', MENU_CHIPS); }
  conv.script.step = 'menu';
  return stepMenu(e, text);
}

function locationFlow(e) {
  const { c } = e;
  if (!c.config.address?.trim()) return e.say('Aún no tengo la dirección de la clínica configurada. ¿Desea que una persona del equipo se la confirme?', [HUMAN_CHIP, ...MENU_ONLY]);
  e.say(fill(c.config.messages.location, {
    direccion: c.config.address, telefono: c.config.phone?.trim() || '(teléfono no configurado)', clinica: e.T.name, horario: hoursSummary(c),
  }), [{ label: 'Agendar cita', text: 'Agendar cita' }, { label: 'Precios y horarios', text: 'Precios y horarios' }, ...MENU_ONLY]);
}

// --- e) Urgencias y atención humana ----------------------------------------------------------

/** ¿La clínica está atendiendo ahora según c.config.hours (hora de Panamá)? El almuerzo cuenta como abierto: el teléfono se contesta. */
export function isOpenNow(c, nowS) {
  const h = dayHours(c, nowS.slice(0, 10));
  if (!h) return false;
  const t = nowS.slice(11, 16);
  return t >= h.open && t < h.close;
}

/** Dentro del horario: teléfono de la clínica. Fuera: número de emergencias del giro (con respaldo en la plantilla y, al final, el de la clínica). */
export function urgentPhone(c, T, open) {
  const clinic = c.config.phone?.trim();
  if (open) return clinic || '';
  return c.config.telefonoEmergenciasFueraDeHorario?.trim() || T?.telefonoEmergenciasFueraDeHorario || clinic || '';
}

function urgentFlow(e) {
  const { c, conv } = e;
  conv.flags.urgent = true;
  conv.script.step = 'urgent'; conv.script.data = {};
  e.touched.add('conv');
  e.log('urgente', `URGENTE · ${conv.name || 'Visitante de la demo'} · conversación marcada como urgente; el bot no agenda`);
  const open = isOpenNow(c, e.nowS);
  const phone = urgentPhone(c, e.T, open);
  const msg = phone ? `${open ? '' : 'En este momento la clínica está fuera de horario de atención. '}${fill(c.config.messages.urgent, { telefono: phone, clinica: e.T.name })}`
    : 'Por lo que describe, esto puede ser una urgencia. No tengo el teléfono de la clínica configurado: acuda al servicio de urgencias más cercano. Por este medio no agendo urgencias.\n\n¿Desea que una persona del equipo le contacte?';
  e.say(msg, [HUMAN_CHIP, { label: 'Volver al menú', text: 'menú' }]);
}

function stepUrgent(e, text) {
  const yn = parseYesNo(text);
  if (yn === 'si') return handoffFlow(e);
  if (yn === 'no' && norm(text).split(' ').length <= 3) {
    reset(e);
    return e.say('Entendido. Si cambia de opinión, escriba «persona» y el equipo le atenderá. ¿Puedo ayudarle con algo más?', MENU_CHIPS);
  }
  e.conv.script.step = 'menu';
  return stepMenu(e, text);
}

export function handoffFlow(e) {
  const { c, conv } = e;
  const already = conv.flags.handoff && conv.mode === 'humano';
  conv.flags.handoff = true; conv.mode = 'humano';
  conv.script.step = 'menu'; conv.script.data = {}; conv.script.humanAck = false;
  e.touched.add('conv');
  if (!already) e.log('humano', `${conv.name || 'Visitante de la demo'} pasó a una persona · conversación marcada para atención humana${conv.flags.urgent ? ' (URGENTE)' : ''}`);
  e.say(fill(c.config.messages.handoff, { clinica: e.T.name }));
}

function humanMode(e, t) {
  const { conv } = e;
  if (matchesAny(t, ['menu', 'asistente', 'volver', 'inicio'])) { conv.mode = 'bot'; conv.script.humanAck = false; reset(e); e.touched.add('conv'); return greeting(e, 'Con gusto, vuelvo a ayudarle.'); }
  if (conv.script.humanAck) return; // ya se avisó una vez; el equipo responde desde el panel
  conv.script.humanAck = true;
  e.say('Su mensaje quedó registrado. Una persona del equipo le responderá en horario de atención. Si prefiere volver al asistente, escriba «menú».', [{ label: 'Volver al asistente', text: 'menú' }]);
}

// --- b) Agendar ---------------------------------------------------------------------------------

// Especies de mascota que se reconocen en el texto ("vacunar a mi perro", "mi gata").
const SPECIES = [
  ['Perro', /\b(perro|perra|perros|perrito|perrita|cachorro|cachorra|can)\b/], ['Gato', /\b(gato|gata|gatos|gatito|gatita|felino)\b/],
  ['Conejo', /\bconej\w*\b/], ['Hámster', /\bh?amster\b/], ['Cobayo', /\b(cobayo|cobaya|cuy)\b/], ['Ave', /\b(ave|aves|loro|perico|canario|pajaro)\b/], ['Tortuga', /\btortuga\w*\b/],
];
export function detectSpecies(text) {
  const t = norm(text);
  const hit = SPECIES.find(([, re]) => re.test(t));
  return hit ? hit[0] : null;
}
/** 'Perra' y 'Perro' son la misma especie para el registro (el sexo no importa aquí). */
const speciesKey = (s) => { const t = norm(s); return /^perr|^cachorr/.test(t) ? 'perro' : /^gat/.test(t) ? 'gato' : t; };

/** Datos que la persona ya dio en un mensaje (día, franja, hora, especie): se recuerdan para no volver a preguntarlos. */
function learn(e, text) {
  const d = e.conv.script.data;
  if (isVet(e.c)) { const sp = detectSpecies(text); if (sp) d.species = sp; }
  if (!d.name) { const n = extractName(text); if (n) d.name = n; } // «…soy Carlos»: no se vuelve a preguntar
}

function startBooking(e, text, preset = {}) {
  const { c, conv } = e;
  const d = { prefs: parsePrefs(text, e.today), seen: [], ...preset };
  const svc = preset.serviceId ? getService(c, preset.serviceId) : detectService(c, text);
  if (svc) d.serviceId = svc.id;
  const pro = detectPro(c, text);
  if (pro) d.professionalId = pro;
  if (!d.phone) d.phone = chatPhone(e); // el teléfono es el del chat: no se pide
  conv.script.step = 'svc'; conv.script.data = d;
  learn(e, text);
  advance(e);
}

function advance(e) {
  const { c } = e;
  const d = e.conv.script.data;
  if (!d.serviceId) return askService(e);
  const pros = prosFor(c, d.serviceId);
  if (!pros.length) return e.say('Por ahora no tengo profesionales disponibles para ese servicio. ¿Desea que una persona del equipo le ayude?', [HUMAN_CHIP, ...MENU_ONLY]);
  if (!d.professionalId) { if (pros.length === 1) d.professionalId = pros[0].id; else return askPro(e, pros); }
  offerSlots(e);
}

function askService(e, prefix = '') {
  const svcs = activeServices(e.c);
  e.conv.script.step = 'svc';
  if (!svcs.length) return e.say('Aún no tengo servicios configurados. ¿Desea que una persona del equipo le ayude?', [HUMAN_CHIP, ...MENU_ONLY]);
  e.say(`${prefix}¿Qué servicio desea agendar?\n${svcs.map((s, i) => `${i + 1}. ${s.name} (${s.minutes} min · ${priceLabel(s)})`).join('\n')}`,
    svcs.map((s) => ({ label: s.name, text: s.name })));
}

function stepSvc(e, text) {
  const { c, conv } = e;
  const d = conv.script.data;
  const svcs = activeServices(c);
  const n = parseChoice(text, svcs.length);
  const named = detectService(c, text);
  const svc = named || (n ? svcs[n - 1] : null);
  if (!svc) return askService(e, 'No encontré ese servicio. ');
  d.serviceId = svc.id;
  if (named || !n) Object.assign(d.prefs, parsePrefs(text, e.today)); // «el 2» elige la opción 2, no el día 2
  learn(e, text);
  const pro = detectPro(c, text); if (pro) d.professionalId = pro;
  advance(e);
}

function askPro(e, pros) {
  e.conv.script.step = 'pro';
  e.say(`¿Con qué profesional desea la cita?\n${pros.map((p, i) => `${i + 1}. ${p.name} — ${p.specialty}`).join('\n')}\n${pros.length + 1}. El primero disponible`,
    [...pros.map((p) => ({ label: p.name, text: p.name })), { label: 'El primero disponible', text: 'el primero disponible' }]);
}

function stepPro(e, text) {
  const { c, conv } = e;
  const d = conv.script.data;
  const pros = prosFor(c, d.serviceId);
  const n = parseChoice(text, pros.length + 1);
  const named = detectPro(c, text);
  const found = named || (n ? (n === pros.length + 1 ? 'any' : pros[n - 1].id) : null);
  if (!found) return askPro(e, pros);
  d.professionalId = found;
  if (named || !n) Object.assign(d.prefs, parsePrefs(text, e.today));
  learn(e, text);
  offerSlots(e);
}

const slotLine = (c, s, showPro) => `${dateShort(s.start.slice(0, 10))} · ${time12(s.start.slice(11, 16))}${showPro ? ` · ${getPro(c, s.professionalId)?.name || ''}` : ''}`;

/** Botones de los horarios ofrecidos + tira de días («Hoy · Mañana · Jue · Vie…», solo días con cupo) + «Otros horarios». */
function slotChips(c, slots, base, today) {
  const chips = slots.map((s, i) => ({ label: `${i + 1}) ${dateShort(s.start.slice(0, 10))} · ${time12(s.start.slice(11, 16))}`, text: String(i + 1) }));
  const days = [];
  for (let i = 0; i < 8 && days.length < 5; i++) {
    const key = addDays(today, i);
    if (!dayHours(c, key) || !freeSlots(c, { ...base, dayKey: key }).length) continue;
    const dow = dayOfWeek(key);
    const abbr = DAYS_SHORT[dow].charAt(0).toUpperCase() + DAYS_SHORT[dow].slice(1);
    days.push({ label: i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : `${abbr} ${Number(key.slice(8, 10))}`, text: i === 0 ? 'hoy' : i === 1 ? 'mañana' : `el ${DAYS[dow]}`, kind: 'day' });
  }
  if (days.length) days[0].sep = true;
  return [...chips, ...days, { label: 'Otros horarios', text: 'otros horarios', sep: true }];
}

/**
 * Los siguientes n horarios libres en orden cronológico global (fecha y hora, sea cual sea el profesional), sin repetir lo ya visto (CIT-RF-18).
 * Un mismo horario libre con varios profesionales se ofrece una sola vez (con el primero de la configuración): «el primero disponible» no es una lista por profesional.
 * Así, cada «Otros horarios» continúa donde terminó la lista anterior y nunca retrocede.
 */
export function nextSlots(c, opts, n = 3, seen = []) {
  const seenStarts = new Set(seen.map((s) => s.start));
  const out = [];
  for (const s of freeSlots(c, opts)) {
    if (out.length >= n) break;
    if (seenStarts.has(s.start) || out.some((o) => o.start === s.start)) continue;
    out.push(s);
  }
  return out;
}

function offerSlots(e) {
  const { c, conv } = e;
  const d = conv.script.data;
  const svc = getService(c, d.serviceId);
  const base = { serviceId: d.serviceId, professionalId: !d.professionalId || d.professionalId === 'any' ? null : d.professionalId, from: earliestStart(c, e.nowS), patientPhone: d.phone || null };
  let note = '';
  let slots = nextSlots(c, { ...base, from: fromWithPrefs(base.from, d.prefs), dayKey: d.prefs?.day, part: d.prefs?.part, clockAt: d.prefs?.clockAt }, 3, d.seen);
  if (!slots.length && hasPrefs(d.prefs)) {
    slots = nextSlots(c, base, 3, d.seen);
    if (slots.length) note = `${closedNote(c, d.prefs?.day) || `No tengo cupos ${prefsText(d.prefs)}`}; estos son los próximos horarios disponibles.\n\n`;
  }
  if (!slots.length) {
    conv.script.step = 'menu'; conv.script.data = {};
    // ¿No quedan horarios porque todos se cruzan con otra cita de esta misma persona? Se dice con claridad.
    const crossing = !d.seen.length && d.phone && nextSlots(c, { ...base, patientPhone: null }, 1).length;
    return e.say(crossing ? `${REASONS.paciente_ocupado} Los horarios libres de este servicio se cruzan con otra cita suya. ¿Desea que una persona del equipo le ayude?`
      : d.seen.length ? 'Ya no tengo más horarios libres en los próximos 14 días. ¿Desea que una persona del equipo le ayude?' : 'No tengo horarios libres en los próximos 14 días. ¿Desea que una persona del equipo le ayude?', [HUMAN_CHIP, ...MENU_ONLY]);
  }
  d.offered = slots; d.seen.push(...slots);
  const showPro = prosFor(c, d.serviceId).length > 1;
  conv.script.step = 'slots';
  e.say(`${note}Estos son los horarios disponibles para ${svc.name}:\n${slots.map((s, i) => `${i + 1}. ${slotLine(c, s, showPro)}`).join('\n')}\n\nResponda con el número, elija un día o escriba «otros horarios».`,
    slotChips(c, slots, base, e.today));
}

/** Interpreta la respuesta a una lista de horarios: elegir uno, pedir más o cambiar de día / franja. */
function readSlotAnswer(e, text, offered) {
  if (matchesAny(text, MORE_SLOTS, false) && !parseChoice(text, offered.length)) return { kind: 'more' };
  if (hasClockMention(text)) {
    const k = parseClock(text);
    const idx = offered.findIndex((s) => s.start.slice(11, 16) === k);
    if (idx >= 0) return { kind: 'pick', idx };
    if (k) return { kind: 'prefs', prefs: { clockAt: k } };
  }
  const n = parseChoice(text, offered.length);
  if (n) return { kind: 'pick', idx: n - 1 };
  const prefs = parsePrefs(text, e.today);
  return hasPrefs(prefs) ? { kind: 'prefs', prefs } : { kind: 'none' };
}

function stepSlots(e, text) {
  const { c, conv } = e;
  const d = conv.script.data;
  const ans = readSlotAnswer(e, text, d.offered || []);
  if (ans.kind === 'more') return offerSlots(e);
  if (ans.kind === 'prefs') { d.prefs = ans.prefs; d.seen = []; return offerSlots(e); }
  if (ans.kind === 'none') { conv.script.misses = (conv.script.misses || 0) + 1; return e.say('No logré identificar el horario. Responda con el número (1, 2 o 3), o escriba «otros horarios».', undefined); }
  const slot = d.offered[ans.idx];
  const svc = getService(c, d.serviceId);
  if (slot.start <= e.nowS) { e.say('Ese horario ya pasó. Estos son los siguientes disponibles.'); return offerSlots(e); }
  if (slotProblem(c, slot.professionalId, slot.start, svc.minutes)) { e.say('Ese horario acaba de ocuparse. Veamos otros disponibles.'); return offerSlots(e); }
  d.slot = slot; d.professionalId = slot.professionalId;
  conv.script.misses = 0;
  afterSlot(e);
}

function afterSlot(e) {
  const { c, conv } = e;
  const d = conv.script.data;
  if (!d.name && conv.name) d.name = conv.name;
  if (!d.phone) d.phone = chatPhone(e); // el teléfono es el del chat (WhatsApp ya lo conoce): no se pide
  if (isVet(c) && !d.pet) {
    // Registro del paciente (por su teléfono o, si el bot le escribió primero, por la conversación): se usa la mascota que ya conocemos.
    // En producción, un número escrito a mano (otra persona) no revela la mascota registrada a ese número.
    const rec = (d.customPhone && !isDemo(c) ? null : patientByPhone(c, d.phone)) || (!d.customPhone && conv.patientId ? getPatient(c, conv.patientId) : null);
    if (rec?.pet && (!d.species || speciesKey(d.species) === speciesKey(rec.pet.species))) d.pet = { ...rec.pet };
  }
  if (!d.name) {
    conv.script.step = 'name';
    const who = chatIdentity(conv, e.T).persona?.name;
    return e.say(`Perfecto. ¿A nombre de quién agendamos?\n(${PRIVACY_TIP})`, who ? [{ label: who, text: who }] : undefined);
  }
  if (!d.phone) return askPhone(e); // solo si el chat no tiene teléfono (no ocurre en la demo)
  if (isVet(c) && !d.pet) { conv.script.step = 'pet_name'; return e.say('¿Cómo se llama su mascota?'); }
  showConfirm(e);
}

function stepName(e, text) {
  const n = parseName(text);
  if (!n) return e.say('No logré entender el nombre. Escríbalo así, por ejemplo: Ana Pérez.');
  e.conv.script.data.name = n;
  afterSlot(e);
}
/** Respaldo: solo si la conversación no tiene teléfono (en la demo el chat siempre lo tiene). */
function askPhone(e) {
  const d = e.conv.script.data;
  e.conv.script.step = 'phone';
  e.say(`Gracias, ${firstName(d.name)}. ¿Con qué número de teléfono le escribimos? Lo usaremos solo para enviarle el recordatorio.`);
}
function stepPhone(e, text) {
  const p = parsePhone(text);
  if (!p || !isPanamaMobile(p)) return e.say(MOBILE_HINT);
  e.conv.script.data.phone = p;
  afterSlot(e);
}
/** Opcional: la persona quiere dejar otro número para el recordatorio (el del chat sigue siendo el predeterminado). */
function askAltPhone(e) {
  const d = e.conv.script.data;
  e.conv.script.step = 'alt_phone';
  e.say(`Claro. ¿Qué celular desea dejar para el recordatorio? (8 dígitos que empiecen con 6, por ejemplo 6000-1234). Si prefiere el de este chat (${phoneDisplay(chatPhone(e))}), escriba «el mismo».`,
    [{ label: `Usar el de este chat`, text: 'el mismo' }]);
}
function stepAltPhone(e, text, t) {
  const d = e.conv.script.data;
  if (has(t, 'mismo') || has(t, 'este chat') || has(t, 'el de aqui') || parseYesNo(text) === 'no') { d.phone = chatPhone(e); d.customPhone = false; return afterSlot(e); }
  const p = parsePhone(text);
  if (!p || !isPanamaMobile(p)) return e.say(MOBILE_HINT, [{ label: 'Usar el de este chat', text: 'el mismo' }]);
  d.phone = p; d.customPhone = p !== chatPhone(e);
  afterSlot(e);
}
function stepPetName(e, text) {
  const n = parseName(text);
  if (!n) return e.say('No logré entender el nombre de su mascota. Escríbalo así, por ejemplo: Max.');
  const d = e.conv.script.data;
  d.pet = { name: n };
  // La especie ya dicha ("vacunar a mi perro") no se vuelve a preguntar.
  if (d.species) { d.pet.species = d.species; e.conv.script.step = 'pet_age'; return e.say(`¿Qué edad tiene ${n}? (por ejemplo: 3 años u 8 meses)`); }
  e.conv.script.step = 'pet_species';
  e.say(`¿${n} es perro, gato u otra especie?`, [{ label: 'Perro', text: 'Perro' }, { label: 'Gato', text: 'Gato' }, { label: 'Otra', text: 'Otra' }]);
}
function stepPetSpecies(e, text) {
  const t = norm(text);
  let species = detectSpecies(text);
  if (!species && t && !has(t, 'otra') && /^[a-z ]{3,20}$/.test(t)) species = titleCase(t);
  if (!species) { e.conv.script.step = 'pet_species'; return e.say('Indíqueme la especie: perro, gato u otra (por ejemplo: conejo).', [{ label: 'Perro', text: 'Perro' }, { label: 'Gato', text: 'Gato' }]); }
  const d = e.conv.script.data;
  d.pet.species = species;
  e.conv.script.step = 'pet_age';
  e.say(`¿Qué edad tiene ${d.pet.name}? (por ejemplo: 3 años u 8 meses)`);
}
function stepPetAge(e, text) {
  const age = parseAge(text);
  if (!age) return e.say('No logré entender la edad. Escríbala así: 3 años, o 8 meses.');
  const d = e.conv.script.data;
  d.pet.age = age;
  showConfirm(e);
}

function showConfirm(e) {
  const { c, conv } = e;
  const d = conv.script.data;
  const svc = getService(c, d.serviceId); const pro = getPro(c, d.professionalId);
  // Regla de cruce de paciente: la misma persona no puede tener dos citas que se crucen (también si cambió el número del recordatorio).
  if (patientConflict(c, { phone: d.phone, start: d.slot.start, minutes: svc.minutes })) {
    e.say(`${REASONS.paciente_ocupado} Veamos otros horarios.`);
    d.seen = []; d.slot = null;
    return offerSlots(e);
  }
  const lines = [
    'Revise su cita:',
    `👤 ${d.name} · ${phoneDisplay(d.phone)}`,
    d.pet ? `🐾 ${d.pet.name} (${d.pet.species}, ${d.pet.age})` : null,
    `🩺 ${svc.name} (${svc.minutes} min) — ${priceLabel(svc)}`,
    svc.sessions ? `📦 Incluye ${svc.sessions} sesiones: la primera queda agendada ahora y las demás las coordina su terapeuta.` : null,
    `🧑‍⚕️ ${pro.name}`,
    `📅 ${stampLong(d.slot.start)}`,
    '', `${d.customPhone ? 'Le escribiremos a ese número.' : 'Le escribiremos a este mismo WhatsApp.'} Si prefiere dejar otro número, escriba «otro número».`,
    '', '¿Confirma?\n1. Sí, confirmar\n2. Cambiar horario\n3. Cancelar',
  ].filter((l) => l !== null);
  conv.script.step = 'confirm';
  e.say(lines.join('\n'), [{ label: 'Sí, confirmar', text: '1' }, { label: 'Cambiar horario', text: '2' }, { label: 'Cancelar', text: '3' }, { label: 'Usar otro número', text: 'otro número', sep: true }]);
}

const wantsOtherPhone = (t) => ['otro numero', 'otro telefono', 'otro celular', 'otro whatsapp', 'cambiar numero', 'cambiar telefono', 'cambiar el numero', 'cambiar el telefono'].some((p) => has(t, p, false));

function stepConfirm(e, text, t) {
  const { c, conv } = e;
  const d = conv.script.data;
  const n = parseChoice(text, 3);
  const yn = parseYesNo(text);
  const typed = parsePhone(text);
  if (wantsOtherPhone(t) || (typed && !n)) {
    if (!typed) return askAltPhone(e);
    if (!isPanamaMobile(typed)) { e.conv.script.step = 'alt_phone'; return e.say(MOBILE_HINT, [{ label: 'Usar el de este chat', text: 'el mismo' }]); }
    d.phone = typed; d.customPhone = typed !== chatPhone(e);
    return showConfirm(e);
  }
  // Cambio de opinión en el resumen («mejor el viernes», «a las 4», «la próxima semana»): se buscan horarios con eso.
  const prefs = n ? {} : parsePrefs(text, e.today);
  if (hasPrefs(prefs) && parseYesNo(text) !== 'si') { d.prefs = prefs; d.seen = []; d.slot = null; return offerSlots(e); }
  if (n === 2 || has(t, 'cambiar') || has(t, 'otro horario') || has(t, 'otra hora')) return offerSlots(e);
  if (n === 3 || yn === 'no' || has(t, 'cancelar')) { reset(e); return e.say('Listo, no agendé nada. ¿Puedo ayudarle con algo más?', MENU_CHIPS); }
  if (n !== 1 && yn !== 'si') return e.say('Responda 1 para confirmar, 2 para cambiar el horario o 3 para cancelar.', [{ label: 'Sí, confirmar', text: '1' }, { label: 'Cambiar horario', text: '2' }, { label: 'Cancelar', text: '3' }]);

  const res = createAppointment(c, { name: d.name, phone: d.phone, serviceId: d.serviceId, professionalId: d.professionalId, start: d.slot.start, origin: 'chat', pet: d.pet || null });
  if (!res.ok) { e.say(`Lo siento, ese horario ya no está disponible. ${REASONS[res.reason] || ''} Veamos otros.`); d.seen = []; return offerSlots(e); }
  const { appt, patient } = res;
  const svc = getService(c, appt.serviceId); const pro = getPro(c, appt.professionalId);
  // Si dejó otro número para el recordatorio, la identidad del chat no cambia (sigue siendo la del WhatsApp que escribe).
  if (!d.customPhone) { conv.patientId = patient.id; conv.name = d.name; conv.phone = patient.phone; }
  else if (!conv.name) conv.name = d.name;
  e.touched.add(appt.id);
  e.log('cita', `Cita creada por el chat · ${d.name} · ${svc.name} · ${stampShort(appt.start)} · ${pro.name}`, appt.id);
  e.say(reminderNote(fill(c.config.messages.confirm, {
    nombre: firstName(d.name), fecha: dateLong(appt.start.slice(0, 10)), hora: time12(appt.start.slice(11, 16)), servicio: svc.name, profesional: pro.name,
    mascota: d.pet ? `${d.pet.name} (${d.pet.species}, ${d.pet.age})` : '', clinica: e.T.name,
  }), appt.reminderPlan), [{ label: 'Agendar otra cita', text: 'Agendar cita' }, ...MENU_ONLY]);
  reset(e);
}

/** El mensaje de confirmación dice cuándo saldrá de verdad el recordatorio (no promete «el día anterior» si ya pasó esa hora). */
function reminderNote(text, plan) {
  if (!plan || plan.kind === 'dia-anterior') return text;
  if (plan.kind === 'horas-antes') return text.replace(/recordatorio el día anterior/i, `recordatorio ${plan.hours} ${plan.hours === 1 ? 'hora' : 'horas'} antes de su cita`);
  return text.replace(/\n*Le enviaremos un recordatorio el día anterior\.\s*/i, '\n\n');
}

// --- d) Reprogramar y cancelar ---------------------------------------------------------------

function startChange(e, text, action) {
  const { conv } = e;
  conv.script.data = { action };
  // Las citas se buscan con el teléfono del chat (no se pide); solo si no hay ninguna se ofrece escribir otro número.
  const phone = (isDemo(e.c) ? parsePhone(text) : null) || chatPhone(e);
  if (phone) return findAppts(e, phone);
  conv.script.step = 'find_phone';
  const hint = demoHint(e);
  e.say('Con gusto. ¿Con qué número de teléfono se agendó la cita?', hint.chip ? [{ label: `Usar ${hint.chip.text} (ejemplo)`, text: hint.chip.text }] : undefined);
}

function demoHint(e) {
  if (!isDemo(e.c)) return { text: '', chip: null }; // en producción nunca se muestran datos de otro paciente
  const upcoming = e.c.appointments.filter((x) => UPCOMING.has(x.status) && x.start > e.nowS && x.origin).sort((p, q) => (p.start < q.start ? -1 : 1));
  // Se prefiere un paciente con una sola cita próxima, para que la pista lleve directo a "reprogramar" sin elegir entre varias.
  const a = upcoming.find((x) => upcoming.filter((y) => y.phone === x.phone).length === 1) || upcoming[0];
  return a ? { text: `\n\n💡 Pista de la demo: pruebe con ${a.phone} (${a.name}).`, chip: { label: `Usar ${a.phone}`, text: a.phone } } : { text: '', chip: null };
}

function findAppts(e, phone) {
  const { c, conv } = e;
  const list = upcomingForPhone(c, phone, e.nowS);
  if (!list.length && !isDemo(c)) {
    conv.script.step = 'menu'; conv.script.data = {};
    return e.say('No encontré citas próximas a este número de WhatsApp. Si la agendó con otro número, una persona del equipo puede ayudarle.', [HUMAN_CHIP, ...MENU_ONLY]);
  }
  if (!list.length) {
    conv.script.step = 'find_phone';
    const hint = demoHint(e);
    const own = phone === chatPhone(e);
    return e.say(`No encontré citas próximas con ${own ? 'el número de este chat' : 'el número'} ${phoneDisplay(phone)}. ${own ? 'Si la cita se agendó con otro número, escríbalo aquí; también puede hablar con una persona del equipo.' : 'Verifique el número o hable con una persona del equipo.'}${hint.text}`,
      [hint.chip, HUMAN_CHIP, ...MENU_ONLY].filter(Boolean));
  }
  if (list.length === 1) return selectAppt(e, list[0]);
  conv.script.data.candidates = list.slice(0, 3).map((a) => a.id);
  conv.script.step = 'pick_appt';
  e.say(`Encontré ${list.length > 3 ? 'varias' : list.length} citas a ese número:\n${list.slice(0, 3).map((a, i) => `${i + 1}. ${getService(c, a.serviceId).name} · ${stampShort(a.start)}`).join('\n')}\n\n¿Cuál desea modificar?`,
    list.slice(0, 3).map((a, i) => ({ label: `${i + 1}) ${stampShort(a.start)}`, text: String(i + 1) })));
}

function stepFindPhone(e, text) {
  if (!isDemo(e.c)) return findAppts(e, chatPhone(e)); // producción: solo el número del chat
  const p = parsePhone(text);
  if (!p) { const hint = demoHint(e); return e.say(`Necesito el número con el que se agendó, por ejemplo 6000-1234.${hint.text}`, [hint.chip, HUMAN_CHIP, ...MENU_ONLY].filter(Boolean)); }
  findAppts(e, p);
}

function stepPickAppt(e, text) {
  const { c, conv } = e;
  const ids = conv.script.data.candidates || [];
  const n = parseChoice(text, ids.length);
  if (!n) return e.say('Responda con el número de la cita que desea modificar.');
  selectAppt(e, getAppt(c, ids[n - 1]));
}

function selectAppt(e, a) {
  const { c, conv } = e;
  const d = conv.script.data;
  d.apptId = a.id;
  conv.phone = a.phone; conv.name = a.name; conv.patientId = a.patientId;
  e.touched.add('conv');
  if (d.action === 'reprogramar') return startResched(e, false);
  if (d.action === 'cancelar') return askCancel(e);
  conv.script.step = 'appt_action';
  e.say(`Su cita: ${getService(c, a.serviceId).name} el ${stampLong(a.start)} con ${getPro(c, a.professionalId).name}.\n\n¿Qué desea hacer?\n1. Reprogramar\n2. Cancelar\n3. Dejarla como está`,
    [{ label: 'Reprogramar', text: '1' }, { label: 'Cancelar la cita', text: '2' }, { label: 'Dejarla como está', text: '3' }]);
}

function stepApptAction(e, text, t) {
  const n = parseChoice(text, 3);
  if (n === 1 || has(t, 'reprogramar') || has(t, 'cambiar') || has(t, 'mover')) return startResched(e, false);
  if (n === 2 || has(t, 'cancelar') || has(t, 'anular')) return askCancel(e);
  if (n === 3 || has(t, 'dejar') || has(t, 'mantener') || parseYesNo(text) === 'no') { reset(e); return e.say('Perfecto, su cita sigue como está. ¿Algo más en lo que pueda ayudarle?', MENU_CHIPS); }
  e.say('Responda 1 para reprogramar, 2 para cancelar o 3 para dejarla como está.');
}

function startResched(e, viaReminder) {
  const { c, conv } = e;
  const d = conv.script.data;
  const a = getAppt(c, d.apptId);
  d.resched = true; d.viaReminder = viaReminder; d.seen = []; d.serviceId = a.serviceId; d.prefs = parsePrefs('', e.today);
  // Los mismos horarios libres de la agenda; primero con el mismo profesional.
  const from = earliestStart(c, e.nowS);
  const same = nextSlots(c, { serviceId: a.serviceId, professionalId: a.professionalId, from, ignoreId: a.id, excludeSlot: { start: a.start, professionalId: a.professionalId }, patientPhone: a.phone, patientId: a.patientId }, 1);
  d.professionalId = same.length ? a.professionalId : 'any';
  offerSlotsResched(e);
}

function offerSlotsResched(e) {
  const { c, conv } = e;
  const d = conv.script.data;
  const a = getAppt(c, d.apptId);
  const from = earliestStart(c, e.nowS);
  const base = { serviceId: a.serviceId, professionalId: d.professionalId === 'any' ? null : d.professionalId, from, ignoreId: a.id, excludeSlot: { start: a.start, professionalId: a.professionalId }, patientPhone: a.phone, patientId: a.patientId };
  let slots = nextSlots(c, { ...base, from: fromWithPrefs(base.from, d.prefs), dayKey: d.prefs?.day, part: d.prefs?.part, clockAt: d.prefs?.clockAt }, 3, d.seen);
  let note = '';
  if (!slots.length && hasPrefs(d.prefs)) { slots = nextSlots(c, base, 3, d.seen); if (slots.length) note = `${closedNote(c, d.prefs?.day) || `No tengo cupos ${prefsText(d.prefs)}`}; estos son los próximos horarios.\n\n`; }
  if (!slots.length) {
    conv.script.step = 'menu'; conv.script.data = {};
    const crossing = !d.seen.length && nextSlots(c, { ...base, patientPhone: null, patientId: null }, 1).length;
    return e.say(crossing ? `${REASONS.paciente_ocupado} Los horarios libres se cruzan con otra cita suya. ¿Desea que una persona del equipo le ayude?` : 'No encuentro más horarios libres en los próximos 14 días. ¿Desea que una persona del equipo le ayude?', [HUMAN_CHIP, ...MENU_ONLY]);
  }
  d.offered = slots; d.seen.push(...slots);
  conv.script.step = 'resched_slots';
  const showPro = prosFor(c, a.serviceId).length > 1;
  e.say(`${note}Estos son los horarios libres para reprogramar su cita de ${getService(c, a.serviceId).name} (ahora: ${stampShort(a.start)}):\n${slots.map((s, i) => `${i + 1}. ${slotLine(c, s, showPro)}`).join('\n')}\n\nResponda con el número, elija un día o escriba «otros horarios».`,
    slotChips(c, slots, base, e.today));
}

function stepReschedSlots(e, text) {
  const { c, conv } = e;
  const d = conv.script.data;
  const ans = readSlotAnswer(e, text, d.offered || []);
  if (ans.kind === 'more') return offerSlotsResched(e);
  if (ans.kind === 'prefs') { d.prefs = ans.prefs; d.seen = []; return offerSlotsResched(e); }
  if (ans.kind === 'none') return e.say('No logré identificar el horario. Responda con el número (1, 2 o 3), o escriba «otros horarios».');
  const slot = d.offered[ans.idx];
  const a = getAppt(c, d.apptId);
  const slotMinutes = a.minutes;
  if (slot.start <= e.nowS) { e.say('Ese horario ya pasó. Estos son los siguientes disponibles.'); return offerSlotsResched(e); }
  if (slotProblem(c, slot.professionalId, slot.start, slotMinutes, a.id)) { e.say('Ese horario acaba de ocuparse. Veamos otros disponibles.'); return offerSlotsResched(e); }
  d.newSlot = slot;
  conv.script.misses = 0;
  showReschedConfirm(e);
}

/** Resumen del cambio (de qué horario a cuál) y confirmación: la cita no cambia hasta que la persona confirma. */
function showReschedConfirm(e) {
  const { c, conv } = e;
  const d = conv.script.data;
  const a = getAppt(c, d.apptId);
  const svc = getService(c, a.serviceId);
  conv.script.step = 'resched_confirm';
  const oldPro = getPro(c, a.professionalId); const newPro = getPro(c, d.newSlot.professionalId);
  const lines = [
    'Revise el cambio de su cita:',
    `🩺 ${svc.name} (${svc.minutes} min)`,
    `📅 Ahora: ${stampLong(a.start)}${oldPro ? ` · ${oldPro.name}` : ''}`,
    `🔁 Nuevo: ${stampLong(d.newSlot.start)}${newPro ? ` · ${newPro.name}` : ''}`,
    'El horario actual quedará libre cuando confirme.',
    '', '¿Confirma el cambio?\n1. Sí, confirmar\n2. Elegir otro horario\n3. Dejarla como está',
  ];
  e.say(lines.join('\n'), [{ label: 'Sí, confirmar', text: '1' }, { label: 'Elegir otro horario', text: '2' }, { label: 'Dejarla como está', text: '3' }]);
}

function stepReschedConfirm(e, text, t) {
  const { c, conv } = e;
  const d = conv.script.data;
  const a = getAppt(c, d.apptId);
  const n = parseChoice(text, 3); const yn = parseYesNo(text);
  if (n === 2 || has(t, 'otro horario') || has(t, 'otra hora') || has(t, 'otro dia') || has(t, 'elegir')) return offerSlotsResched(e);
  if (has(t, 'cancelar') || has(t, 'anular')) return askCancel(e);
  if (n === 3 || yn === 'no' || has(t, 'dejar') || has(t, 'mantener')) { reset(e); return e.say('Perfecto, su cita sigue como está. ¿Algo más en lo que pueda ayudarle?', MENU_CHIPS); }
  if (n !== 1 && yn !== 'si') return e.say('Responda 1 para confirmar el cambio, 2 para elegir otro horario o 3 para dejarla como está.', [{ label: 'Sí, confirmar', text: '1' }, { label: 'Elegir otro horario', text: '2' }, { label: 'Dejarla como está', text: '3' }]);
  const slot = d.newSlot;
  const old = a.start;
  const res = moveAppointment(c, a.id, { start: slot.start, professionalId: slot.professionalId }, { notice: true, actor: 'chat' });
  if (!res.ok) { e.say(`Ese horario ya no está disponible. ${REASONS[res.reason] || ''}`); return offerSlotsResched(e); }
  e.touched.add(a.id);
  e.log('estado', `Cita reprogramada por el paciente · ${a.name} · ${stampShort(old)} → ${stampShort(a.start)} · el horario anterior quedó libre${d.viaReminder ? ' · tras el recordatorio (ausencia evitada)' : ''}`, a.id);
  e.say(`✅ Listo. Su cita de ${getService(c, a.serviceId).name} quedó reprogramada para el ${stampLong(a.start)}.\nEl horario anterior quedó libre.`, MENU_ONLY);
  reset(e);
}

function askCancel(e) {
  const { c, conv } = e;
  const a = getAppt(c, conv.script.data.apptId);
  conv.script.step = 'cancel_confirm';
  e.say(`¿Confirma que desea cancelar su cita de ${getService(c, a.serviceId).name} del ${stampLong(a.start)}?\n1. Sí, cancelar\n2. No, mantenerla`,
    [{ label: 'Sí, cancelar', text: '1' }, { label: 'No, mantenerla', text: '2' }]);
}

function stepCancelConfirm(e, text) {
  const { c, conv } = e;
  const a = getAppt(c, conv.script.data.apptId);
  const n = parseChoice(text, 2); const yn = parseYesNo(text);
  if (n === 2 || yn === 'no') { reset(e); return e.say('Perfecto, su cita se mantiene. ¿Algo más en lo que pueda ayudarle?', MENU_CHIPS); }
  if (n !== 1 && yn !== 'si') return e.say('Responda 1 para cancelar la cita o 2 para mantenerla.', [{ label: 'Sí, cancelar', text: '1' }, { label: 'No, mantenerla', text: '2' }]);
  const res = setStatus(c, a.id, 'cancelada', { actor: 'chat' });
  if (!res.ok) { reset(e); return e.say('Esa cita ya no se puede cancelar desde aquí. Una persona del equipo puede ayudarle.', [HUMAN_CHIP, ...MENU_ONLY]); }
  e.touched.add(a.id);
  e.log('estado', `Cita cancelada por el paciente · ${a.name} · ${getService(c, a.serviceId).name} · ${stampShort(a.start)} · el horario quedó libre`, a.id);
  e.say('Su cita fue cancelada y el horario quedó libre. ¿Desea agendar otra?', [{ label: 'Agendar cita', text: 'Agendar cita' }, ...MENU_ONLY]);
  reset(e);
}

// --- c) Recordatorio ----------------------------------------------------------------------------

/** «hoy», «mañana» o «el jueves 19 de noviembre», según el día de la cita. */
export const whenText = (day, today) => (day === today ? 'hoy' : day === addDays(today, 1) ? 'mañana' : `el ${dateLong(day)}`);

/** El bot escribe primero: recordatorio del día anterior. Devuelve { out, touched }. */
export function startReminder(c, conv, apptId, ctx) {
  const a = getAppt(c, apptId);
  const out = [];
  const e = { c, conv, ctx, T: ctx.profile, out, touched: new Set([a.id]), nowS: stamp(ctx.now), today: todayKey(), say: (t, chips) => out.push(chips ? { text: tidy(t), chips } : { text: tidy(t) }), log: (...x) => ctx.log?.(...x) };
  conv.script = { step: 'reminder', data: { apptId: a.id }, misses: 0 };
  conv.patientId = a.patientId; conv.name = a.name; conv.phone = a.phone; conv.mode = 'bot';
  a.reminder = 'enviado';
  e.log('recordatorio', `Recordatorio enviado · ${a.name} · cita ${stampShort(a.start)}`, a.id);
  const cuando = whenText(a.start.slice(0, 10), e.today);
  const tpl = c.config.messages.reminder || '';
  // Textos antiguos traen «mañana» fijo: si la cita no es mañana, se cambia por «hoy» o la fecha.
  const fixed = tpl.includes('{cuando}') || cuando === 'mañana' ? tpl : tpl.replace(/\bmañana\b/, cuando);
  e.say(fill(fixed, {
    nombre: firstName(a.name), hora: time12(a.start.slice(11, 16)), fecha: dateLong(a.start.slice(0, 10)), cuando, servicio: getService(c, a.serviceId).name,
    profesional: getPro(c, a.professionalId).name, clinica: ctx.profile.name,
  }), [{ label: '1. Sí', text: '1' }, { label: '2. Reprogramar', text: '2' }]);
  return { out, touched: [...e.touched] };
}

function stepReminder(e, text, t) {
  const { c, conv } = e;
  const d = conv.script.data;
  const a = getAppt(c, d.apptId);
  if (!a || !UPCOMING.has(a.status)) { reset(e); return e.say('Esa cita ya no está activa. ¿Puedo ayudarle con algo más?', MENU_CHIPS); }
  const n = parseChoice(text, 2); const yn = parseYesNo(text);
  if (has(t, 'cancelar') || has(t, 'anular')) return askCancel(e);
  if (n === 2 || has(t, 'reprogramar') || has(t, 'cambiar') || has(t, 'mover') || has(t, 'no puedo') || yn === 'no') { a.reminder = 'reprogramo'; return startResched(e, true); }
  if (n === 1 || yn === 'si') {
    setStatus(c, a.id, 'confirmada', { actor: 'chat' });
    e.touched.add(a.id);
    e.log('estado', `${a.name} confirmó por WhatsApp · ${stampShort(a.start)} → Confirmada`, a.id);
    e.say(`¡Gracias, ${firstName(a.name)}! Su cita quedó confirmada para el ${stampLong(a.start)}. ¡Le esperamos!`, MENU_ONLY);
    return reset(e);
  }
  e.say('Responda 1 para confirmar su cita o 2 para reprogramarla.', [{ label: '1. Sí', text: '1' }, { label: '2. Reprogramar', text: '2' }]);
}

// --- f) Seguimiento -----------------------------------------------------------------------------

/** El bot escribe primero: aviso de seguimiento del giro. Devuelve { out, touched } o null. */
export function startFollowup(c, conv, patientId, ctx) {
  const p = getPatient(c, patientId);
  const kind = FOLLOWUP_KIND[c.giro];
  if (!p) return null;
  const item = computeFollowups(c, c.giro, todayKey()).find((x) => x.patientId === patientId);
  const out = [];
  const e = { c, conv, ctx, T: ctx.profile, out, touched: new Set(['conv']), nowS: stamp(ctx.now), today: todayKey(), say: (t, chips) => out.push(chips ? { text: tidy(t), chips } : { text: tidy(t) }), log: (...x) => ctx.log?.(...x) };
  conv.script = { step: 'followup', data: { patientId, kind, serviceId: FOLLOWUP_SERVICE[c.giro] }, misses: 0 };
  conv.patientId = p.id; conv.name = p.name; conv.phone = p.phone; conv.mode = 'bot';
  if (item) markFollowupSent(c, p.id, kind, item.marker);
  e.log('seguimiento', `Seguimiento enviado · ${p.name} · ${item ? item.label : ctx.profile.followupRule}`);
  e.say(fill(c.config.messages.followup, { nombre: firstName(p.name), mascota: p.pet?.name || '', clinica: ctx.profile.name }),
    [{ label: '1. Sí, agendar', text: '1' }, { label: '2. Más tarde', text: '2' }]);
  return { out, touched: [...e.touched] };
}

function stepFollowup(e, text) {
  const { conv } = e;
  const d = conv.script.data;
  const n = parseChoice(text, 2); const yn = parseYesNo(text);
  if (n === 1 || yn === 'si' || has(norm(text), 'agendar')) return startBooking(e, '', { serviceId: d.serviceId });
  if (n === 2 || yn === 'no') { reset(e); return e.say('Entendido, le avisaremos más adelante. ¡Que tenga un excelente día!', MENU_CHIPS); }
  e.say('Responda 1 para agendar ahora o 2 para más tarde.', [{ label: '1. Sí, agendar', text: '1' }, { label: '2. Más tarde', text: '2' }]);
}

const STEPS = {
  menu: stepMenu, urgent: stepUrgent, offer_human: stepUrgent, svc: stepSvc, pro: stepPro, slots: stepSlots, name: stepName, phone: stepPhone,
  pet_name: stepPetName, pet_species: stepPetSpecies, pet_age: stepPetAge, confirm: stepConfirm,
  alt_phone: stepAltPhone, offer_eval: stepOfferEval,
  find_phone: stepFindPhone, pick_appt: stepPickAppt, appt_action: stepApptAction, resched_slots: stepReschedSlots, resched_confirm: stepReschedConfirm,
  cancel_confirm: stepCancelConfirm, reminder: stepReminder, followup: stepFollowup,
};

/** Respuestas fijas que el controlador reutiliza (p. ej. en modo IA, donde urgencias y "persona" las decide el guion). */
export function runFlow(c, conv, ctx, kind) {
  const out = [];
  const e = { c, conv, ctx, T: ctx.profile, out, touched: new Set(), nowS: stamp(ctx.now), today: todayKey(), say: (t, chips) => out.push(chips ? { text: tidy(t), chips } : { text: tidy(t) }), log: (...x) => ctx.log?.(...x) };
  conv.script = conv.script || { step: 'menu', data: {}, misses: 0 };
  if (kind === 'urgent') urgentFlow(e);
  else if (kind === 'handoff') handoffFlow(e);
  return { out, touched: [...e.touched] };
}
