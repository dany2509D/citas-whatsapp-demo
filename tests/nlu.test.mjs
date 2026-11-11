import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasClockMention, matchesAny, norm, parseAge, parseChoice, parseClock, parseDayPref, parseName, parsePhone, parseTimeOfDay, parseYesNo,
} from '../public/shared/chat-engine/nlu.js';

test('norm: sin tildes, sin signos y con abreviaturas de chat', () => {
  assert.equal(norm('¿Cuánto CUESTA la Evaluación?'), 'cuanto cuesta la evaluacion');
  assert.equal(norm('necesito cita pa mañana'), 'necesito cita para manana');
  assert.equal(norm('a las 10:30 a. m.'), 'a las 10:30 am');
});

test('parseChoice: números y ordinales, sin confundir "una" ni horas', () => {
  assert.equal(parseChoice('2', 3), 2);
  assert.equal(parseChoice('la segunda', 3), 2);
  assert.equal(parseChoice('opción 3', 3), 3);
  assert.equal(parseChoice('el último', 3), 3);
  assert.equal(parseChoice('quiero una sesión de terapia', 3), null);
  assert.equal(parseChoice('5', 3), null);
});

test('parseYesNo', () => {
  for (const s of ['sí', 'Si', 'claro', 'ok', 'dale', 'confirmo']) assert.equal(parseYesNo(s), 'si', s);
  for (const s of ['no', 'No gracias', 'mejor no', 'nel']) assert.equal(parseYesNo(s), 'no', s);
  assert.equal(parseYesNo('quizás'), null);
});

test('parsePhone: formatos de Panamá', () => {
  assert.equal(parsePhone('6000-1234'), '6000-1234');
  assert.equal(parsePhone('mi número es +507 6000 1234 gracias'), '6000-1234');
  assert.equal(parsePhone('60001234'), '6000-1234');
  assert.equal(parsePhone('227-1234'), '227-1234');
  assert.equal(parsePhone('12345'), null);
  assert.equal(parsePhone('hola'), null);
});

test('parseName', () => {
  assert.equal(parseName('me llamo ana pérez'), 'Ana Pérez');
  assert.equal(parseName('soy José de la Cruz.'), 'José de la Cruz');
  assert.equal(parseName('Luis'), 'Luis');
  assert.equal(parseName('6000-1234'), null);
  assert.equal(parseName('hola'), null);
  assert.equal(parseName('a'), null);
});

test('parseDayPref y parseTimeOfDay: "mañana" es el día siguiente salvo "en la mañana"', () => {
  const today = '2026-11-10'; // martes
  assert.equal(parseDayPref('quiero cita para mañana', today), '2026-11-11');
  assert.equal(parseDayPref('mañana en la tarde', today), '2026-11-11');
  assert.equal(parseDayPref('en la mañana', today), null);
  assert.equal(parseDayPref('hoy', today), today);
  assert.equal(parseDayPref('el viernes', today), '2026-11-13');
  assert.equal(parseDayPref('pasado mañana', today), '2026-11-12');
  assert.equal(parseTimeOfDay('en la mañana'), 'manana');
  assert.equal(parseTimeOfDay('mañana por la tarde'), 'tarde');
  assert.equal(parseTimeOfDay('mañana'), null);
});

test('parseClock y hasClockMention', () => {
  assert.equal(parseClock('a las 10:30 am'), '10:30');
  assert.equal(parseClock('3 pm'), '15:00');
  assert.equal(parseClock('a las 3'), '15:00');
  assert.equal(parseClock('las 9'), '09:00');
  assert.equal(hasClockMention('la 2'), false);
  assert.equal(hasClockMention('a las 10'), true);
  assert.equal(parseClock('nada'), null);
});

test('parseAge', () => {
  assert.equal(parseAge('3'), '3 años');
  assert.equal(parseAge('tiene 8 meses'), '8 meses');
  assert.equal(parseAge('1 año'), '1 año');
  assert.equal(parseAge('mucha'), null);
});

test('matchesAny: raíces con * y errores de una letra en palabras largas', () => {
  assert.ok(matchesAny('reprogramr mi cita', ['reprogramar']));
  assert.ok(matchesAny('fue un envenenamiento', ['envenen*']));
  assert.ok(!matchesAny('mi cita es buena', ['envenen*']));
});
