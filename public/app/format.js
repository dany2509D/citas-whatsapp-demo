// Formatos de texto de la demo: moneda (solo B/.), ITBMS, horarios y plantillas de mensajes.
import { DAYS_SHORT, time12 } from '../shared/time/panama.js';

export const ITBMS = 0.07;
export const CURRENCY = 'B/.';

/** Moneda en balboas, sin espacio entre el símbolo y la cifra: "B/.35.00" (CIT-RNF-06). */
export const money = (n) => `${CURRENCY}${Number(n).toFixed(2)}`;
export const withItbms = (price) => Math.round(price * (1 + ITBMS) * 100) / 100;

export function priceLabel(svc) {
  if (svc.price == null || !Number.isFinite(Number(svc.price))) return 'precio por confirmar';
  return `${money(svc.price)}${svc.itbms ? ' + ITBMS 7%' : ''}`;
}

/** Rellena {variables}; las que no existan quedan vacías. */
export function fill(template, vars = {}) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

/** "Lun–Vie: 8:00 a. m. – 5:00 p. m." (agrupa días consecutivos con el mismo horario). */
export function hoursSummary(c) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const label = (d) => DAYS_SHORT[d].charAt(0).toUpperCase() + DAYS_SHORT[d].slice(1);
  const text = (h) => (h ? `${time12(h.open)} – ${time12(h.close)}` : 'cerrado');
  const groups = [];
  for (const d of order) {
    const h = c.config.hours[d] || null;
    const last = groups.at(-1);
    if (last && text(last.h) === text(h)) last.days.push(d);
    else groups.push({ days: [d], h });
  }
  return groups.map((g) => {
    const days = g.days.length > 1 ? `${label(g.days[0])}–${label(g.days.at(-1))}` : label(g.days[0]);
    return `${days}: ${text(g.h)}`;
  }).join('\n');
}

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
