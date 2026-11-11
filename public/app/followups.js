// Seguimientos por giro (CIT-RF-08):
//  · Veterinaria: aviso de la próxima vacuna a los 12 meses de la última.
//  · Fisioterapia: aviso cuando quedan 2 sesiones del paquete.
//  · Odontología: recordatorio de limpieza a los 6 meses de la última.
import { addMonths, stampShort } from '../shared/time/panama.js';
import { UPCOMING, getPatient } from './agenda.js';

export const FOLLOWUP_KIND = { fisio: 'paquete', dental: 'limpieza', vet: 'vacuna' };
export const FOLLOWUP_SERVICE = { fisio: 'sesion', dental: 'limpieza', vet: 'vacuna' };

export function lastService(patient, serviceId) {
  const dates = (patient.history || []).filter((h) => h.serviceId === serviceId).map((h) => h.date).sort();
  return dates.at(-1) || null;
}

export const STATE_LABEL = { por_enviar: 'Por enviar', programado: 'Programado', enviado: 'Enviado', agendada: 'Cita agendada' };

/** Lista de seguimientos: primero los que ya toca enviar. */
export function computeFollowups(c, giro, today) {
  const kind = FOLLOWUP_KIND[giro];
  const serviceId = FOLLOWUP_SERVICE[giro];
  const items = [];
  for (const p of c.patients) {
    let due = null; let marker = null; let label = null; let ready = false;
    if (kind === 'vacuna') {
      const last = lastService(p, 'vacuna');
      if (!last) continue;
      due = addMonths(last, 12); marker = last; ready = due <= today;
      label = `Próxima vacuna de ${p.pet?.name || 'la mascota'} (la última fue el ${last.split('-').reverse().join('/')})`;
    } else if (kind === 'limpieza') {
      const last = lastService(p, 'limpieza');
      if (!last) continue;
      due = addMonths(last, 6); marker = last; ready = due <= today;
      label = `Limpieza de los 6 meses (la última fue el ${last.split('-').reverse().join('/')})`;
    } else {
      if (!p.package) continue;
      const remaining = p.package.total - p.package.used;
      if (remaining < 2 || remaining > 4) continue; // el aviso sale exactamente al quedar 2 sesiones
      marker = String(p.package.used); ready = remaining <= 2; due = ready ? today : null;
      label = ready ? `Paquete ${p.package.used}/${p.package.total}: quedan ${remaining} sesiones` : `Paquete ${p.package.used}/${p.package.total}: se avisa al quedar 2 sesiones`;
    }
    const booked = c.appointments.find((a) => a.patientId === p.id && UPCOMING.has(a.status) && a.serviceId === serviceId && a.start >= `${today}T00:00`);
    let state;
    if (booked) state = 'agendada';
    else if (p.sent?.[kind] === marker) state = 'enviado';
    else state = ready ? 'por_enviar' : 'programado';
    items.push({ id: `${p.id}:${kind}`, patientId: p.id, name: p.name, kind, due, state, label, marker, bookedStart: booked ? booked.start : null, bookedLabel: booked ? stampShort(booked.start) : null });
  }
  const rank = { por_enviar: 0, programado: 1, enviado: 2, agendada: 3 };
  return items.sort((a, b) => rank[a.state] - rank[b.state] || String(a.due || '9').localeCompare(String(b.due || '9')));
}

export function markFollowupSent(c, patientId, kind, marker) {
  const p = getPatient(c, patientId);
  if (!p) return;
  p.sent = p.sent || {};
  p.sent[kind] = marker;
}
