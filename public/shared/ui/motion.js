// Movimiento con medida: aparición al hacer scroll, cifras que cuentan hasta su valor y esperas
// cancelables para guiones animados. Todo respeta «reducir movimiento» (prefers-reduced-motion).

export const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Cuenta desde 0 hasta el número que ya tiene el elemento («50%» → 0%…50%). */
export function countUp(el, { ms = 800 } = {}) {
  const txt = el.textContent;
  const m = txt.match(/^(\d+)(.*)$/);
  if (!m || reducedMotion()) return;
  const to = Number(m[1]); const suffix = m[2];
  const t0 = performance.now();
  el.textContent = `0${suffix}`;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    el.textContent = p < 1 ? `${Math.round(to * (1 - (1 - p) ** 3))}${suffix}` : txt;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Muestra con una transición suave los elementos [data-reveal] al entrar en pantalla. Devuelve la función que limpia. */
export function reveal(root = document, { instant = false } = {}) {
  document.documentElement.classList.add('js-motion');
  const els = [...root.querySelectorAll('[data-reveal]')];
  // «instant»: se vuelve a dibujar la misma pantalla (p. ej. al cambiar de giro): sin repetir la entrada.
  if (instant || reducedMotion() || typeof IntersectionObserver === 'undefined') {
    // is-instant evita que el navegador anime de 0 a 1 si ya calculó el estilo oculto (p. ej. al dar foco).
    els.forEach((e) => e.classList.add('is-visible', 'is-instant'));
    return () => {};
  }
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  els.forEach((e, i) => { e.style.setProperty('--d', `${(i % 3) * 80}ms`); io.observe(e); });
  return () => io.disconnect();
}

/** Para pruebas y capturas: deja todo visible de inmediato. */
export const revealAll = () => document.querySelectorAll('[data-reveal]').forEach((e) => e.classList.add('is-visible'));

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Anima con la API nativa (solo transform/opacidad); si la curva no es válida en este navegador, usa una de respaldo. */
function animate(el, frames, opts) {
  try { return el.animate(frames, opts); } catch { return el.animate(frames, { ...opts, easing: 'cubic-bezier(.22, 1, .36, 1)' }); }
}

/**
 * FLIP: mide los [data-flip] de root, ejecuta mutate() (el redibujado de siempre) y desliza cada nodo desde donde
 * estaba hasta su sitio nuevo, solo con transform. A los nodos que no existían les pone la clase `enter`.
 * Con «reducir movimiento», pestaña oculta o sin soporte, solo ejecuta mutate().
 */
export function flip(root, mutate, { ms = 320, enter = 'flip-in', max = 80 } = {}) {
  if (reducedMotion() || document.hidden || !root.isConnected || typeof root.animate !== 'function') return mutate();
  const keyed = () => [...root.querySelectorAll('[data-flip]')];
  const first = new Map();
  for (const el of keyed()) { const r = el.getBoundingClientRect(); if (r.width || r.height) first.set(el.dataset.flip, r); }
  const out = mutate();
  const easing = cssVar('--spring') || 'cubic-bezier(.22, 1, .36, 1)';
  const moved = new Map();
  for (const el of keyed().slice(0, max)) {
    const a = first.get(el.dataset.flip);
    if (!a) { if (enter && first.size) el.classList.add(enter); continue; }
    const b = el.getBoundingClientRect();
    if (b.width || b.height) moved.set(el, [a.left - b.left, a.top - b.top]);
  }
  for (const [el, [dx, dy]] of moved) {
    // Si el contenedor con clave ya se mueve, el hijo solo anima la diferencia (no se mueve dos veces).
    const parent = el.parentElement?.closest('[data-flip]');
    const [px, py] = (parent && moved.get(parent)) || [0, 0];
    const x = dx - px; const y = dy - py;
    if ((Math.abs(x) < 1 && Math.abs(y) < 1) || Math.abs(x) > 900 || Math.abs(y) > 900) continue;
    animate(el, [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }], { duration: ms, easing });
  }
  return out;
}

/**
 * Cifra que rueda dígito a dígito hasta `text` (desde `prev`, o desde cero la primera vez). El texto del elemento
 * queda siendo la cifra real («50%»), así lectores de pantalla y pruebas leen lo mismo. El CSS está en polish.css (.roll__d).
 */
export function rollTo(el, text, prev = null) {
  const to = String(text);
  const from = (prev == null ? '' : String(prev)).padStart(to.length, '0').slice(-to.length);
  el.textContent = '';
  const cols = [];
  [...to].forEach((ch, i) => {
    if (!/\d/.test(ch)) { el.append(ch); return; }
    const s = document.createElement('span');
    s.className = 'roll__d'; s.textContent = ch;
    s.style.setProperty('--d', /\d/.test(from[i]) ? from[i] : '0');
    s.style.setProperty('--i', String(to.length - 1 - i));
    el.append(s); cols.push([s, ch]);
  });
  const land = () => cols.forEach(([s, ch]) => s.style.setProperty('--d', ch));
  if (reducedMotion() || typeof requestAnimationFrame !== 'function') land();
  else requestAnimationFrame(() => requestAnimationFrame(land));
}

/** Envuelve un redibujado completo en un fundido cruzado (View Transitions); sin la API o con «reducir movimiento», lo hace en el acto. */
export function withTransition(update) {
  if (reducedMotion() || typeof document.startViewTransition !== 'function' || document.hidden) return update();
  try { document.startViewTransition(() => update()); } catch { update(); }
}

/** Temporizador cancelable: const t = timeline(); await t.wait(500); t.stop(). */
export function timeline() {
  let alive = true; const timers = new Set();
  return {
    get alive() { return alive; },
    wait: (ms) => new Promise((resolve) => { const id = setTimeout(() => { timers.delete(id); resolve(alive); }, ms); timers.add(id); }),
    stop() { alive = false; timers.forEach(clearTimeout); timers.clear(); },
  };
}
