import { setNow, now } from '../public/shared/time/panama.js';
import { buildClinic, emptyConversation } from '../public/app/data/seed.js';
import { TEMPLATES } from '../public/app/data/templates.js';
import { respond } from '../public/app/bot.js';

/** Martes 10 de noviembre de 2026, 10:00 a. m. en Panamá (hora de pared). */
export const FIXED_NOW = () => new Date(Date.UTC(2026, 10, 10, 10, 0, 0));

export function fixClock(fn = FIXED_NOW) { setNow(fn); }

export class Session {
  constructor(giro = 'fisio') {
    fixClock();
    this.giro = giro;
    this.T = TEMPLATES[giro];
    this.c = buildClinic(giro, now());
    this.conv = emptyConversation('live', Date.now());
    this.logs = [];
    this.out = [];
  }
  ctx() { return { now: now(), profile: this.T, log: (kind, text, id) => this.logs.push({ kind, text, id }) }; }
  say(text) {
    const r = respond(this.c, this.conv, text, this.ctx());
    this.out = r.out;
    return r.out.map((o) => o.text).join('\n---\n');
  }
  get step() { return this.conv.script.step; }
  chips() { return this.out.flatMap((o) => o.chips || []).map((c) => c.label); }
}

export const chatAppts = (c, phone) => c.appointments.filter((a) => a.phone === phone);
