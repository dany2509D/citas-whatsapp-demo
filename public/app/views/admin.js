// Panel administrativo (#/admin). Sin contraseña: un botón "Entrar como administrador".
import { h, $ } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { dateLong, dateShort, todayKey, weekDays } from '../../shared/time/panama.js';
import { logoNode } from '../logos.js';
import * as agenda from './admin-agenda.js';
import * as inbox from './admin-inbox.js';
import * as followups from './admin-followups.js';
import * as config from './admin-config.js';
import { needsAttention } from './admin-inbox.js';

const TABS = [
  ['agenda', 'Agenda', 'calendar', agenda],
  ['conversaciones', 'Conversaciones', 'inbox', inbox],
  ['seguimiento', 'Seguimiento', 'bell', followups],
  ['configuracion', 'Configuración', 'sliders', config],
];

const SUBTITLE = {
  agenda: () => { const w = weekDays(todayKey()); return `Semana del ${dateShort(w[0])} al ${dateShort(w[6])} · hoy es ${dateLong(todayKey())}`; },
  conversaciones: () => 'Las urgentes y las que pasaron a una persona aparecen primero.',
  seguimiento: () => 'Avisos automáticos para que sus pacientes vuelvan.',
  configuracion: () => 'Lo que cambie aquí lo usa el asistente en su próxima respuesta.',
};

export function mountAdmin(root, app, sub) {
  const { store } = app;
  const T = store.profile();

  if (!app.admin.entered()) {
    root.append(h('div', { class: 'wrap' }, h('section', { class: 'card gate', 'aria-labelledby': 'h1' },
      h('div', { style: { width: '68px' } }, logoNode(store.state.giro)),
      h('h1', { id: 'h1', tabindex: '-1' }, 'Panel de recepción'),
      h('p', null, `Aquí la recepción de ${T.name} ve la agenda, las conversaciones y los indicadores.`),
      h('p', { class: 'field__hint' }, 'En una clínica real aquí iría su usuario y contraseña. En esta demo no hace falta: entre con un clic.'),
      h('button', { class: 'btn btn--accent btn--lg', type: 'button', id: 'btn-admin-enter', onclick: () => { app.admin.enter(); app.navigate('#/admin/agenda'); } }, icon('dashboard', { size: 20 }), 'Entrar como administrador'),
      h('a', { href: '#/demo' }, 'Volver a la vista de cliente'))));
    $('#h1', root)?.focus({ preventScroll: true });
    return () => {};
  }

  const tab = TABS.find((t) => t[0] === sub) || TABS[0];
  const count = h('span', { class: 'count', hidden: true, 'aria-label': 'conversaciones por atender' });
  const paintCount = () => { const n = store.clinic().conversations.filter(needsAttention).length; count.textContent = String(n); count.hidden = !n; };

  const content = h('div', { id: 'admin-content' });
  root.append(h('div', { class: 'wrap' },
    h('div', { class: 'admin-layout' },
      h('aside', { class: 'admin-side', 'aria-label': 'Menú del panel' },
        h('div', { class: 'side-card' },
          h('div', { class: 'side-id' }, logoNode(store.state.giro), h('div', null, h('b', null, T.short || T.name), h('small', null, T.giro))),
          h('div', { class: 'side-title' }, 'Recepción'),
          h('nav', { class: 'admin-nav', 'aria-label': 'Secciones del panel' }, TABS.map(([key, label, ic]) => h('a', { href: `#/admin/${key}`, ...(key === tab[0] ? { 'aria-current': 'page' } : {}) }, icon(ic, { size: 19 }), label, key === 'conversaciones' ? count : null)))),
        h('div', { class: 'side-card is-actions' },
          h('div', { class: 'side-actions' },
            h('a', { class: 'btn btn--sm', href: '#/demo', id: 'btn-to-client' }, icon('arrow-left', { size: 15 }), 'Volver a la vista de cliente'),
            h('button', { class: 'btn btn--sm btn--ghost', type: 'button', onclick: () => { app.admin.exit(); app.navigate('#/admin'); } }, icon('logout', { size: 15 }), 'Salir del panel')))),
      h('section', { 'aria-labelledby': 'h1' },
        h('div', { class: 'page-head' }, h('div', null, h('h1', { id: 'h1', tabindex: '-1' }, tab[1]), h('p', null, `${T.name} · ${SUBTITLE[tab[0]]()}`))),
        content))));

  const unmountSub = tab[3].mount(content, app);
  paintCount();
  const unsub = store.subscribe((e) => { if (e.type === 'conv' || e.type === 'change') paintCount(); });
  $('#h1', root)?.focus({ preventScroll: true });
  return () => { unsub(); unmountSub?.(); };
}
