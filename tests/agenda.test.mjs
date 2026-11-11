import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from './helpers.mjs';
import { now, nowStamp } from '../public/shared/time/panama.js';
import {
  createAppointment, earliestStart, endOf, freeSlots, kpis, moveAppointment, setStatus, slotProblem, suggestSlots,
} from '../public/app/agenda.js';
import { GIROS } from '../public/app/data/templates.js';
import { computeFollowups } from '../public/app/followups.js';

for (const giro of GIROS) {
  test(`semilla ${giro}: 3 profesionales, 4 servicios, 15 pacientes, 25 citas esta semana`, () => {
    const { c } = new Session(giro);
    assert.equal(c.config.professionals.length, 3);
    assert.equal(c.config.services.length, 4);
    assert.equal(c.patients.length, 15);
    assert.equal(c.appointments.length, 25);
    for (const a of c.appointments) assert.ok(a.start >= '2026-11-09' && a.start < '2026-11-15', a.start);
    assert.ok(new Set(c.appointments.map((a) => a.status)).size >= 4, 'estados variados');
  });

  test(`semilla ${giro}: ninguna cita se superpone con otra del mismo profesional`, () => {
    const { c } = new Session(giro);
    const live = c.appointments.filter((a) => a.status !== 'cancelada');
    for (const a of live) {
      for (const b of live) {
        if (a === b || a.professionalId !== b.professionalId) continue;
        assert.ok(!(a.start < endOf(b) && endOf(a) > b.start), `${a.id} se cruza con ${b.id}`);
      }
    }
  });

  test(`semilla ${giro}: determinista (mismo día, mismos datos)`, () => {
    const a = new Session(giro).c; const b = new Session(giro).c;
    assert.deepEqual(a.appointments.map((x) => [x.start, x.status, x.professionalId]), b.appointments.map((x) => [x.start, x.status, x.professionalId]));
  });
}

test('un horario nunca queda asignado dos veces al mismo profesional', () => {
  const { c } = new Session('fisio');
  const slot = freeSlots(c, { serviceId: 'sesion', professionalId: 'p1', from: earliestStart(c, nowStamp()) })[0];
  const first = createAppointment(c, { name: 'Ana Pérez', phone: '6000-9001', serviceId: 'sesion', professionalId: 'p1', start: slot.start });
  assert.ok(first.ok);
  assert.equal(createAppointment(c, { name: 'Otra Persona', phone: '6000-9002', serviceId: 'sesion', professionalId: 'p1', start: slot.start }).reason, 'ocupado');
  // ni siquiera a mitad de la cita
  const mid = new Date(Date.parse(`${slot.start}:00Z`) + 15 * 60000).toISOString().slice(0, 16);
  assert.equal(slotProblem(c, 'p1', mid, 30), 'ocupado');
  // ese horario ya no se ofrece
  assert.ok(!suggestSlots(c, { serviceId: 'sesion', professionalId: 'p1', from: earliestStart(c, nowStamp()) }, 50).some((s) => s.start === slot.start));
});

test('mover: valida el destino y libera el horario anterior; cancelar también libera', () => {
  const { c } = new Session('dental');
  const from = earliestStart(c, nowStamp());
  const [s1, s2] = freeSlots(c, { serviceId: 'limpieza', professionalId: 'p1', from });
  const { appt } = createAppointment(c, { name: 'Luis Gómez', phone: '6000-9003', serviceId: 'limpieza', professionalId: 'p1', start: s1.start });
  const blocker = createAppointment(c, { name: 'Bloqueo', phone: '6000-9004', serviceId: 'limpieza', professionalId: 'p1', start: s2.start });
  assert.equal(moveAppointment(c, appt.id, { start: s2.start }).reason, 'ocupado');
  assert.equal(moveAppointment(c, appt.id, { start: '2026-11-15T10:00' }).reason, 'cerrado'); // domingo
  const free = freeSlots(c, { serviceId: 'limpieza', professionalId: 'p1', from }).find((s) => s.start > s2.start && s.start !== s1.start);
  const moved = moveAppointment(c, appt.id, { start: free.start });
  assert.ok(moved.ok); assert.equal(appt.status, 'reprogramada'); assert.ok(appt.avoided);
  assert.equal(slotProblem(c, 'p1', s1.start, 45), null, 'el horario anterior quedó libre');
  assert.ok(setStatus(c, blocker.appt.id, 'cancelada').ok);
  assert.equal(slotProblem(c, 'p1', s2.start, 45), null, 'cancelar libera el horario');
  // volver a activar una cita cancelada sobre un horario ocupado se rechaza
  createAppointment(c, { name: 'Nueva', phone: '6000-9005', serviceId: 'limpieza', professionalId: 'p1', start: s2.start });
  assert.equal(setStatus(c, blocker.appt.id, 'pendiente').reason, 'ocupado');
});

test('estados: cada cambio queda en el historial con hora', () => {
  const { c } = new Session('vet');
  const a = c.appointments.find((x) => x.status === 'pendiente');
  const before = a.history.length;
  setStatus(c, a.id, 'confirmada');
  setStatus(c, a.id, 'atendida');
  assert.equal(a.history.length, before + 2);
  assert.ok(a.history.every((h) => typeof h.ts === 'number' && h.text));
  assert.equal(setStatus(c, a.id, 'inventado').ok, false);
});

test('indicadores de la semana', () => {
  const { c } = new Session('fisio');
  const k = kpis(c, now());
  assert.equal(k.total + k.canceled, 25);
  assert.ok(k.pctConfirmed >= 0 && k.pctConfirmed <= 100);
  assert.ok(k.avoided >= 3);
  assert.ok(k.humans >= 2);
});

test('seguimientos por giro: 12 meses (vet), 6 meses (dental), 2 sesiones (fisio)', () => {
  const today = '2026-11-10';
  const vet = computeFollowups(new Session('vet').c, 'vet', today);
  assert.ok(vet.some((f) => f.state === 'por_enviar' && /vacuna/i.test(f.label)));
  const dental = computeFollowups(new Session('dental').c, 'dental', today);
  assert.ok(dental.some((f) => f.state === 'por_enviar' && /6 meses/.test(f.label)));
  const fisio = computeFollowups(new Session('fisio').c, 'fisio', today);
  const due = fisio.filter((f) => f.state === 'por_enviar');
  assert.ok(due.length >= 1 && due.every((f) => /quedan 2 sesiones/.test(f.label)));
});
