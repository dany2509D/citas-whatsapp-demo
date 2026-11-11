// Motor de lenguaje del modo guion: reglas simples que entienden variaciones del texto
// (tildes, mayúsculas, abreviaturas de chat, errores de una letra). No usa IA.
import { addDays, dayOfWeek, pad2 } from '../time/panama.js';

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

/** 'si' | 'no' | null */
export function parseYesNo(text) {
  const t = norm(text);
  if (!t) return null;
  const toks = t.split(' ');
  if (toks[0] === 'no' || NO.some((p) => has(t, p, false))) return 'no';
  if (YES.some((p) => has(t, p, false))) return 'si';
  return null;
}

/** Extrae un teléfono panameño de 7 u 8 dígitos y lo da con guion ("6000-1003"). */
export function parsePhone(text) {
  const s = String(text ?? '');
  let m = s.match(/(?:\+?\s*507[\s.-]*)?(?<![\d])(\d{4})[\s.-]?(\d{4})(?![\d])/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/(?<![\d])(\d{3})[\s.-]?(\d{4})(?![\d])/);
  return m ? `${m[1]}-${m[2]}` : null;
}
export const phoneDigits = (p) => String(p ?? '').replace(/\D/g, '').replace(/^507(?=\d{7,8}$)/, '');
export const phoneDisplay = (p) => `+507 ${p}`;

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

/** Hora de reloj dicha en el texto -> 'HH:mm' o null. Sin indicación, 1 a 6 se toma como tarde. */
export function parseClock(text) {
  const t = norm(text);
  let h; let min = 0; let suf = null; let m;
  if ((m = t.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/))) { h = +m[1]; min = +m[2]; suf = m[3]; }
  else if ((m = t.match(/\b(?:a )?las? (\d{1,2})(?:\s*(am|pm))?\b/))) { h = +m[1]; suf = m[2]; }
  else if ((m = t.match(/\b(\d{1,2})\s*(am|pm)\b/))) { h = +m[1]; suf = m[2]; }
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
  return /\d{1,2}[:.]\d{2}/.test(t) || /\b\d{1,2}\s*(am|pm)\b/.test(t) || /\blas \d{1,2}\b/.test(t);
}

const WEEKDAYS = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 0 };

/** "para mañana", "el viernes", "hoy", "pasado mañana" -> 'YYYY-MM-DD' o null. */
export function parseDayPref(text, today) {
  const t = norm(text);
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
