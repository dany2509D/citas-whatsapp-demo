// Grupo B: semilla y agenda. Fechas imposibles (CIT-RNF-04) y citas cruzadas de un paciente (CIT-RNF-08).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXED_NOW, Session } from './helpers.mjs';
import { setNow, epochOf, nowStamp, now, stamp, mondayOf, dateKey, dateLong, time12, stampLong } from '../public/shared/time/panama.js';
import { buildClinic } from '../public/app/data/seed.js';
import { GIROS } from '../public/app/data/templates.js';
import {
  REASONS, UPCOMING, createAppointment, endOf, freeSlots, moveAppointment, patientConflict, reminderDue, setStatus, suggestSlots,
} from '../public/app/agenda.js';

const HOLD = new Set(['pendiente', 'confirmada', 'reprogramada', 'atendida', 'no_asistio']);
const at = (day, h, m) => () => new Date(Date.UTC(2026, 10, day, h, m, 0));

// Semana del lun 9 al dom 15 de nov de 2026, más el lunes 16 (semana nueva), a distintas horas.
const CLOCKS = [];
for (const day of [9, 10, 11, 12, 13, 14, 15, 16]) for (const [h, m] of [[0, 5], [0, 30], [8, 0], [10, 0], [12, 30], [18, 0], [23, 59]]) CLOCKS.push([`${day} nov ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, at(day, h, m)]);

test.afterEach(() => setNow(null));

function build(giro, clock) {
  setNow(clock);
  return buildClinic(giro, now());
}

for (const giro of GIROS) {
  test(`semilla ${giro}: nada tiene fecha futura a ninguna hora del día (${CLOCKS.length} relojes)`, () => {
    for (const [label, clock] of CLOCKS) {
      const c = build(giro, clock);
      const nowS = nowStamp();
      const nowE = epochOf(nowS);
      const ctx = `${giro} ${label}`;
      for (const a of c.appointments) {
        assert.ok(a.createdAt <= nowE, `${ctx}: cita ${a.name} ${a.start} creada en el futuro`);
        assert.ok(a.createdAt <= epochOf(a.start), `${ctx}: cita creada después de su propia hora`);
        let prev = 0;
        for (const h of a.history) {
          assert.ok(h.ts <= nowE, `${ctx}: historial futuro en ${a.name} ${a.start}: ${h.text}`);
          assert.ok(h.ts >= prev, `${ctx}: historial fuera de orden en ${a.name} ${a.start}`);
          prev = h.ts;
        }
        assert.ok(a.history[0].ts >= a.createdAt, `${ctx}: la primera nota es anterior a la creación`);
        if (a.payment) assert.ok(a.payment.at <= nowE, `${ctx}: pago futuro`);
      }
      for (const v of c.conversations) {
        assert.ok(v.lastTs <= nowE, `${ctx}: conversación ${v.id} con lastTs futuro`);
        let prev = 0;
        for (const m of v.messages) { assert.ok(m.ts <= nowE, `${ctx}: mensaje futuro en ${v.id}`); assert.ok(m.ts >= prev, `${ctx}: mensajes fuera de orden en ${v.id}`); prev = m.ts; }
      }
      for (const ev of c.events) assert.ok(ev.ts <= nowE, `${ctx}: evento futuro`);
      for (const p of c.patients) for (const h of p.history) assert.ok(h.date <= nowStamp().slice(0, 10), `${ctx}: historial de paciente con fecha futura`);
    }
  });

  test(`semilla ${giro}: ningún recordatorio "Programado" tiene la hora vencida`, () => {
    for (const [label, clock] of CLOCKS) {
      const c = build(giro, clock);
      const nowS = nowStamp();
      for (const a of c.appointments) {
        if (!UPCOMING.has(a.status) && a.status !== 'cancelada') continue;
        if (a.reminder === 'programado') assert.ok(reminderDue(c, a) > nowS, `${giro} ${label}: ${a.name} ${a.start} programado para ${reminderDue(c, a)}`);
      }
    }
  });

  test(`semilla ${giro}: un paciente nunca tiene citas cruzadas y como máximo una por día`, () => {
    for (const [label, clock] of CLOCKS) {
      const c = build(giro, clock);
      for (const a of c.appointments) {
        for (const b of c.appointments) {
          if (a === b || a.patientId !== b.patientId) continue;
          assert.notEqual(a.start.slice(0, 10), b.start.slice(0, 10), `${giro} ${label}: ${a.name} tiene dos citas el ${a.start.slice(0, 10)}`);
          if (HOLD.has(a.status) && HOLD.has(b.status)) assert.ok(!(a.start < endOf(b) && endOf(a) > b.start), `${giro} ${label}: ${a.name} con citas cruzadas`);
        }
      }
    }
  });

  test(`semilla ${giro}: 25 citas y 15 pacientes por semana, sin cruce de profesional, KPI razonable, a cualquier hora`, () => {
    for (const [label, clock] of CLOCKS) {
      const c = build(giro, clock);
      const wk = mondayOf(dateKey(now()));
      const week = c.appointments.filter((a) => mondayOf(a.start.slice(0, 10)) === wk);
      assert.equal(week.length, 25, `${giro} ${label}`);
      assert.equal(c.patients.length, 15);
      assert.ok(new Set(c.appointments.map((a) => a.status)).size >= 3, `${giro} ${label}: estados variados`);
      assert.ok(week.filter((a) => a.avoided).length >= 3, `${giro} ${label}: ausencias evitadas`);
      const live = c.appointments.filter((a) => a.status !== 'cancelada');
      for (const a of live) for (const b of live) {
        if (a === b || a.professionalId !== b.professionalId) continue;
        assert.ok(!(a.start < endOf(b) && endOf(a) > b.start), `${giro} ${label}: profesional con dos citas a la vez`);
      }
    }
  });

  test(`semilla ${giro}: las conversaciones de ejemplo coinciden con las citas que mencionan`, () => {
    for (const [label, clock] of CLOCKS) {
      const c = build(giro, clock);
      const nowE = epochOf(nowStamp());
      const svcName = (a) => c.config.services.find((s) => s.id === a.serviceId).name;
      const proName = (a) => c.config.professionals.find((p) => p.id === a.professionalId).name;
      // Conversación 1: agendó desde el chat; la cita existe, es pendiente y se creó con el último mensaje del bot.
      const v1 = c.conversations.find((v) => v.id === 'cvs1');
      const last1 = v1.messages.at(-1);
      const a1 = c.appointments.find((a) => a.patientId === v1.patientId && a.origin === 'chat' && a.createdAt === last1.ts);
      assert.ok(a1, `${giro} ${label}: cvs1 sin cita`);
      assert.equal(a1.status, 'pendiente');
      assert.ok(last1.text.includes(dateLong(a1.start.slice(0, 10))), `${giro} ${label}: fecha en cvs1`);
      assert.ok(last1.text.includes(time12(a1.start.slice(11, 16))), `${giro} ${label}: hora en cvs1`);
      assert.ok(last1.text.includes(svcName(a1)) && last1.text.includes(proName(a1)), `${giro} ${label}: servicio/profesional en cvs1`);
      assert.ok(v1.messages.some((m) => m.from === 'user' && m.text.toLowerCase().includes(svcName(a1).toLowerCase())), `${giro} ${label}: el paciente pide ese servicio`);
      assert.ok(a1.start > nowStamp(), `${giro} ${label}: la cita de cvs1 es futura`);
      // la opción que eligió es la de la cita
      const offer = v1.messages.find((m) => m.from === 'bot' && /^\d\. /m.test(m.text) && /horarios disponibles/.test(m.text)).text;
      const chosen = Number(v1.messages.filter((m) => m.from === 'user').at(-1).text);
      assert.ok(offer.split('\n').find((l) => l.startsWith(`${chosen}. `)).includes(time12(a1.start.slice(11, 16))), `${giro} ${label}: opción elegida`);
      // Conversación 3: recordatorio → reprogramar; la cita es la reprogramada que el último mensaje nombra.
      const v3 = c.conversations.find((v) => v.id === 'cvs3');
      const last3 = v3.messages.at(-1);
      const a3 = c.appointments.find((a) => a.patientId === v3.patientId && a.status === 'reprogramada' && last3.text.includes(stampLong(a.start)));
      assert.ok(a3, `${giro} ${label}: cvs3 sin cita reprogramada`);
      assert.ok(last3.text.includes(svcName(a3)), `${giro} ${label}: servicio en cvs3`);
      assert.ok(a3.history.at(-1).text.startsWith('Reprogramada: ') && a3.history.at(-1).ts <= nowE);
      assert.ok(a3.history.at(-1).text.includes(`→ ${a3.history.at(-1).text.split('→ ')[1].split(' (')[0]}`));
    }
  });

  test(`semilla ${giro}: determinista, "Reiniciar demo" deja lo mismo`, () => {
    const sig = (c) => JSON.stringify([
      c.appointments.map((a) => [a.patientId, a.serviceId, a.professionalId, a.start, a.status, a.reminder, a.createdAt, a.origin, a.history.map((h) => [h.ts, h.text])]),
      c.conversations.map((v) => [v.id, v.patientId, v.messages.map((m) => [m.from, m.text, m.ts])]),
    ]);
    for (const [, clock] of CLOCKS.filter((_, i) => i % 5 === 0)) assert.equal(sig(build(giro, clock)), sig(build(giro, clock)));
  });
}

// --- Regla de cruce de un mismo paciente ---------------------------------------------------------

function withPatientAppt(giro = 'fisio') {
  const s = new Session(giro);
  const { c } = s;
  const a = c.appointments.filter((x) => UPCOMING.has(x.status) && x.start > nowStamp()).sort((p, q) => (p.start < q.start ? -1 : 1))[0];
  return { c, a };
}

test('patientConflict: detecta cruces por teléfono o por id, ignora canceladas y la propia cita', () => {
  const { c, a } = withPatientAppt();
  assert.equal(patientConflict(c, { phone: a.phone, start: a.start, minutes: a.minutes })?.id, a.id);
  assert.equal(patientConflict(c, { patientId: a.patientId, start: a.start, minutes: 15 })?.id, a.id);
  assert.equal(patientConflict(c, { phone: `+507 ${a.phone}`, start: a.start, minutes: a.minutes })?.id, a.id, 'el formato del teléfono no importa');
  assert.equal(patientConflict(c, { phone: a.phone, start: a.start, minutes: a.minutes, ignoreId: a.id }), null);
  assert.equal(patientConflict(c, { phone: a.phone, start: endOf(a), minutes: 30 }), null, 'citas seguidas no se cruzan');
  assert.equal(patientConflict(c, { phone: '6000-9999', start: a.start, minutes: a.minutes }), null);
  const prev = a.status; a.status = 'cancelada';
  assert.equal(patientConflict(c, { phone: a.phone, start: a.start, minutes: a.minutes }), null, 'una cancelada no ocupa agenda');
  a.status = prev;
});

test('agendar: se rechaza con un motivo claro si el paciente ya tiene una cita que se cruza', () => {
  const { c, a } = withPatientAppt();
  // otro profesional libre a la misma hora (el cruce es del paciente, no del profesional)
  const other = c.config.professionals.find((p) => p.id !== a.professionalId && p.serviceIds.includes(a.serviceId));
  const before = c.appointments.length;
  const res = createAppointment(c, { name: a.name, phone: a.phone, serviceId: a.serviceId, professionalId: other.id, start: a.start });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'paciente_ocupado');
  assert.match(REASONS.paciente_ocupado, /ya tiene otra cita/);
  assert.equal(c.appointments.length, before);
  // si el cruce fuera con otro paciente, la regla no estorba
  const ok = createAppointment(c, { name: 'Persona Nueva', phone: '6000-9100', serviceId: a.serviceId, professionalId: other.id, start: a.start });
  assert.ok(ok.ok || ok.reason !== 'paciente_ocupado');
});

test('mover: se rechaza si el destino se cruza con otra cita del mismo paciente; la propia cita no cuenta', () => {
  const s = new Session('dental');
  const { c } = s;
  const from = `${nowStamp().slice(0, 10)}T00:00`;
  const [s1] = freeSlots(c, { serviceId: 'evaluacion', professionalId: 'p1', from: '2026-11-12T08:00', days: 1 });
  const first = createAppointment(c, { name: 'Marta Ruiz', phone: '6000-9200', serviceId: 'evaluacion', professionalId: 'p1', start: s1.start });
  assert.ok(first.ok);
  const [s2] = freeSlots(c, { serviceId: 'limpieza', professionalId: 'p1', from: '2026-11-13T08:00', days: 1 });
  const second = createAppointment(c, { name: 'Marta Ruiz', phone: '6000-9200', serviceId: 'limpieza', professionalId: 'p1', start: s2.start });
  assert.ok(second.ok);
  // mover la segunda sobre la primera (mismo profesional ocupado → ocupado) o con otro profesional (→ paciente_ocupado)
  const pro3 = c.config.professionals.find((p) => p.id === 'p3');
  const res = moveAppointment(c, second.appt.id, { start: s1.start, professionalId: 'p3' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'paciente_ocupado');
  assert.ok(pro3);
  // moverse a un horario libre sin cruce sí funciona, y moverse sobre sí misma (mismo horario) no se cruza consigo
  assert.ok(moveAppointment(c, second.appt.id, { start: s2.start }).ok);
  assert.equal(second.appt.status, 'reprogramada');
  assert.ok(from);
});

test('reactivar una cita cancelada que ahora se cruzaría con otra del paciente se rechaza', () => {
  const { c } = new Session('fisio');
  const free = freeSlots(c, { serviceId: 'sesion', from: '2026-11-12T08:00', days: 1 });
  const s1 = free.find((sl) => sl.professionalId === 'p1' && free.some((o) => o.start === sl.start && o.professionalId === 'p2'));
  assert.ok(s1);
  const x = createAppointment(c, { name: 'Luis Gómez', phone: '6000-9300', serviceId: 'sesion', professionalId: 'p1', start: s1.start });
  assert.ok(setStatus(c, x.appt.id, 'cancelada').ok);
  const y = createAppointment(c, { name: 'Luis Gómez', phone: '6000-9300', serviceId: 'sesion', professionalId: 'p2', start: s1.start });
  assert.ok(y.ok, 'con la anterior cancelada ya no se cruza');
  assert.equal(setStatus(c, x.appt.id, 'pendiente').reason, 'paciente_ocupado');
});

test('freeSlots / suggestSlots con patientPhone no ofrecen horarios que se crucen con otra cita del paciente', () => {
  const { c } = new Session('fisio');
  const opts = { serviceId: 'sesion', from: '2026-11-12T08:00', dayKey: '2026-11-12' };
  const free = freeSlots(c, opts);
  const s1 = free.find((sl) => sl.professionalId === 'p1' && free.some((o) => o.start === sl.start && o.professionalId === 'p2'));
  const mine = createAppointment(c, { name: 'Ana Ríos', phone: '6000-9400', serviceId: 'sesion', professionalId: 'p1', start: s1.start });
  assert.ok(mine.ok);
  const all = freeSlots(c, opts);
  const filtered = freeSlots(c, { ...opts, patientPhone: '6000-9400' });
  const clashing = all.filter((sl) => patientConflict(c, { phone: '6000-9400', start: sl.start, minutes: sl.minutes }));
  assert.ok(clashing.length > 0, 'otro profesional libre a la misma hora cruzaría con la cita de la paciente');
  assert.equal(filtered.length, all.length - clashing.length);
  for (const sl of filtered) assert.equal(patientConflict(c, { phone: '6000-9400', start: sl.start, minutes: sl.minutes }), null);
  assert.ok(all.some((sl) => sl.start === s1.start && sl.professionalId === 'p2'));
  assert.ok(!filtered.some((sl) => sl.start === s1.start), 'a esa hora no se ofrece nada a esa paciente');
  const sug = suggestSlots(c, { ...opts, patientPhone: '6000-9400' }, 50);
  assert.equal(sug.length, new Set(filtered.map((sl) => sl.start)).size, 'suggestSlots ofrece un horario por hora');
  for (const sl of sug) assert.equal(patientConflict(c, { phone: '6000-9400', start: sl.start, minutes: sl.minutes }), null);
  // sin patientPhone la oferta no cambia (compatibilidad), y otra persona sí ve esos horarios
  assert.equal(freeSlots(c, { ...opts, patientPhone: '6000-9401' }).length, all.length);
  // al reprogramar, ignoreId deja libre el horario de la propia cita
  const own = freeSlots(c, { ...opts, professionalId: 'p1', patientPhone: '6000-9400', ignoreId: mine.appt.id });
  assert.ok(own.some((sl) => sl.start === s1.start), 'su propio horario cuenta como libre al moverla');
});

test('el reloj fijo de las pruebas sigue siendo martes 10 nov 2026, 10:00', () => {
  setNow(FIXED_NOW);
  assert.equal(stamp(now()), '2026-11-10T10:00');
});
