// Grupo C: interfaz suelta (contacto, recordatorios, moneda, fecha al mover, mayúsculas, agenda móvil, animación).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session, chatAppts } from './helpers.mjs';
import { money, priceLabel } from '../public/app/format.js';
import { CONTACT, LINKS } from '../public/shared/ui/ui.js';
import { dateWords } from '../public/app/ui/appt-modal.js';
import { REMINDER_PREVIEW, reminderRows } from '../public/app/ui/livepanel.js';
import { addDays, nowStamp, todayKey } from '../public/shared/time/panama.js';
import { createAppointment, dayBeforeList } from '../public/app/agenda.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const GIROS = ['fisio', 'dental', 'vet'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out); else if (/\.(js|css|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('moneda: B/.35.00 sin espacio, también con ITBMS', () => {
  assert.equal(money(35), 'B/.35.00');
  assert.equal(money('12.5'), 'B/.12.50');
  assert.equal(priceLabel({ price: 35, itbms: false }), 'B/.35.00');
  assert.equal(priceLabel({ price: 35, itbms: true }), 'B/.35.00 + ITBMS 7%');
  assert.equal(priceLabel({ price: null }), 'precio por confirmar');
});

test('moneda: ningún texto de la demo lleva "B/. " con espacio ni en el código ni en lo que dice el bot', () => {
  for (const f of [...walk('public'), 'README.md', 'api/chat.js']) {
    const txt = read(f);
    assert.ok(!/B\/\.\s+[\d$]/.test(txt), `${f} tiene "B/. " con espacio antes de la cifra`);
  }
  for (const giro of GIROS) {
    const s = new Session(giro);
    const all = [s.say('hola'), s.say('precios'), ...s.c.conversations.flatMap((v) => v.messages.map((m) => m.text))].join('\n');
    assert.ok(!/B\/\.\s/.test(all), `${giro}: hay "B/. " con espacio`);
    assert.match(all, /B\/\.\d/, `${giro}: no se ve ningún precio`);
  }
});

test('contacto: el diagnóstico abre WhatsApp +507 6663-2666 con el mensaje codificado', () => {
  assert.equal(CONTACT.whatsapp, '50766632666');
  const u = new URL(LINKS.diagnostico);
  assert.equal(u.origin + u.pathname, 'https://wa.me/50766632666');
  assert.equal(u.searchParams.get('text'), 'Hola, vi la demo de citas por WhatsApp y quiero un diagnóstico');
  assert.ok(LINKS.diagnostico.includes(encodeURIComponent('diagnóstico')));
  assert.ok(!LINKS.diagnostico.includes('cuentanos-tu-proyecto'));
});

test('contacto: banner y cierre de la presentación abren en pestaña nueva con noopener', () => {
  const ui = read('public/shared/ui/ui.js');
  assert.match(ui, /href: LINKS\.diagnostico, target: '_blank', rel: 'noopener'/);
  assert.match(read('public/shared/ui/presentation.js'), /href: s\.link\.href, target: '_blank', rel: 'noopener'/);
  assert.match(read('public/app/presentation-steps.js'), /href: LINKS\.diagnostico/);
});

test('fecha al mover: el texto acompaña a la fecha y cambia con ella', () => {
  assert.equal(dateWords('2026-11-12'), 'jueves 12 de noviembre');
  assert.equal(dateWords('2026-11-13'), 'viernes 13 de noviembre');
  assert.equal(dateWords(''), '');
  assert.equal(dateWords(null), '');
  const src = read('public/app/ui/appt-modal.js');
  assert.match(src, /oninput: \(e\) => \{ dateText\.textContent = dateWords\(e\.target\.value\)/);
});

for (const giro of GIROS) {
  test(`recordatorios (${giro}): los de mañana y los recién agendados no se ocultan; "Ver todos" muestra la lista completa`, () => {
    const s = new Session(giro);
    const c = s.c; const now = nowStamp();
    const total = dayBeforeList(c, now, Infinity).length;
    const prev = reminderRows(c, now);
    const full = reminderRows(c, now, { all: true });
    assert.equal(full.rows.length, total);
    assert.equal(full.total, total);
    assert.ok(prev.rows.length <= Math.max(REMINDER_PREVIEW, total));
    assert.equal(prev.total, total);
    // El que sale hoy a las 9:00 a. m. para una cita de mañana está entre los visibles.
    const tomorrow = addDays(todayKey(), 1);
    const dueToday = full.rows.filter((r) => r.due.startsWith(`${todayKey()}T`) && r.start.startsWith(tomorrow));
    if (dueToday.length) assert.ok(prev.rows.some((r) => r.apptId === dueToday[0].apptId), 'falta el recordatorio de las citas de mañana');
    // Una cita nueva lejana (que por orden quedaría fuera) sigue visible mientras esté fijada.
    const svc = c.config.services.find((x) => x.active !== false);
    const pro = c.config.professionals.find((p) => p.serviceIds.includes(svc.id));
    let made = null;
    for (let d = 20; d < 60 && !made; d++) {
      const day = addDays(todayKey(), d);
      for (const hh of ['09:00', '10:00', '11:00', '14:00']) {
        const r = createAppointment(c, { name: 'Prueba Lejana', phone: '6000-9999', serviceId: svc.id, professionalId: pro.id, start: `${day}T${hh}`, origin: 'panel' });
        if (r.ok) { made = r.appt; break; }
      }
    }
    assert.ok(made, 'no se pudo crear la cita de prueba');
    const after = reminderRows(c, now, { pinned: [made.id] });
    assert.ok(after.rows.some((r) => r.apptId === made.id), 'el recordatorio nuevo quedó oculto');
    assert.equal(after.total, total + 1);
    assert.equal(reminderRows(c, now, { all: true }).rows.length, total + 1);
    assert.ok(chatAppts(c, '6000-9999').length === 1);
  });
}

test('panel En vivo: control "Ver todos" para los recordatorios', () => {
  const src = read('public/app/ui/livepanel.js');
  assert.match(src, /id: 'rem-all'/);
  assert.match(src, /Ver todos \(/);
});

test('mayúsculas: ninguna etiqueta se pone en mayúsculas por CSS (el badge URGENTE va escrito así)', () => {
  for (const f of ['public/app/app.css', 'public/shared/ui/base.css', 'public/shared/whatsapp-sim/whatsapp-sim.css']) {
    assert.ok(!/text-transform\s*:\s*uppercase/i.test(read(f)), `${f} aún usa text-transform: uppercase`);
  }
  const pres = read('public/shared/ui/presentation.js');
  assert.match(pres, /`Paso \$\{i \+ 1\} de \$\{steps\.length\}`/);
  assert.match(pres, /'En pausa'/);
});

test('agenda en móvil: abre en Día salvo que la persona haya elegido otra vista', () => {
  const src = read('public/app/views/admin-agenda.js');
  assert.match(src, /innerWidth < 760 \? 'dia' : 'semana'/);
  assert.match(src, /if \(!ui\.modeChosen\) ui\.mode = defaultMode\(\);/);
  assert.match(src, /ui\.mode = 'semana'; ui\.modeChosen = true;/);
  assert.match(src, /ui\.mode = 'dia'; ui\.modeChosen = true;/);
});

test('menos animación: solo la portada anima su entrada', () => {
  const css = read('public/app/app.css');
  assert.ok(!/main\[data-enter\]\s*>\s*\.wrap:not\(:has\(\.hero\)\)\s*\{[^}]*animation/.test(css));
  assert.match(css, /main\[data-enter\] \.hero__copy/);
  assert.match(css, /\[data-reveal\]/);
  assert.match(css, /prefers-reduced-motion/);
});
