// Adaptador al modo "IA real": llama a /api/chat (función serverless con la clave en una
// variable de entorno; la clave nunca llega al navegador). Si /api/chat no existe, tarda
// demasiado o devuelve algo inesperado, lanza AIUnavailable y quien llama vuelve al guion.

export class AIUnavailable extends Error {
  constructor(reason) { super(reason); this.name = 'AIUnavailable'; this.reason = reason; }
}

export const DEFAULT_ENDPOINT = '/api/chat';

async function timedFetch(url, init, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); }
  catch (e) { throw new AIUnavailable(e?.name === 'AbortError' ? 'tiempo agotado' : 'sin conexión con /api/chat'); }
  finally { clearTimeout(timer); }
}

/** ¿Responde /api/chat y tiene clave configurada? (GET /api/chat -> { ok: true }) */
export async function pingAI(endpoint = DEFAULT_ENDPOINT, ms = 4000) {
  try {
    const res = await timedFetch(endpoint, { method: 'GET', headers: { accept: 'application/json' } }, ms);
    if (!res.ok) return { ok: false, reason: res.status === 404 ? 'no existe /api/chat' : `estado ${res.status}` };
    const data = await res.json().catch(() => null);
    return data?.ok ? { ok: true, model: data.model } : { ok: false, reason: data?.reason || 'IA no configurada' };
  } catch (e) { return { ok: false, reason: e.reason || 'sin respuesta' }; }
}

/**
 * Pide una respuesta. Contrato (ver README):
 *   petición  { demo, sessionId, messages:[{role,content}], context }
 *   respuesta { reply, actions:[{type,payload}], handoff }
 */
export async function askAI({ endpoint = DEFAULT_ENDPOINT, demo, sessionId, messages, context, ms = 25000 }) {
  const res = await timedFetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ demo, sessionId, messages, context }),
  }, ms);
  if (!res.ok) throw new AIUnavailable(`estado ${res.status}`);
  let data;
  try { data = await res.json(); } catch { throw new AIUnavailable('respuesta no válida'); }
  if (!data || typeof data.reply !== 'string' || !data.reply.trim()) throw new AIUnavailable('respuesta vacía');
  return {
    reply: data.reply.slice(0, 1500),
    actions: Array.isArray(data.actions)
      ? data.actions.filter((a) => a && typeof a.type === 'string').slice(0, 6).map((a) => ({ type: a.type, payload: a.payload && typeof a.payload === 'object' ? a.payload : {} }))
      : [],
    handoff: data.handoff === true,
  };
}
