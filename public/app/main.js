// Arranque de la demo: estado, tema por giro, barra superior, rutas por hash y modo Presentación.
import { mountBanner, toast, confirmDialog } from '../shared/ui/ui.js';
import { $, clear, h, replace } from '../shared/ui/dom.js';
import { createStorage } from '../shared/storage/storage.js';
import { createPresentation } from '../shared/ui/presentation.js';
import { createStore } from './state.js';
import { createController } from './controller.js';
import { GIROS, TEMPLATES } from './data/templates.js';
import { logoNode } from './logos.js';
import { icon } from '../shared/ui/icons.js';
import { reveal, revealAll, withTransition } from '../shared/ui/motion.js';
import { buildSteps } from './presentation-steps.js';
import { mountHome } from './views/home.js';
import { mountDemo } from './views/demo.js';
import { mountAdmin } from './views/admin.js';

const store = createStore();
store.init();

// "Entrar como administrador": sin contraseña, solo un botón (dura lo que dure la pestaña).
const adminFlag = createStorage('pl-citas-admin', () => globalThis.sessionStorage);

const app = {
  store,
  toast,
  demo: null,
  controller: null,
  admin: {
    entered: () => adminFlag.load()?.in === true,
    enter: () => adminFlag.save({ in: true }),
    exit: () => adminFlag.clear(),
  },
  navigate,
};
app.controller = createController({ store, notify: (m, kind) => toast(m, { kind }) });

// ---- Tema por giro -----------------------------------------------------------------------------
function applyTheme() {
  const p = store.profile().palette;
  const s = document.documentElement.style;
  s.setProperty('--brand', p.brand); s.setProperty('--brand-dark', p.brandDark); s.setProperty('--brand-soft', p.soft);
  s.setProperty('--accent', p.accent); s.setProperty('--on-accent', p.onAccent);
  document.documentElement.dataset.giro = store.state.giro;
}

// ---- Estructura fija ------------------------------------------------------------------------------
mountBanner($('#banner-root'));
const shell = $('#shell');
const bar = h('header', { class: 'appbar' });
const view = h('main', { id: 'main', tabindex: '-1' });
const foot = h('footer', { class: 'foot' });
shell.append(bar, view, foot);

function renderBar() {
  const T = store.profile();
  const route = parseRoute()[0];
  const link = (href, label, key, short) => h('a', { href, ...(route === key ? { 'aria-current': 'page' } : {}) }, short ? [h('span', { class: 'long' }, label), h('span', { class: 'short' }, short)] : label);
  const select = h('select', { id: 'giro-select', onchange: (e) => store.setGiro(e.target.value) },
    GIROS.map((g) => h('option', { value: g, ...(g === store.state.giro ? { selected: true } : {}) }, TEMPLATES[g].giro)));
  clear(bar).append(h('div', { class: 'appbar__in' },
    h('a', { class: 'brand', href: '#/', 'aria-label': `${T.name}: ir al inicio` },
      h('span', { class: 'brand__logo' }, logoNode(store.state.giro)),
      h('span', { class: 'brand__name' }, T.name, h('span', { class: 'brand__giro' }, `Demo de ${T.giro.toLowerCase()}`))),
    h('nav', { class: 'nav', 'aria-label': 'Principal' }, link('#/', 'Inicio', ''), link('#/demo', 'Demo del cliente', 'demo', 'Demo'), link('#/admin', 'Panel de recepción', 'admin', 'Panel')),
    h('div', { class: 'appbar__tools' },
      h('div', { class: 'field' }, h('label', { for: 'giro-select', class: 'sr-only' }, 'Giro de la clínica'), select),
      h('button', { class: `btn btn--sm ${presentation.active ? 'btn--dark' : 'btn--primary'}`, type: 'button', id: 'btn-present', onclick: () => (presentation.active ? presentation.stop() : presentation.start()) },
        icon(presentation.active ? 'stop' : 'play', { size: 15 }), presentation.active ? 'Salir de la presentación' : 'Presentación'),
      h('button', { class: 'btn btn--sm btn--ghost', type: 'button', id: 'btn-reset', title: 'Reiniciar demo', onclick: resetDemo }, icon('reset', { size: 15 }), h('span', { class: 'btn__lbl' }, 'Reiniciar demo')))));
}

function renderFoot() {
  replace(foot,
    h('p', null, 'Demo. Todo lo que ve es simulado: no se conecta a WhatsApp real ni se procesan pagos (Yappy, tarjeta, ACH y efectivo son solo ejemplos). Personas, teléfonos y datos son ficticios.'),
    store.persistent ? null : h('p', null, icon('alert', { size: 15 }), ' Su navegador bloquea el almacenamiento: la demo funciona, pero los cambios no se conservan al recargar.'));
}

async function resetDemo() {
  const ok = await confirmDialog({ title: 'Reiniciar demo', text: 'Se borrarán los cambios y se volverán a cargar los datos de ejemplo (citas, pacientes y conversaciones de los tres giros). ¿Desea continuar?', confirmLabel: 'Sí, reiniciar', tone: 'dark' });
  if (!ok) return;
  doReset();
  toast('Demo reiniciada con los datos de ejemplo.', { kind: 'ok' });
}
function doReset() { store.reset(); app.controller.newChat(); store.save(); }

// ---- Modo Presentación -----------------------------------------------------------------------------
const presentation = createPresentation({
  getSteps: () => buildSteps(app),
  onStart: async ({ silent }) => { doReset(); await navigate('#/'); if (!silent) renderBar(); },
  onStop: () => renderBar(),
});
app.presentation = presentation;

// ---- Rutas ----------------------------------------------------------------------------------------------
function parseRoute() {
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('?')[0].split('/').filter(Boolean);
  return [parts[0] || '', parts[1] || ''];
}

let unmount = null; let lastKey = null; let skipNext = false; let stopReveal = null;

function render() {
  unmount?.(); unmount = null; app.demo = null;
  const [route, sub] = parseRoute();
  clear(view);
  let title = 'Citas por WhatsApp para clínicas';
  if (route === 'demo') { unmount = mountDemo(view, app); title = `Demo del cliente · ${store.profile().name}`; }
  else if (route === 'admin') { unmount = mountAdmin(view, app, sub); title = `Panel de recepción · ${store.profile().name}`; }
  else { unmount = mountHome(view, app); }
  document.title = `${title}`;
  renderBar(); renderFoot();
  const key = `${route}/${sub}`;
  const entering = key !== lastKey;
  // La entrada animada solo ocurre al llegar a una pantalla; redibujarla (cambio de giro) no la repite.
  view.toggleAttribute('data-enter', entering);
  stopReveal?.(); stopReveal = reveal(view, { instant: !entering });
  if (entering) { lastKey = key; window.scrollTo(0, 0); }
}

/** Cambia de ruta y deja la pantalla lista en el acto (el modo Presentación lo necesita). */
export function navigate(hash) {
  if (location.hash !== hash) { skipNext = true; location.hash = hash; }
  render();
  return Promise.resolve();
}

window.addEventListener('hashchange', () => { if (skipNext) { skipNext = false; return; } render(); });

store.subscribe((e) => {
  if (e.type === 'giro') withTransition(() => { applyTheme(); render(); }); // el color de marca y la pantalla se funden, sin corte seco
  else if (e.type === 'reset') { applyTheme(); render(); }
});

applyTheme();
render();
if (store.weekRolled) toast('Cambió la semana: se cargaron datos de ejemplo nuevos para la semana actual.');
window.__app = app; // para pruebas y para el presentador (consola)
window.__revealAll = revealAll; // pruebas y capturas: deja visibles de golpe los bloques que aparecen al hacer scroll
