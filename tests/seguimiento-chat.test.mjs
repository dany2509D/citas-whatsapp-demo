// CIT-RF-17: «Simular seguimiento» nunca mete en un chat el mensaje de otra persona.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixClock } from './helpers.mjs';
import { createStore } from '../public/app/state.js';
import { createStorage } from '../public/shared/storage/storage.js';
import { createController } from '../public/app/controller.js';
import { chatIdentity } from '../public/app/bot.js';
import { phoneDigits } from '../public/shared/chat-engine/nlu.js';

const backend = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
function setup(giro) {
  fixClock();
  const b = backend();
  const store = createStore({ storage: createStorage('t', () => b) });
  store.init();
  if (giro) store.setGiro(giro);
  const ctl = createController({ store, notify: () => {} });
  ctl.speed = 0;
  return { store, ctl };
}
const firstNames = (store) => new Set(store.clinic().patients.map((p) => p.name.split(' ')[0]));

for (const giro of ['fisio', 'dental', 'vet']) {
  test(`seguimiento (${giro}): con alguien probando en el chat, el aviso va al chat de su destinataria y el chat anterior queda guardado`, async () => {
    const { store, ctl } = setup(giro);
    await ctl.sendUser('Hola');                       // quien prueba ya escribió
    const before = store.live().id;
    const myPhone = phoneDigits(chatIdentity(store.live(), store.profile()).phone);
    await ctl.simulateFollowup();
    const live = store.live();
    const bot = live.messages.filter((m) => m.from === 'bot').map((m) => m.text);
    assert.ok(bot.some((t) => /^Hola /.test(t)), 'llegó el aviso');
    // El chat donde llegó el aviso es el de la destinataria: su nombre y su teléfono, no los de quien probaba
    const who = store.clinic().patients.find((p) => phoneDigits(p.phone) === phoneDigits(live.phone));
    assert.ok(who, 'el chat tiene la identidad de una paciente real');
    assert.notEqual(phoneDigits(live.phone), myPhone);
    assert.ok(bot.some((t) => t.includes(who.name.split(' ')[0])), 'el saludo nombra a la dueña del chat');
    for (const t of bot) for (const n of firstNames(store)) if (n !== who.name.split(' ')[0]) assert.ok(!new RegExp(`^Hola ${n}\\b`).test(t), `no saluda a «${n}» en el chat de ${who.name}`);
    // El chat anterior se conserva en la bandeja con lo que se había escrito
    const old = store.clinic().conversations.find((v) => v.id !== 'live' && v.messages.some((m) => m.from === 'user' && m.text === 'Hola'));
    assert.ok(old, 'el chat anterior quedó guardado');
    assert.notEqual(live.id, before === 'live' ? null : before);
  });

  test(`seguimiento (${giro}): con el chat vacío no se archiva nada y se usa ese mismo chat`, async () => {
    const { store, ctl } = setup(giro);
    const n = store.clinic().conversations.length;
    await ctl.simulateFollowup();
    assert.equal(store.clinic().conversations.length, n, 'no se crea otro chat');
    assert.ok(store.live().messages.some((m) => m.from === 'bot' && /^Hola /.test(m.text)));
  });
}

test('seguimiento: si quien prueba es la destinataria, el aviso llega a su propio chat sin cambiarlo', async () => {
  const { store, ctl } = setup('fisio');
  const item = store.clinic().patients.find((p) => p.package);
  const live = store.live();
  live.name = item.name; live.phone = item.phone; live.patientId = item.id; live.messages.push({ id: 'm0', from: 'user', text: 'Hola', ts: Date.now() });
  const id = live.id;
  await ctl.simulateFollowup({ patientId: item.id });
  assert.equal(store.live().id, id, 'sigue siendo el mismo chat');
  assert.equal(store.live().phone, item.phone);
});
