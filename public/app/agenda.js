// Reglas de la agenda: horarios libres, crear / mover / cancelar citas, estados e indicadores.
// Regla de oro (CIT-RNF-02): un horario nunca queda asignado a dos citas del mismo profesional;
// toda creación y todo movimiento pasan por slotProblem().
import {
  addDays, addMin, dateKey, dayOfWeek, diffMin, epochNow, fromMin, nowStamp, stampShort, toMin, weekDays,
} from '../shared/time/panama.js';
import { phoneDigits } from '../shared/chat-engine/nlu.js';
import { holidaysBetween, holidaysOn } from '../shared/time/feriados-pa.js';

export const STATUS = {
  pendiente: 'Pendiente', confirmada: 'Confirmada', reprogramada: 'Reprogramada',
  cancelada: 'Cancelada', no_asistio: 'No asistió', atendida: 'Atendida',
};
export const STATUS_KEYS = Object.keys(STATUS);
export const UPCOMING = new Set(['pendiente', 'confirmada', 'reprogramada']);
const HOLDS = new Set(['pendiente', 'confirmada', 'reprogramada', 'atendida', 'no_asistio']); // cancelada libera el horario

let counter = 0;
export const newId = (p = 'x') => `${p}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const getService = (c, id) => c.config.services.find((s) => s.id === id);
export const getPro = (c, id) => c.config.professionals.find((p) => p.id === id);
export const getAppt = (c, id) => c.appointments.find((a) => a.id === id);
export const getPatient = (c, id) => c.patients.find((p) => p.id === id);
export const patientByPhone = (c, phone) => c.patients.find((p) => phoneDigits(p.phone) === phoneDigits(phone));
export const endOf = (a) => addMin(a.start, a.minutes);
export const activeServices = (c) => c.config.services.filter((s) => s.active !== false);
export const proOffers = (c, proId, serviceId) => { const p = getPro(c, proId); return !!p && p.active !== false && p.serviceIds.includes(serviceId); };

export function note(a, text, ts = epochNow()) { a.history.push({ ts, text }); }

export const REASONS = {
  ocupado: 'Ese horario ya está ocupado para ese profesional.',
  fuera_de_horario: 'Queda fuera del horario de atención.',
  cerrado: 'La clínica no atiende ese día.',
  feriado: 'Ese día es feriado o la clínica cierra.',
  almuerzo: 'Coincide con la hora de almuerzo.',
  profesional_no_atiende: 'Ese profesional no atiende ese día.',
  profesional: 'Ese profesional no ofrece este servicio.',
  servicio: 'Ese servicio no está disponible.',
  paciente_ocupado: 'Ese paciente ya tiene otra cita que se cruza con ese horario.',
  estado: 'Esa cita ya no se puede mover.',
  pasado: 'Ese horario ya pasó.',
  no_existe: 'No se encontró la cita.',
};

/**
 * Feriados y cierres (c.config.cierres):
 *   feriadosNacionales (true): cerrar los feriados nacionales de Panamá (ver shared/time/feriados-pa.js).
 *   tradicionales (true): cerrar también los días tradicionales (lunes de Carnaval, 4 de noviembre).
 *   abiertoEn ([]): fechas 'YYYY-MM-DD' en que la clínica abre aunque sea feriado.
 *   extra ([{ date, name }]): cierres propios (vacaciones, inventario, un «puente» decretado).
 */
export const DEFAULT_CIERRES = { feriadosNacionales: true, tradicionales: true, abiertoEn: [], extra: [] };

/** ¿Por qué cierra la clínica ese día? { name, kind: 'nacional' | 'tradicional' | 'propio' } o null (abre normal). */
export function closureOf(c, key) {
  const z = c.config.cierres || DEFAULT_CIERRES;
  const day = String(key).slice(0, 10);
  const own = (z.extra || []).find((x) => x.date === day);
  if (own) return { name: own.name || 'Cierre de la clínica', kind: 'propio' };
  if ((z.abiertoEn || []).includes(day)) return null;
  const h = holidaysOn(day).find((x) => (x.kind === 'nacional' ? z.feriadosNacionales !== false : z.tradicionales !== false));
  return h ? { name: h.name, kind: h.kind } : null;
}

/** Feriados y cierres que caen en días que la clínica normalmente abre, desde fromKey durante `days` días. */
export function upcomingClosures(c, fromKey, days = 30) {
  const to = addDays(fromKey, days - 1);
  const dates = new Set([...holidaysBetween(fromKey, to).map((h) => h.date), ...(c.config.cierres?.extra || []).map((x) => x.date).filter((d) => d >= fromKey && d <= to)]);
  return [...dates].sort().map((date) => ({ date, ...closureOf(c, date) })).filter((x) => x.name && c.config.hours[dayOfWeek(x.date)]);
}

/** Horario de ese día; null si la clínica no abre (día libre de la semana, feriado o cierre propio). */
export const dayHours = (c, key) => (closureOf(c, key) ? null : c.config.hours[dayOfWeek(key)] || null);

/** null si el horario es válido; si no, el motivo ('cerrado', 'ocupado', …). */
export function slotProblem(c, proId, start, minutes, ignoreId = null) {
  const key = start.slice(0, 10);
  if (c.config.hours[dayOfWeek(key)] && closureOf(c, key)) return 'feriado';
  const h = dayHours(c, key);
  if (!h) return 'cerrado';
  const p = getPro(c, proId);
  if (!p || p.active === false) return 'profesional';
  if (!p.days.includes(dayOfWeek(key))) return 'profesional_no_atiende';
  const s = toMin(start.slice(11, 16));
  const e = s + minutes;
  if (s < toMin(h.open) || e > toMin(h.close)) return 'fuera_de_horario';
  const L = c.config.lunch;
  if (L?.start && L?.end && s < toMin(L.end) && e > toMin(L.start)) return 'almuerzo';
  const end = addMin(start, minutes);
  const clash = c.appointments.some((a) => a.id !== ignoreId && a.professionalId === proId && HOLDS.has(a.status) && start < endOf(a) && end > a.start);
  return clash ? 'ocupado' : null;
}

/**
 * Regla de cruce de un mismo paciente (CIT-RNF-08): un paciente no puede tener dos citas que se crucen.
 * Firma: patientConflict(c, { phone, patientId, start, minutes, ignoreId }) -> la cita que se cruza, o null.
 *  - phone / patientId: basta uno de los dos (se compara por teléfono sin formato y por id de paciente).
 *  - start ('YYYY-MM-DDTHH:mm') y minutes: el horario que se quiere ocupar.
 *  - ignoreId: cita que se está moviendo (no cuenta contra sí misma).
 * Solo cuentan las citas que ocupan agenda (las canceladas no). Citas seguidas, sin cruzarse, sí se permiten.
 */
export function patientConflict(c, { phone = null, patientId = null, start, minutes, ignoreId = null }) {
  const digits = phone ? phoneDigits(phone) : '';
  if (!digits && !patientId) return null;
  const end = addMin(start, minutes);
  return c.appointments.find((a) => a.id !== ignoreId && HOLDS.has(a.status)
    && ((patientId && a.patientId === patientId) || (digits && phoneDigits(a.phone) === digits))
    && start < endOf(a) && end > a.start) || null;
}

/** Primer horario ofrecible: ahora + anticipación mínima, redondeado al siguiente bloque. */
export function earliestStart(c, nowS) {
  const step = c.config.slotMinutes || 30;
  const s = addMin(nowS, c.config.leadMinutes ?? 60);
  const up = Math.ceil(toMin(s.slice(11, 16)) / step) * step;
  return up >= 1440 ? `${addDays(s.slice(0, 10), 1)}T00:00` : `${s.slice(0, 10)}T${fromMin(up)}`;
}

const inPart = (t, part) => (part === 'manana' ? t < 720 : part === 'tarde' ? t >= 720 && t < 1080 : t >= 1080);

/**
 * Todos los horarios libres reales, en orden cronológico.
 * patientPhone (opcional): si se pasa, no se ofrecen horarios que se crucen con otra cita del mismo
 * paciente (ver patientConflict); también acepta patientId. ignoreId excluye la cita que se está moviendo.
 * suggestSlots(c, opts, n, seen) recibe las mismas opciones, así que también acepta patientPhone.
 */
export function freeSlots(c, { serviceId, professionalId = null, from, days = 14, dayKey = null, part = null, clockAt = null, ignoreId = null, excludeSlot = null, patientPhone = null, patientId = null }) {
  const svc = getService(c, serviceId);
  if (!svc) return [];
  const step = c.config.slotMinutes || 30;
  const keys = dayKey ? [dayKey] : Array.from({ length: days }, (_, i) => addDays(from.slice(0, 10), i));
  const pros = c.config.professionals.filter((p) => p.active !== false && p.serviceIds.includes(serviceId) && (!professionalId || p.id === professionalId));
  const out = [];
  const byPatient = patientPhone || patientId;
  for (const key of keys) {
    const h = dayHours(c, key);
    if (!h) continue;
    for (let t = toMin(h.open); t + svc.minutes <= toMin(h.close); t += step) {
      const start = `${key}T${fromMin(t)}`;
      if (start < from) continue;
      if (part && !inPart(t, part)) continue;
      if (clockAt && fromMin(t) !== clockAt) continue;
      if (byPatient && patientConflict(c, { phone: patientPhone, patientId, start, minutes: svc.minutes, ignoreId })) continue;
      for (const p of pros) {
        if (excludeSlot && excludeSlot.start === start && excludeSlot.professionalId === p.id) continue;
        if (!slotProblem(c, p.id, start, svc.minutes, ignoreId)) out.push({ start, professionalId: p.id, minutes: svc.minutes });
      }
    }
  }
  return out;
}

function pickSpread(slots, n) {
  const picked = [];
  const days = new Set();
  const taken = (s) => picked.some((p) => p.start === s.start);
  for (const s of slots) {
    if (picked.length >= n) break;
    const day = s.start.slice(0, 10);
    const last = picked.at(-1);
    const spaced = last && last.start.slice(0, 10) === day && diffMin(s.start, last.start) >= 60;
    if (!taken(s) && (!picked.length || !days.has(day) || spaced)) { picked.push(s); days.add(day); }
  }
  for (const s of slots) { if (picked.length >= n) break; if (!taken(s)) picked.push(s); }
  return picked.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** Hasta n horarios (por defecto 3) repartidos en distintos días u horas, sin repetir los ya vistos. */
export function suggestSlots(c, opts, n = 3, seen = []) {
  const skip = new Set(seen.map((s) => `${s.start}|${s.professionalId}`));
  return pickSpread(freeSlots(c, opts).filter((s) => !skip.has(`${s.start}|${s.professionalId}`)), n);
}

export function createAppointment(c, { name, phone, serviceId, professionalId, start, origin = 'chat', pet = null, status = 'pendiente', force = false, ts = epochNow(), live = true }) {
  const svc = getService(c, serviceId);
  if (!svc || svc.active === false) return { ok: false, reason: 'servicio' };
  if (!proOffers(c, professionalId, serviceId)) return { ok: false, reason: 'profesional' };
  if (!force && live && origin === 'chat' && start <= nowStamp()) return { ok: false, reason: 'pasado' }; // el chat nunca agenda en el pasado (la semilla sí, con live: false)
  if (!force) {
    const problem = slotProblem(c, professionalId, start, svc.minutes);
    if (problem) return { ok: false, reason: problem };
    if (patientConflict(c, { phone, start, minutes: svc.minutes })) return { ok: false, reason: 'paciente_ocupado' };
  }
  let patient = patientByPhone(c, phone);
  if (!patient) { patient = { id: newId('pa'), name, phone, sent: {}, history: [] }; c.patients.push(patient); }
  if (pet) patient.pet = pet;
  if (svc.sessions && !patient.package) patient.package = { total: svc.sessions, used: 0 };
  const appt = {
    id: newId('ap'), patientId: patient.id, name: name || patient.name, phone: patient.phone, serviceId, professionalId, start,
    minutes: svc.minutes, status, origin, pet: pet || (patient.pet ? { ...patient.pet } : null), createdAt: ts, reminder: 'programado',
    history: [], payment: null,
  };
  if (live) appt.reminderPlan = planReminder(c, start, nowStamp()); // la semilla no lo usa: sus recordatorios ya están resueltos
  note(appt, origin === 'chat' ? 'Creada desde el chat de WhatsApp' : 'Creada desde el panel', ts);
  c.appointments.push(appt);
  return { ok: true, appt, patient };
}

const ACTOR = { chat: 'por el paciente en el chat', panel: 'desde el panel' };

export function moveAppointment(c, id, { start, professionalId } = {}, { notice = true, actor = 'panel', ts = epochNow() } = {}) {
  const a = getAppt(c, id);
  if (!a) return { ok: false, reason: 'no_existe' };
  if (!UPCOMING.has(a.status)) return { ok: false, reason: 'estado' };
  const pro = professionalId || a.professionalId;
  const s = start || a.start;
  if (!proOffers(c, pro, a.serviceId)) return { ok: false, reason: 'profesional' };
  if (actor === 'chat' && s <= nowStamp()) return { ok: false, reason: 'pasado' };
  const problem = slotProblem(c, pro, s, a.minutes, a.id);
  if (problem) return { ok: false, reason: problem };
  if (patientConflict(c, { phone: a.phone, patientId: a.patientId, start: s, minutes: a.minutes, ignoreId: a.id })) return { ok: false, reason: 'paciente_ocupado' };
  const old = { start: a.start, professionalId: a.professionalId };
  a.start = s; a.professionalId = pro; a.status = 'reprogramada'; a.rescheduled = true; a.reminder = 'programado';
  a.reminderPlan = planReminder(c, s, nowStamp());
  if (notice) a.avoided = true;
  note(a, `Reprogramada: ${stampShort(old.start)} → ${stampShort(s)} (${ACTOR[actor] || actor}${notice ? '; con aviso por WhatsApp' : '; sin aviso'})`, ts);
  return { ok: true, appt: a, old };
}

export function setStatus(c, id, status, { actor = 'panel', ts = epochNow() } = {}) {
  const a = getAppt(c, id);
  if (!a) return { ok: false, reason: 'no_existe' };
  if (!STATUS[status]) return { ok: false, reason: 'estado' };
  if (a.status === status) return { ok: true, appt: a, same: true };
  if (HOLDS.has(status) && !HOLDS.has(a.status)) { // vuelve desde "Cancelada": revisar que el horario siga libre
    const problem = slotProblem(c, a.professionalId, a.start, a.minutes, a.id);
    if (problem) return { ok: false, reason: problem };
    if (patientConflict(c, { phone: a.phone, patientId: a.patientId, start: a.start, minutes: a.minutes, ignoreId: a.id })) return { ok: false, reason: 'paciente_ocupado' };
  }
  const prev = a.status;
  a.status = status;
  note(a, `Estado: ${STATUS[prev]} → ${STATUS[status]} (${ACTOR[actor] || actor})`, ts);
  if (status === 'confirmada') a.reminder = 'confirmo';
  if (status === 'atendida') registerAttendance(c, a);
  return { ok: true, appt: a, prev };
}

function registerAttendance(c, a) {
  if (a.attended) return;
  a.attended = true;
  const patient = getPatient(c, a.patientId);
  if (!patient) return;
  patient.history = patient.history || [];
  patient.history.push({ serviceId: a.serviceId, date: a.start.slice(0, 10) });
  patient.sent = {};
  const svc = getService(c, a.serviceId);
  if (svc?.countsPackage && patient.package) patient.package.used = Math.min(patient.package.total, patient.package.used + 1);
}

export function upcomingForPhone(c, phone, nowS) {
  const d = phoneDigits(phone);
  return c.appointments
    .filter((a) => UPCOMING.has(a.status) && phoneDigits(a.phone) === d && endOf(a) > nowS)
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

export const weekRange = (key) => { const w = weekDays(key); return [w[0], w[6]]; };
export function weekAppts(c, key) {
  const [first, last] = weekRange(key);
  return c.appointments.filter((a) => { const d = a.start.slice(0, 10); return d >= first && d <= last; });
}

/** Indicadores del panel (CIT-RF-12). */
export function kpis(c, nowDate) {
  const week = weekAppts(c, dateKey(nowDate));
  const live = week.filter((a) => a.status !== 'cancelada');
  const confirmed = live.filter((a) => a.status === 'confirmada' || a.status === 'atendida').length;
  return {
    total: live.length,
    canceled: week.length - live.length,
    confirmed,
    pctConfirmed: live.length ? Math.round((confirmed * 100) / live.length) : 0,
    avoided: week.filter((a) => a.avoided).length,
    humans: c.conversations.filter((v) => v.flags?.handoff).length,
    urgent: c.conversations.filter((v) => v.flags?.urgent).length,
  };
}

/**
 * Cuándo sale el recordatorio de una cita que se agenda ahora (CIT-RF-16). Normalmente, el día anterior a la hora configurada.
 * Si esa hora ya pasó (p. ej. de noche, para una cita de mañana temprano), sale unas horas antes de la cita
 * (por defecto 2, configurable con horasRecordatorioCercano); si ni eso cabe, no se programa ninguno.
 * Devuelve { kind: 'dia-anterior' | 'horas-antes' | 'ninguno', due, hours? }. Nunca devuelve una hora pasada.
 */
export function planReminder(c, start, nowS) {
  const dayBefore = `${addDays(start.slice(0, 10), -1)}T${c.config.reminderTime || '09:00'}`;
  if (dayBefore > nowS) return { kind: 'dia-anterior', due: dayBefore };
  const hours = Number(c.config.horasRecordatorioCercano ?? 2) || 2;
  const near = addMin(start, -hours * 60);
  if (near > nowS) return { kind: 'horas-antes', due: near, hours };
  return { kind: 'ninguno', due: null };
}

export const reminderDue = (c, a) => `${addDays(a.start.slice(0, 10), -1)}T${c.config.reminderTime || '09:00'}`;

/** Recordatorios "día anterior" de las próximas citas, en orden de envío. */
export function dayBeforeList(c, nowS, limit = 8) {
  return c.appointments
    .filter((a) => UPCOMING.has(a.status) && a.start >= nowS && a.reminderPlan?.kind !== 'ninguno')
    .map((a) => ({ kind: a.reminderPlan?.kind || 'dia-anterior', apptId: a.id, due: a.reminderPlan?.due || reminderDue(c, a), state: a.reminder || 'programado', patient: a.name, start: a.start, serviceId: a.serviceId }))
    .sort((x, y) => (x.due < y.due ? -1 : 1))
    .slice(0, limit);
}

/** Avisa al paciente dentro de su conversación (crea una si no existe). Devuelve la conversación. */
export function notifyPatient(c, appt, text, ts = epochNow()) {
  const d = phoneDigits(appt.phone);
  let conv = c.conversations.find((v) => phoneDigits(v.phone) === d);
  if (!conv) {
    conv = {
      id: newId('cv'), name: appt.name, phone: appt.phone, patientId: appt.patientId, messages: [], flags: { urgent: false, handoff: false },
      mode: 'bot', resolved: false, script: { step: 'menu', data: {}, misses: 0 }, lastTs: ts, unread: 0,
    };
    c.conversations.push(conv);
  }
  conv.messages.push({ id: newId('m'), from: 'bot', text, ts });
  conv.lastTs = ts;
  conv.unread = (conv.unread || 0) + 1;
  return conv;
}
