import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, chatAppts } from './helpers.mjs';
import { now } from '../public/shared/time/panama.js';
import { getAppt, slotProblem } from '../public/app/agenda.js';
import { startFollowup, startReminder } from '../public/app/bot.js';
import { computeFollowups } from '../public/app/followups.js';
import { PRIVACY_TIP, looksClinical } from '../public/app/privacy.js';

/** El teléfono es el del chat (la persona ficticia del giro): el bot ya no lo pide (CIT-RF-03). */
const phoneOf = (s) => s.T.persona.phone;

/** Agenda por chat hasta el resumen y lo confirma. Devuelve la cita creada. */
function book(s, { service, pro = 'el primero disponible', first = 'Quiero una cita para mañana' } = {}) {
  s.say(first);
  if (s.step === 'svc') s.say(service);
  if (s.step === 'pro') s.say(pro);
  assert.equal(s.step, 'slots', `se esperaban horarios, está en ${s.step}`);
  s.say('1');
  assert.equal(s.step, 'name');
  s.say('me llamo ana perez');
  if (s.giro === 'vet') { assert.equal(s.step, 'pet_name'); s.say('Max'); if (s.step === 'pet_species') s.say('perro'); s.say('3 años'); }
  assert.equal(s.step, 'confirm', 'tras el nombre no pide el teléfono');
  const summary = s.out[0].text;
  s.say('1');
  const [appt] = chatAppts(s.c, phoneOf(s));
  return { appt, summary };
}

test('agendar por chat (fisioterapia): 3 horarios reales, resumen y cita Pendiente con origen chat', () => {
  const s = new Session('fisio');
  s.say('Hola, quiero una cita para mañana');
  assert.match(s.out[0].text, /¿Qué servicio desea agendar\?/);
  s.say('sesión de terapia');
  assert.equal(s.step, 'pro');
  s.say('el primero disponible');
  const offer = s.out[0].text;
  assert.equal(offer.match(/^\d\. /gm).length, 3, 'ofrece exactamente 3 horarios');
  assert.match(offer, /mié 11 nov/, 'respeta "para mañana"');
  const before = s.c.appointments.length;
  s.say('1'); s.say('me llamo ana pérez');
  assert.match(s.out[0].text, /Revise su cita/);
  assert.match(s.out[0].text, /Ana Pérez/);
  s.say('sí');
  assert.equal(s.c.appointments.length, before + 1);
  const a = chatAppts(s.c, phoneOf(s))[0];
  assert.equal(a.status, 'pendiente'); assert.equal(a.origin, 'chat'); assert.equal(a.start.slice(0, 10), '2026-11-11');
  assert.ok(s.logs.some((l) => l.kind === 'cita' && l.id === a.id), 'avisa al panel en vivo');
  assert.match(s.out[0].text, /Su cita quedó agendada/);
  assert.equal(slotProblem(s.c, a.professionalId, a.start, a.minutes), 'ocupado', 'el horario ya no está libre');
});

test('agendar por chat (odontología y veterinaria, con mascota)', () => {
  const d = new Session('dental');
  const { appt: da } = book(d, { service: 'limpieza' });
  assert.equal(da.serviceId, 'limpieza');

  const v = new Session('vet');
  const { appt, summary } = book(v, { service: 'vacuna', first: 'Quiero vacunar a mi perro' });
  assert.equal(appt.serviceId, 'vacuna');
  assert.deepEqual({ ...appt.pet }, { name: 'Max', species: 'Perro', age: '3 años' });
  assert.match(summary, /🐾 Max \(Perro, 3 años\)/);
  assert.match(v.out[0].text, /🐾 Max/);
});

test('"el segundo", horas y "otros horarios" al elegir', () => {
  const s = new Session('fisio');
  s.say('quiero agendar una sesión con cualquiera');
  assert.equal(s.step, 'slots');
  const first = s.out[0].text;
  s.say('otros horarios');
  assert.notEqual(s.out[0].text, first);
  s.say('la segunda');
  assert.equal(s.step, 'name');
});

test('tira de días: botones de días con cupo; tocar uno ofrece solo horarios de ese día', () => {
  const probe = new Session('fisio');
  probe.say('quiero agendar una sesión con cualquiera');
  const chips = probe.out.flatMap((o) => o.chips || []);
  const days = chips.filter((c) => c.kind === 'day');
  assert.ok(days.length >= 3, 'hay al menos tres días para elegir');
  assert.ok(days.every((c) => !/^Dom/.test(c.label)), 'no ofrece los domingos (la clínica está cerrada)');
  assert.equal(chips.at(-1).label, 'Otros horarios', '«Otros horarios» sigue al final');
  for (const d of days) {
    const s = new Session('fisio');
    s.say('quiero agendar una sesión con cualquiera');
    s.say(d.text);
    assert.equal(s.step, 'slots', d.label);
    const data = s.conv.script.data;
    assert.ok(data.prefs.day, `${d.label}: entendió el día`);
    assert.ok(data.offered.length > 0 && data.offered.every((o) => o.start.slice(0, 10) === data.prefs.day), `${d.label}: todos los horarios son de ese día`);
    assert.doesNotMatch(s.out[0].text, /No tengo cupos/, `${d.label}: no cayó en «sin cupos»`);
  }
});

test('un horario ocupado por otra persona mientras se agenda no se asigna dos veces', () => {
  const s = new Session('fisio');
  s.say('Quiero una sesión de terapia'); s.say('Quintero');
  s.say('1'); s.say('Ana Pérez');
  const slot = s.conv.script.data.slot;
  // alguien del equipo toma ese horario desde el panel antes de que la persona confirme
  s.c.appointments.push({ id: 'panel1', professionalId: slot.professionalId, start: slot.start, minutes: 45, status: 'confirmada', history: [], name: 'X', phone: '6000-9099', serviceId: 'sesion' });
  s.say('1');
  assert.equal(chatAppts(s.c, phoneOf(s)).length, 0, 'no se crea la cita');
  assert.match(s.out.map((o) => o.text).join('\n'), /ya no está disponible/);
  assert.equal(s.step, 'slots');
});

test('recordatorio: "Sí" confirma y "Reprogramar" cambia la cita y libera el horario', () => {
  const s = new Session('dental');
  const { appt } = book(s, { service: 'limpieza' });
  const r = startReminder(s.c, s.conv, appt.id, s.ctx());
  assert.match(r.out[0].text, /le recordamos su cita mañana a las \d+:\d\d [ap]\. m\. ¿Confirma\?\n1\. Sí\n2\. Reprogramar/);
  assert.equal(appt.reminder, 'enviado');
  s.say('1');
  assert.equal(appt.status, 'confirmada'); assert.equal(appt.reminder, 'confirmo');

  // segundo caso: reprogramar
  const s2 = new Session('fisio');
  const { appt: a2 } = book(s2, { service: 'sesión de terapia' });
  const oldStart = a2.start; const oldPro = a2.professionalId;
  startReminder(s2.c, s2.conv, a2.id, s2.ctx());
  s2.say('2');
  assert.equal(s2.step, 'resched_slots');
  s2.say('1');
  assert.equal(s2.step, 'resched_confirm', 'primero pide confirmar el cambio');
  assert.equal(a2.start, oldStart, 'la cita no cambia hasta confirmar');
  s2.say('1');
  assert.equal(a2.status, 'reprogramada'); assert.ok(a2.avoided);
  assert.notEqual(`${a2.start}|${a2.professionalId}`, `${oldStart}|${oldPro}`);
  assert.equal(slotProblem(s2.c, oldPro, oldStart, a2.minutes), null, 'el horario anterior vuelve a estar disponible');
});

test('cancelar por chat libera el horario', () => {
  const s = new Session('vet');
  const { appt } = book(s, { service: 'vacuna', first: 'Quiero vacunar a mi perro' });
  s.say('quiero cancelar mi cita');
  assert.equal(s.step, 'cancel_confirm');
  s.say('1');
  assert.equal(appt.status, 'cancelada');
  assert.equal(slotProblem(s.c, appt.professionalId, appt.start, appt.minutes), null);
});

test('reprogramar por teléfono: busca citas futuras y avisa si no hay', () => {
  const s = new Session('fisio');
  s.say('necesito reprogramar mi cita');
  assert.equal(s.step, 'find_phone');
  s.say('6000-0000');
  assert.match(s.out[0].text, /No encontré citas próximas/);
  const hint = s.chips().find((c) => c.startsWith('Usar '));
  assert.ok(hint, 'ofrece un teléfono de ejemplo de la demo');
  s.say(hint.replace('Usar ', ''));
  assert.equal(s.step, 'resched_slots');
});

// --- Urgencias -----------------------------------------------------------------------------------

const URGENT = {
  fisio: ['tengo un dolor fuerte en la espalda', 'tuve un accidente', 'hay sangrado', 'no respira bien'],
  dental: ['tengo un dolor fuerte en una muela', 'se me cayó un diente y sangra mucho', 'es una emergencia', 'sospechamos envenenamiento'],
  vet: ['mi perro se tragó algo y está vomitando', 'lo atropellaron', 'mi gato no respira', 'creo que fue un envenenamiento'],
};
for (const [giro, phrases] of Object.entries(URGENT)) {
  test(`urgencias (${giro}): no agenda, da el teléfono, marca URGENTE y ofrece una persona`, () => {
    for (const phrase of phrases) {
      const s = new Session(giro);
      const before = s.c.appointments.length;
      s.say(phrase);
      assert.ok(s.conv.flags.urgent, phrase);
      assert.match(s.out[0].text, /\+507 6000-/);
      assert.match(s.out[0].text, /no agendo urgencias/);
      assert.ok(s.chips().includes('Pasar a una persona'));
      assert.equal(s.c.appointments.length, before);
      assert.ok(s.logs.some((l) => l.kind === 'urgente'));
      s.say('sí, por favor');
      assert.ok(s.conv.flags.handoff && s.conv.mode === 'humano');
    }
  });
}

test('urgencias: también interrumpen un agendamiento a medias', () => {
  const s = new Session('vet');
  s.say('Quiero vacunar a mi perro');
  s.say('mi perro tiene un envenenamiento');
  assert.ok(s.conv.flags.urgent);
  assert.equal(chatAppts(s.c, phoneOf(s)).length, 0);
});

test('las palabras de urgencia de la configuración se respetan', () => {
  const s = new Session('fisio');
  s.say('se me durmió todo el brazo');
  assert.ok(s.conv.flags.urgent, 'palabra del guion por defecto');
  const t = new Session('dental');
  t.say('me salió una mancha rara');
  assert.ok(!t.conv.flags.urgent);
  t.c.config.urgentWords.push('mancha rara');
  t.say('me salió una mancha rara');
  assert.ok(t.conv.flags.urgent);
});

// --- Atención humana, precios, ubicación ----------------------------------------------------------

test('pasar a una persona marca la conversación y el bot deja de agendar', () => {
  const s = new Session('dental');
  s.say('Hablar con una persona');
  assert.ok(s.conv.flags.handoff); assert.equal(s.conv.mode, 'humano');
  assert.ok(s.logs.some((l) => l.kind === 'humano'));
  s.say('quiero una cita');
  assert.match(s.out[0].text, /quedó registrado/);
  s.say('menú');
  assert.equal(s.conv.mode, 'bot');
});

test('precios, horarios y ubicación salen de la configuración, no se inventan', () => {
  const s = new Session('dental');
  s.say('¿cuánto cuesta?');
  assert.match(s.out[0].text, /Blanqueamiento — 60 min — B\/\.150\.00 \+ ITBMS 7%/);
  assert.match(s.out[0].text, /Lun–Vie: 8:00 a\. m\. – 6:00 p\. m\./);
  s.c.config.services.find((x) => x.id === 'limpieza').price = 55;
  s.say('precios');
  assert.match(s.out[0].text, /Limpieza — 45 min — B\/\.55\.00/);
  s.say('ubicación');
  assert.match(s.out[0].text, /Plaza Sonrisa/);
  s.c.config.address = '';
  s.say('dónde están');
  assert.match(s.out[0].text, /Aún no tengo la dirección/);
  assert.ok(s.chips().includes('Pasar a una persona'));
});

const FORMS = {
  agendar: ['necesito cita pa mañana', 'quiero agendar', 'me pueden dar un turno', 'quisiera reservar una cita', 'AGENDAR CITA', 'busco cupo para esta semana'],
  cancelar: ['quiero cancelar mi cita', 'necesito anular la cita', 'ya no voy a poder ir', 'no puedo ir a mi cita', 'cancela mi cita por favor', 'Reprogramar o cancelar'],
  precios: ['cuánto cuesta', 'precios', 'qué precio tienen', 'cuál es el costo', 'CUÁNTO COBRAN', 'a qué hora abren'],
};
for (const [intent, phrases] of Object.entries(FORMS)) {
  test(`el guion reconoce ${phrases.length} formas de pedir: ${intent} (con o sin tildes)`, () => {
    for (const p of phrases) {
      const s = new Session('fisio');
      s.say(p);
      const t = s.out.map((o) => o.text).join('\n');
      if (intent === 'agendar') assert.match(t, /¿Qué servicio desea agendar\?/, p);
      if (intent === 'cancelar') assert.match(t, /teléfono|número/i, p);
      if (intent === 'precios') assert.match(t, /Horario de atención/, p);
      assert.ok(!/No estoy seguro/.test(t), p);
    }
  });
}

test('menú inicial con las cinco opciones y números', () => {
  const s = new Session('vet');
  s.say('hola');
  for (const o of ['Agendar cita', 'Precios y horarios', 'Ubicación', 'Reprogramar o cancelar', 'Hablar con una persona']) assert.ok(s.chips().includes(o), o);
  s.say('3');
  assert.match(s.out[0].text, /Nos encontramos en/);
  s.say('asdfgh');
  assert.match(s.out[0].text, /No estoy seguro/);
});

// --- Privacidad y seguimiento ------------------------------------------------------------------------

test('privacidad: lo que parezca dato de salud avisa y se detecta para no guardarlo', () => {
  assert.ok(looksClinical('me duele mucho la rodilla'));
  assert.ok(looksClinical('mi perro tiene fiebre'));
  assert.ok(!looksClinical('quiero una cita para mañana'));
  const s = new Session('fisio');
  s.say('me duele la rodilla, quiero cita');
  assert.equal(s.out[0].text, PRIVACY_TIP);
});

test('seguimiento: el bot escribe primero y "1" lleva a agendar con los datos ya conocidos', () => {
  const s = new Session('vet');
  const due = computeFollowups(s.c, 'vet', '2026-11-10').find((f) => f.state === 'por_enviar');
  const r = startFollowup(s.c, s.conv, due.patientId, s.ctx());
  assert.match(r.out[0].text, /12 meses desde la última vacuna/);
  assert.equal(computeFollowups(s.c, 'vet', '2026-11-10').find((f) => f.patientId === due.patientId).state, 'enviado');
  s.say('1');
  assert.equal(s.step, 'pro');
  s.say('cualquiera'); s.say('1');
  assert.equal(s.step, 'confirm', 'no vuelve a pedir nombre, teléfono ni mascota');
  s.say('sí');
  const a = s.c.appointments.find((x) => x.patientId === due.patientId && x.origin === 'chat');
  assert.equal(a.serviceId, 'vacuna');
});

test('la semilla no queda alterada entre sesiones de prueba (reloj fijo)', () => {
  const s = new Session('fisio');
  assert.equal(now().toISOString(), '2026-11-10T10:00:00.000Z');
  assert.ok(getAppt(s.c, s.c.appointments[0].id));
});
