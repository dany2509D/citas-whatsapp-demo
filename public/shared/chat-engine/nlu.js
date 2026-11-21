// Motor de lenguaje del modo guion: reglas simples que entienden variaciones del texto
// (tildes, mayúsculas, abreviaturas de chat, errores de una letra). No usa IA.
import { addDays, dayOfWeek, mondayOf, pad2 } from '../time/panama.js';

const SLANG = {
  pa: 'para', pq: 'porque', xq: 'porque', q: 'que', k: 'que', tmb: 'tambien', tb: 'tambien',
  xfa: 'por favor', xfavor: 'por favor', pf: 'por favor', pls: 'por favor', ola: 'hola', holi: 'hola',
  holaa: 'hola', buenas: 'buenas', msj: 'mensaje', info: 'informacion', porfa: 'por favor',
};

/** Minúsculas, sin tildes ni signos, con abreviaturas de chat expandidas. */
export function norm(text) {
  let t = String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/\b([ap])\s*\.?\s*m\b\.?/g, '$1m'); // "a. m." -> "am"
  t = t.replace(/[^a-z0-9:.\s]/g, ' ');
  t = t.replace(/\.(?!\d)/g, ' ').replace(/(?<!\d):/g, ' ');
  return t.split(/\s+/).filter(Boolean).map((w) => SLANG[w] ?? w).join(' ');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Prepara un patrón: texto normalizado; "raiz*" significa "empieza con raiz". */
export function compile(p) {
  if (p instanceof RegExp) return p;
  const star = String(p).endsWith('*');
  const base = norm(String(p).replace(/\*$/, ''));
  return star ? `${base}*` : base;
}

/** ¿El texto (ya normalizado) contiene el patrón (ya compilado) como palabra o frase? */
export function has(t, p, fuzzy = true) {
  if (p instanceof RegExp) return p.test(t);
  const padded = ` ${t} `;
  if (p.endsWith('*')) return padded.includes(` ${p.slice(0, -1)}`);
  if (padded.includes(` ${p} `)) return true;
  if (fuzzy && !p.includes(' ') && p.length >= 6) {
    return t.split(' ').some((w) => w.length >= 5 && Math.abs(w.length - p.length) <= 1 && levenshtein(w, p) <= 1);
  }
  return false;
}

export function matchesAny(text, patterns, fuzzy = true) {
  const t = norm(text);
  return patterns.some((p) => has(t, compile(p), fuzzy));
}

// --- Salud y urgencias (CIT-RF-07) ------------------------------------------------------------

/** Frases que NIEGAN un dolor ("ya no tengo dolor", "no me duele mucho", "sin dolor"). Se aplican sobre texto normalizado. */
const NEGATED_PAIN = [
  /\b(?:ya )?no (?:me )?duel(?:e|en)(?: (?:ya|mas|tanto|nada|much\w+))*/g,
  /\b(?:ya )?no (?:tengo|siento|hay|presento|tiene|siente)(?: (?:ya|mas|tanto|nada de|mucho|mucha|ningun|ninguna|un|el|nada))* (?:dolor|molestia)(?:es)?(?: (?:fuerte|intenso|insoportable|terrible|mucho))*/g,
  /\bsin (?:ningun )?(?:dolor|molestia)(?:es)?/g,
  /\b(?:se me )?(?:quito|paso|calmo|cedio) (?:ya )?(?:el )?dolor/g,
  /\bno (?:es|fue|era|esta) (?:un )?(?:dolor )?(?:muy )?(?:fuerte|intenso|insoportable|terrible)/g,
];

/** Quita del texto las frases que niegan un dolor, para que "ya no me duele mucho" no cuente como urgencia. */
export function stripNegatedPain(text) {
  let t = norm(text);
  for (const re of NEGATED_PAIN) t = t.replace(re, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Raíces de salud (compiladas con "*" = empieza con). Sirven para no responder "no entendí" ante un mensaje de salud. */
const HEALTH_WORDS = [
  'dolor*', 'duele*', 'duelen', 'molest*', 'sangr*', 'hincha*', 'inflam*', 'fiebre', 'lesion*', 'herid*', 'golpe*', 'infeccion*', 'infectad*',
  'mareo*', 'nausea*', 'vomit*', 'diarrea', 'tos', 'cojea*', 'cojo', 'rasca*', 'picazon', 'alerg*', 'pus', 'absceso', 'sintoma*', 'enferm*',
  'malestar', 'me siento mal', 'se siente mal', 'muela*', 'diente*', 'encia*', 'caries', 'sensibilidad', 'torcedura', 'esguince', 'contractura', 'calambre*', 'adormec*',
  'hormigueo', 'convulsion*', 'respira*', 'caida', 'trago', 'comio', 'envenen*', 'intoxic*',
].map(compile);

/** ¿El mensaje habla de salud (síntomas, lesiones, malestar)? */
export function hasHealthWords(text) {
  const t = stripNegatedPain(text);
  return HEALTH_WORDS.some((p) => has(t, p, false));
}

/** Devuelve el nombre de la primera intención (en orden de prioridad) con algún patrón presente. */
export function matchIntent(text, defs) {
  const t = norm(text);
  for (const [name, patterns] of Object.entries(defs)) {
    if (patterns.some((p) => has(t, compile(p)))) return name;
  }
  return null;
}

const ORD = {
  primero: 1, primera: 1, uno: 1, segundo: 2, segunda: 2, dos: 2, tercero: 3, tercera: 3, tres: 3,
  cuarto: 4, cuarta: 4, cuatro: 4, quinto: 5, quinta: 5, cinco: 5,
};

/** "2", "la segunda", "opción 3", "el último" -> número de opción (1..n) o null. */
export function parseChoice(text, n) {
  const t = norm(text);
  const toks = t.split(' ').filter(Boolean);
  if (!toks.length || toks.length > 6) return null;
  if (/\b(ultimo|ultima)\b/.test(t)) return n;
  for (const k of toks) if (/^\d$/.test(k) && +k >= 1 && +k <= n) return +k;
  for (const k of toks) if (ORD[k] && ORD[k] <= n) return ORD[k];
  return null;
}

const YES = ['si', 'sip', 'sii', 'claro', 'dale', 'ok', 'okay', 'vale', 'confirmo', 'confirmar', 'confirmada', 'correcto', 'exacto',
  'perfecto', 'de acuerdo', 'afirmativo', 'listo', 'bueno', 'esta bien', 'por supuesto', 'seguro', 'yes', 'adelante', 'procede'];
const NO = ['no', 'nop', 'nel', 'negativo', 'nada', 'mejor no', 'todavia no', 'despues', 'luego', 'mas tarde'];

/** Palabras sueltas que, al inicio del mensaje, ya dicen «sí» ("sí, luego paso", "ok, después le aviso"). */
const YES_LEAD = new Set(['si', 'sip', 'sii', 'claro', 'dale', 'ok', 'okay', 'vale', 'confirmo', 'confirmar', 'confirmada', 'correcto', 'exacto',
  'perfecto', 'listo', 'bueno', 'seguro', 'yes', 'adelante', 'procede', 'afirmativo']);
const EMOJI_YES = /👍|👌|✅|☑|✔|🙌|🤝/u;
const EMOJI_NO = /👎|❌|🚫|✖/u;

/** 'si' | 'no' | null */
export function parseYesNo(text) {
  const raw = String(text ?? '');
  const t = norm(raw);
  const toks = t ? t.split(' ') : [];
  // Emojis (norm los borra): 👍 / ✅ / 👌 = sí; 👎 / ❌ = no. Solo si no hay palabras que digan lo contrario.
  if (!toks.includes('no') && EMOJI_YES.test(raw) && !EMOJI_NO.test(raw)) return 'si';
  if (EMOJI_NO.test(raw) && !EMOJI_YES.test(raw) && !YES_LEAD.has(toks[0])) return 'no';
  if (!t) return null;
  if (toks[0] === 'no') return 'no';
  // "Sí, luego paso" / "sí, nada más": empieza con un sí y no niega nada después.
  if (YES_LEAD.has(toks[0]) && !toks.includes('no')) return 'si';
  if (NO.some((p) => has(t, p, false))) return 'no';
  if (YES.some((p) => has(t, p, false))) return 'si';
  return null;
}

/**
 * Extrae un teléfono panameño de 7 u 8 dígitos y lo da con guion ("6000-1003").
 * Acepta el formato que manda WhatsApp, con el código de país pegado ("50761234567", "+50761234567").
 */
export function parsePhone(text) {
  const s = String(text ?? '');
  let m = s.match(/(?<![\d])\+?\s*507[\s.-]?(\d{4})[\s.-]?(\d{4})(?![\d])/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/(?<![\d])\+?\s*507[\s.-]?(\d{3})[\s.-]?(\d{4})(?![\d])/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/(?:\+?\s*507[\s.-]*)?(?<![\d])(\d{4})[\s.-]?(\d{4})(?![\d])/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/(?<![\d])(\d{3})[\s.-]?(\d{4})(?![\d])/);
  return m ? `${m[1]}-${m[2]}` : null;
}
export const phoneDigits = (p) => String(p ?? '').replace(/\D/g, '').replace(/^507(?=\d{7,8}$)/, '');
export const phoneDisplay = (p) => `+507 ${p}`;
/** ¿Es un celular de Panamá (8 dígitos que empiezan con 6)? Solo a un celular se le puede escribir por WhatsApp. */
export const isPanamaMobile = (p) => /^6\d{7}$/.test(phoneDigits(p));
/** Número en formato de WhatsApp (código de país + 8 dígitos, sin signos): "50761234567". null si no es un celular. */
export const toWaId = (p) => (isPanamaMobile(p) ? `507${phoneDigits(p)}` : null);
/** Enlace directo al chat: "https://wa.me/50761234567". null si no es un celular. */
export const waLink = (p) => { const id = toWaId(p); return id ? `https://wa.me/${id}` : null; };
export const MOBILE_HINT = 'Para enviarle el recordatorio por WhatsApp necesito un celular de 8 dígitos que empiece con 6, por ejemplo 6000-1234.';

const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
export function titleCase(s) {
  return String(s).trim().split(/\s+/).map((w, i) => (i > 0 && SMALL.has(w.toLowerCase())
    ? w.toLowerCase()
    : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ');
}

const NOT_NAMES = new Set(['hola', 'si', 'no', 'menu', 'ok', 'gracias', 'cancelar', 'persona', 'ayuda', 'agendar', 'cita', 'buenas', 'buenos dias']);

/** "me llamo ana perez" -> "Ana Pérez" (conserva tildes); null si no parece un nombre. */
export function parseName(text) {
  let s = String(text ?? '').trim().replace(/[.!?¡¿,;]+$/g, '');
  s = s.replace(/^(?:hola[, ]+)?(?:me llamo|mi nombre completo es|mi nombre es|el nombre es|a nombre de|mi nombre|soy|es)\s+/i, '').trim();
  if (s.length < 2 || s.length > 60 || !/^[\p{L}][\p{L}'’.\- ]*$/u.test(s)) return null;
  if (NOT_NAMES.has(norm(s)) || (s.match(/\p{L}/gu) || []).length < 2) return null;
  return titleCase(s);
}

/** Palabras que nunca forman parte de un nombre: cortan la frase ("soy Carlos y quiero…" -> "Carlos"). */
const NAME_STOP = new Set(['y', 'e', 'o', 'u', 'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'que', 'quiero', 'queria', 'quisiera', 'necesito', 'deseo',
  'busco', 'para', 'por', 'con', 'a', 'al', 'en', 'mi', 'me', 'tengo', 'paciente', 'pacientes', 'nuevo', 'nueva', 'cliente', 'clienta', 'quien', 'yo',
  'manana', 'hoy', 'cita', 'hola', 'buenas', 'gracias', 'agendar', 'reservar', 'pero', 'porque', 'si', 'no', 'ya', 'aqui', 'su', 'sus', 'tu', 'muy']);

/**
 * Nombre dicho dentro de una frase más larga: "Hola, quiero cita mañana, soy Carlos" -> "Carlos".
 * Con "me llamo" / "mi nombre es" basta; con "soy" se exige mayúscula inicial ("soy nuevo" no es un nombre).
 * Devuelve null si no hay un nombre claro (en ese caso el bot lo pregunta).
 */
export function extractName(text) {
  const s = String(text ?? '');
  const m = s.match(/(?:^|[\s,.;:!¡¿])(me llamo|mi nombre es|soy)\s+([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,3})/iu);
  if (!m) return null;
  const strong = !/^soy$/i.test(m[1]);
  const words = [];
  for (const w of m[2].split(/\s+/)) {
    if (NAME_STOP.has(norm(w)) || w.length < 2) break;
    if (!strong && !/^\p{Lu}/u.test(w)) break;
    words.push(w);
  }
  if (!words.length || words.length > 4) return null;
  return parseName(words.join(' '));
}

/** Hora de reloj dicha en el texto -> 'HH:mm' o null. Sin indicación, 1 a 6 se toma como tarde. */
export function parseClock(text) {
  const t = norm(text);
  let h; let min = 0; let suf = null; let m;
  const plus = (x) => (x === 'media' ? 30 : x === 'cuarto' ? 15 : x ? +x : 0); // "y media", "y cuarto", "y 30"
  if (/\bmedio ?dia\b/.test(t)) return '12:00';
  if ((m = t.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/))) { h = +m[1]; min = +m[2]; suf = m[3]; }
  else if ((m = t.match(/\b(?:a )?las? (\d{1,2})(?: y (media|cuarto|\d{1,2}))?(?:\s*(am|pm))?\b/))) { h = +m[1]; min = plus(m[2]); suf = m[3]; }
  else if ((m = t.match(/\b(\d{1,2})(?: y (media|cuarto|\d{1,2}))?\s*(am|pm)\b/))) { h = +m[1]; min = plus(m[2]); suf = m[3]; }
  else if ((m = t.match(/\b(\d{1,2}) y (media|cuarto)\b/))) { h = +m[1]; min = plus(m[2]); }
  else return null;
  if (h > 23 || min > 59) return null;
  if (!suf) suf = /\bde la (tarde|noche)\b/.test(t) ? 'pm' : /\bde la manana\b/.test(t) ? 'am' : null;
  if (suf === 'pm' && h < 12) h += 12;
  if (suf === 'am' && h === 12) h = 0;
  if (!suf && h >= 1 && h <= 6) h += 12;
  return `${pad2(h)}:${pad2(min)}`;
}

/** ¿El texto menciona claramente una hora ("10:30", "3 pm", "a las 10")? Evita confundir "la 2" con las 2. */
export function hasClockMention(text) {
  const t = norm(text);
  return /\d{1,2}[:.]\d{2}/.test(t) || /\b\d{1,2}\s*(am|pm)\b/.test(t) || /\blas \d{1,2}\b/.test(t)
    || /\b\d{1,2} y (media|cuarto)\b/.test(t) || /\bmedio ?dia\b/.test(t);
}

const WEEKDAYS = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 0 };
const MONTH_NUM = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const NUM_WORDS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };

/** 'YYYY-MM-DD' de un día y mes; si esa fecha ya pasó este año, la del año siguiente. null si la fecha no existe. */
function dateOf(today, day, month) {
  const y = +today.slice(0, 4);
  for (const year of [y, y + 1]) {
    const key = `${year}-${pad2(month)}-${pad2(day)}`;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1) return null; // 31 de noviembre, 30 de febrero…
    if (key >= today) return key;
  }
  return null;
}
/** Día N del mes en curso; si ya pasó, el del mes siguiente. */
function dayOfMonth(today, day) {
  if (day < 1 || day > 31) return null;
  const y = +today.slice(0, 4); const mo = +today.slice(5, 7);
  for (let i = 0; i < 3; i++) {
    const month = ((mo - 1 + i) % 12) + 1; const year = y + Math.floor((mo - 1 + i) / 12);
    const d = new Date(Date.UTC(year, month - 1, day));
    const key = `${year}-${pad2(month)}-${pad2(day)}`;
    if (d.getUTCMonth() === month - 1 && key >= today) return key;
  }
  return null;
}

/**
 * Día que la persona pide -> 'YYYY-MM-DD' o null. Entiende: "hoy", "mañana", "pasado mañana", "el viernes", "el lunes 16",
 * "el 25" / "para el día 25", "25 de noviembre", "25/11", "en 3 días" / "dentro de dos días".
 * "el 2" a secas (dos palabras) no cuenta: suele ser una opción de una lista.
 */
export function parseDayPref(text, today) {
  const raw = String(text ?? '');
  const t = norm(raw);
  let m;
  if ((m = t.match(/\b(\d{1,2}) (?:de )?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/))) return dateOf(today, +m[1], MONTH_NUM[m[2]]);
  if ((m = raw.match(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/))) return +m[2] >= 1 && +m[2] <= 12 ? dateOf(today, +m[1], +m[2]) : null;
  if ((m = t.match(/\b(?:en|dentro de) (\d{1,2}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez) dias?\b/))) {
    const n = NUM_WORDS[m[1]] ?? +m[1];
    return n >= 1 && n <= 30 ? addDays(today, n) : null;
  }
  if ((m = t.match(/\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo) (\d{1,2})\b(?![:.]\d)(?! ?(?:am|pm))/))) return dayOfMonth(today, +m[1]);
  const elDia = t.match(/\b(?:el dia|dia|el) (\d{1,2})\b(?![:.]\d)(?! ?(?:am|pm|de la|y media|y cuarto))/);
  if (elDia && (/\bdia\b/.test(t) || t.split(' ').length > 2)) return dayOfMonth(today, +elDia[1]);
  if (/\bpasado manana\b/.test(t)) return addDays(today, 2);
  if (/\bhoy\b/.test(t)) return today;
  const withoutMorning = t.replace(/\b(en|por|de|a|durante|para) la manana\b/g, ' ');
  if (/\bmanana\b/.test(withoutMorning)) return addDays(today, 1);
  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      let key = addDays(today, 1);
      for (let i = 0; i < 7; i++, key = addDays(key, 1)) if (dayOfWeek(key) === dow) return key;
    }
  }
  return null;
}

/** "la próxima semana" / "la semana que viene" / "la otra semana" -> lunes de la semana siguiente ('YYYY-MM-DD') o null. */
export function parsePrefsWeek(text, today) {
  const t = norm(text);
  if (/\b(?:proxima semana|semana que viene|semana entrante|otra semana|siguiente semana|semana siguiente)\b/.test(t)) return addDays(mondayOf(today), 7);
  return null;
}

/** 'manana' | 'tarde' | 'noche' | null (parte del día que prefiere). */
export function parseTimeOfDay(text) {
  const t = norm(text);
  if (/\b(en|por|de|a|durante|para) la manana\b/.test(t) || /\btemprano\b/.test(t)) return 'manana';
  if (/\b(en|por|de|a|durante|para) la tarde\b/.test(t) || /\bpor la tarde\b/.test(t)) return 'tarde';
  if (/\b(en|por|de|a|durante|para) la noche\b/.test(t)) return 'noche';
  return null;
}

/** Edad de mascota: "3", "3 años", "8 meses" -> "3 años" / "8 meses"; null si no se entiende. */
export function parseAge(text) {
  const t = norm(text);
  const m = t.match(/\b(\d{1,2})\s*(anos?|meses|mes|semanas?)?\b/);
  if (!m) return null;
  const n = +m[1];
  if (n < 1 || n > 40) return null;
  const unit = m[2] || 'anos';
  if (unit.startsWith('mes')) return `${n} ${n === 1 ? 'mes' : 'meses'}`;
  if (unit.startsWith('sem')) return `${n} ${n === 1 ? 'semana' : 'semanas'}`;
  return `${n} ${n === 1 ? 'año' : 'años'}`;
}
