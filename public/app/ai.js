// Modo "IA real" del lado del navegador. La IA solo PROPONE acciones; aquí se aplican únicamente
// las de la lista permitida, validando cada payload contra la agenda real (BASE: contrato de /api/chat).
import { askAI } from '../shared/chat-engine/ai-adapter.js';
import { isPanamaMobile, parseName, parsePhone, phoneDigits } from '../shared/chat-engine/nlu.js';
import { clock, dateShort, stamp, stampLong, stampShort, time12, todayKey } from '../shared/time/panama.js';
import {
  REASONS, UPCOMING, activeServices, createAppointment, earliestStart, freeSlots, getAppt, getPro, getService, moveAppointment, proOffers,
  setStatus, slotProblem, upcomingClosures, upcomingForPhone,
} from './agenda.js';
import { hoursSummary } from './format.js';
import { isDemo, runFlow } from './bot.js';

export const ALLOWED = ['proponer_horarios', 'crear_cita', 'reprogramar_cita', 'cancelar_cita', 'confirmar_cita', 'marcar_urgente', 'pasar_a_persona'];
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const short = (v, n = 40) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/**
 * Teléfonos con los que se buscan (y se pueden tocar) citas. En producción: SOLO el número del chat (el de WhatsApp que escribe).
 * En la demo comercial (modoDemo) también los que la persona escribió, para poder probar con los pacientes ficticios.
 */
function knownPhones(c, conv) {
  const set = new Set();
  if (isDemo(c)) for (const m of conv.messages) if (m.from === 'user') { const p = parsePhone(m.text || ''); if (p) set.add(phoneDigits(p)); }
  const own = conv.phone || conv.persona?.phone;
  if (own) set.add(phoneDigits(own));
  return set;
}

/** Hasta 6 horarios por día, repartidos, durante los próximos días abiertos (horarios libres reales). */
function slotsForContext(c, nowS) {
  const from = earliestStart(c, nowS);
  const byKey = new Map();
  for (const svc of activeServices(c)) {
    for (const s of freeSlots(c, { serviceId: svc.id, from, days: 10 })) {
      const key = `${s.start}|${s.professionalId}`;
      if (!byKey.has(key)) byKey.set(key, { inicio: s.start, profesionalId: s.professionalId, servicioIds: [] });
      byKey.get(key).servicioIds.push(svc.id);
    }
  }
  const perDay = new Map();
  for (const s of [...byKey.values()].sort((a, b) => (a.inicio < b.inicio ? -1 : 1))) {
    const day = s.inicio.slice(0, 10);
    if (!perDay.has(day)) perDay.set(day, []);
    perDay.get(day).push(s);
  }
  const out = [];
  for (const list of perDay.values()) {
    const step = Math.max(1, Math.floor(list.length / 6));
    for (let i = 0; i < list.length && out.length < 60; i += step) { if (out.filter((x) => x.inicio.startsWith(list[i].inicio.slice(0, 10))).length < 6) out.push(list[i]); }
  }
  return out;
}

export function buildAIContext(c, conv, profile, nowDate) {
  const nowS = stamp(nowDate);
  const phones = knownPhones(c, conv);
  const citas = [...phones].flatMap((p) => upcomingForPhone(c, p, nowS)).slice(0, 6).map((a) => ({
    id: a.id, servicioId: a.serviceId, profesionalId: a.professionalId, inicio: a.start, estado: a.status, nombre: a.name,
  }));
  const patient = conv.patientId ? c.patients.find((p) => p.id === conv.patientId) : null;
  return {
    giro: profile.giro,
    clinica: { nombre: profile.name, telefono: c.config.phone || '', direccion: c.config.address || '', horario: hoursSummary(c).replaceAll('\n', '; ') },
    hoy: todayKey(), horaActual: clock(nowDate),
    servicios: activeServices(c).map((s) => ({ id: s.id, nombre: s.name, duracionMin: s.minutes, precio: s.price, itbmsAplica: !!s.itbms })),
    profesionales: c.config.professionals.filter((p) => p.active !== false).map((p) => ({ id: p.id, nombre: p.name, especialidad: p.specialty, servicioIds: p.serviceIds })),
    mensajes: c.config.messages,
    horariosLibres: slotsForContext(c, nowS),
    cierresProximos: upcomingClosures(c, todayKey(), 45).map((x) => ({ fecha: x.date, motivo: x.name })),
    citasDelPaciente: citas,
    paciente: { nombre: conv.name || patient?.name || '', telefono: conv.phone || '', mascota: patient?.pet || null },
  };
}

/** Historial para la IA: solo texto guardado (los mensajes con posibles datos de salud ya van redactados). */
export function historyForAI(conv, max = 20) {
  return conv.messages.filter((m) => (m.from === 'user' || m.from === 'bot' || m.from === 'staff') && m.text)
    .slice(-max).map((m) => ({ role: m.from === 'user' ? 'user' : 'assistant', content: m.text }));
}

/** Aplica las acciones propuestas. Devuelve { errors, chips, touched }. Nada se aplica sin pasar la validación. */
export function applyActions(c, conv, actions, ctx) {
  const errors = []; const chips = []; const touched = new Set();
  const phones = knownPhones(c, conv);
  const nowS = stamp(ctx.now);
  const log = (...a) => ctx.log?.(...a);
  const own = (id) => { const a = getAppt(c, id); return a && UPCOMING.has(a.status) && phones.has(phoneDigits(a.phone)) ? a : null; };

  for (const act of actions || []) {
    const p = act.payload || {};
    if (!ALLOWED.includes(act.type)) { errors.push({ type: act.type, message: 'acción no permitida' }); continue; }
    switch (act.type) {
      case 'proponer_horarios': {
        for (const h of (Array.isArray(p.horarios) ? p.horarios : []).slice(0, 3)) {
          const svc = getService(c, h?.servicioId);
          if (!svc || !STAMP_RE.test(h.inicio || '') || !proOffers(c, h.profesionalId, svc.id) || slotProblem(c, h.profesionalId, h.inicio, svc.minutes)) continue;
          chips.push({ label: `${dateShort(h.inicio.slice(0, 10))} · ${time12(h.inicio.slice(11, 16))}`, text: `Quiero el ${stampLong(h.inicio)}` });
        }
        break;
      }
      case 'crear_cita': {
        const svc = getService(c, p.servicioId);
        const name = parseName(short(p.nombre, 60)); const phone = parsePhone(short(p.telefono, 30));
        const pet = c.giro === 'vet' ? { name: short(p.mascota?.nombre, 30), species: short(p.mascota?.especie, 20), age: short(p.mascota?.edad, 20) } : null;
        if (!svc || !STAMP_RE.test(p.inicio || '') || !name || !phone) { errors.push({ type: act.type, message: 'faltan datos para crear la cita' }); break; }
        if (!isPanamaMobile(phone)) { errors.push({ type: act.type, message: 'el teléfono debe ser un celular de Panamá (6XXX-XXXX)' }); break; }
        if (pet && !(pet.name && pet.species && pet.age)) { errors.push({ type: act.type, message: 'faltan los datos de la mascota' }); break; }
        if (p.inicio < nowS) { errors.push({ type: act.type, message: 'ese horario ya pasó' }); break; }
        const res = createAppointment(c, { name, phone, serviceId: svc.id, professionalId: p.profesionalId, start: p.inicio, origin: 'chat', pet });
        if (!res.ok) { errors.push({ type: act.type, message: REASONS[res.reason] || 'no se pudo crear la cita', reason: res.reason }); break; }
        conv.patientId = res.patient.id; conv.name = name; conv.phone = res.patient.phone;
        touched.add(res.appt.id);
        log('cita', `Cita creada por el chat (IA) · ${name} · ${svc.name} · ${stampShort(p.inicio)} · ${getPro(c, p.profesionalId).name}`, res.appt.id);
        break;
      }
      case 'reprogramar_cita': {
        const a = own(p.citaId);
        if (!a || !STAMP_RE.test(p.inicio || '')) { errors.push({ type: act.type, message: 'no encuentro esa cita' }); break; }
        const old = a.start;
        const res = moveAppointment(c, a.id, { start: p.inicio, professionalId: p.profesionalId || a.professionalId }, { notice: true, actor: 'chat' });
        if (!res.ok) { errors.push({ type: act.type, message: REASONS[res.reason] || 'no se pudo reprogramar', reason: res.reason }); break; }
        touched.add(a.id);
        log('estado', `Cita reprogramada por el paciente (IA) · ${a.name} · ${stampShort(old)} → ${stampShort(a.start)} · el horario anterior quedó libre`, a.id);
        break;
      }
      case 'cancelar_cita':
      case 'confirmar_cita': {
        const a = own(p.citaId);
        if (!a) { errors.push({ type: act.type, message: 'no encuentro esa cita' }); break; }
        const status = act.type === 'cancelar_cita' ? 'cancelada' : 'confirmada';
        const res = setStatus(c, a.id, status, { actor: 'chat' });
        if (!res.ok) { errors.push({ type: act.type, message: 'no se pudo actualizar la cita' }); break; }
        touched.add(a.id);
        log('estado', status === 'cancelada' ? `Cita cancelada por el paciente (IA) · ${a.name} · ${stampShort(a.start)} · el horario quedó libre` : `${a.name} confirmó por WhatsApp (IA) · ${stampShort(a.start)} → Confirmada`, a.id);
        break;
      }
      case 'marcar_urgente': {
        if (!conv.flags.urgent) { conv.flags.urgent = true; touched.add('conv'); log('urgente', `URGENTE · ${conv.name || 'Visitante de la demo'} · conversación marcada como urgente`); }
        break;
      }
      case 'pasar_a_persona': {
        if (!conv.flags.handoff) { runFlow(c, conv, ctx, 'handoff'); touched.add('conv'); }
        break;
      }
      default: break;
    }
  }
  return { errors, chips, touched: [...touched] };
}

/**
 * Un turno con IA real. Lanza AIUnavailable si /api/chat falla (quien llama vuelve al guion).
 * Devuelve { out, touched }.
 */
export async function aiTurn({ c, conv, profile, ctx, sessionId, ask = askAI }) {
  const res = await ask({ demo: 'citas', sessionId, messages: historyForAI(conv), context: buildAIContext(c, conv, profile, ctx.now) });
  const applied = applyActions(c, conv, res.actions, ctx);
  const touched = new Set(applied.touched);
  if (applied.errors.length) {
    const why = applied.errors[0].message;
    return { out: [{ text: `Lo siento, no pude completar ese paso: ${why}. ¿Desea que le muestre otros horarios o que una persona del equipo le ayude?`, chips: [{ label: 'Otros horarios', text: 'Muéstreme otros horarios' }, { label: 'Pasar a una persona', text: 'Hablar con una persona', kind: 'warn' }] }], touched: [...touched], errors: applied.errors };
  }
  if (res.handoff && !conv.flags.handoff) {
    runFlow(c, conv, ctx, 'handoff');
    touched.add('conv');
    return { out: [{ text: res.reply }], touched: [...touched], errors: [] };
  }
  const chips = applied.chips.length ? [...applied.chips, { label: 'Otros horarios', text: 'Muéstreme otros horarios' }] : undefined;
  return { out: [chips ? { text: res.reply, chips } : { text: res.reply }], touched: [...touched], errors: [] };
}
