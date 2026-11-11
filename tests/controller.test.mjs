import test from 'node:test';
import assert from 'node:assert/strict';
import { fixClock } from './helpers.mjs';
import { createStore } from '../public/app/state.js';
import { createStorage } from '../public/shared/storage/storage.js';
import { createController } from '../public/app/controller.js';
import { AIUnavailable } from '../public/shared/chat-engine/ai-adapter.js';
import { applyActions, buildAIContext, historyForAI } from '../public/app/ai.js';
import { now, setNow } from '../public/shared/time/panama.js';
import { slotProblem } from '../public/app/agenda.js';

const memoryBackend = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), _m: m }; };

function setup({ ai, backend = memoryBackend() } = {}) {
  fixClock();
  const store = createStore({ storage: createStorage('t', () => backend) });
  store.init();
  const notes = [];
  const ctl = createController({ store, notify: (m) => notes.push(m), ai });
  ctl.speed = 0;
  return { store, ctl, backend, notes };
}
const texts = (store) => store.live().messages.map((m) => `${m.from}: ${m.text}`);

test('almacenamiento: guarda y recupera; "Reiniciar demo" vuelve a la semilla', () => {
  const { store, ctl, backend } = setup();
  const seedCount = store.clinic().appointments.length;
  return ctl.sendUser('Quiero una sesión de terapia mañana con cualquiera').then(async () => {
    await ctl.sendUser('1'); await ctl.sendUser('Ana Pérez'); await ctl.sendUser('sí');
    assert.equal(store.clinic().appointments.length, seedCount + 1);
    const again = createStore({ storage: createStorage('t', () => backend) }); again.init();
    assert.equal(again.clinic().appointments.length, seedCount + 1, 'persiste en localStorage');
    store.reset();
    assert.equal(store.clinic().appointments.length, seedCount, 'reiniciar deja exactamente la semilla');
    assert.equal(store.live().messages.length, 0);
  });
});

test('con localStorage bloqueado la demo sigue funcionando en memoria', async () => {
  fixClock();
  const blocked = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() { throw new Error('bloqueado'); } };
  const store = createStore({ storage: createStorage('t', () => blocked) });
  store.init();
  const ctl = createController({ store }); ctl.speed = 0;
  await ctl.sendUser('Quiero una limpieza'); // el giro por defecto es fisio: el servicio no existe; igual responde
  assert.ok(store.live().messages.length >= 2);
  assert.equal(store.persistent, false);
  const noBackend = createStore({ storage: createStorage('t', () => { throw new Error('sin acceso'); }) });
  assert.ok(noBackend.init().clinics.fisio);
});

test('datos dañados en localStorage: se vuelve a sembrar sin romper', () => {
  fixClock();
  const backend = memoryBackend(); backend.setItem('t', '{no es json');
  const store = createStore({ storage: createStorage('t', () => backend) });
  assert.equal(store.init().v, 2);
  assert.equal(store.clinic().appointments.length, 25);
});

test('cambió la semana: la semilla se renueva', () => {
  const { store, backend } = setup();
  setNow(() => new Date(Date.UTC(2026, 10, 17, 10, 0, 0))); // una semana después
  const again = createStore({ storage: createStorage('t', () => backend) }); again.init();
  assert.ok(again.clinic().appointments.every((a) => a.start >= '2026-11-16' && a.start < '2026-11-22'));
  assert.equal(again.weekRolled, true);
  fixClock();
  store.save();
});

test('privacidad: un mensaje con datos de salud se muestra pero NO se guarda', async () => {
  const { store, ctl, backend } = setup();
  await ctl.sendUser('me duele mucho la rodilla');
  const live = store.live();
  assert.equal(live.messages[0]._raw, 'me duele mucho la rodilla', 'en memoria, para mostrarlo en el teléfono');
  assert.match(live.messages[0].text, /no guardado/);
  const saved = backend._m.get('t');
  assert.ok(!saved.includes('rodilla'), 'no llega a localStorage');
  await ctl.sendUser('tengo un dolor fuerte en el pecho');
  assert.ok(!backend._m.get('t').includes('en el pecho'));
  assert.ok(store.live().flags.urgent);
});

test('urgencia: sube la bandera, el panel la ve y "Pasar a una persona" la deriva', async () => {
  const { store, ctl } = setup();
  await ctl.sendUser('tengo un dolor fuerte');
  assert.ok(store.live().flags.urgent);
  assert.ok(store.clinic().events.some((e) => e.kind === 'urgente'));
  await ctl.requestHandoff();
  assert.ok(store.live().flags.handoff && store.live().mode === 'humano');
  ctl.staffReply('live', 'Hola, le llamamos ahora mismo.');
  assert.ok(texts(store).some((t) => t.startsWith('staff: Hola, le llamamos')));
  ctl.returnToBot('live');
  assert.equal(store.live().mode, 'bot');
});

test('Simular día anterior: recordatorio al chat y "Sí" pasa la cita a Confirmada', async () => {
  const { store, ctl } = setup();
  for (const t of ['Quiero una sesión de terapia mañana', 'cualquiera', '1', 'Ana Pérez', 'sí']) await ctl.sendUser(t);
  const appt = store.clinic().appointments.find((a) => a.phone === store.profile().persona.phone);
  assert.equal(appt.status, 'pendiente');
  await ctl.simulateDayBefore();
  assert.ok(texts(store).some((t) => /le recordamos su cita mañana a las/.test(t)));
  assert.equal(appt.reminder, 'enviado');
  await ctl.sendUser('1');
  assert.equal(appt.status, 'confirmada');
  assert.ok(store.clinic().events.some((e) => /confirmó por WhatsApp/.test(e.text)));
});

test('Simular día anterior sin cita propia usa una cita de la agenda y lo avisa', async () => {
  const { store, ctl } = setup();
  await ctl.simulateDayBefore();
  assert.ok(texts(store).some((t) => /Demo: no hay una cita de esta persona/.test(t)));
  assert.ok(texts(store).some((t) => /le recordamos su cita/.test(t)));
});

test('Simular seguimiento (veterinaria): aviso a los 12 meses y agendar con los datos conocidos', async () => {
  const { store, ctl } = setup();
  store.setGiro('vet');
  await ctl.simulateFollowup();
  assert.ok(texts(store).some((t) => /12 meses desde la última vacuna/.test(t)));
  assert.ok(store.clinic().events.some((e) => e.kind === 'seguimiento'));
});

test('adjuntos: no se guardan; se explica la privacidad', async () => {
  const { store, ctl } = setup();
  await ctl.sendAttachment({ name: 'analisis.pdf', type: 'application/pdf', size: 1200 });
  assert.match(texts(store).at(-1), /no guardamos imágenes ni documentos clínicos/);
  await ctl.sendAttachment({ name: 'virus.exe', type: 'application/x-msdownload', size: 10 });
  assert.match(texts(store).at(-1), /Solo puedo recibir imágenes o PDF/);
});

test('cambiar de giro cambia marca y datos; cada giro conserva los suyos', () => {
  const { store } = setup();
  assert.equal(store.profile().name, 'Centro de Fisioterapia Movimiento');
  store.setGiro('dental'); assert.equal(store.profile().name, 'Clínica Dental Sonrisa');
  store.setGiro('vet'); assert.equal(store.profile().name, 'Veterinaria Patitas');
  assert.ok(store.clinic().config.services.some((s) => s.id === 'bano'));
});

test('nuevo chat archiva la conversación en la bandeja', async () => {
  const { store, ctl } = setup();
  await ctl.sendUser('hola');
  const before = store.clinic().conversations.length;
  ctl.newChat();
  assert.equal(store.live().messages.length, 0);
  assert.equal(store.clinic().conversations.length, before + 1);
});

// --- Modo IA real -------------------------------------------------------------------------------------

test('IA real: la IA propone acciones y el navegador las valida y aplica', async () => {
  const calls = [];
  const { store, ctl } = setup({ ai: { ping: async () => ({ ok: true, model: 'x' }), turn: (args) => import('../public/app/ai.js').then((m) => m.aiTurn({ ...args, ask: async (req) => {
    calls.push(req);
    const slot = req.context.horariosLibres.find((h) => h.servicioIds.includes('sesion') && h.profesionalId === 'p1');
    if (calls.length === 1) return { reply: 'Estos son 3 horarios…', actions: [{ type: 'proponer_horarios', payload: { horarios: [{ inicio: slot.inicio, profesionalId: 'p1', servicioId: 'sesion' }] } }], handoff: false };
    return { reply: '✅ Listo, su cita quedó agendada.', actions: [{ type: 'crear_cita', payload: { servicioId: 'sesion', profesionalId: 'p1', inicio: slot.inicio, nombre: 'ana pérez', telefono: '6000 9001' } }], handoff: false };
  } })) } });
  assert.equal((await ctl.setAiMode('ia')).ok, true);
  await ctl.sendUser('quiero una sesión');
  assert.ok(store.live().chips.length >= 2, 'chips con los horarios propuestos');
  const before = store.clinic().appointments.length;
  await ctl.sendUser('sí, confirmo');
  assert.equal(store.clinic().appointments.length, before + 1);
  const a = store.clinic().appointments.find((x) => x.phone === '6000-9001');
  assert.equal(a.origin, 'chat'); assert.equal(a.status, 'pendiente'); assert.equal(a.name, 'Ana Pérez');
  assert.equal(calls[0].demo, 'citas');
  assert.ok(calls[0].context.horariosLibres.length > 10 && calls[0].context.horariosLibres.length <= 60);
});

test('IA real: acciones inválidas o ajenas se rechazan (horario ocupado, cita de otra persona, acción no permitida)', () => {
  fixClock();
  const { store } = setup();
  const c = store.clinic(); const conv = store.live();
  const ctx = { now: now(), profile: store.profile(), log() {} };
  const busy = c.appointments.find((a) => (a.status === 'pendiente' || a.status === 'confirmada') && a.start > '2026-11-10T12:00');
  const r1 = applyActions(c, conv, [{ type: 'crear_cita', payload: { servicioId: busy.serviceId, profesionalId: busy.professionalId, inicio: busy.start, nombre: 'Ana Pérez', telefono: '6000-9001' } }], ctx);
  assert.equal(r1.errors[0].reason, 'ocupado');
  const r2 = applyActions(c, conv, [{ type: 'cancelar_cita', payload: { citaId: busy.id } }], ctx);
  assert.match(r2.errors[0].message, /no encuentro esa cita/);
  assert.notEqual(busy.status, 'cancelada', 'no se cancela la cita de otra persona');
  const r3 = applyActions(c, conv, [{ type: 'borrar_todo', payload: {} }], ctx);
  assert.equal(r3.errors[0].message, 'acción no permitida');
  const r4 = applyActions(c, conv, [{ type: 'crear_cita', payload: { servicioId: 'sesion', profesionalId: 'p1', inicio: '2026-11-11T08:00', nombre: '', telefono: 'abc' } }], ctx);
  assert.match(r4.errors[0].message, /faltan datos/);
  assert.equal(slotProblem(c, busy.professionalId, busy.start, busy.minutes), 'ocupado');
});

test('IA real: el historial y el contexto no llevan datos de salud ni claves', () => {
  const { store } = setup();
  const conv = store.live();
  conv.messages.push({ id: 'a', from: 'user', text: '🔒 Mensaje no guardado por privacidad (posible dato de salud)', _raw: 'me duele la rodilla', ts: 1 });
  const hist = historyForAI(conv);
  assert.ok(!JSON.stringify(hist).includes('rodilla'));
  const ctx = buildAIContext(store.clinic(), conv, store.profile(), now());
  assert.ok(!JSON.stringify(ctx).toLowerCase().includes('api_key'));
  assert.equal(ctx.servicios.length, 4);
});

test('IA real: si /api/chat falla, vuelve al guion sin romper nada (y tras 2 fallos regresa al modo guion)', async () => {
  const boom = { ping: async () => ({ ok: true }), turn: async () => { throw new AIUnavailable('estado 502'); } };
  const { store, ctl, notes } = setup({ ai: boom });
  await ctl.setAiMode('ia');
  await ctl.sendUser('hola');
  assert.ok(texts(store).some((t) => /La IA real no respondió/.test(t)));
  assert.ok(texts(store).some((t) => /asistente virtual de Centro de Fisioterapia Movimiento/.test(t)), 'responde el guion');
  assert.equal(store.state.aiMode, 'ia');
  await ctl.sendUser('precios');
  assert.equal(store.state.aiMode, 'guion');
  assert.ok(notes.some((n) => /volvió al modo guion/.test(n)));
});

test('IA real no disponible: no se activa y devuelve la razón (la interfaz la explica, sin avisos técnicos)', async () => {
  const { store, ctl, notes } = setup({ ai: { ping: async () => ({ ok: false, reason: 'no existe /api/chat' }), turn: async () => { throw new Error('no debe llamarse'); } } });
  const r = await ctl.setAiMode('ia');
  assert.equal(r.ok, false); assert.equal(store.state.aiMode, 'guion');
  assert.equal(r.reason, 'no existe /api/chat');
  assert.equal(notes.length, 0, 'no se muestra un aviso técnico al cliente');
});

test('IA real: urgencias y "persona" siempre las decide el guion, nunca la IA', async () => {
  let aiCalled = 0;
  const { store, ctl } = setup({ ai: { ping: async () => ({ ok: true }), turn: async () => { aiCalled++; throw new AIUnavailable('x'); } } });
  await ctl.setAiMode('ia');
  await ctl.sendUser('mi gato no respira');
  await ctl.sendUser('quiero hablar con una persona');
  assert.equal(aiCalled, 0);
  assert.ok(store.live().flags.urgent && store.live().flags.handoff);
});
