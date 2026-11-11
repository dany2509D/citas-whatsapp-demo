// Simulador de WhatsApp: marco de teléfono con burbujas, hora, doble check, "escribiendo…",
// botones de respuesta rápida y adjuntos. Es solo interfaz: no se conecta a WhatsApp real.
import { h, svgFrom, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { clockOfEpoch, now, clock, time12 } from '../time/panama.js';

const ICON = {
  back: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  video: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3.5 8.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2zM15.5 10.6l4.2-2.6a.5.5 0 0 1 .8.4v7.200a.5.5 0 0 1-.8.4l-4.2-2.600" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  call: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M6.6 3.8h2.300a1 1 0 0 1 1 .8l.7 3.100a1 1 0 0 1-.3 1L8.700 10.300a12.500 12.500 0 0 0 5 5l1.600-1.600a1 1 0 0 1 1-.3l3.100.7a1 1 0 0 1 .8 1v2.300a1.800 1.800 0 0 1-1.900 1.800A16.300 16.300 0 0 1 4.800 5.700a1.800 1.800 0 0 1 1.800-1.900z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clip: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M16.5 6.5v9a4.5 4.5 0 0 1-9 0V5.8a3 3 0 0 1 6 0v8.9a1.5 1.5 0 0 1-3 0V7H9.5v7.7a3 3 0 0 0 6 0V5.8a4.5 4.5 0 0 0-9 0v9.7a6 6 0 0 0 12 0v-9z"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12.6 2-12.6 2z"/></svg>',
  person: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-3.9 0-8 2-8 4.5V21h16v-2.5c0-2.5-4.1-4.5-8-4.5z"/></svg>',
  signal: '<svg viewBox="0 0 19 12" width="19" height="12" aria-hidden="true"><g fill="currentColor"><rect x="0" y="8" width="3.2" height="4" rx="1"/><rect x="5" y="5.5" width="3.2" height="6.5" rx="1"/><rect x="10" y="3" width="3.2" height="9" rx="1"/><rect x="15" y="0" width="3.2" height="12" rx="1"/></g></svg>',
  wifi: '<svg viewBox="0 0 18 13" width="18" height="13" aria-hidden="true"><path d="M1 4.6a11.5 11.5 0 0 1 16 0M3.7 7.5a7.4 7.4 0 0 1 10.6 0M6.4 10.3a3.4 3.4 0 0 1 5.2 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="9" cy="12" r="1.1" fill="currentColor"/></svg>',
  battery: '<svg viewBox="0 0 28 13" width="28" height="13" aria-hidden="true"><rect x=".5" y=".5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" opacity=".5"/><rect x="2" y="2" width="20" height="9" rx="2.4" fill="currentColor"/><path d="M25 4.5v4c.9-.3 1.6-1.200 1.600-2s-.7-1.700-1.600-2z" fill="currentColor" opacity=".55"/></svg>',
};

const TICK_LABEL = { sent: 'Enviado', delivered: 'Entregado', read: 'Leído' };
/** Pone el estado en los checks sin volver a crearlos: el segundo trazo se dibuja al entregarse y ambos pasan a azul al leerse (CSS). */
function setTicks(svg, status) {
  const s = TICK_LABEL[status] ? status : 'sent';
  svg.classList.toggle('is-delivered', s !== 'sent');
  svg.classList.toggle('is-read', s === 'read');
  svg.setAttribute('aria-label', TICK_LABEL[s]);
}
function ticks(status) {
  const svg = svgFrom('<svg class="wa-ticks" viewBox="0 0 18 11" width="17" height="11" role="img"><path pathLength="1" d="M1.5 6l3 3L10.5 1.5"/><path pathLength="1" d="M7 8.2l1.3 1.3L15 1.5"/></svg>');
  setTicks(svg, status);
  return svg;
}

/** Íconos de la barra de estado (señal, wifi, batería), para dibujar otro teléfono con el mismo aspecto. */
export const statusIcons = () => h('span', { class: 'wa-status__icons' }, svgFrom(ICON.signal), svgFrom(ICON.wifi), svgFrom(ICON.battery));
/** Doble check suelto (decorativo) con el mismo dibujo del chat. */
export const tickIcon = (status = 'sent') => ticks(status);

const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function createPhone({
  title = 'Clínica', subtitle = 'Asistente virtual', avatar = null, placeholder = 'Escriba un mensaje',
  handoffNote = 'Una persona del equipo revisa los casos importantes', handoffLabel = 'Pasar a una persona',
  simNote = 'Simulación de WhatsApp para la demo. No se conecta a WhatsApp real.',
  onSend, onAttach, onChip, onHandoff,
} = {}) {
  let chipsSig = null;
  let messages = [];
  let typing = false;
  let baseSubtitle = subtitle;

  const timeEl = h('span', { class: 'wa-status__time' });
  const tick = () => { timeEl.textContent = time12(clock(now())).replace(/\s*[ap]\. ?m\.$/i, ''); }; // como en un iPhone: «10:20», sin a. m./p. m.
  tick();
  const timer = setInterval(tick, 30000);

  const avatarEl = h('span', { class: 'wa-avatar', 'aria-hidden': 'true' });
  const titleEl = h('span', { class: 'wa-head__title' }, title);
  const subEl = h('span', { class: 'wa-head__sub' }, subtitle);
  if (avatar) avatarEl.append(avatar);

  const log = h('div', { class: 'wa-chat', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': 'Conversación de WhatsApp' });
  const chipsEl = h('div', { class: 'wa-chips', role: 'group', 'aria-label': 'Respuestas rápidas' });
  // Los botones rápidos van en una sola fila que se desplaza (el chat conserva su alto). Un degradado avisa que hay más a los lados.
  const chipsHint = () => {
    const more = chipsEl.scrollWidth - chipsEl.scrollLeft - chipsEl.clientWidth > 4;
    chipsEl.classList.toggle('has-more', more);
    chipsEl.classList.toggle('has-less', chipsEl.scrollLeft > 4);
  };
  chipsEl.addEventListener('scroll', chipsHint, { passive: true });
  chipsEl.addEventListener('wheel', (e) => { // con ratón: la rueda mueve la fila de lado a lado
    if (chipsEl.scrollWidth <= chipsEl.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    chipsEl.scrollLeft += e.deltaY; e.preventDefault();
  }, { passive: false });
  const chipsWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(chipsHint) : null;
  chipsWatch?.observe(chipsEl);
  const input = h('input', { id: 'wa-input', class: 'wa-input__field', type: 'text', autocomplete: 'off', placeholder, maxlength: 400, enterkeyhint: 'send' });
  const file = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'sr-only', tabindex: '-1', 'aria-label': 'Archivo adjunto (imagen o PDF)' });
  file.addEventListener('change', () => { if (file.files[0]) onAttach?.(file.files[0]); file.value = ''; });

  const form = h('form', { class: 'wa-input', autocomplete: 'off' },
    h('button', { class: 'wa-input__btn', type: 'button', 'aria-label': 'Adjuntar imagen o PDF', onclick: () => file.click() }, svgFrom(ICON.clip)),
    h('label', { class: 'sr-only', for: 'wa-input' }, 'Escriba su mensaje'),
    input, file,
    h('button', { class: 'wa-input__btn wa-input__btn--send', type: 'submit', 'aria-label': 'Enviar mensaje' }, svgFrom(ICON.send)));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    onSend?.(text);
  });

  const human = h('div', { class: 'wa-human' },
    h('span', { class: 'wa-human__note' }, svgFrom(ICON.person), h('span', null, handoffNote)),
    h('button', { class: 'wa-human__btn', type: 'button', onclick: () => onHandoff?.() }, handoffLabel));

  const screen = h('section', { class: 'wa-phone', 'aria-label': 'Teléfono con chat de WhatsApp simulado' },
    h('div', { class: 'wa-status', 'aria-hidden': 'true' }, timeEl, h('span', { class: 'wa-island' }),
      h('span', { class: 'wa-status__icons' }, svgFrom(ICON.signal), svgFrom(ICON.wifi), svgFrom(ICON.battery))),
    h('header', { class: 'wa-head' },
      h('span', { class: 'wa-head__back', 'aria-hidden': 'true' }, svgFrom(ICON.back)),
      avatarEl, h('span', { class: 'wa-head__txt' }, titleEl, subEl),
      h('span', { class: 'wa-head__acts', 'aria-hidden': 'true' }, svgFrom(ICON.video), svgFrom(ICON.call))),
    log, chipsEl, human, form, h('div', { class: 'wa-home', 'aria-hidden': 'true' }));
  // El marco (canto metálico y botones laterales) rodea la pantalla; lo que se coloca en la página es el marco.
  const el = h('div', { class: 'wa-device' }, screen);

  function renderMessage(m, fresh) {
    const out = m.from === 'user';
    if (m.from === 'system') return h('div', { class: `wa-sys${fresh ? ' is-new' : ''}` }, h('span', null, m.text));
    const meta = h('span', { class: 'wa-meta' }, h('time', null, clockOfEpoch(m.ts)), out ? ticks(m.status || 'sent') : null);
    const bubble = h('div', { class: 'wa-bubble' },
      m.from === 'staff' ? h('span', { class: 'wa-who' }, 'Equipo de la clínica') : null,
      m.attachment ? h('div', { class: 'wa-file' }, h('span', { class: 'wa-file__ico', 'aria-hidden': 'true' }, m.attachment.kind === 'pdf' ? 'PDF' : 'IMG'),
        h('span', { class: 'wa-file__name' }, m.attachment.name, h('small', null, fmtSize(m.attachment.size)))) : null,
      m.text || m._raw ? h('p', { class: 'wa-text' }, m._raw ?? m.text) : null,
      meta);
    return h('div', { class: `wa-row wa-row--${out ? 'out' : 'in'}${fresh ? ' wa-row--new' : ''}`, dataset: { id: m.id } }, bubble);
  }

  // Dibujo incremental: cada mensaje conserva su nodo (clave = id). Solo se agregan los nuevos, se quitan los que ya no
  // están y, si cambió el estado de envío, se actualizan los checks en su sitio. Así el chat no salta: lo nuevo entra
  // con su animación y la lista se desliza hasta el final, como en WhatsApp.
  const rows = new Map(); // id → { el, sig, status }
  const noteEl = h('div', { class: 'wa-sys wa-sys--note' }, h('span', null, icon('lock', { size: 12 }), simNote));
  const typingRow = h('div', { class: 'wa-row wa-row--in wa-row--typing' }, h('div', { class: 'wa-bubble wa-typing', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
  const calm = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let painted = false; let pinned = true;
  log.addEventListener('scroll', () => { pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 120; }, { passive: true });
  // Si el chat cambia de alto (aparecen o se van los botones rápidos) y la persona estaba al final, sigue al final.
  const stick = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (pinned) log.scrollTop = log.scrollHeight; }) : null;
  stick?.observe(log);

  function render() {
    const first = !painted; painted = true;
    const wasPinned = pinned;
    let grew = false;
    const ids = new Set(messages.map((m, i) => m.id ?? `i${i}`));
    for (const [id, r] of rows) if (!ids.has(id)) { r.el.remove(); rows.delete(id); }
    if (!noteEl.isConnected) log.prepend(noteEl);
    const hadTyping = typingRow.isConnected;
    let prev = noteEl;
    messages.forEach((m, i) => {
      const id = m.id ?? `i${i}`;
      const sig = `${m.from}|${m.text || ''}|${m._raw ?? ''}|${m.attachment?.name || ''}`;
      let r = rows.get(id);
      if (!r || r.sig !== sig) {
        const el = renderMessage(m, !first && !r);
        if (r) r.el.replaceWith(el); else grew = true;
        r = { el, sig, status: m.status }; rows.set(id, r);
      } else if (r.status !== m.status) {
        const t = r.el.querySelector('.wa-ticks'); if (t) setTicks(t, m.status || 'sent');
        r.status = m.status;
      }
      if (prev.nextSibling !== r.el) prev.after(r.el);
      prev = r.el;
    });
    if (typing) { if (!hadTyping || typingRow.previousSibling !== prev) { prev.after(typingRow); grew = grew || !hadTyping; } }
    else typingRow.remove();
    if (first || calm() || typeof log.scrollTo !== 'function') { if (first || wasPinned || grew) log.scrollTop = log.scrollHeight; }
    else if (grew || wasPinned) { pinned = true; log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' }); }
  }

  return {
    el,
    setHeader({ title: t, subtitle: s, avatar: a }) {
      if (t != null) titleEl.textContent = t;
      if (s != null) { baseSubtitle = s; subEl.textContent = typing ? 'escribiendo…' : s; }
      if (a) { clear(avatarEl).append(a); }
    },
    setMessages(list) { messages = list; render(); },
    setTyping(on) { typing = on; subEl.textContent = on ? 'escribiendo…' : baseSubtitle; render(); },
    setChips(chips) {
      // Si son los mismos botones no se tocan: se conserva el desplazamiento y no se repite la entrada.
      const sig = (chips || []).map((c) => `${c.sep ? '|' : ''}${c.kind || ''}:${c.label}`).join('\n');
      if (sig === chipsSig && !chipsEl.hidden === !!sig) return;
      chipsSig = sig;
      chipsEl.classList.toggle('is-fresh', !!sig);
      clear(chipsEl);
      (chips || []).forEach((c, i) => {
        if (c.sep) chipsEl.append(h('span', { class: 'wa-chips__sep', 'aria-hidden': 'true' }));
        chipsEl.append(h('button', { class: `wa-chip${c.kind ? ` wa-chip--${c.kind}` : ''}`, type: 'button', style: { '--n': Math.min(i, 8) }, onclick: () => onChip?.(c) }, c.label));
      });
      chipsEl.hidden = !(chips && chips.length);
      chipsEl.scrollLeft = 0;
      requestAnimationFrame(chipsHint);
    },
    focusInput() { input.focus(); },
    destroy() { clearInterval(timer); chipsWatch?.disconnect(); stick?.disconnect(); },
  };
}
