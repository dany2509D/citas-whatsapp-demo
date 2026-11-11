// Grupo A1: urgencias (CIT-RF-07, CIT-HU4.1, tabla 7.1) y urgencia fuera de horario.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, chatAppts } from './helpers.mjs';
import { setNow } from '../public/shared/time/panama.js';
import { stripNegatedPain, hasHealthWords } from '../public/shared/chat-engine/nlu.js';
import { isOpenNow, urgentPhone } from '../public/app/bot.js';
import { createStore, STORAGE_KEY } from '../public/app/state.js';
import { createStorage } from '../public/shared/storage/storage.js';
import { TEMPLATES, GIROS } from '../public/app/data/templates.js';
import { validEmergencyPhone } from '../public/app/views/admin-config.js';

const at = (y, m, d, h, mi) => setNow(() => new Date(Date.UTC(y, m - 1, d, h, mi, 0)));
// Martes 10 nov 2026 (la sesión arranca a las 10:00). Sáb 14, dom 15.
const CLINIC = { fisio: '+507 6000-1000', dental: '+507 6000-2000', vet: '+507 6000-3000' };
const EMERG = { fisio: '911', dental: '911', vet: '+507 6000-3911' };

// --- Tabla 7.1 completa (14 frases) -------------------------------------------------------------

const TABLE_URGENT = [
  ['dental', 'se me partió un diente y me duele mucho'],
  ['dental', 'me duele muchísimo la muela'],
  ['dental', 'se me cayó un diente por un golpe'],
  ['dental', 'tengo la cara hinchada'],
  ['dental', 'tengo un dolor fuerte'],
  ['vet', 'mi perro comió chocolate'],
  ['vet', 'mi perro se tragó algo y está vomitando'],
  ['vet', 'a mi gato lo atropelló un carro'],
  ['vet', 'mi perrita está convulsionando'],
  ['fisio', 'tengo un dolor fuerte en la espalda'],
  ['fisio', 'me caí y no puedo mover el brazo'],
];

for (const [giro, phrase] of TABLE_URGENT) {
  test(`tabla 7.1 urgencia (${giro}): «${phrase}» no agenda, da el teléfono, marca URGENTE y ofrece una persona`, () => {
    const s = new Session(giro);
    const before = s.c.appointments.length;
    s.say(phrase);
    assert.ok(s.conv.flags.urgent, 'marcada URGENTE');
    assert.equal(s.step, 'urgent');
    assert.ok(s.out[0].text.includes(CLINIC[giro]), 'dentro del horario: teléfono de la clínica');
    assert.match(s.out[0].text, /no agendo urgencias/);
    assert.doesNotMatch(s.out[0].text, /No estoy seguro/);
    assert.ok(s.chips().includes('Pasar a una persona'));
    assert.equal(s.c.appointments.length, before);
    assert.ok(s.logs.some((l) => l.kind === 'urgente'));
    s.say('sí, por favor');
    assert.ok(s.conv.flags.handoff && s.conv.mode === 'humano');
  });
}

test('tabla 7.1 no urgencia: «ya no tengo dolor, quiero agendar el control de progreso» agenda (los 3 giros)', () => {
  for (const giro of GIROS) {
    const s = new Session(giro);
    s.say('ya no tengo dolor, quiero agendar el control de progreso');
    assert.ok(!s.conv.flags.urgent, giro);
    assert.notEqual(s.step, 'urgent', giro);
    assert.ok(['svc', 'pro', 'slots'].includes(s.step), `${giro}: ${s.step}`);
    assert.doesNotMatch(s.out[0].text, /no agendo urgencias|No estoy seguro/);
  }
  const f = new Session('fisio');
  f.say('ya no tengo dolor, quiero agendar el control de progreso');
  assert.equal(f.conv.script.data.serviceId, 'control', 'entendió el servicio y sigue agendando');
});

test('tabla 7.1 no urgencia: «necesito una cita urgente para mañana» agenda (los 3 giros)', () => {
  for (const giro of GIROS) {
    const s = new Session(giro);
    s.say('necesito una cita urgente para mañana');
    assert.ok(!s.conv.flags.urgent, giro);
    assert.ok(['svc', 'pro', 'slots'].includes(s.step), `${giro}: ${s.step}`);
  }
});

test('tabla 7.1: «me sangra la encía cuando me cepillo» no es urgencia y ofrece una evaluación, no la lista de precios', () => {
  const s = new Session('dental');
  s.say('me sangra la encía cuando me cepillo');
  assert.ok(!s.conv.flags.urgent);
  const all = s.out.map((o) => o.text).join('\n');
  assert.match(all, /evaluaci[oó]n/i);
  assert.doesNotMatch(all, /servicios y precios|Horario de atención|No estoy seguro/);
  assert.ok(['svc', 'pro', 'slots'].includes(s.step), s.step);
});

// --- Mismas urgencias en los tres giros -------------------------------------------------------

test('«me duele mucho / muchísimo» y «dolor insoportable» son urgencia en los tres giros', () => {
  for (const giro of GIROS) {
    for (const phrase of ['me duele mucho la rodilla', 'me duele muchísimo la cabeza', 'tengo un dolor insoportable', 'me duelen muchísimo las muelas', 'tengo un dolor fuerte']) {
      const s = new Session(giro);
      s.say(phrase);
      assert.ok(s.conv.flags.urgent, `${giro}: ${phrase}`);
    }
  }
});

test('veterinaria: palabras de la spec (uvas, xilitol, raticida, no come, no orina, parto)', () => {
  for (const phrase of ['mi perro se comió unas uvas', 'mi perro comió algo con xilitol', 'mi gato probó raticida', 'mi perro no come desde ayer', 'mi gata no orina', 'mi perra está de parto']) {
    const s = new Session('vet');
    s.say(phrase);
    assert.ok(s.conv.flags.urgent, phrase);
  }
});

test('odontología: palabras de la spec (partido, quebrado, fractura, absceso, fiebre, insoportable)', () => {
  for (const phrase of ['tengo un diente partido', 'se me partió una muela', 'se me quebró un diente', 'creo que tengo una fractura en la mandíbula', 'tengo un absceso', 'tengo fiebre y la mejilla duele', 'es insoportable', 'se me hinchó la cara']) {
    const s = new Session('dental');
    s.say(phrase);
    assert.ok(s.conv.flags.urgent, phrase);
  }
});

test('urgencia interrumpe un agendamiento a medias y no crea citas', () => {
  const s = new Session('dental');
  s.say('Quiero una limpieza');
  s.say('se me partió un diente y me duele mucho');
  assert.ok(s.conv.flags.urgent);
  assert.equal(s.step, 'urgent');
  assert.equal(chatAppts(s.c, '6000-9999').length, 0);
});

// --- Falsos positivos y negaciones ----------------------------------------------------------------

test('negaciones del dolor no son urgencia: «ya no me duele mucho», «sin dolor», «no tengo dolor fuerte»', () => {
  for (const giro of GIROS) {
    for (const phrase of ['ya no me duele mucho, quiero una cita', 'estoy sin dolor y quiero agendar', 'no tengo dolor fuerte, quiero una cita', 'ya no tengo dolor, quiero una cita', 'se me quitó el dolor, quiero agendar']) {
      const s = new Session(giro);
      s.say(phrase);
      assert.ok(!s.conv.flags.urgent, `${giro}: ${phrase}`);
    }
  }
});

test('decisión documentada: dolor leve + cita agenda; «me duele mucho» + cita es urgencia', () => {
  const leve = new Session('fisio');
  leve.say('tengo dolor de cabeza leve, quiero una cita');
  assert.ok(!leve.conv.flags.urgent);
  assert.ok(['svc', 'pro', 'slots'].includes(leve.step), leve.step);
  const fuerte = new Session('fisio');
  fuerte.say('me duele mucho la espalda, quiero una cita');
  assert.ok(fuerte.conv.flags.urgent);
});

test('stripNegatedPain y hasHealthWords', () => {
  assert.equal(stripNegatedPain('Ya no me duele mucho, quiero una cita'), 'quiero una cita');
  assert.ok(hasHealthWords('me salió una herida'));
  assert.ok(!hasHealthWords('ya no tengo dolor'));
  assert.ok(!hasHealthWords('qué hora es'));
});

// --- Salud sin intención: ofrece una persona ----------------------------------------------------------

test('mensaje de salud sin intención: ofrece pasar a una persona en vez de «No estoy seguro»', () => {
  for (const [giro, phrase] of [['fisio', 'tengo un calambre raro en la pierna'], ['dental', 'me salió una herida en la lengua'], ['vet', 'mi perro está cojeando']]) {
    const s = new Session(giro);
    s.say(phrase);
    assert.ok(!s.conv.flags.urgent, phrase);
    const all = s.out.map((o) => o.text).join('\n');
    assert.doesNotMatch(all, /No estoy seguro de haber entendido/, phrase);
    assert.match(all, /persona del equipo/);
    assert.ok(s.chips().includes('Pasar a una persona'));
    s.say('sí');
    assert.ok(s.conv.flags.handoff && s.conv.mode === 'humano', phrase);
  }
});

test('un mensaje sin relación con salud sigue recibiendo «No estoy seguro»', () => {
  const s = new Session('dental');
  s.say('blablabla xyz');
  assert.match(s.out[0].text, /No estoy seguro de haber entendido/);
});

// --- CIT-RF-12 / [12]: urgencia fuera de horario -------------------------------------------------------

const urgentPhrase = { fisio: 'tengo un dolor fuerte en la espalda', dental: 'se me partió un diente y me duele mucho', vet: 'mi perro comió chocolate' };

for (const giro of GIROS) {
  test(`fuera de horario (${giro}): 1:43 a. m. da el número de emergencias, no el de la clínica`, () => {
    const s = new Session(giro);
    at(2026, 11, 10, 1, 43);
    s.say(urgentPhrase[giro]);
    const text = s.out[0].text;
    assert.ok(s.conv.flags.urgent);
    assert.ok(text.includes(EMERG[giro]), text);
    assert.ok(!text.includes(CLINIC[giro]), 'no manda llamar a la clínica cerrada');
    assert.match(text, /fuera de horario/);
    assert.ok(s.chips().includes('Pasar a una persona'));
  });

  test(`horario (${giro}): sábado después del cierre y domingo usan el de emergencias; en horario, el de la clínica`, () => {
    for (const [d, h, mi, esperado] of [[14, 20, 0, 'emerg'], [15, 10, 0, 'emerg'], [10, 10, 0, 'clinica'], [10, 20, 0, 'emerg'], [10, 7, 59, 'emerg'], [10, 8, 0, 'clinica']]) {
      const s = new Session(giro);
      at(2026, 11, d, h, mi);
      s.say(urgentPhrase[giro]);
      const text = s.out[0].text;
      assert.ok(text.includes(esperado === 'emerg' ? EMERG[giro] : CLINIC[giro]), `${d} ${h}:${mi} -> ${text}`);
      if (esperado === 'emerg') assert.ok(!text.includes(CLINIC[giro]));
      else if (EMERG[giro] !== '911') assert.ok(!text.includes(EMERG[giro]));
    }
  });
}

test('sábado: abre hasta el cierre del sábado (fisio 12:00), no el de lunes a viernes', () => {
  const s = new Session('fisio');
  at(2026, 11, 14, 13, 0); // sábado 1:00 p. m., fisio cierra a las 12:00
  s.say('tengo un dolor fuerte en la espalda');
  assert.ok(s.out[0].text.includes('911'));
  const d = new Session('dental');
  at(2026, 11, 14, 12, 30); // dental cierra a la 1:00 p. m.
  d.say('tengo un dolor fuerte');
  assert.ok(d.out[0].text.includes('+507 6000-2000'));
});

test('isOpenNow usa c.config.hours y urgentPhone cae al respaldo', () => {
  const s = new Session('vet');
  assert.equal(isOpenNow(s.c, '2026-11-10T10:00'), true);
  assert.equal(isOpenNow(s.c, '2026-11-10T17:00'), false);
  assert.equal(isOpenNow(s.c, '2026-11-15T10:00'), false);
  s.c.config.hours[2] = null; // martes cerrado por configuración
  assert.equal(isOpenNow(s.c, '2026-11-10T10:00'), false);
  assert.equal(urgentPhone(s.c, s.T, false), '+507 6000-3911');
  assert.equal(urgentPhone(s.c, s.T, true), '+507 6000-3000');
  delete s.c.config.telefonoEmergenciasFueraDeHorario; // estado guardado antiguo
  assert.equal(urgentPhone(s.c, s.T, false), '+507 6000-3911', 'respaldo en la plantilla');
  s.c.config.telefonoEmergenciasFueraDeHorario = '   ';
  assert.equal(urgentPhone(s.c, s.T, false), '+507 6000-3911');
  s.c.config.phone = ''; s.T = { ...s.T, telefonoEmergenciasFueraDeHorario: '' };
  assert.equal(urgentPhone(s.c, s.T, true), '');
});

test('el número de emergencias configurado en el panel se usa fuera de horario', () => {
  const s = new Session('dental');
  s.c.config.telefonoEmergenciasFueraDeHorario = '+507 6000-4444';
  at(2026, 11, 10, 1, 43);
  s.say('tengo un dolor fuerte');
  assert.ok(s.out[0].text.includes('+507 6000-4444'));
  assert.ok(!s.out[0].text.includes('911'));
});

test('sin teléfono configurado fuera de horario no inventa uno', () => {
  const s = new Session('dental');
  s.c.config.telefonoEmergenciasFueraDeHorario = ''; s.c.config.phone = '';
  s.T = { ...s.T, telefonoEmergenciasFueraDeHorario: '' };
  at(2026, 11, 10, 1, 43);
  s.say('tengo un dolor fuerte');
  assert.match(s.out[0].text, /No tengo el teléfono de la clínica configurado/);
  assert.ok(s.conv.flags.urgent);
});

// --- Plantillas, configuración y almacenamiento -----------------------------------------------------------

test('cada giro tiene telefonoEmergenciasFueraDeHorario en la plantilla y en la configuración sembrada', () => {
  for (const g of GIROS) {
    assert.equal(TEMPLATES[g].telefonoEmergenciasFueraDeHorario, EMERG[g]);
    assert.equal(new Session(g).c.config.telefonoEmergenciasFueraDeHorario, EMERG[g]);
  }
  assert.match(TEMPLATES.vet.telefonoEmergenciasFueraDeHorario, /^\+507 6000-\d{4}$/);
});

test('validación del teléfono de emergencias del panel', () => {
  for (const ok of ['911', '+507 6000-3911', '6000-3911', '(507) 6000 3911']) assert.equal(validEmergencyPhone(ok), null, ok);
  for (const bad of ['', '   ', 'abc', '12', '12345', '911911911911911', 'llame al 911']) assert.ok(validEmergencyPhone(bad), `debe rechazar «${bad}»`);
});

test('almacenamiento: un estado guardado v1 se vuelve a sembrar con la versión 2', () => {
  assert.match(STORAGE_KEY, /v2$/);
  const m = new Map();
  const backend = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  const first = createStore({ storage: createStorage('k', () => backend) });
  const st = first.init();
  assert.equal(st.v, 2);
  // simula un estado antiguo: versión 1 y sin el campo nuevo
  const old = JSON.parse(m.get('k'));
  old.v = 1;
  for (const g of GIROS) delete old.clinics[g].config.telefonoEmergenciasFueraDeHorario;
  m.set('k', JSON.stringify(old));
  const again = createStore({ storage: createStorage('k', () => backend) });
  const fresh = again.init();
  assert.equal(fresh.v, 2);
  for (const g of GIROS) assert.equal(fresh.clinics[g].config.telefonoEmergenciasFueraDeHorario, EMERG[g]);
});

test('«Restablecer palabras» usa las palabras nuevas de la plantilla', () => {
  assert.ok(TEMPLATES.vet.urgent.includes('chocolate'));
  assert.ok(TEMPLATES.dental.urgent.some((w) => w.startsWith('me duele much')));
  assert.ok(TEMPLATES.fisio.urgent.includes('dolor insoportable'));
});
