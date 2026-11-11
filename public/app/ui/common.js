// Piezas de interfaz que usan varias pantallas.
import { h } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { phoneDisplay } from '../../shared/chat-engine/nlu.js';
import { STATUS, getPro, getService } from '../agenda.js';
import { clockOfEpoch, dateKeyOfEpoch, dateShort, stampShort, todayKey } from '../../shared/time/panama.js';

export const STATUS_ICON = { pendiente: 'clock', confirmada: 'check', reprogramada: 'refresh', cancelada: 'x', no_asistio: 'ban', atendida: 'check-circle' };

/** Etiqueta de estado: ícono + texto (no depende solo del color). */
export function badge(status) {
  return h('span', { class: `badge badge--${status}` }, icon(STATUS_ICON[status], { size: 12, stroke: 2.6 }), STATUS[status]);
}

/** Estado en una línea (para los bloques del calendario). */
export const statusInline = (status) => h('span', { class: 'cal-appt__st' }, icon(STATUS_ICON[status], { size: 11, stroke: 2.6 }), ` ${STATUS[status]}`);

export const fmtPhone = (p) => phoneDisplay(p);

/** Descripción completa de una cita (para lectores de pantalla y títulos). */
export function apptSummary(c, a) {
  return `${a.name}, ${getService(c, a.serviceId)?.name || ''}, ${stampShort(a.start)}, ${getPro(c, a.professionalId)?.name || ''}, ${STATUS[a.status]}`;
}

// Línea de tiempo del panel «En vivo»: ícono y color según el tipo de cambio.
const FEED = {
  cita: ['calendar-check', 'ok'], estado: ['refresh', 'indigo'], urgente: ['alert', 'warn'], humano: ['user-check', 'amber'],
  recordatorio: ['clock', 'brand'], seguimiento: ['bell', 'brand'], sistema: ['info', 'slate'],
};
export function feedChip(kind, size = 18) {
  const [name, tone] = FEED[kind] || FEED.sistema;
  return h('span', { class: `chip-ic chip-ic--${tone}` }, icon(name, { size }));
}
/** Ícono dentro de un recuadro de color (portada, indicadores, tarjetas). */
export const chipIcon = (name, tone = 'brand', size = 20) => h('span', { class: `chip-ic chip-ic--${tone}` }, icon(name, { size }));

export const initials = (name) => String(name || '?').replace(/^(Lcda?\.|Lcdo\.|Dra?\.|Sra?\.)\s+/i, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const avatar = (name, cls = '') => h('span', { class: `initials ${cls}`.trim(), 'aria-hidden': 'true' }, initials(name));

/** "mar 10 nov 10:42 a. m." / "hoy 10:42 a. m." para marcas de tiempo reales. */
export function whenLabel(ms) {
  const key = dateKeyOfEpoch(ms);
  return `${key === todayKey() ? 'hoy' : dateShort(key)} ${clockOfEpoch(ms)}`;
}

export const REMINDER_LABEL = { programado: 'Programado', enviado: 'Enviado', confirmo: 'Confirmó', reprogramo: 'Pidió reprogramar' };

export function srOnly(text) { return h('span', { class: 'sr-only' }, text); }

/** Encabezado de tarjeta con ícono (configuración, seguimiento). */
export function cardHead(iconName, title, hint, id) {
  return h('div', { class: 'card__head' }, chipIcon(iconName, 'brand', 20), h('div', null, h('h2', id ? { id } : null, title), hint ? h('p', null, hint) : null));
}
