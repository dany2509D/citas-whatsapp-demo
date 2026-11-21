// Feriados de Panamá y cierres propios: la agenda, el bot, la IA y el panel no ofrecen ni aceptan citas en un día cerrado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, fixClock, noHolidays, realHolidays } from './helpers.mjs';
import { easterSunday, holidaysOn, panamaHolidays } from '../public/shared/time/feriados-pa.js';
import { closureOf, createAppointment, dayHours, freeSlots, moveAppointment, slotProblem, upcomingClosures } from '../public/app/agenda.js';
import { buildClinic } from '../public/app/data/seed.js';
import { isOpenNow } from '../public/app/bot.js';
import { applyActions } from '../public/app/ai.js';
import { setNow, now } from '../public/shared/time/panama.js';

test.beforeEach(() => realHolidays());
test.afterEach(() => { noHolidays(); fixClock(); });

const dates = (year, kind) => panamaHolidays(year).filter((h) => !kind || h.kind === kind).map((h) => h.date);

test('Pascua: 2026, 2027 y 2028', () => {
  assert.equal(easterSunday(2026), '2026-04-05');
  assert.equal(easterSunday(2027), '2027-03-28');
  assert.equal(easterSunday(2028), '2028-04-16');
});

test('feriados nacionales de 2027 (incluye Carnaval, Viernes Santo y el traslado del 28 de noviembre)', () => {
  assert.deepEqual(dates(2027, 'nacional'), [
    '2027-01-01', '2027-01-09', '2027-02-09', '2027-03-26', '2027-05-01', '2027-11-03', '2027-11-05', '2027-11-10',
    '2027-11-28', '2027-11-29', '2027-12-08', '2027-12-20', '2027-12-25',
  ]);
  assert.deepEqual(dates(2027, 'tradicional'), ['2027-02-08', '2027-11-04']);
  assert.match(holidaysOn('2027-11-29')[0].name, /Independencia.*lunes/);
});

test('2026: el 20 de diciembre cae domingo y se descansa el lunes 21', () => {
  assert.ok(dates(2026, 'nacional').includes('2026-12-21'));
  assert.ok(dates(2026, 'nacional').includes('2026-02-17')); // Martes de Carnaval 2026
  assert.ok(dates(2026, 'nacional').includes('2026-04-03')); // Viernes Santo 2026
});

test('closureOf: nacional, tradicional, abierto a propósito y cierre propio', () => {
  const s = new Session('fisio');
  const cfg = s.c.config;
  assert.deepEqual(closureOf(s.c, '2026-11-10'), { name: 'Primer Grito de Independencia', kind: 'nacional' });
  assert.equal(closureOf(s.c, '2026-11-04').kind, 'tradicional');
  assert.equal(closureOf(s.c, '2026-11-11'), null);
  cfg.cierres.tradicionales = false;
  assert.equal(closureOf(s.c, '2026-11-04'), null);
  cfg.cierres.abiertoEn = ['2026-11-10'];
  assert.equal(closureOf(s.c, '2026-11-10'), null);
  cfg.cierres.extra = [{ date: '2026-11-12', name: 'Vacaciones del equipo' }];
  assert.deepEqual(closureOf(s.c, '2026-11-12'), { name: 'Vacaciones del equipo', kind: 'propio' });
  cfg.cierres.feriadosNacionales = false; cfg.cierres.abiertoEn = [];
  assert.equal(closureOf(s.c, '2026-11-10'), null);
});

test('un feriado no tiene horario: no hay horarios libres, no se crea ni se mueve una cita a ese día', () => {
  const s = new Session('fisio');
  assert.equal(dayHours(s.c, '2026-11-10'), null);
  assert.equal(freeSlots(s.c, { serviceId: 'sesion', from: '2026-11-09T00:00', dayKey: '2026-11-10' }).length, 0);
  assert.equal(slotProblem(s.c, 'p1', '2026-11-28T09:00', 45), 'feriado'); // sábado 28: abre normalmente, pero es feriado
  const r = createAppointment(s.c, { name: 'Ana Pérez', phone: '6123-4567', serviceId: 'sesion', professionalId: 'p2', start: '2026-11-28T09:00', origin: 'panel' });
  assert.equal(r.ok, false); assert.equal(r.reason, 'feriado');
  const a = s.c.appointments.find((x) => ['pendiente', 'confirmada'].includes(x.status) && x.start > '2026-11-11');
  assert.equal(moveAppointment(s.c, a.id, { start: '2026-11-28T09:00', professionalId: 'p2' }).reason, 'feriado');
});

test('IA: crear_cita en un feriado se rechaza', () => {
  const s = new Session('fisio');
  const r = applyActions(s.c, s.conv, [{ type: 'crear_cita', payload: { servicioId: 'sesion', profesionalId: 'p2', inicio: '2026-11-28T09:00', nombre: 'Ana Pérez', telefono: '6123-4567' } }], s.ctx());
  assert.equal(r.errors.length, 1);
});

test('la semilla no pone citas en un feriado', () => {
  fixClock();
  const c = buildClinic('fisio', now());
  assert.equal(c.appointments.filter((a) => a.start.startsWith('2026-11-10')).length, 0);
  assert.ok(c.appointments.length > 10);
});

test('el bot dice que el día pedido es feriado y ofrece los siguientes horarios', () => {
  const s = new Session('fisio');
  s.say('quiero una sesión de terapia el 28 de noviembre');
  s.say('el primero disponible');
  const t = s.out.map((o) => o.text).join('\n');
  assert.equal(s.step, 'slots');
  assert.match(t, /sábado 28 de noviembre es feriado \(Independencia de Panamá de España\)/);
  assert.ok(s.conv.script.data.offered.every((o) => !o.start.startsWith('2026-11-28')));
});

test('«hoy» es feriado: el bot no ofrece horarios de hoy', () => {
  const s = new Session('fisio'); // martes 10 de noviembre de 2026 = feriado
  s.say('quiero una sesión de terapia para hoy');
  s.say('el primero disponible');
  assert.match(s.out.map((o) => o.text).join('\n'), /feriado \(Primer Grito de Independencia\)/);
  assert.ok(s.conv.script.data.offered.every((o) => !o.start.startsWith('2026-11-10')));
  assert.ok(!s.chips().includes('Hoy'));
});

test('cierre propio: el bot lo explica con su motivo', () => {
  const s = new Session('fisio');
  s.c.config.cierres.extra = [{ date: '2026-11-12', name: 'inventario anual' }];
  s.say('quiero una sesión de terapia el jueves');
  s.say('el primero disponible');
  assert.match(s.out.map((o) => o.text).join('\n'), /jueves 12 de noviembre la clínica estará cerrada \(inventario anual\)/);
});

test('preguntas de horario: «¿abren el 28 de noviembre?» y «¿abren hoy?»', () => {
  const s = new Session('fisio');
  assert.match(s.say('¿abren el 28 de noviembre?'), /sábado 28 de noviembre no atendemos: es feriado \(Independencia de Panamá de España\)/);
  assert.match(s.say('¿atienden hoy?'), /Hoy \(martes\) no atendemos: es feriado \(Primer Grito de Independencia\)/);
  assert.match(s.say('¿qué horario tienen?'), /Próximos feriados.*Sábado 28 de noviembre: Independencia/s);
});

test('urgencias en un feriado: la clínica cuenta como cerrada (se da el número de emergencias)', () => {
  const s = new Session('fisio');
  assert.equal(isOpenNow(s.c, '2026-11-10T10:00'), false);
  assert.equal(isOpenNow(s.c, '2026-11-11T10:00'), true);
});

test('upcomingClosures: solo días que la clínica normalmente abre', () => {
  const s = new Session('fisio');
  const list = upcomingClosures(s.c, '2026-11-01', 30).map((x) => x.date);
  assert.deepEqual(list, ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-10', '2026-11-28']);
  setNow(null);
});

test('IA: el contexto lleva los próximos feriados y el prompt los conserva', async () => {
  const { buildAIContext } = await import('../public/app/ai.js');
  const { buildSystem } = await import('../api/chat.js');
  const s = new Session('fisio');
  const ctx = buildAIContext(s.c, s.conv, s.T, now());
  assert.ok(ctx.cierresProximos.some((x) => x.fecha === '2026-11-28' && /Independencia/.test(x.motivo)));
  const sys = buildSystem(ctx);
  assert.match(sys, /"cierresProximos":\[[^\]]*2026-11-28/);
  assert.match(sys, /no ofrezcas citas esos días/);
});
