// Controlador del chat de la demo: recibe lo que escribe la persona, decide si responde el guion
// o la IA real (con respaldo automático al guion), aplica los cambios en los datos al instante
// (para que el panel "En vivo" los muestre antes de que el bot termine de escribir) y simula
// el ritmo de WhatsApp (entregado, leído, "escribiendo…").
import { epochNow, nowStamp, now, todayKey, addDays } from '../shared/time/panama.js';
import { AIUnavailable, pingAI } from '../shared/chat-engine/ai-adapter.js';
import { phoneDigits } from '../shared/chat-engine/nlu.js';
import { UPCOMING, getAppt, getPatient, newId, upcomingForPhone } from './agenda.js';
import { HUMAN_CHIP, chatIdentity, isUrgent, respond, startFollowup, startReminder, wantsHuman } from './bot.js';
import { REDACTED_TEXT, looksClinical } from './privacy.js';
import { computeFollowups } from './followups.js';
import { aiTurn } from './ai.js';

const MAX_FILE = 5 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createController({ store, notify = () => {}, ai = { ping: pingAI, turn: aiTurn } }) {
  let queue = Promise.resolve();
  let typing = false;
  let aiFailures = 0;
  let sessionId = newId('s');
  const typingListeners = new Set();

  const ctl = {
    /** 0 = sin pausas (pruebas y repeticiones de la presentación); 1 = ritmo normal. */
    speed: 1,
    get typing() { return typing; },
    onTyping(fn) { typingListeners.add(fn); return () => typingListeners.delete(fn); },
  };

  const wait = (ms) => (ctl.speed === 0 ? Promise.resolve() : sleep(ms * ctl.speed));
  const setTyping = (on) => { typing = on; typingListeners.forEach((fn) => fn(on)); };
  const ctx = () => ({ now: now(), profile: store.profile(), log: (kind, text, apptId) => store.logEvent(kind, text, apptId) });
  const msgId = () => newId('m');
  const afterEffects = (touched = []) => store.commit({ type: 'change', touched: touched.filter((t) => t !== 'conv') });

  function pushSystem(conv, text) {
    conv.messages.push({ id: msgId(), from: 'system', text, ts: epochNow() });
    store.commit({ type: 'conv', id: 'live' });
  }

  async function deliver(conv, out) {
    for (const o of out) {
      setTyping(true);
      await wait(Math.min(1400, 450 + o.text.length * 7));
      setTyping(false);
      conv.messages.push({ id: msgId(), from: 'bot', text: o.text, ts: epochNow() });
      conv.chips = o.chips || [];
      conv.lastTs = epochNow();
      store.commit({ type: 'conv', id: 'live' });
    }
  }

  async function turn(text) {
    const c = store.clinic(); const conv = store.live(); const profile = store.profile();
    const urgent = isUrgent(c, text);
    const clinical = urgent || looksClinical(text);
    const msg = { id: msgId(), from: 'user', text: clinical ? REDACTED_TEXT : text, ts: epochNow(), status: 'sent' };
    if (clinical) msg._raw = text; // solo en memoria: no se guarda
    conv.messages.push(msg); conv.chips = []; conv.lastTs = msg.ts; conv.resolved = false;
    store.commit({ type: 'conv', id: 'live' });
    await wait(300);
    msg.status = 'delivered'; store.commit({ type: 'conv', id: 'live' });

    let result = null; let fellBack = false;
    const scriptOnly = urgent || wantsHuman(text) || conv.mode === 'humano';
    if (store.state.aiMode === 'ia' && !scriptOnly) {
      try { result = await ai.turn({ c, conv, profile, ctx: ctx(), sessionId }); aiFailures = 0; }
      catch (e) {
        if (!(e instanceof AIUnavailable)) console.error(e);
        aiFailures += 1; fellBack = true;
        if (aiFailures >= 2) { store.setAiMode('guion'); notify('La IA real no responde: la demo volvió al modo guion.', 'warn'); }
      }
    }
    if (!result) {
      if (fellBack) { conv.script = { step: 'menu', data: {}, misses: 0 }; conv.messages.push({ id: msgId(), from: 'system', text: 'La IA real no respondió: esta respuesta viene del modo guion.', ts: epochNow() }); }
      result = respond(c, conv, text, ctx());
    }
    afterEffects(result.touched);
    msg.status = 'read'; store.commit({ type: 'conv', id: 'live' });
    await deliver(conv, result.out);
  }

  /** La persona escribe en el teléfono. Se atiende de a un mensaje a la vez. */
  ctl.sendUser = (text, { speed } = {}) => {
    const clean = String(text ?? '').trim().slice(0, 400);
    if (!clean) return Promise.resolve();
    queue = queue.then(async () => { const prev = ctl.speed; if (speed != null) ctl.speed = speed; try { await turn(clean); } finally { ctl.speed = prev; } }).catch((e) => console.error(e));
    return queue;
  };

  ctl.requestHandoff = () => ctl.sendUser('Quiero hablar con una persona');
  /** Se resuelve cuando el bot terminó de responder todo lo pendiente. */
  ctl.idle = () => queue;

  ctl.sendAttachment = (file) => {
    queue = queue.then(async () => {
      const conv = store.live();
      const kind = file.type === 'application/pdf' ? 'pdf' : file.type.startsWith('image/') ? 'image' : null;
      const ok = kind && file.size <= MAX_FILE;
      conv.messages.push({ id: msgId(), from: 'user', text: '', attachment: { name: String(file.name).slice(0, 60), kind: kind || 'image', size: file.size }, ts: epochNow(), status: 'sent' });
      conv.chips = []; conv.lastTs = epochNow();
      store.commit({ type: 'conv', id: 'live' });
      await wait(300);
      const out = ok
        ? [{ text: 'Recibí su archivo 📎. Por privacidad no guardamos imágenes ni documentos clínicos en este canal: solo necesitamos su nombre, teléfono, servicio y hora. ¿Desea que una persona del equipo lo revise?', chips: [HUMAN_CHIP, { label: 'Menú', text: 'menú' }] }]
        : [{ text: 'Solo puedo recibir imágenes o PDF de hasta 5 MB.' }];
      await deliver(conv, out);
    }).catch((e) => console.error(e));
    return queue;
  };

  /** El bot escribe primero (recordatorio / seguimiento). */
  function botFirst(make, pill) {
    queue = queue.then(async () => {
      const conv = store.live();
      if (pill) pushSystem(conv, pill);
      const result = make(conv);
      if (!result) return;
      afterEffects(result.touched);
      await deliver(result.conv || conv, result.out);
    }).catch((e) => console.error(e));
    return queue;
  }

  /** "Simular día anterior": recordatorio a la cita de la persona y a las demás citas de mañana. */
  ctl.simulateDayBefore = ({ apptId = null } = {}) => botFirst((conv) => {
    const c = store.clinic();
    const nowS = nowStamp();
    let target = apptId ? getAppt(c, apptId) : upcomingForPhone(c, chatIdentity(conv, store.profile()).phone, nowS)[0];
    let pill = 'Recordatorio automático · día anterior a la cita';
    if (!target || !UPCOMING.has(target.status)) {
      target = c.appointments.filter((a) => a.status === 'pendiente' && a.start >= nowS).sort((a, b) => (a.start < b.start ? -1 : 1))[0]
        || c.appointments.filter((a) => UPCOMING.has(a.status) && a.start >= nowS)[0];
      if (!target) { pushSystem(conv, 'No hay citas próximas para recordar. Agende una cita en el chat y vuelva a simular el día anterior.'); return null; }
      pill = `Demo: no hay una cita de esta persona; se usa la de ${target.name} para mostrar el recordatorio`;
    } else if (apptId) pill = `Demo: recordatorio automático para la cita de ${target.name}`;
    pushSystem(conv, pill);
    const tomorrow = addDays(todayKey(), 1);
    const others = c.appointments.filter((a) => a.id !== target.id && UPCOMING.has(a.status) && a.start.slice(0, 10) === tomorrow && (a.reminder || 'programado') === 'programado');
    others.forEach((a) => { a.reminder = 'enviado'; });
    if (others.length) store.logEvent('recordatorio', `Recordatorios del día anterior enviados a ${others.length} ${others.length === 1 ? 'cita' : 'citas'} de mañana`);
    return startReminder(c, conv, target.id, ctx());
  });

  /** "Simular seguimiento": aviso por giro (vacuna 12 meses / 2 sesiones / limpieza 6 meses). */
  ctl.simulateFollowup = ({ patientId = null } = {}) => botFirst((conv) => {
    const c = store.clinic();
    const items = computeFollowups(c, store.state.giro, todayKey());
    const pending = (i) => i.state === 'por_enviar' || i.state === 'programado';
    const mine = phoneDigits(chatIdentity(conv, store.profile()).phone);
    const own = items.find((i) => pending(i) && phoneDigits(getPatient(c, i.patientId)?.phone) === mine); // el aviso de quien está probando
    const item = patientId ? items.find((i) => i.patientId === patientId) : (own || items.find((i) => i.state === 'por_enviar') || items.find(pending));
    if (!item) { pushSystem(conv, 'No hay seguimientos pendientes en este momento.'); return null; }
    // Un aviso va al chat de SU destinatario: si es otra persona, el chat actual se guarda en la bandeja y se abre el de ella
    // (nunca llega a un chat el mensaje dirigido a otro paciente).
    const who = getPatient(c, item.patientId);
    let target = conv;
    if (phoneDigits(who?.phone) !== mine) {
      if (conv.messages.length) { store.newChat(); target = store.live(); }
      pushSystem(target, `Seguimiento automático para ${who.name} · ${store.profile().followupRule}. Se abrió su chat; el anterior quedó guardado en la bandeja del panel.`);
    } else pushSystem(target, `Seguimiento automático · ${store.profile().followupRule}`);
    const r = startFollowup(c, target, item.patientId, ctx());
    return r ? { ...r, conv: target } : null;
  });

  ctl.newChat = () => { store.newChat(); aiFailures = 0; sessionId = newId('s'); };

  ctl.setAiMode = async (mode) => {
    if (mode !== 'ia') { store.setAiMode('guion'); aiFailures = 0; resetScript(); return { ok: true }; }
    const r = await ai.ping();
    if (!r.ok) { store.setAiMode('guion'); return { ok: false, reason: r.reason }; }
    aiFailures = 0; resetScript(); store.setAiMode('ia');
    return { ok: true, model: r.model };
  };
  function resetScript() { const v = store.live(); v.script = { step: 'menu', data: {}, misses: 0 }; store.save(); }

  // --- Acciones del panel sobre las conversaciones ---
  const findConv = (id) => store.clinic().conversations.find((v) => v.id === id);
  ctl.staffReply = (id, text) => {
    const conv = findConv(id); const clean = String(text || '').trim().slice(0, 500);
    if (!conv || !clean) return false;
    conv.messages.push({ id: msgId(), from: 'staff', text: clean, ts: epochNow() });
    conv.lastTs = epochNow(); conv.unread = 0; conv.flags.handoff = true;
    store.logEvent('humano', `El equipo respondió a ${conv.name || 'la conversación'}`);
    store.commit({ type: 'change', touched: [] });
    return true;
  };
  ctl.resolveConv = (id) => {
    const conv = findConv(id); if (!conv) return;
    conv.resolved = true; conv.flags.urgent = false; conv.unread = 0;
    store.commit({ type: 'change', touched: [] });
  };
  ctl.returnToBot = (id) => {
    const conv = findConv(id); if (!conv) return;
    conv.mode = 'bot'; conv.script = { step: 'menu', data: {}, misses: 0 };
    store.commit({ type: 'change', touched: [] });
  };

  ctl.patient = (id) => getPatient(store.clinic(), id);
  return ctl;
}
