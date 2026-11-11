// Estado de la demo: todo vive en localStorage (con respaldo en memoria si falla), con
// datos semilla la primera vez. Cada giro tiene sus propios datos.
import { createStorage } from '../shared/storage/storage.js';
import { epochNow, mondayOf, now, todayKey } from '../shared/time/panama.js';
import { TEMPLATES, GIROS } from './data/templates.js';
import { buildClinic, emptyConversation } from './data/seed.js';
import { newId } from './agenda.js';

// v2: la configuración por giro incorpora telefonoEmergenciasFueraDeHorario y nuevas palabras de urgencia; un estado v1 se vuelve a sembrar.
export const STORAGE_KEY = 'pl-citas-demo-v2';
const MAX_EVENTS = 40;
const MAX_CONVS = 30;

export function createStore({ storage = createStorage(STORAGE_KEY) } = {}) {
  const listeners = new Set();
  let state = null;
  let weekRolled = false;

  const seedAll = () => ({
    v: 2,
    giro: state?.giro || 'fisio',
    aiMode: 'guion',
    clinics: Object.fromEntries(GIROS.map((g) => [g, buildClinic(g, now())])),
  });

  function init() {
    const saved = storage.load();
    const ok = saved && saved.v === 2 && GIROS.every((g) => saved.clinics?.[g]);
    state = ok ? saved : seedAll();
    if (!GIROS.includes(state.giro)) state.giro = 'fisio';
    // Si cambió la semana, las citas de la semilla ya no son "de esta semana": se vuelve a sembrar ese giro.
    for (const g of GIROS) {
      if (state.clinics[g].seedWeek !== mondayOf(todayKey())) {
        state.clinics[g] = buildClinic(g, now());
        weekRolled = true;
      }
    }
    save();
    return state;
  }

  const save = () => storage.save(state);
  const emit = (evt) => { for (const fn of [...listeners]) { try { fn(evt); } catch (e) { console.error(e); } } };

  const store = {
    init,
    get state() { return state; },
    get persistent() { return storage.persistent; },
    get weekRolled() { const w = weekRolled; weekRolled = false; return w; },
    profile: (g = state.giro) => TEMPLATES[g],
    clinic: (g = state.giro) => state.clinics[g],
    live(g = state.giro) {
      const c = state.clinics[g];
      let v = c.conversations.find((x) => x.id === 'live');
      if (!v) { v = emptyConversation('live', epochNow()); c.conversations.unshift(v); }
      // Identidad del chat (persona ficticia del giro): quien escribe por WhatsApp. También se completa en estados ya guardados.
      if (!v.persona && TEMPLATES[g]?.persona) v.persona = { ...TEMPLATES[g].persona };
      return v;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit,
    save,
    /** Guarda y avisa a las pantallas. evt = { type: 'appt'|'conv'|'config'|'feed'|'giro'|'ai'|'reset', id? } */
    commit(evt = { type: 'change' }) { save(); emit(evt); },

    setGiro(g) {
      if (!GIROS.includes(g) || g === state.giro) return;
      state.giro = g;
      save();
      emit({ type: 'giro', giro: g });
    },
    setAiMode(mode) { state.aiMode = mode === 'ia' ? 'ia' : 'guion'; save(); emit({ type: 'ai', mode: state.aiMode }); },

    /** Línea para el panel "En vivo". kind: cita | estado | urgente | humano | recordatorio | seguimiento | sistema */
    logEvent(kind, text, apptId = null, giro = state.giro) {
      const c = state.clinics[giro];
      c.events.unshift({ id: newId('ev'), ts: epochNow(), kind, text, apptId });
      if (c.events.length > MAX_EVENTS) c.events.length = MAX_EVENTS;
    },

    /** Guarda el chat en vivo en la bandeja y empieza uno nuevo. */
    newChat(giro = state.giro) {
      const c = state.clinics[giro];
      const live = c.conversations.find((v) => v.id === 'live');
      if (live && live.messages.some((m) => m.from === 'user')) {
        live.id = newId('cv'); // el mismo objeto pasa a ser una conversación archivada de la bandeja
        live.name = live.name || 'Visitante de la demo';
        if (c.conversations.length > MAX_CONVS) c.conversations.splice(MAX_CONVS);
      } else if (live) {
        c.conversations = c.conversations.filter((v) => v.id !== 'live');
      }
      const fresh = emptyConversation('live', epochNow());
      if (TEMPLATES[giro]?.persona) fresh.persona = { ...TEMPLATES[giro].persona };
      c.conversations.unshift(fresh);
      save();
      emit({ type: 'conv', id: 'live', reset: true });
    },

    /** "Reiniciar demo": borra todo y vuelve a sembrar. */
    reset() {
      storage.clear();
      const giro = state.giro;
      state = null;
      state = seedAll();
      state.giro = giro;
      save();
      emit({ type: 'reset' });
    },
  };
  return store;
}
