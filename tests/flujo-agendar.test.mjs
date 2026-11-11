// Grupo A2: flujo de agendar y consultas (CIT-RF-03, -06, -09, -17, -18; CIT-HU2.1, 2.2, 2.3, 3.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, chatAppts, fixClock } from './helpers.mjs';
import { TEMPLATES, GIROS } from '../public/app/data/templates.js';
import { buildClinic } from '../public/app/data/seed.js';
import { createStore } from '../public/app/state.js';
import { createStorage } from '../public/shared/storage/storage.js';
import { createController } from '../public/app/controller.js';
import { chatIdentity, detectSpecies } from '../public/app/bot.js';
import { now } from '../public/shared/time/panama.js';
import { phoneDigits } from '../public/shared/chat-engine/nlu.js';
import { patientConflict, slotProblem } from '../public/app/agenda.js';

const SERVICE = { fisio: 'sesión de terapia', dental: 'limpieza', vet: 'vacuna' };
const phoneOf = (s) => s.T.persona.phone;
const display = (p) => `+507 ${p}`;
const memoryBackend = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), _m: m }; };

/** Agenda hasta el resumen (sin confirmar). */
function toSummary(s, { first, name = 'Ana Pérez' } = {}) {
  s.say(first || `Quiero ${SERVICE[s.giro]} para mañana`);
  if (s.step === 'svc') s.say(SERVICE[s.giro]);
  if (s.step === 'pro') s.say('el primero disponible');
  assert.equal(s.step, 'slots');
  s.say('1');
  assert.equal(s.step, 'name');
  s.say(name);
  if (s.giro === 'vet') { assert.equal(s.step, 'pet_name'); s.say('Max'); if (s.step === 'pet_species') s.say('perro'); s.say('3 años'); }
  assert.equal(s.step, 'confirm');
}

// --- [4] El teléfono es el del chat ---------------------------------------------------------------

test('cada giro tiene una persona ficticia del chat que no coincide con ningún paciente de la semilla', () => {
  fixClock();
  const phones = new Set();
  for (const g of GIROS) {
    const p = TEMPLATES[g].persona;
    assert.ok(p?.name && /^6000-\d{4}$/.test(p.phone), g);
    const c = buildClinic(g, now());
    assert.ok(!c.patients.some((x) => x.name === p.name || phoneDigits(x.phone) === phoneDigits(p.phone)), `${g}: la persona no es un paciente de la semilla`);
    assert.ok(!c.appointments.some((a) => phoneDigits(a.phone) === phoneDigits(p.phone)), `${g}: sin citas de la persona`);
    assert.ok(!phones.has(p.phone), 'cada giro tiene su propio número');
    phones.add(p.phone);
  }
});

for (const giro of GIROS) {
  test(`agendar (${giro}): no pide el teléfono; el resumen usa el del chat y la cita queda a ese número`, () => {
    const s = new Session(giro);
    const sent = [];
    const say = s.say.bind(s);
    s.say = (t) => { const r = say(t); sent.push(r); return r; };
    s.say(`Quiero ${SERVICE[giro]} para mañana`);
    if (s.step === 'svc') s.say(SERVICE[giro]);
    if (s.step === 'pro') s.say('el primero disponible');
    assert.equal(s.step, 'slots');
    assert.equal(s.out[0].text.match(/^\d\. /gm).length, 3);
    s.say('1');
    assert.equal(s.step, 'name');
    assert.ok(s.chips().includes(s.T.persona.name), 'sugiere el nombre de la persona con un botón');
    s.say('me llamo ana perez');
    if (giro === 'vet') { s.say('Max'); s.say('perro'); s.say('3 años'); }
    assert.equal(s.step, 'confirm');
    const summary = s.out[0].text;
    assert.match(summary, new RegExp(`Ana Perez · \\+507 ${phoneOf(s)}`));
    assert.ok(s.chips().includes('Usar otro número'), 'ofrece, opcionalmente, otro número');
    assert.ok(sent.every((t) => !/número de teléfono|cuál es su (número|teléfono)/i.test(t)), 'nunca pide el teléfono');
    s.say('1');
    const [appt] = chatAppts(s.c, phoneOf(s));
    assert.ok(appt && appt.origin === 'chat' && appt.status === 'pendiente');
    assert.equal(s.conv.phone, phoneOf(s));
  });
}

test('«Usar otro número»: deja otro número para el recordatorio sin cambiar quién escribe', () => {
  const s = new Session('dental');
  toSummary(s);
  s.say('otro número');
  assert.equal(s.step, 'alt_phone');
  s.say('abc');
  assert.equal(s.step, 'alt_phone', 'un número inválido se vuelve a pedir');
  s.say('6000-7777');
  assert.equal(s.step, 'confirm');
  assert.match(s.out[0].text, /\+507 6000-7777/);
  s.say('sí');
  assert.equal(chatAppts(s.c, '6000-7777').length, 1);
  assert.equal(chatAppts(s.c, phoneOf(s)).length, 0);
  assert.notEqual(s.conv.phone, '6000-7777', 'la identidad del chat no cambia');
  assert.equal(chatIdentity(s.conv, s.T).phone, phoneOf(s));
  // y «el mismo» devuelve al número del chat
  const t = new Session('dental');
  toSummary(t);
  t.say('otro número'); t.say('el mismo');
  assert.equal(t.step, 'confirm');
  assert.match(t.out[0].text, new RegExp(phoneOf(t)));
});

test('un número escrito en el resumen también cuenta como «otro número»', () => {
  const s = new Session('fisio');
  toSummary(s);
  s.say('mejor al 6000-5555');
  assert.equal(s.step, 'confirm');
  assert.match(s.out[0].text, /\+507 6000-5555/);
});

test('el orden del flujo se mantiene: servicio, profesional, 3 horarios, nombre, resumen', () => {
  const s = new Session('fisio');
  s.say('quiero agendar');
  assert.equal(s.step, 'svc');
  s.say('sesión de terapia');
  assert.equal(s.step, 'pro');
  s.say('el primero disponible');
  assert.equal(s.step, 'slots');
  s.say('2');
  assert.equal(s.step, 'name');
  s.say('Ana Pérez');
  assert.equal(s.step, 'confirm');
});

test('estados guardados antes de la persona: el bot usa la de la plantilla', () => {
  const s = new Session('fisio');
  delete s.conv.persona;
  assert.deepEqual(chatIdentity(s.conv, s.T), { name: s.T.persona.name, phone: s.T.persona.phone, persona: s.T.persona });
  toSummary(s);
  assert.match(s.out[0].text, new RegExp(s.T.persona.phone));
});

test('si el bot ya conoce el teléfono de la conversación (seguimiento), lo usa y no pregunta nada', () => {
  const s = new Session('fisio');
  const p = s.c.patients[0];
  s.conv.phone = p.phone; s.conv.name = p.name; s.conv.patientId = p.id;
  s.say('quiero una sesión de terapia con cualquiera');
  assert.equal(s.step, 'slots');
  s.say('1');
  assert.equal(s.step, 'confirm');
  assert.match(s.out[0].text, new RegExp(p.phone));
});

test('regla de cruce de paciente: no ofrece ni confirma horarios que se crucen con otra cita de la misma persona', () => {
  const s = new Session('fisio');
  toSummary(s, { first: 'Quiero una evaluación inicial mañana con cualquiera' });
  s.say('1');
  const [first] = chatAppts(s.c, phoneOf(s));
  // segunda cita: ningún horario ofrecido se cruza con la primera
  s.say('quiero una sesión de terapia mañana con cualquiera');
  for (let i = 0; i < 4 && s.step === 'slots'; i++) {
    for (const o of s.conv.script.data.offered) assert.equal(patientConflict(s.c, { phone: phoneOf(s), start: o.start, minutes: o.minutes }), null);
    s.say('otros horarios');
  }
  // si alguien más crea una cita que se cruza mientras confirma, se avisa el motivo
  const t = new Session('fisio');
  toSummary(t, { first: 'Quiero una sesión de terapia mañana con cualquiera' });
  const slot = t.conv.script.data.slot;
  t.c.appointments.push({ ...first, id: 'x1', patientId: 'x', phone: phoneOf(t), start: slot.start, professionalId: slot.professionalId === 'p3' ? 'p1' : 'p3', status: 'confirmada', history: [] });
  t.say('1');
  assert.equal(chatAppts(t.c, phoneOf(t)).length, 1, 'no se crea la segunda cita');
  assert.match(t.out.map((o) => o.text).join('\n'), /ya tiene otra cita que se cruza/);
});

test('reprogramar usa el teléfono del chat: encuentra sola la cita de la persona (sin pedir número)', () => {
  const s = new Session('fisio');
  toSummary(s); s.say('1');
  s.say('quiero reprogramar mi cita');
  assert.equal(s.step, 'resched_slots', 'no pide el teléfono');
  assert.ok(s.out.every((o) => !/número de teléfono/i.test(o.text)));
});

test('sin citas con el número del chat, ofrece escribir otro número (reprogramar)', () => {
  const s = new Session('vet');
  s.say('necesito reprogramar mi cita');
  assert.equal(s.step, 'find_phone');
  assert.match(s.out[0].text, /número de este chat/);
  assert.match(s.out[0].text, new RegExp(phoneOf(s)));
});

// --- [8] Preguntas puntuales ----------------------------------------------------------------------

test('«¿a qué hora abren el sábado?» devuelve el horario del sábado de cada giro, desde la configuración', () => {
  const expected = { fisio: ['8:00 a. m.', '12:00 p. m.'], dental: ['8:00 a. m.', '1:00 p. m.'], vet: ['8:00 a. m.', '2:00 p. m.'] };
  for (const g of GIROS) {
    const s = new Session(g);
    s.say('¿a qué hora abren el sábado?');
    const t = s.out.map((o) => o.text).join('\n');
    assert.match(t, /sábado/i);
    for (const h of expected[g]) assert.ok(t.includes(h), `${g}: ${h}`);
    assert.doesNotMatch(t, /B\/\./, 'no devuelve la lista de precios');
    assert.doesNotMatch(t, /Lun–Vie/, 'solo el sábado');
  }
  const s = new Session('fisio');
  s.c.config.hours[6] = { open: '09:00', close: '11:30' };
  s.say('¿a qué hora abren el sábado?');
  assert.match(s.out[0].text, /9:00 a\. m\./); assert.match(s.out[0].text, /11:30 a\. m\./);
  s.c.config.hours[6] = null;
  s.say('¿atienden los sábados?');
  assert.match(s.out[0].text, /sábado no atendemos/);
  s.say('¿abren el domingo?');
  assert.match(s.out[0].text, /domingo no atendemos/);
  s.say('¿a qué hora abren?');
  assert.match(s.out[0].text, /Horario de atención/);
  assert.doesNotMatch(s.out[0].text, /B\/\./);
});

test('«¿cuánto cuesta la sesión?» devuelve el precio de ESE servicio, no la lista', () => {
  const cases = [['fisio', '¿cuánto cuesta la sesión?', /Sesión de terapia: B\/\.30\.00 \(45 min\)/, /Evaluación inicial|Control de progreso/],
    ['dental', '¿cuánto cuesta el blanqueamiento?', /Blanqueamiento: B\/\.150\.00 \+ ITBMS 7%/, /Limpieza/],
    ['vet', '¿cuánto cuesta el baño?', /Baño: B\/\.20\.00 \+ ITBMS 7%/, /Vacuna/]];
  for (const [g, q, yes, no] of cases) {
    const s = new Session(g);
    s.say(q);
    const t = s.out.map((o) => o.text).join('\n');
    assert.match(t, yes, g); assert.doesNotMatch(t, no, g);
    assert.ok(s.chips().some((c) => c.startsWith('Agendar ')), 'ofrece agendar ese servicio');
    assert.ok(s.chips().includes('Lista de precios'));
  }
  const s = new Session('fisio');
  s.c.config.services.find((x) => x.id === 'sesion').price = 33;
  s.say('¿cuánto cuesta la sesión?');
  assert.match(s.out[0].text, /B\/\.33\.00/);
  s.say('lista de precios');
  assert.match(s.out[0].text, /Evaluación inicial — 60 min/, 'la lista completa solo si la piden');
  s.say('¿cuánto cuesta?');
  assert.match(s.out[0].text, /Control de progreso — 30 min/);
});

test('precio y horario en la misma pregunta se responden juntos', () => {
  const s = new Session('fisio');
  s.say('¿cuánto cuesta la sesión y a qué hora abren el sábado?');
  assert.match(s.out[0].text, /Sesión de terapia: B\/\.30\.00/);
  assert.match(s.out[0].text, /8:00 a\. m\./);
});

test('«¿atienden lesiones de rodilla?» no da la lista de precios ni afirma nada clínico: ofrece evaluación o una persona', () => {
  for (const g of GIROS) {
    const s = new Session(g);
    const q = { fisio: '¿atienden lesiones de rodilla?', dental: '¿atienden dolor de muelas?', vet: '¿atienden lesiones de patas?' }[g];
    s.say(q);
    const t = s.out.map((o) => o.text).join('\n');
    assert.doesNotMatch(t, /Estos son nuestros servicios y precios|•/, `${g}: sin lista de precios`);
    assert.match(t, /no puedo valorar/, g);
    assert.doesNotMatch(t, /(sí|si),? (atendemos|tratamos)|podemos (curar|tratar)/i, `${g}: no afirma nada clínico`);
    const svc = s.c.config.services.find((x) => x.id === 'evaluacion' || x.id === 'consulta');
    assert.ok(t.includes(svc.name), `${g}: ofrece ${svc.name}`);
    assert.ok(s.chips().includes('Pasar a una persona'), g);
    assert.equal(s.step, 'offer_eval');
  }
  const s = new Session('fisio');
  s.say('¿atienden lesiones de rodilla?');
  s.say('sí');
  assert.equal(s.conv.script.data.serviceId, 'evaluacion', 'agenda la evaluación');
  assert.equal(s.step, 'pro');
  const h = new Session('fisio');
  h.say('¿atienden lesiones de rodilla?');
  h.say('quiero hablar con una persona');
  assert.ok(h.conv.flags.handoff);
});

// --- [9] Datos ya dados ---------------------------------------------------------------------------

test('veterinaria: «vacunar a mi perro» no vuelve a preguntar la especie ni el servicio', () => {
  const s = new Session('vet');
  s.say('Quiero vacunar a mi perro');
  assert.equal(s.conv.script.data.serviceId, 'vacuna');
  assert.equal(s.conv.script.data.species, 'Perro');
  assert.equal(s.step, 'pro', 'ya saltó el servicio');
  s.say('el primero disponible'); s.say('1'); s.say('Brenda Olmos');
  assert.equal(s.step, 'pet_name');
  s.say('Toby');
  assert.equal(s.step, 'pet_age', 'se salta la especie');
  assert.ok(s.out.every((o) => !/perro, gato u otra/.test(o.text)));
  s.say('7 años');
  assert.equal(s.step, 'confirm');
  assert.match(s.out[0].text, /🐾 Toby \(Perro, 7 años\)/);
  s.say('1');
  assert.deepEqual({ ...chatAppts(s.c, phoneOf(s))[0].pet }, { name: 'Toby', species: 'Perro', age: '7 años' });
});

test('veterinaria: la especie se recuerda aunque se diga después del servicio, y el día no se repite', () => {
  const s = new Session('vet');
  s.say('Quiero una vacuna para mañana');
  assert.equal(s.step, 'pro');
  s.say('es para mi gata, cualquiera');
  assert.equal(s.conv.script.data.species, 'Gato');
  assert.equal(s.step, 'slots');
  assert.ok(s.conv.script.data.offered.every((o) => o.start.startsWith('2026-11-11')), 'ya tenía el día');
  s.say('1'); s.say('Ana Pérez'); s.say('Luna');
  assert.equal(s.step, 'pet_age');
  assert.deepEqual(['perro', 'Gata', 'gato', 'Hámster'].map((x) => detectSpecies(`mi ${x}`)), ['Perro', 'Gato', 'Gato', 'Hámster']);
});

test('veterinaria: si el registro del paciente ya tiene la mascota, no se pregunta nada de ella', () => {
  const s = new Session('vet');
  const p = s.c.patients.find((x) => x.pet.species === 'Perro');
  s.conv.phone = p.phone; s.conv.name = p.name; s.conv.patientId = p.id;
  s.say('Quiero vacunar a mi perro con cualquiera');
  s.say('1');
  assert.equal(s.step, 'confirm');
  assert.match(s.out[0].text, new RegExp(p.pet.name));
  // pero si dice otra especie distinta de la del registro, no se asume la misma mascota
  const t = new Session('vet');
  t.conv.phone = p.phone; t.conv.name = p.name; t.conv.patientId = p.id;
  t.say('Quiero vacunar a mi gato con cualquiera');
  t.say('1');
  assert.equal(t.step, 'pet_name');
});

// --- [10] Reprogramar con confirmación --------------------------------------------------------------

for (const giro of GIROS) {
  test(`reprogramar (${giro}): muestra de qué horario a cuál, pide confirmar y solo entonces mueve la cita`, () => {
    const s = new Session(giro);
    toSummary(s); s.say('1');
    const appt = chatAppts(s.c, phoneOf(s))[0];
    const oldStart = appt.start; const oldPro = appt.professionalId;
    s.say('quiero reprogramar mi cita');
    assert.equal(s.step, 'resched_slots');
    s.say('2');
    assert.equal(s.step, 'resched_confirm');
    const summary = s.out[0].text;
    assert.match(summary, /Ahora:/); assert.match(summary, /Nuevo:/); assert.match(summary, /¿Confirma el cambio\?/);
    assert.ok(s.chips().includes('Sí, confirmar') && s.chips().includes('Dejarla como está'));
    assert.equal(appt.start, oldStart, 'no cambia antes de confirmar');
    assert.equal(appt.status, 'pendiente');
    assert.equal(slotProblem(s.c, oldPro, oldStart, appt.minutes, appt.id), null);
    const picked = s.conv.script.data.newSlot;
    s.say('sí');
    assert.equal(appt.start, picked.start);
    assert.equal(appt.status, 'reprogramada');
    assert.equal(slotProblem(s.c, oldPro, oldStart, appt.minutes), picked.start === oldStart && picked.professionalId === oldPro ? 'ocupado' : null, 'el horario anterior queda libre');
    assert.match(s.out[0].text, /quedó reprogramada/);
  });
}

test('reprogramar: «elegir otro horario» vuelve a la lista y «dejarla como está» no cambia nada', () => {
  const s = new Session('fisio');
  toSummary(s); s.say('1');
  const appt = chatAppts(s.c, phoneOf(s))[0];
  const oldStart = appt.start;
  s.say('reprogramar'); s.say('1');
  assert.equal(s.step, 'resched_confirm');
  s.say('2');
  assert.equal(s.step, 'resched_slots');
  s.say('1');
  assert.equal(s.step, 'resched_confirm');
  s.say('3');
  assert.equal(s.step, 'menu');
  assert.equal(appt.start, oldStart); assert.equal(appt.status, 'pendiente');
  assert.match(s.out[0].text, /sigue como está/);
  // una respuesta que no se entiende no mueve nada
  s.say('reprogramar'); s.say('1');
  s.say('quizás');
  assert.equal(s.step, 'resched_confirm'); assert.equal(appt.start, oldStart);
});

test('reprogramar: si el horario nuevo se ocupa antes de confirmar, no se mueve y se ofrecen otros', () => {
  const s = new Session('fisio');
  toSummary(s); s.say('1');
  const appt = chatAppts(s.c, phoneOf(s))[0];
  const oldStart = appt.start;
  s.say('reprogramar'); s.say('1');
  const slot = s.conv.script.data.newSlot;
  s.c.appointments.push({ id: 'ocupa', professionalId: slot.professionalId, start: slot.start, minutes: 45, status: 'confirmada', history: [], name: 'X', phone: '6000-9099', serviceId: 'sesion', patientId: 'zz' });
  s.say('1');
  assert.equal(appt.start, oldStart);
  assert.equal(s.step, 'resched_slots');
  assert.match(s.out.map((o) => o.text).join('\n'), /ya no está disponible/);
});

test('reprogramar con el número de otro paciente (pista de la demo) también pide confirmar', () => {
  const s = new Session('fisio');
  s.say('necesito reprogramar mi cita');
  const hint = s.chips().find((c) => c.startsWith('Usar '));
  s.say(hint.replace('Usar ', ''));
  assert.equal(s.step, 'resched_slots');
  const appt = s.c.appointments.find((a) => a.id === s.conv.script.data.apptId);
  const oldStart = appt.start;
  s.say('1');
  assert.equal(s.step, 'resched_confirm');
  assert.equal(appt.start, oldStart);
  s.say('1');
  assert.notEqual(appt.start, oldStart);
});

// --- [11] Horarios en orden cronológico ----------------------------------------------------------------

/** Pasa por todas las páginas de «Otros horarios» y junta los horarios ofrecidos. */
function pages(s, max = 12) {
  const all = [];
  for (let i = 0; i < max && (s.step === 'slots' || s.step === 'resched_slots'); i++) {
    all.push(...s.conv.script.data.offered.map((o) => ({ ...o })));
    s.say('otros horarios');
  }
  return all;
}

for (const giro of GIROS) {
  test(`«Otros horarios» con «el primero disponible» (${giro}) avanza en orden cronológico global y no repite`, () => {
    const s = new Session(giro);
    s.say(`quiero ${SERVICE[giro]} con cualquiera`);
    if (s.step === 'pro') s.say('el primero disponible');
    const all = pages(s, 10);
    assert.ok(all.length >= 15, 'hay varias páginas');
    for (let i = 1; i < all.length; i++) assert.ok(all[i].start > all[i - 1].start, `${all[i - 1].start} -> ${all[i].start}`);
    assert.equal(new Set(all.map((x) => `${x.start}|${x.professionalId}`)).size, all.length, 'sin repetir');
  });
}

test('reprogramar: «Otros horarios» también avanza en orden y sin repetir', () => {
  const s = new Session('fisio');
  toSummary(s); s.say('1');
  s.say('reprogramar');
  const all = [];
  for (let i = 0; i < 8 && s.step === 'resched_slots'; i++) { all.push(...s.conv.script.data.offered); s.say('otros horarios'); }
  assert.ok(all.length >= 12);
  for (let i = 1; i < all.length; i++) assert.ok(all[i].start > all[i - 1].start);
});

test('la tira de días sigue funcionando junto al orden cronológico', () => {
  const s = new Session('fisio');
  s.say('quiero agendar una sesión con cualquiera');
  const days = s.out.flatMap((o) => o.chips || []).filter((c) => c.kind === 'day');
  assert.ok(days.length >= 3);
  s.say(days.at(-1).text);
  const d = s.conv.script.data;
  assert.ok(d.offered.every((o) => o.start.slice(0, 10) === d.prefs.day));
  for (let i = 1; i < d.offered.length; i++) assert.ok(d.offered[i].start > d.offered[i - 1].start);
});

// --- Identidad en el estado y el controlador -----------------------------------------------------------

test('el chat en vivo nace con la persona del giro; «Nuevo chat» y estados antiguos también', async () => {
  fixClock();
  const backend = memoryBackend();
  const store = createStore({ storage: createStorage('t', () => backend) });
  store.init();
  for (const g of GIROS) {
    store.setGiro(g);
    assert.deepEqual({ ...store.live().persona }, { ...TEMPLATES[g].persona });
  }
  // estado guardado sin persona
  delete store.live().persona;
  assert.deepEqual({ ...store.live().persona }, { ...TEMPLATES[store.state.giro].persona });
  const ctl = createController({ store }); ctl.speed = 0;
  await ctl.sendUser('hola');
  ctl.newChat();
  assert.deepEqual({ ...store.live().persona }, { ...TEMPLATES[store.state.giro].persona });
  assert.equal(store.live().messages.length, 0);
});

test('controlador: agenda sin teléfono, «Simular día anterior» encuentra la cita de la persona y reprograma con confirmación', async () => {
  fixClock();
  const store = createStore({ storage: createStorage('t', () => memoryBackend()) });
  store.init();
  const ctl = createController({ store }); ctl.speed = 0;
  const phone = store.profile().persona.phone;
  for (const t of ['Quiero una sesión de terapia mañana', 'cualquiera', '1', 'Ana Pérez', 'sí']) await ctl.sendUser(t);
  const appt = store.clinic().appointments.find((a) => a.phone === phone);
  assert.ok(appt, 'la cita quedó con el teléfono del chat');
  assert.ok(!store.live().messages.some((m) => m.from === 'bot' && /número de teléfono/i.test(m.text)));
  assert.equal(store.live().phone, phone);
  await ctl.simulateDayBefore();
  assert.equal(appt.reminder, 'enviado');
  await ctl.sendUser('2');
  assert.equal(store.live().script.step, 'resched_slots');
  const old = appt.start;
  await ctl.sendUser('1');
  assert.equal(store.live().script.step, 'resched_confirm');
  assert.equal(appt.start, old);
  await ctl.sendUser('sí');
  assert.notEqual(appt.start, old);
  assert.equal(appt.status, 'reprogramada');
});
