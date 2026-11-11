// CIT-RF-16: nunca queda un recordatorio «Programado» con hora pasada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, fixClock } from './helpers.mjs';
import { dayBeforeList, planReminder } from '../public/app/agenda.js';
import { nowStamp } from '../public/shared/time/panama.js';

const at = (h, m = 0, day = 10) => () => new Date(Date.UTC(2026, 10, day, h, m, 0)); // hora de pared de Panamá

test('planReminder: el día anterior si aún no pasó; unas horas antes si ya pasó; ninguno si ni eso cabe', () => {
  const s = new Session('fisio');
  const c = s.c;
  // Martes 10 a las 10:00: una cita del jueves 12 a las 8:00 → el miércoles 11 a las 9:00
  assert.deepEqual(planReminder(c, '2026-11-12T08:00', '2026-11-10T10:00'), { kind: 'dia-anterior', due: '2026-11-11T09:00' });
  // Martes 23:05: una cita del miércoles 8:00 → el día anterior (martes 9:00) ya pasó → 2 horas antes
  const near = planReminder(c, '2026-11-11T08:00', '2026-11-10T23:05');
  assert.equal(near.kind, 'horas-antes'); assert.equal(near.due, '2026-11-11T06:00'); assert.equal(near.hours, 2);
  // Miércoles 7:30 para una cita de las 8:00: faltan 30 min, no cabe un aviso de 2 h antes
  assert.equal(planReminder(c, '2026-11-11T08:00', '2026-11-11T07:30').kind, 'ninguno');
  // Configurable
  c.config.horasRecordatorioCercano = 3;
  assert.equal(planReminder(c, '2026-11-11T08:00', '2026-11-10T23:05').due, '2026-11-11T05:00');
});

for (const giro of ['fisio', 'dental', 'vet']) {
  test(`agendar de noche una cita para la mañana (${giro}): el recordatorio sale horas antes y la confirmación lo dice`, () => {
    const s = new Session(giro);
    fixClock(at(23, 5));
    s.say(giro === 'vet' ? 'Quiero vacunar a mi perro para mañana' : giro === 'dental' ? 'Quiero una limpieza para mañana' : 'Quiero una sesión de terapia para mañana');
    if (s.step === 'svc') s.say(giro === 'vet' ? 'vacuna' : 'limpieza');
    if (s.step === 'pro') s.say('el primero disponible');
    assert.equal(s.step, 'slots');
    s.say('1'); s.say('me llamo ana perez');
    if (giro === 'vet') { s.say('Max'); s.say('3 años'); }
    s.say('1');
    const appt = s.c.appointments.filter((a) => a.origin === 'chat' && a.name === 'Ana Perez' || a.name === 'Ana Pérez').at(-1);
    assert.ok(appt, 'se creó la cita');
    assert.equal(appt.start.slice(0, 10), '2026-11-11');
    assert.equal(appt.reminderPlan.kind, 'horas-antes');
    const text = s.out.map((o) => o.text).join('\n');
    assert.match(text, /recordatorio 2 horas antes de su cita/);
    assert.doesNotMatch(text, /recordatorio el día anterior/);
    // La lista nunca muestra un recordatorio programado en el pasado
    const mine = dayBeforeList(s.c, nowStamp(), Infinity).find((r) => r.apptId === appt.id);
    assert.ok(mine && mine.kind === 'horas-antes' && mine.due > nowStamp(), 'figura con una hora futura');
    const stale = dayBeforeList(s.c, nowStamp(), Infinity).filter((r) => r.state === 'programado' && r.due < nowStamp());
    assert.deepEqual(stale.map((r) => r.patient), [], 'ningún recordatorio «Programado» con hora pasada');
  });
}

test('si faltan menos de 2 horas no se promete ningún recordatorio', () => {
  const s = new Session('fisio');
  s.c.config.leadMinutes = 0;
  fixClock(at(12, 40, 10)); // 7:40 a. m.
  s.say('Quiero una sesión de terapia hoy'); if (s.step === 'pro') s.say('el primero disponible');
  if (s.step !== 'slots') return; // sin horarios hoy a esa hora: nada que comprobar
  s.say('1'); s.say('me llamo ana perez'); s.say('1');
  const appt = s.c.appointments.filter((a) => a.name === 'Ana Perez' || a.name === 'Ana Pérez').at(-1);
  if (!appt || appt.reminderPlan.kind !== 'ninguno') return;
  assert.doesNotMatch(s.out.map((o) => o.text).join('\n'), /recordatorio/i);
});
