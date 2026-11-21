// Feriados de Panamá (días de fiesta y duelo nacional), calculados para cualquier año.
//
// Fuente: Código de Trabajo (días de descanso obligatorio) y calendarios publicados para 2026–2027.
// Las fechas móviles salen de la Pascua: Martes de Carnaval = Pascua − 47 días; Viernes Santo = Pascua − 2.
// Regla de traslado: si un feriado nacional cae en domingo, el descanso pasa al lunes siguiente.
//
// IMPORTANTE: el Gobierno a veces decreta «puentes» o traslados extra. Esos (y las vacaciones de cada negocio)
// se agregan a mano en la configuración de la clínica («Cierres propios»). Confirme la lista con el MITRADEL cada año.
import { addDays, dayOfWeek, pad2 } from './panama.js';

/** Feriados nacionales de fecha fija (descanso obligatorio). */
const FIXED = [
  ['01-01', 'Año Nuevo'],
  ['01-09', 'Día de los Mártires'],
  ['05-01', 'Día del Trabajador'],
  ['11-03', 'Separación de Panamá de Colombia'],
  ['11-05', 'Consolidación de la Separación (Colón)'],
  ['11-10', 'Primer Grito de Independencia'],
  ['11-28', 'Independencia de Panamá de España'],
  ['12-08', 'Día de las Madres'],
  ['12-20', 'Día de Duelo Nacional'],
  ['12-25', 'Navidad'],
];
/** Días que muchos negocios cierran por tradición, aunque no son descanso obligatorio por ley. */
const TRADITIONAL = [['11-04', 'Día de los Símbolos Patrios']];

/** Domingo de Pascua ('YYYY-MM-DD'), algoritmo gregoriano anónimo (Meeus/Jones/Butcher). */
export function easterSunday(year) {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30; const i = Math.floor(c / 4); const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Feriados de un año, en orden: [{ date: 'YYYY-MM-DD', name, kind: 'nacional' | 'tradicional' }].
 * Incluye el lunes de traslado cuando un feriado nacional cae en domingo.
 */
export function panamaHolidays(year) {
  const easter = easterSunday(year);
  const list = [
    ...FIXED.map(([md, name]) => ({ date: `${year}-${md}`, name, kind: 'nacional' })),
    { date: addDays(easter, -47), name: 'Martes de Carnaval', kind: 'nacional' },
    { date: addDays(easter, -2), name: 'Viernes Santo', kind: 'nacional' },
    { date: addDays(easter, -48), name: 'Lunes de Carnaval', kind: 'tradicional' },
    ...TRADITIONAL.map(([md, name]) => ({ date: `${year}-${md}`, name, kind: 'tradicional' })),
  ];
  for (const h of list.filter((x) => x.kind === 'nacional' && dayOfWeek(x.date) === 0)) {
    list.push({ date: addDays(h.date, 1), name: `${h.name} (se descansa el lunes)`, kind: 'nacional' });
  }
  return list.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

let override = null;
const cache = new Map();
/** Solo para pruebas: reemplaza el calendario (p. ej. () => [] para una semana fija sin feriados). Sin argumento vuelve al real. */
export const setHolidayCalendar = (fn) => { override = fn || null; };

function byDate(year) {
  if (override) return new Map(override(year).map((h) => [h.date, [h]]));
  if (!cache.has(year)) {
    const m = new Map();
    for (const h of panamaHolidays(year)) m.set(h.date, [...(m.get(h.date) || []), h]);
    cache.set(year, m);
  }
  return cache.get(year);
}

/** Feriados de ese día (puede haber dos, p. ej. un traslado que coincide con otro). Lista vacía si no hay. */
export const holidaysOn = (key) => byDate(+String(key).slice(0, 4)).get(String(key).slice(0, 10)) || [];

/** Feriados entre dos fechas (incluidas), en orden. */
export function holidaysBetween(fromKey, toKey) {
  const out = [];
  for (let y = +fromKey.slice(0, 4); y <= +toKey.slice(0, 4); y++) {
    for (const [date, hs] of byDate(y)) if (date >= fromKey && date <= toKey) out.push(...hs);
  }
  return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}
