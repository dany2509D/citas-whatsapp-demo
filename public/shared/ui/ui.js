// Componentes de interfaz compartidos: banner de demo, avisos (toast) y diálogos.
import { h, $, clear } from './dom.js';
import { icon } from './icons.js';

// Contacto comercial (CIT-RF-19): el diagnóstico gratis se pide por WhatsApp con el mensaje ya escrito.
export const CONTACT = {
  whatsapp: '50766632666', // +507 6663-2666
  message: 'Hola, vi la demo de citas por WhatsApp y quiero un diagnóstico',
};

export const LINKS = {
  site: 'https://panacealogic.dev',
  diagnostico: `https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(CONTACT.message)}`,
  formulario: 'https://panacealogic.dev/cuentanos-tu-proyecto?demo=citas',
};

const calm = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Banner fijo arriba. Publica su alto en --banner-h para que el resto lo respete. */
export function mountBanner(container) {
  const banner = h('div', { class: 'demo-banner', role: 'region', 'aria-label': 'Aviso de demostración' },
    h('p', { class: 'demo-banner__text' },
      'Demo de ', h('a', { href: LINKS.site, target: '_blank', rel: 'noopener' }, 'Panacea Logic AI'),
      ' · Datos ficticios · No ingrese información real'),
    h('a', { class: 'demo-banner__cta', href: LINKS.diagnostico, target: '_blank', rel: 'noopener', 'aria-label': 'Agende un diagnóstico gratis de 30 minutos por WhatsApp (se abre en una pestaña nueva)' },
      'Agende un diagnóstico gratis de 30 minutos'));
  container.append(banner);
  const sync = () => document.documentElement.style.setProperty('--banner-h', `${banner.offsetHeight}px`);
  sync();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(sync).observe(banner);
  else addEventListener('resize', sync);
  return banner;
}

/** Aviso breve; se anuncia a lectores de pantalla. */
export function toast(message, { kind = 'info', ms = 3200 } = {}) {
  let region = $('#toasts');
  if (!region) {
    region = h('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  const el = h('div', { class: `toast toast--${kind}` }, message);
  region.append(el);
  setTimeout(() => { if (calm()) { el.remove(); return; } el.classList.add('is-leaving'); setTimeout(() => el.remove(), 160); }, ms);
  return el;
}

/** Diálogo modal nativo (<dialog>): foco atrapado, Esc cierra. */
export function openDialog({ title, body, wide = false, onClose, labelledBy = 'dlg-title' }) {
  const dlg = h('dialog', { class: `dlg${wide ? ' dlg--wide' : ''}`, 'aria-labelledby': labelledBy });
  // La salida es más corta que la entrada: se marca .is-closing, se espera la animación y recién entonces se cierra.
  let closing = false;
  const close = () => {
    if (!dlg.open || closing) return;
    if (calm()) { dlg.close(); return; }
    closing = true; dlg.classList.add('is-closing');
    setTimeout(() => { closing = false; if (dlg.open) dlg.close(); }, 140);
  };
  const head = h('div', { class: 'dlg__head' },
    h('h2', { id: labelledBy, class: 'dlg__title' }, title),
    h('button', { class: 'btn btn--ghost btn--icon', type: 'button', 'aria-label': 'Cerrar', onclick: close }, icon('x', { size: 18 })));
  const content = h('div', { class: 'dlg__body' });
  if (body) content.append(body);
  dlg.append(head, content);
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); }); // Esc también pasa por la salida
  document.body.append(dlg);
  dlg.showModal();
  return { dialog: dlg, close, setBody(node) { clear(content).append(node); }, setTitle(t) { $('.dlg__title', dlg).textContent = t; } };
}

/** Confirmación con <dialog>; resuelve true/false. */
export function confirmDialog({ title, text, confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', danger = false, tone = 'brand' }) {
  return new Promise((resolve) => {
    let answer = false;
    const body = h('div', null,
      h('p', null, text),
      h('div', { class: 'dlg__actions' },
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => d.close() }, cancelLabel),
        h('button', { class: `btn ${danger ? 'btn--danger' : tone === 'dark' ? 'btn--primary' : 'btn--accent'}`, type: 'button', onclick: () => { answer = true; d.close(); } }, confirmLabel)));
    const d = openDialog({ title, body, labelledBy: 'dlg-confirm', onClose: () => resolve(answer) });
  });
}
