// Modo Presentación (reutilizable): recorre el flujo principal paso a paso. Cada paso ejecuta
// una acción real de la demo y muestra una nota corta de qué se está demostrando.
// Se puede pausar, avanzar, retroceder (vuelve a reproducir desde el inicio) y salir.
import { h, $, $$, clear, reducedMotion } from './dom.js';
import { icon } from './icons.js';

export function createPresentation({ getSteps, onStart, onStop, root = document.body }) {
  let steps = []; let i = 0; let playing = false; let card = null; let timer = null; let busy = false; let active = false; let token = 0;

  // Resalte: un anillo propio que viaja de un objetivo al siguiente (se desliza y cambia de tamaño) y late una vez al llegar.
  // Un bucle ligero lo reajusta si el objetivo se redibuja o cambia de sitio.
  let rings = []; let sels = []; let raf = 0;
  const rectOf = (els) => {
    const rs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
    if (!rs.length) return null;
    const l = Math.min(...rs.map((r) => r.left)); const t = Math.min(...rs.map((r) => r.top));
    const rr = Math.max(...rs.map((r) => r.right)); const bb = Math.max(...rs.map((r) => r.bottom));
    return { x: l + scrollX - 5, y: t + scrollY - 5, w: rr - l + 10, h: bb - t + 10 };
  };
  const place = (ring, r, animate) => {
    const to = { transform: `translate(${r.x}px, ${r.y}px)`, width: `${r.w}px`, height: `${r.h}px` };
    if (animate && !reducedMotion() && ring._r) ring.animate([{ transform: ring.style.transform, width: ring.style.width, height: ring.style.height }, to], { duration: 420, easing: 'cubic-bezier(.65, 0, .35, 1)' });
    Object.assign(ring.style, to); ring._r = r;
  };
  const clearHighlight = () => { cancelAnimationFrame(raf); rings.forEach((r) => r.remove()); rings = []; sels = []; };
  const near = (a, b) => Math.abs(a - b) <= 1;
  const track = () => {
    sels.forEach((s, k) => { const r = rectOf($$(s)); const g = rings[k]; if (r && g && !(near(r.x, g._r.x) && near(r.y, g._r.y) && near(r.w, g._r.w) && near(r.h, g._r.h))) place(g, r, false); });
    raf = requestAnimationFrame(track);
  };
  const highlight = (sel) => {
    const list = [].concat(sel || []);
    const prev = rings; rings = []; sels = list;
    list.forEach((s, k) => {
      const r = rectOf($$(s)); if (!r) return;
      const ring = prev[k] || h('div', { class: 'pres-ring', 'aria-hidden': 'true' });
      if (!ring.isConnected) { root.append(ring); ring._r = null; place(ring, r, false); } else place(ring, r, true);
      ring.classList.remove('is-landed'); void ring.offsetWidth; setTimeout(() => ring.classList.add('is-landed'), 380);
      rings[k] = ring;
    });
    prev.slice(list.length).forEach((x) => x.remove());
    if (list[0]) $$(list[0])[0]?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    cancelAnimationFrame(raf); raf = requestAnimationFrame(track);
  };

  function paint() {
    if (!card) return;
    const s = steps[i];
    clear(card);
    card.append(
      h('div', { class: 'pres__top' }, h('span', null, `Paso ${i + 1} de ${steps.length}`), h('span', null, playing ? 'Reproduciendo' : 'En pausa')),
      h('div', { class: 'pres__bar', 'aria-hidden': 'true' }, h('i', { style: { width: `${((i + 1) / steps.length) * 100}%` } })),
      h('h2', { id: 'pres-title' }, s.title),
      h('p', { id: 'pres-note', 'aria-live': 'polite' }, s.note),
      h('div', { class: 'pres__act' },
        h('div', { class: 'row', style: { gap: '8px' } },
          h('button', { class: 'btn btn--sm', type: 'button', disabled: busy || i === 0, onclick: prev }, icon('chevron-left', { size: 15 }), 'Anterior'),
          h('button', { class: 'btn btn--sm', type: 'button', onclick: togglePlay, 'aria-pressed': String(playing) }, icon(playing ? 'pause' : 'play', { size: 14 }), playing ? 'Pausar' : 'Reproducir solo'),
          h('button', { class: 'btn btn--sm btn--primary', type: 'button', disabled: busy, onclick: next }, i === steps.length - 1 ? 'Terminar' : 'Siguiente', i === steps.length - 1 ? null : icon('chevron-right', { size: 15 }))),
        h('div', { class: 'row', style: { gap: '8px' } },
          s.link ? h('a', { class: 'btn btn--sm btn--primary', href: s.link.href, target: '_blank', rel: 'noopener', 'aria-label': `${s.link.label} (se abre en una pestaña nueva)` }, s.link.label) : null,
          h('button', { class: 'btn btn--sm', type: 'button', onclick: stop }, 'Salir (Esc)'))));
  }

  async function show(idx, { replay = false } = {}) {
    const my = ++token;
    clearTimeout(timer);
    busy = true; i = idx; paint();
    try {
      if (replay) {
        await onStart({ silent: true });
        for (let j = 0; j < idx; j++) await steps[j].run?.({ instant: true });
      }
      if (my !== token) return;
      await steps[idx].run?.({ instant: false });
      if (my !== token) return;
      highlight(steps[idx].highlight);
    } catch (e) { console.error(e); }
    busy = false; paint();
    if (playing && my === token) timer = setTimeout(next, steps[idx].dwell ?? 5200);
  }

  function next() { if (busy) return; if (i >= steps.length - 1) return stop(); show(i + 1); }
  function prev() { if (busy || i === 0) return; show(i - 1, { replay: true }); }
  function togglePlay() { playing = !playing; clearTimeout(timer); paint(); if (playing && !busy) timer = setTimeout(next, 1500); }

  function onKey(e) {
    if (!active) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { stop(); }
    else if (!typing && e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (!typing && e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
  }

  async function start() {
    if (active) return;
    active = true; playing = false;
    steps = getSteps();
    document.body.classList.add('is-presenting');
    card = h('section', { class: 'pres', role: 'region', 'aria-labelledby': 'pres-title', 'aria-label': 'Modo presentación' });
    root.append(card);
    document.addEventListener('keydown', onKey);
    await onStart({ silent: false });
    show(0);
  }

  function stop() {
    if (!active) return;
    active = false; playing = false; token++; clearTimeout(timer);
    clearHighlight(); card?.remove(); card = null;
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('is-presenting');
    onStop?.();
  }

  return { start, stop, get active() { return active; } };
}
