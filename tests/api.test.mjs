import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_ACTIONS, buildSystem, createHandler, parseModelReply, validateRequest } from '../api/chat.js';

const post = (body, headers = {}) => new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const good = { demo: 'citas', sessionId: 's1', messages: [{ role: 'user', content: 'Hola' }], context: { clinica: { nombre: 'Veterinaria Patitas' }, giro: 'Veterinaria' } };
const fake = (reply, extra = {}) => ({ beta: { messages: { create: async (p) => { fake.last = p; return { stop_reason: 'end_turn', content: [{ type: 'text', text: reply }], ...extra }; } } }, messages: { create: async (p) => { fake.last = p; return { stop_reason: 'end_turn', content: [{ type: 'text', text: reply }], ...extra }; } } });

test('GET indica si la IA está configurada (sin exponer la clave)', async () => {
  const off = await createHandler({ env: {} })(new Request('http://x/api/chat'));
  assert.deepEqual(await off.json(), { ok: false, reason: 'IA no configurada (falta ANTHROPIC_API_KEY en el servidor)' });
  const on = await createHandler({ env: { ANTHROPIC_API_KEY: 'k-prueba' } })(new Request('http://x/api/chat'));
  const body = await on.json();
  assert.equal(body.ok, true);
  assert.ok(!JSON.stringify(body).includes('k-prueba'));
});

test('POST sin clave: 503 y el navegador vuelve al guion', async () => {
  const res = await createHandler({ env: {} })(post(good));
  assert.equal(res.status, 503);
});

test('POST válido: devuelve { reply, actions, handoff } y filtra acciones no permitidas', async () => {
  const model = JSON.stringify({ reply: 'Con gusto. ¿Qué servicio desea?', actions: [{ type: 'borrar_todo', payload: {} }, { type: 'marcar_urgente', payload: {} }], handoff: false });
  const handler = createHandler({ env: { ANTHROPIC_API_KEY: 'k' }, getClient: async () => fake(`Aquí va:\n${model}`) });
  const res = await handler(post(good));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.reply, 'Con gusto. ¿Qué servicio desea?');
  assert.deepEqual(data.actions, [{ type: 'marcar_urgente', payload: {} }]);
  assert.equal(data.handoff, false);
  assert.equal(fake.last.model, 'claude-opus-5-5');
  assert.deepEqual(fake.last.output_config, { effort: 'low' });
  assert.match(fake.last.system, /Veterinaria Patitas/);
  assert.ok(!('temperature' in fake.last));
});

test('el modelo y los respaldos se configuran por variables de entorno', async () => {
  let used;
  const client = { messages: { create: async (p) => { used = { path: 'messages', p }; return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"reply":"ok","actions":[],"handoff":false}' }] }; } }, beta: { messages: { create: async (p) => { used = { path: 'beta', p }; return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"reply":"ok","actions":[],"handoff":false}' }] }; } } } };
  await createHandler({ env: { ANTHROPIC_API_KEY: 'k', CLAUDE_MODEL: 'claude-haiku-5-5', CLAUDE_FALLBACKS: 'off' }, getClient: async () => client })(post(good));
  assert.equal(used.path, 'messages'); assert.equal(used.p.model, 'claude-haiku-5-5');
  await createHandler({ env: { ANTHROPIC_API_KEY: 'k' }, getClient: async () => client })(post(good));
  assert.equal(used.path, 'beta'); assert.deepEqual(used.p.betas, ['server-side-fallback-2026-07-01']); assert.equal(used.p.fallbacks, 'default');
});

test('rechazo del modelo, respuesta inválida o error del SDK: error controlado (nunca revienta)', async () => {
  const env = { ANTHROPIC_API_KEY: 'k' };
  const refusal = await createHandler({ env, getClient: async () => fake('', { stop_reason: 'refusal' }) })(post(good));
  assert.equal(refusal.status, 502);
  const junk = await createHandler({ env, getClient: async () => fake('no es json') })(post(good));
  assert.equal(junk.status, 502);
  const boom = await createHandler({ env, getClient: async () => ({ beta: { messages: { create: async () => { throw new Error('secreto interno'); } } } }) })(post(good));
  assert.equal(boom.status, 502);
  assert.ok(!(await boom.text()).includes('secreto interno'));
  const limited = await createHandler({ env, getClient: async () => ({ beta: { messages: { create: async () => { throw Object.assign(new Error('x'), { status: 429 }); } } } }) })(post(good));
  assert.equal(limited.status, 429);
});

test('validación de la petición', () => {
  assert.ok(validateRequest(good).value);
  assert.ok(validateRequest({ ...good, demo: 'otra' }).error);
  assert.ok(validateRequest({ ...good, messages: [] }).error);
  assert.ok(validateRequest({ ...good, messages: [{ role: 'assistant', content: 'hola' }] }).error);
  assert.ok(validateRequest({ ...good, context: { x: 'a'.repeat(30000) } }).error);
  const merged = validateRequest({ ...good, messages: [{ role: 'assistant', content: 'a' }, { role: 'user', content: 'uno' }, { role: 'user', content: 'dos' }] }).value;
  assert.deepEqual(merged.messages, [{ role: 'user', content: 'uno\ndos' }]);
  const long = validateRequest({ ...good, messages: [{ role: 'user', content: 'x'.repeat(5000) }] }).value;
  assert.equal(long.messages[0].content.length, 1500);
});

test('origen no permitido y cuerpo inválido', async () => {
  const handler = createHandler({ env: { ANTHROPIC_API_KEY: 'k', ALLOWED_ORIGINS: 'https://citas.panacealogic.dev' }, getClient: async () => fake('{"reply":"ok","actions":[],"handoff":false}') });
  assert.equal((await handler(post(good, { origin: 'https://otro.com' }))).status, 403);
  assert.equal((await handler(post(good, { origin: 'https://citas.panacealogic.dev' }))).status, 200);
  assert.equal((await handler(new Request('http://x/api/chat', { method: 'POST', body: '{no' }))).status, 400);
  assert.equal((await handler(new Request('http://x/api/chat', { method: 'PUT' }))).status, 405);
});

test('el prompt incluye el mismo flujo del guion, la privacidad y las urgencias', () => {
  const s = buildSystem({ clinica: { nombre: 'Clínica Dental Sonrisa' }, giro: 'Odontología' });
  for (const piece of ['Agendar cita / Precios y horarios', 'EXACTAMENTE 3 horarios', 'nunca pidas ni repitas síntomas', 'marcar_urgente', 'handoff', 'ITBMS 7%']) assert.ok(s.includes(piece), piece);
  for (const a of ALLOWED_ACTIONS) assert.ok(s.includes(a), a);
});

test('parseModelReply tolera texto alrededor y rechaza lo inválido', () => {
  assert.equal(parseModelReply('```json\n{"reply":"Hola","actions":[],"handoff":true}\n```').handoff, true);
  assert.equal(parseModelReply('{"reply":"","actions":[]}'), null);
  assert.equal(parseModelReply('{"actions":[]}'), null);
  assert.equal(parseModelReply(null), null);
});
