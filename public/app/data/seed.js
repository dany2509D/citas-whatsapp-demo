// Datos semilla: por giro, 3 profesionales, 4 servicios, 15 pacientes y 25 citas en la semana
// actual (de lunes a sábado) con estados variados. Determinista: el mismo giro y el mismo día
// siempre dan la misma semilla, así "Reiniciar demo" deja exactamente el estado de partida.
//
// Reglas de coherencia (CIT-RNF-04, CIT-RNF-08):
//  - Nada tiene fecha posterior a "ahora", a cualquier hora del día: las citas se crean como muy tarde
//    "ayer" (a una hora fija por cita), y los mensajes y las notas de historial se recortan a "ahora".
//  - Un paciente tiene como máximo una cita por día en la semilla (así nunca se cruzan).
//  - El recordatorio "día anterior" se calcula con la misma regla de la agenda (reminderDue): si su hora
//    ya venció, la cita queda con recordatorio "enviado"; si no, "programado". Nunca "programado" en el pasado.
//  - Las conversaciones de ejemplo 1 y 3 se construyen a partir de citas reales de la semilla
//    (mismo servicio, fecha, hora y profesional que mencionan).
import { TEMPLATES } from './templates.js';
import {
  DAYS, addDays, addMonths, dateKey, dateKeyOfEpoch, dateLong, dateShort, dayOfWeek, epochOf, fromMin, mondayOf, stamp, stampLong, stampShort, time12, toMin, weekDays,
} from '../../shared/time/panama.js';
import {
  createAppointment, dayHours, earliestStart, endOf, freeSlots, getPro, getService, newId, note, reminderDue, slotProblem, suggestSlots,
} from '../agenda.js';
import { REDACTED_TEXT } from '../privacy.js';
import { fill, firstName, money } from '../format.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const byStart = (x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0);

const WEIGHTS = {
  fisio: { evaluacion: 2, sesion: 5, paquete: 1, control: 2 },
  dental: { evaluacion: 3, limpieza: 4, blanqueamiento: 1, ortodoncia: 3 },
  vet: { consulta: 4, vacuna: 3, desparasitacion: 2, bano: 3 },
};
const PAY = ['Yappy', 'Tarjeta', 'ACH', 'Efectivo'];

export function emptyConversation(id = 'live', ts = Date.now()) {
  return {
    id, name: '', phone: '', patientId: null, messages: [], flags: { urgent: false, handoff: false }, mode: 'bot',
    resolved: false, script: { step: 'menu', data: {}, misses: 0 }, lastTs: ts, unread: 0,
  };
}

function seedPatients(id, T, today, r) {
  const prefix = { fisio: 1, dental: 2, vet: 3 }[id];
  return T.patients.map((row, i) => {
    const p = { id: `pa${i + 1}`, name: row[0], phone: `6000-${prefix}${String(i + 1).padStart(3, '0')}`, sent: {}, history: [] };
    const daysAgo = (min, max) => addDays(today, -(min + Math.floor(r() * (max - min + 1))));
    if (id === 'fisio') {
      if (row[1] === 'paq') p.package = { total: 10, used: row[2] };
      p.history.push({ serviceId: row[1] === 'paq' ? 'sesion' : 'evaluacion', date: daysAgo(3, 20) });
    } else if (id === 'dental') {
      if (row[1] != null) p.history.push({ serviceId: 'limpieza', date: addDays(addMonths(today, -row[1]), -Math.floor(r() * 5)) });
      else p.history.push({ serviceId: 'evaluacion', date: daysAgo(20, 90) });
    } else {
      p.pet = { name: row[1], species: row[2], age: row[3] };
      p.history.push({ serviceId: 'vacuna', date: addDays(addMonths(today, -row[4]), -Math.floor(r() * 5)) });
    }
    return p;
  });
}

function distribute(total, n) {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total - base * n ? 1 : 0));
}

/** Hora en que se creó la cita: de 1 a 5 días antes de su día, pero nunca después de "ayer" (así siempre es anterior a ahora). */
function createdStamp(r, key, today) {
  const k = Math.floor(r() * 5) + 1;
  const day = [addDays(key, -k), addDays(today, -1)].sort()[0];
  return epochOf(`${day}T${fromMin(8 * 60 + Math.floor(r() * 20) * 30)}`);
}

/** Estado del recordatorio "día anterior": si su hora ya venció quedó enviado; si no, programado (misma regla que dayBeforeList). */
const reminderFor = (c, a, nowS) => (reminderDue(c, a) <= nowS ? 'enviado' : 'programado');

function seedAppointments(c, id, today, nowS, nowE, r) {
  const days = weekDays(today).filter((k) => dayHours(c, k));
  const counts = distribute(25, days.length);
  const weights = Object.entries(WEIGHTS[id]).flatMap(([s, w]) => Array(w).fill(s));
  days.forEach((key, di) => {
    let placed = 0;
    for (let tries = 0; placed < counts[di] && tries < 400; tries++) {
      const serviceId = pick(r, weights);
      const svc = c.config.services.find((s) => s.id === serviceId);
      const pros = c.config.professionals.filter((p) => p.serviceIds.includes(serviceId) && p.days.includes(dayOfWeek(key)));
      if (!pros.length) continue;
      const pro = pick(r, pros);
      const h = dayHours(c, key);
      const starts = [];
      for (let t = toMin(h.open); t + svc.minutes <= toMin(h.close); t += c.config.slotMinutes) {
        const start = `${key}T${fromMin(t)}`;
        if (!slotProblem(c, pro.id, start, svc.minutes)) starts.push(start);
      }
      if (!starts.length) continue;
      // Un paciente, como máximo una cita por día: se elige entre quienes aún no tienen cita ese día.
      const free = c.patients.filter((p) => !c.appointments.some((a) => a.patientId === p.id && a.start.slice(0, 10) === key));
      if (!free.length) continue;
      const patient = pick(r, free);
      const origin = r() < 0.6 ? 'chat' : 'panel';
      const res = createAppointment(c, { name: patient.name, phone: patient.phone, serviceId, professionalId: pro.id, start: pick(r, starts), origin, ts: createdStamp(r, key, today) });
      if (res.ok) placed++;
    }
  });

  // Estados según el momento: lo pasado se atiende o falta; lo futuro está pendiente, confirmado, etc.
  for (const a of c.appointments) {
    const end = endOf(a);
    let status;
    if (end <= nowS) { const x = r(); status = x < 0.72 ? 'atendida' : x < 0.84 ? 'no_asistio' : 'cancelada'; }
    else if (a.start <= nowS) status = 'confirmada';
    else { const x = r(); status = x < 0.34 ? 'pendiente' : x < 0.8 ? 'confirmada' : x < 0.92 ? 'reprogramada' : 'cancelada'; }
    a.status = status;
  }
  const future = c.appointments.filter((a) => a.start > nowS);
  const need = (status, n, from) => {
    let have = c.appointments.filter((a) => a.status === status).length;
    for (const a of from) { if (have >= n) break; if (a.status !== status) { a.status = status; have++; } }
  };
  need('reprogramada', 3, future.filter((a) => a.status === 'pendiente' || a.status === 'confirmada'));
  need('no_asistio', 2, c.appointments.filter((a) => endOf(a) <= nowS && a.status === 'atendida'));
  need('pendiente', 3, future.filter((a) => a.status === 'confirmada'));

  // Ninguna nota de historial puede ser posterior a "ahora": las de "después de la cita" se recortan.
  const afterVisit = (a) => Math.min(epochOf(endOf(a)) + 10 * 60000, nowE);
  for (const a of c.appointments) {
    const svc = c.config.services.find((s) => s.id === a.serviceId);
    const base = a.createdAt + 3600000;
    if (a.status === 'confirmada') { a.reminder = 'confirmo'; note(a, 'Estado: Pendiente → Confirmada (por el paciente en el chat)', base); }
    else if (a.status === 'pendiente') a.reminder = reminderFor(c, a, nowS);
    else if (a.status === 'reprogramada') {
      a.rescheduled = true; a.avoided = true; a.reminder = reminderFor(c, a, nowS);
      note(a, 'Reprogramada: el paciente pidió cambiar al recibir el recordatorio (con aviso por WhatsApp)', base);
    } else if (a.status === 'cancelada') { a.reminder = reminderFor(c, a, nowS); note(a, 'Estado: Pendiente → Cancelada (por el paciente en el chat)', base); }
    else if (a.status === 'no_asistio') { a.reminder = 'enviado'; note(a, 'Estado: Pendiente → No asistió (desde el panel)', afterVisit(a)); }
    else if (a.status === 'atendida') {
      a.reminder = 'confirmo'; a.attended = true;
      note(a, 'Estado: Pendiente → Confirmada (por el paciente en el chat)', base);
      note(a, 'Estado: Confirmada → Atendida (desde el panel)', afterVisit(a));
      if (r() < 0.65) a.payment = { method: pick(r, PAY), amount: Math.round(svc.price * (svc.itbms ? 1.07 : 1) * 100) / 100, at: afterVisit(a), simulated: true };
    }
  }
  // Ausencias evitadas (KPI): al menos 3, aunque la semana ya esté casi toda en el pasado (p. ej. un sábado por la noche).
  let avoided = c.appointments.filter((a) => a.avoided).length;
  for (const a of c.appointments) {
    if (avoided >= 3) break;
    if (a.avoided || (a.status !== 'atendida' && a.status !== 'confirmada')) continue;
    a.rescheduled = true; a.avoided = true; avoided++;
    note(a, 'Reprogramada: el paciente pidió cambiar al recibir el recordatorio (con aviso por WhatsApp)', a.createdAt + 2 * 3600000);
  }
  c.appointments.sort(byStart);
}

const sameDay = (c, patientId, key, exceptId) => c.appointments.some((a) => a.id !== exceptId && a.patientId === patientId && a.start.slice(0, 10) === key);

/**
 * Cita futura de la semilla (o, si ya no queda ninguna esta semana, una de la semana siguiente) que se le
 * asigna a un paciente para que la conversación de ejemplo hable de una cita real. Respeta "una cita por día".
 */
function claimAppt(c, patient, status, today, nowS, nowE, taken) {
  let a = c.appointments.filter((x) => x.status === status && x.start > nowS && !taken.has(x.id) && !sameDay(c, patient.id, x.start.slice(0, 10), x.id)).sort(byStart)[0];
  if (!a) {
    const svc = c.config.services[1] || c.config.services[0];
    const from = `${addDays(mondayOf(today), 7)}T00:00`;
    const slot = freeSlots(c, { serviceId: svc.id, from, days: 7, patientPhone: patient.phone })[0];
    const res = createAppointment(c, { name: patient.name, phone: patient.phone, serviceId: svc.id, professionalId: slot.professionalId, start: slot.start, origin: 'chat', ts: nowE - 2 * 86400000 });
    a = res.appt;
    a.status = status;
    if (status === 'reprogramada') { a.rescheduled = true; a.avoided = true; }
  }
  taken.add(a.id);
  a.patientId = patient.id; a.name = patient.name; a.phone = patient.phone; a.pet = patient.pet ? { ...patient.pet } : null;
  a.reminder = reminderFor(c, a, nowS);
  return a;
}

function seedConversations(c, T, today, nowS, nowE) {
  const P = c.patients;
  const menu = '1. Agendar cita\n2. Precios y horarios\n3. Ubicación\n4. Reprogramar o cancelar\n5. Hablar con una persona';
  const greet = `${fill(T.messages.greeting, { clinica: T.name })}\n\n${menu}`;
  let n = 0;
  const mk = (from, text, minsAgo, extra = {}) => ({ id: `ms${++n}`, from, text, ts: nowE - minsAgo * 60000, ...extra });
  const conv = (idx, patient, flags, messages, mode = 'bot', resolved = false) => ({
    id: `cvs${idx}`, name: patient.name, phone: patient.phone, patientId: patient.id, messages, flags, mode, resolved,
    script: { step: 'menu', data: {}, misses: 0 }, lastTs: messages.at(-1).ts, unread: 0,
  });
  const noFlags = () => ({ urgent: false, handoff: false });
  const a = P[1]; const b = P[3]; const d = P[5]; const e = P[8]; const f = P[10]; const g = P[12];
  const [s0] = c.config.services;
  const taken = new Set();

  const showPro = (serviceId) => c.config.professionals.filter((p) => p.active !== false && p.serviceIds.includes(serviceId)).length > 1;
  const slotLine = (s, serviceId) => `${dateShort(s.start.slice(0, 10))} · ${time12(s.start.slice(11, 16))}${showPro(serviceId) ? ` · ${getPro(c, s.professionalId)?.name || ''}` : ''}`;
  /** Horarios ofrecidos: los libres más próximos del paciente más el de la cita real, en orden cronológico. */
  const offered = (appt, nFree) => {
    const free = suggestSlots(c, { serviceId: appt.serviceId, from: earliestStart(c, nowS), patientPhone: appt.phone }, nFree);
    const own = { start: appt.start, professionalId: appt.professionalId };
    const list = [...free, own].sort(byStart);
    return { list, idx: list.findIndex((s) => s.start === own.start && s.professionalId === own.professionalId) };
  };
  const petText = (p) => (p.pet ? `${p.pet.name} (${p.pet.species}, ${p.pet.age})` : '');

  // Conversación 1: el paciente agenda desde el chat; la cita existe, es pendiente y se creó en el último mensaje del bot.
  const appt1 = claimAppt(c, a, 'pendiente', today, nowS, nowE, taken);
  const svc1 = getService(c, appt1.serviceId);
  const pro1 = getPro(c, appt1.professionalId);
  const o1 = offered(appt1, 2);
  const bookedTs = nowE - 184 * 60000;
  appt1.origin = 'chat'; appt1.createdAt = bookedTs;
  appt1.history = [{ ts: bookedTs, text: 'Creada desde el chat de WhatsApp' }];

  // Conversación 3: recordatorio → "Reprogramar" → nuevo horario. La cita (reprogramada) es la real y su historial dice de dónde vino.
  const appt3 = claimAppt(c, d, 'reprogramada', today, nowS, nowE, taken);
  const svc3 = getService(c, appt3.serviceId);
  const remindTs = nowE - 300 * 60000;
  const remindDay = addDays(dateKeyOfEpoch(remindTs), 1);
  let oldDay = remindDay;
  for (let i = 0; i < 8 && !dayHours(c, oldDay); i++) oldDay = addDays(oldDay, 1);
  const oldFree = freeSlots(c, { serviceId: appt3.serviceId, dayKey: oldDay, from: `${oldDay}T00:00`, patientPhone: appt3.phone })[0];
  let oldStart = oldFree ? oldFree.start : `${oldDay}T${dayHours(c, oldDay).open}`;
  if (oldStart === appt3.start) oldStart = `${oldDay}T${dayHours(c, oldDay).open}`;
  const when = oldDay === remindDay ? 'mañana' : `el ${DAYS[dayOfWeek(oldDay)]}`;
  const o3 = offered(appt3, 2);
  appt3.history = [appt3.history[0], { ts: nowE - 287 * 60000, text: `Reprogramada: ${stampShort(oldStart)} → ${stampShort(appt3.start)} (por el paciente en el chat; con aviso por WhatsApp)` }];

  return [
    conv(1, a, noFlags(), [
      mk('user', 'Hola, quiero una cita', 190, { status: 'read' }), mk('bot', greet, 189),
      mk('user', `Quiero ${svc1.name.toLowerCase()}`, 187, { status: 'read' }),
      mk('bot', `Estos son los horarios disponibles para ${svc1.name}:\n${o1.list.map((s, i) => `${i + 1}. ${slotLine(s, appt1.serviceId)}`).join('\n')}\n\nResponda con el número, elija un día o escriba «otros horarios».`, 186),
      mk('user', String(o1.idx + 1), 185, { status: 'read' }),
      mk('bot', fill(T.messages.confirm, {
        nombre: firstName(a.name), fecha: dateLong(appt1.start.slice(0, 10)), hora: time12(appt1.start.slice(11, 16)), servicio: svc1.name, profesional: pro1.name, mascota: petText(a), clinica: T.name,
      }), 184),
    ]),
    conv(2, b, noFlags(), [
      mk('user', `¿Cuánto cuesta ${s0.name.toLowerCase()}?`, 95, { status: 'read' }),
      mk('bot', `${T.messages.pricesIntro}\n• ${s0.name} — ${s0.minutes} min — ${money(s0.price)}`, 94),
      mk('user', 'Gracias', 93, { status: 'read' }), mk('bot', '¡Con gusto! Si desea agendar, escriba «cita».', 92),
    ]),
    conv(3, d, noFlags(), [
      mk('bot', fill(T.messages.reminder, { nombre: firstName(d.name), hora: time12(oldStart.slice(11, 16)) }).replace('mañana', when), 300),
      mk('user', '2', 290, { status: 'read' }),
      mk('bot', `Estos son los horarios libres para reprogramar su cita de ${svc3.name} (ahora: ${stampShort(oldStart)}):\n${o3.list.map((s, i) => `${i + 1}. ${slotLine(s, appt3.serviceId)}`).join('\n')}\n\nResponda con el número, elija un día o escriba «otros horarios».`, 289),
      mk('user', String(o3.idx + 1), 288, { status: 'read' }),
      mk('bot', `✅ Listo. Su cita de ${svc3.name} quedó reprogramada para el ${stampLong(appt3.start)}\nEl horario anterior quedó libre.`, 287),
    ]),
    conv(4, e, { urgent: false, handoff: true }, [
      mk('user', '¿Trabajan con seguro o aseguradoras?', 45, { status: 'read' }),
      mk('bot', 'Esa consulta la atiende una persona del equipo. ¿Desea que le contacte?', 44),
      mk('user', 'Sí, por favor', 43, { status: 'read' }),
      mk('bot', fill(T.messages.handoff, { clinica: T.name }), 42),
    ], 'humano'),
    conv(5, f, { urgent: true, handoff: false }, [
      mk('user', REDACTED_TEXT, 20, { status: 'read' }),
      mk('bot', fill(T.messages.urgent, { telefono: T.phone }), 19),
    ]),
    conv(6, g, { urgent: false, handoff: true }, [
      mk('user', 'Necesito una factura de mi última visita', 600, { status: 'read' }),
      mk('bot', fill(T.messages.handoff, { clinica: T.name }), 599),
      mk('staff', 'Hola, ya le enviamos la factura al correo registrado.', 560),
      mk('user', 'Recibida, gracias', 555, { status: 'read' }),
    ], 'bot', true),
  ];
}

export function buildClinic(id, nowDate) {
  const T = TEMPLATES[id];
  const today = dateKey(nowDate);
  const nowS = stamp(nowDate);
  const nowE = epochOf(nowS);
  const r = rng(hash(`${id}:${mondayOf(today)}`));

  const config = {
    address: T.address,
    phone: T.phone,
    telefonoEmergenciasFueraDeHorario: T.telefonoEmergenciasFueraDeHorario || '',
    hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, T.hours[d] ? { open: T.hours[d][0], close: T.hours[d][1] } : null])),
    lunch: { start: '12:00', end: '13:00' },
    slotMinutes: 30,
    leadMinutes: 60,
    reminderTime: '09:00',
    services: T.services.map((s) => ({ ...s, active: true })),
    professionals: T.pros.map((p) => ({ id: p.id, name: p.name, specialty: p.specialty, days: [...p.days], serviceIds: [...p.services], active: true })),
    messages: { ...T.messages },
    urgentWords: [...T.urgent],
  };

  const c = {
    giro: id, seedWeek: mondayOf(today), config, patients: [], appointments: [], conversations: [], events: [],
  };
  c.patients = seedPatients(id, T, today, r);
  seedAppointments(c, id, today, nowS, nowE, r);
  c.conversations = [emptyConversation('live', nowE), ...seedConversations(c, T, today, nowS, nowE)];
  c.appointments.sort(byStart);
  for (const a of c.appointments) a.history.sort((x, y) => x.ts - y.ts);
  c.events = [{ id: newId('ev'), ts: nowE, kind: 'sistema', text: 'Datos de ejemplo cargados: 3 profesionales, 25 citas esta semana y 15 pacientes ficticios.' }];
  return c;
}
