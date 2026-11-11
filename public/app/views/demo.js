// Pantalla principal de la demo: a la izquierda el teléfono con el WhatsApp de la clínica;
// a la derecha el panel "En vivo" con lo que cambia cada mensaje.
import { h, $ } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { createPhone } from '../../shared/whatsapp-sim/phone.js';
import { confirmDialog } from '../../shared/ui/ui.js';
import { logoNode } from '../logos.js';
import { createLivePanel } from '../ui/livepanel.js';

const friendlyReason = (reason = '') => {
  if (/ANTHROPIC_API_KEY|no configurada/i.test(reason)) return 'falta configurar la clave en el servidor.';
  if (/no existe/i.test(reason)) return 'este sitio no tiene la función /api/chat.';
  return `${reason || 'sin respuesta del servidor'}.`;
};

export function mountDemo(root, app) {
  const { store, controller: ctl } = app;
  const T = store.profile();
  let tab = 'chat';

  const phone = createPhone({
    title: T.name,
    subtitle: 'Asistente virtual · en línea',
    avatar: logoNode(store.state.giro),
    placeholder: 'Escriba un mensaje',
    onSend: (t) => ctl.sendUser(t),
    onChip: (chip) => ctl.sendUser(chip.text),
    onAttach: (f) => ctl.sendAttachment(f),
    onHandoff: () => ctl.requestHandoff(),
  });

  function paintPhone() {
    const conv = store.live();
    phone.setMessages(conv.messages);
    const started = conv.messages.some((m) => m.from === 'user');
    phone.setChips(started ? (conv.chips || []) : T.starters.map((s) => ({ label: s, text: s })));
  }

  const grid = h('div', { class: 'demo-grid', 'data-tab': 'chat' });
  const tabChat = h('button', { type: 'button', role: 'tab', id: 'tab-chat', 'aria-selected': 'true', 'aria-controls': 'pane-chat', onclick: () => setTab('chat') }, icon('message', { size: 17 }), 'WhatsApp');
  const dot = h('i', { class: 'dot', hidden: true, 'aria-hidden': 'true' });
  const tabPanel = h('button', { type: 'button', role: 'tab', id: 'tab-panel', 'aria-selected': 'false', 'aria-controls': 'pane-panel', onclick: () => setTab('panel') }, icon('activity', { size: 17 }), 'Panel en vivo', dot);
  function setTab(t) {
    tab = t; grid.dataset.tab = t; dot.hidden = true;
    tabChat.setAttribute('aria-selected', String(t === 'chat')); tabPanel.setAttribute('aria-selected', String(t === 'panel'));
  }

  const live = createLivePanel(app, { onShowChat: () => setTab('chat') });

  // --- Herramientas de la demo ---
  const modeStatus = h('p', { class: 'mode__status', 'aria-live': 'polite' });
  const radio = (value, label, ic) => h('label', null,
    h('input', { type: 'radio', name: 'ai-mode', value, id: `mode-${value}`, onchange: () => chooseMode(value) }), h('span', null, icon(ic, { size: 15 }), label));
  const modeGuion = radio('guion', 'Modo guion', 'list');
  const modeIa = radio('ia', 'IA real', 'sparkle');
  function paintMode() {
    const ia = store.state.aiMode === 'ia';
    $('input', modeGuion).checked = !ia; $('input', modeIa).checked = ia;
    modeStatus.textContent = ia
      ? 'IA real activa: responde Claude desde /api/chat. Urgencias y «pasar a una persona» siguen las reglas del guion. Si falla, vuelve al guion.'
      : 'Modo guion: reglas y respuestas predefinidas que entienden variaciones del texto. Es el modo por defecto.';
  }
  async function chooseMode(m) {
    modeStatus.textContent = m === 'ia' ? 'Comprobando /api/chat…' : '';
    const r = await ctl.setAiMode(m);
    paintMode();
    if (r && !r.ok) modeStatus.textContent = `La IA real no está disponible: ${friendlyReason(r.reason)} Se mantiene el modo guion.`;
  }

  const tools = h('section', { class: 'card tools', 'aria-labelledby': 'tools-h' },
    h('h2', { id: 'tools-h' }, 'Controles de la demo'),
    h('div', { class: 'tools__row' },
      h('button', { class: 'btn btn--sm btn--primary', type: 'button', id: 'btn-daybefore', onclick: () => ctl.simulateDayBefore() }, icon('clock', { size: 16 }), 'Simular día anterior'),
      h('button', { class: 'btn btn--sm', type: 'button', id: 'btn-followup', onclick: () => ctl.simulateFollowup() }, icon('bell', { size: 16 }), 'Simular seguimiento'),
      h('button', { class: 'btn btn--sm', type: 'button', id: 'btn-newchat', onclick: async () => {
        if (!store.live().messages.length || await confirmDialog({ title: 'Nuevo chat', text: 'El chat actual se guarda en la bandeja del panel y empieza uno nuevo. ¿Continuar?', confirmLabel: 'Nuevo chat' })) ctl.newChat();
      } }, icon('plus', { size: 16 }), 'Nuevo chat')),
    h('fieldset', { class: 'mode' }, h('legend', { class: 'label' }, 'Asistente'), h('div', { class: 'seg-radio' }, modeGuion, modeIa), modeStatus));

  grid.append(
    h('div', { class: 'demo-phone', id: 'pane-chat', role: 'tabpanel', 'aria-labelledby': 'tab-chat' }, phone.el, tools),
    h('div', { class: 'demo-panel', id: 'pane-panel', role: 'tabpanel', 'aria-labelledby': 'tab-panel' }, live.el));

  root.append(h('div', { class: 'wrap' },
    h('div', { class: 'demo-head' },
      h('div', null, h('h1', { id: 'h1', tabindex: '-1' }, 'Pruebe el asistente como paciente'), h('p', null, `Escriba en el teléfono como lo haría un paciente de ${T.name}. A la derecha verá cada cambio en el panel de la clínica.`)),
      h('button', { class: 'btn', type: 'button', onclick: () => { app.admin.enter(); app.navigate('#/admin/agenda'); } }, icon('dashboard', { size: 17 }), 'Entrar como administrador', icon('arrow-right', { size: 16 }))),
    h('div', { class: 'demo-tabs', role: 'tablist', 'aria-label': 'Vista' }, tabChat, tabPanel),
    grid));

  paintPhone(); paintMode();
  // El teléfono tiene la misma proporción que el de la portada (alto ≈ 1,9 × ancho). Para que quepa entero en la
  // ventana se reduce todo a la vez con zoom (marco, letra y botones), en vez de aplastarlo.
  const PHONE_H = 716;
  const fitPhone = () => {
    if (matchMedia('(max-width: 520px)').matches) { phone.el.style.zoom = ''; return; }
    const top = grid.getBoundingClientRect().top + window.scrollY;
    phone.el.style.zoom = String(Math.max(0.76, Math.min(1, (window.innerHeight - top - 14) / PHONE_H)).toFixed(3));
  };
  fitPhone(); requestAnimationFrame(fitPhone);
  window.addEventListener('resize', fitPhone);
  const offTyping = ctl.onTyping((on) => phone.setTyping(on));
  const unsub = store.subscribe((e) => {
    if (e.type === 'conv' || e.type === 'change') paintPhone();
    if (e.type === 'ai') paintMode();
  });

  app.demo = {
    controller: ctl, phone, setTab,
    markPanelNew() { if (tab === 'chat') dot.hidden = false; },
  };
  return () => { unsub(); offTyping(); live.destroy(); phone.destroy(); window.removeEventListener('resize', fitPhone); };
}
