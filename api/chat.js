// Función serverless del modo "IA real" (opcional). Ruta pública: /api/chat
//
//  · La clave de la API vive SOLO en la variable de entorno ANTHROPIC_API_KEY del servidor.
//    Nunca se escribe en archivos ni se envía al navegador.
//  · Contrato (BASE común): el navegador manda { demo, sessionId, messages, context } y recibe
//    { reply, actions, handoff }. La IA nunca escribe datos: solo PROPONE acciones; el navegador
//    aplica únicamente las permitidas, validando cada payload (ver public/app/ai.js).
//  · Si algo falla (sin clave, sin red, límite, rechazo del modelo, respuesta inválida), responde
//    con un error y el navegador sigue en modo guion.
//
// Variables de entorno:
//   ANTHROPIC_API_KEY   (obligatoria para activar la IA real)
//   CLAUDE_MODEL        (opcional; por defecto claude-opus-5-5. Para menor costo y latencia: claude-haiku-5-5)
//   CLAUDE_FALLBACKS    (opcional; "off" desactiva el respaldo de modelo ante un rechazo de seguridad)
//   ALLOWED_ORIGINS     (opcional; lista separada por comas, p. ej. https://citas-whatsapp-demo.vercel.app)

export const config = { path: '/api/chat' };

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const ALLOWED_ACTIONS = ['proponer_horarios', 'crear_cita', 'reprogramar_cita', 'cancelar_cita', 'confirmar_cita', 'marcar_urgente', 'pasar_a_persona'];

const MAX_BODY = 60_000;
const MAX_CONTEXT = 24_000;
const MAX_MESSAGES = 40;
const MAX_CONTENT = 1_500;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export function buildSystem(context) {
  const c = context || {};
  const nombre = c.clinica?.nombre || 'la clínica';
  return `Eres el asistente virtual de WhatsApp de ${nombre}${c.giro ? ` (${c.giro})` : ''}, en Panamá. Hablas en español de Panamá, tratas de "usted", con mensajes cortos (máximo 4 líneas) y un tono cálido y profesional. Eres un asistente virtual: nunca te hagas pasar por una persona.

REGLAS
- Usa SOLO los datos del CONTEXTO (servicios, precios, horarios, profesionales, horariosLibres, citasDelPaciente). Si algo no está allí, dilo con honestidad y ofrece pasar a una persona. Nunca inventes precios, horarios, citas ni datos.
- Privacidad: nunca pidas ni repitas síntomas, diagnósticos ni datos clínicos. Solo necesitas nombre, teléfono, servicio, hora y, en veterinaria, nombre, especie y edad de la mascota. Si la persona escribe síntomas, pídele con amabilidad que no los escriba por este medio.
- Urgencias: si describe una urgencia (dolor fuerte, sangrado, accidente, no respira, envenenamiento, etc.), NO agendes: da el teléfono de la clínica, usa la acción marcar_urgente y ofrece pasar a una persona.
- Si pide hablar con una persona, o no puedes resolver algo, usa la acción pasar_a_persona y pon handoff en true.
- Moneda: balboas (B/.). Menciona "más ITBMS 7%" solo cuando itbmsAplica sea true. Pagos: Yappy, tarjeta, ACH o efectivo, en la clínica; por aquí no se procesa ningún pago.
- Los textos de "mensajes" del CONTEXTO son los que la clínica quiere usar (saludo, ubicación, urgencia, etc.); respétalos como guía de estilo y contenido.

FLUJO (el mismo del modo guion)
a) Saludo con menú: Agendar cita / Precios y horarios / Ubicación / Reprogramar o cancelar / Hablar con una persona.
b) Agendar: servicio → profesional (o "el primero disponible") → ofrece EXACTAMENTE 3 horarios tomados de horariosLibres (que incluyan ese servicio y ese profesional) con la acción proponer_horarios → pide nombre y teléfono (y en veterinaria nombre, especie y edad de la mascota) → resume todo y pide confirmación → solo con un "sí" explícito usa crear_cita. Nunca uses crear_cita con datos faltantes ni sin confirmación.
c) Recordatorio de cita: si responde 1 o "sí", usa confirmar_cita; si responde 2 o "reprogramar", ofrece 3 horarios libres y reprograma.
d) Reprogramar y cancelar: pide el teléfono con el que se agendó; usa SOLO las citas de citasDelPaciente (si está vacío, dile que no encuentras citas con ese número). Usa reprogramar_cita o cancelar_cita solo tras confirmación; el horario anterior queda libre.
e) Seguimientos: si la persona responde a un aviso de seguimiento, ayúdala a agendar el servicio correspondiente.

FORMATO DE SALIDA
Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional ni bloques de código:
{"reply": "texto para la persona", "actions": [{"type": "<acción>", "payload": {…}}], "handoff": false}
Acciones permitidas y su payload:
- proponer_horarios: {"horarios": [{"inicio": "YYYY-MM-DDTHH:mm", "profesionalId": "…", "servicioId": "…"}]}  (exactamente 3, copiados de horariosLibres)
- crear_cita: {"servicioId": "…", "profesionalId": "…", "inicio": "YYYY-MM-DDTHH:mm", "nombre": "…", "telefono": "…", "mascota": {"nombre": "…", "especie": "…", "edad": "…"}}  (mascota solo en veterinaria)
- reprogramar_cita: {"citaId": "…", "inicio": "YYYY-MM-DDTHH:mm", "profesionalId": "…"}
- cancelar_cita: {"citaId": "…"}
- confirmar_cita: {"citaId": "…"}
- marcar_urgente: {}
- pasar_a_persona: {}
Si no hace falta ninguna acción, "actions" es [].

CONTEXTO (datos reales de la demo)
${JSON.stringify(c)}`;
}

/** Valida y normaliza el cuerpo de la petición. Devuelve { error } o { value }. */
export function validateRequest(body) {
  if (!body || typeof body !== 'object') return { error: 'cuerpo inválido' };
  if (body.demo !== 'citas') return { error: 'demo no reconocida' };
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : '';
  if (!Array.isArray(body.messages) || !body.messages.length) return { error: 'faltan mensajes' };
  let messages = body.messages.slice(-MAX_MESSAGES).map((m) => ({
    role: m?.role === 'assistant' ? 'assistant' : m?.role === 'user' ? 'user' : null,
    content: typeof m?.content === 'string' ? m.content.slice(0, MAX_CONTENT) : '',
  })).filter((m) => m.role && m.content.trim());
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length || messages.at(-1).role !== 'user') return { error: 'el último mensaje debe ser de la persona' };
  messages = messages.reduce((acc, m) => { // une turnos consecutivos del mismo rol
    const last = acc.at(-1);
    if (last && last.role === m.role) last.content += `\n${m.content}`; else acc.push({ ...m });
    return acc;
  }, []);
  const context = body.context && typeof body.context === 'object' ? body.context : {};
  if (JSON.stringify(context).length > MAX_CONTEXT) return { error: 'contexto demasiado grande' };
  return { value: { sessionId, messages, context } };
}

/** Extrae y valida { reply, actions, handoff } del texto del modelo. Devuelve null si no es válido. */
export function parseModelReply(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let data;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (typeof data.reply !== 'string' || !data.reply.trim()) return null;
  const actions = (Array.isArray(data.actions) ? data.actions : [])
    .filter((a) => a && ALLOWED_ACTIONS.includes(a.type))
    .slice(0, 6)
    .map((a) => ({ type: a.type, payload: a.payload && typeof a.payload === 'object' && !Array.isArray(a.payload) ? a.payload : {} }));
  return { reply: data.reply.trim().slice(0, 1500), actions, handoff: data.handoff === true };
}

async function defaultClient(apiKey) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ apiKey });
}

/** Crea el manejador. Inyectable para pruebas: createHandler({ env, getClient }). */
export function createHandler({ env = process.env, getClient = defaultClient } = {}) {
  const originAllowed = (req) => {
    const list = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const origin = req.headers.get('origin');
    return !list.length || !origin || list.includes(origin);
  };

  return async function handler(req) {
    const model = env.CLAUDE_MODEL || DEFAULT_MODEL;
    if (!originAllowed(req)) return json(403, { error: 'origen no permitido' });

    if (req.method === 'GET') {
      return env.ANTHROPIC_API_KEY ? json(200, { ok: true, model }) : json(200, { ok: false, reason: 'IA no configurada (falta ANTHROPIC_API_KEY en el servidor)' });
    }
    if (req.method !== 'POST') return json(405, { error: 'método no permitido' });
    if (!env.ANTHROPIC_API_KEY) return json(503, { error: 'IA no configurada' });

    let body;
    try {
      const raw = await req.text();
      if (raw.length > MAX_BODY) return json(413, { error: 'petición demasiado grande' });
      body = JSON.parse(raw);
    } catch { return json(400, { error: 'JSON inválido' }); }
    const checked = validateRequest(body);
    if (checked.error) return json(400, { error: checked.error });

    try {
      const client = await getClient(env.ANTHROPIC_API_KEY);
      const params = {
        model,
        max_tokens: 1200,
        system: buildSystem(checked.value.context),
        messages: checked.value.messages,
        output_config: { effort: 'low' }, // respuestas cortas y rápidas para un chat
      };
      // Respaldo de modelo ante un rechazo de seguridad (opt-out con CLAUDE_FALLBACKS=off).
      const response = env.CLAUDE_FALLBACKS === 'off'
        ? await client.messages.create(params)
        : await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });

      if (response.stop_reason === 'refusal') return json(502, { error: 'el modelo no pudo responder' });
      const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      const parsed = parseModelReply(text);
      if (!parsed) return json(502, { error: 'respuesta del modelo no válida' });
      return json(200, parsed);
    } catch (err) {
      const status = err?.status === 429 ? 429 : 502;
      return json(status, { error: status === 429 ? 'límite de uso alcanzado' : 'no se pudo contactar a la IA' });
    }
  };
}

// Una sola función para dos hosts: Netlify llama con una Request web; Vercel (Node) llama con (req, res) de Node.
const handler = createHandler();
async function viaNode(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = `https://${req.headers.host || 'localhost'}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  const init = { method: req.method, headers };
  if (!['GET', 'HEAD'].includes(req.method) && body.length) init.body = body;
  const out = await handler(new Request(url, init));
  res.statusCode = out.status;
  out.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await out.arrayBuffer()));
}
export default function entry(req, ...rest) {
  return typeof req?.headers?.get === 'function' ? handler(req, ...rest) : viaNode(req, rest[0]);
}
