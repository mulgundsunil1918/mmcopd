/**
 * The wording of the WhatsApp messages a clinic sends with one click (Communication → WhatsApp Business): seven messages, each a template with
 * {{placeholders}} that are filled in for the patient.
 *
 * WHERE THEY ARE KEPT (owner, 2026-10-27: "all WhatsApp settings in Settings"): in the saved setting `whatsapp_templates_json` — a JSON map of ONLY the messages
 * the clinic changed, { confirmed: "…", review: "…" }. Before, they were kept in the browser's own storage on each computer, which no backup carries (a restore
 * or a new PC lost the clinic's wording) and which the other computers of the clinic never saw. Because only CHANGED messages are stored, a message the
 * clinic never touched follows any improvement made to the built-in wording in a later version.
 *
 * NO EMOJI, ever (see lib/messageText.ts): the wording is cleaned of emoji when it is read, whatever was typed or restored.
 */
import { cleanForWhatsApp } from './messageText';

export interface WaTemplateType { key: string; label: string; icon: string }

/** The seven one-click messages, in the order they appear. `icon` is for the buttons on screen only — it is never part of a message. */
export const WA_TEMPLATE_TYPES: WaTemplateType[] = [
  { key: 'confirmed', label: 'Appt Confirmed', icon: '✅' },
  { key: 'visit_done', label: 'Visit Done', icon: '🏥' },
  { key: 'review', label: 'Google Review', icon: '⭐' },
  { key: 'rx', label: 'Rx Ready', icon: '💊' },
  { key: 'lab', label: 'Lab Ready', icon: '🧪' },
  { key: 'radiology', label: 'Radiology Ready', icon: '📷' },
  { key: 'bill', label: 'Bill', icon: '🧾' },
];

/** The built-in wording. Variables: {{patient_name}} {{doctor_name}} {{date}} {{time}} {{token}} {{clinic_name}} {{clinic_phone}} {{clinic_address}} {{review_link}} */
export const DEFAULT_WA_TEMPLATES: Record<string, string> = {
  confirmed:  `Namaste {{patient_name}},\n\nYour appointment at *{{clinic_name}}* is confirmed!\n\n*Doctor:* {{doctor_name}}\n*Date:* {{date}}   *Time:* {{time}}\n*Token:* #{{token}}\n\nPlease arrive 10 minutes early.\n\n{{clinic_address}}\nPhone: {{clinic_phone}}\n\nThank you,\n*{{clinic_name}}*`,
  visit_done: `Hello {{patient_name}},\n\nThank you for visiting *{{clinic_name}}* today! We hope you had a wonderful experience.\n\nFor any follow-up or queries, please call us at {{clinic_phone}}.\n\nTake care!\n*{{clinic_name}}*`,
  review:     `Hello {{patient_name}},\n\nThank you for visiting *{{clinic_name}}*!\n\nWe'd love to hear about your experience - could you spare a moment to leave us a Google review?\n\n{{review_link}}\n\nYour feedback means a lot to us. Thank you!\n*{{clinic_name}}*`,
  rx:         `Hello {{patient_name}},\n\nYour prescription from *{{clinic_name}}* is ready. Please collect it at your earliest convenience.\n\nThank you,\n*{{clinic_name}}*`,
  lab:        `Hello {{patient_name}},\n\nYour lab report is ready at *{{clinic_name}}*. Please collect it at your convenience.\n\nThank you,\n*{{clinic_name}}*`,
  radiology:  `Hello {{patient_name}},\n\nYour radiology report is ready at *{{clinic_name}}*. Please collect it at your convenience.\n\nThank you,\n*{{clinic_name}}*`,
  bill:       `Hello {{patient_name}},\n\nThank you for visiting *{{clinic_name}}*. Your bill is ready.\n\nFor any queries, call us at {{clinic_phone}}.\n\nThank you!`,
};

/** The placeholders a message may use, for the editor's reminder line. */
export const WA_VARIABLES = '{{patient_name}}  {{doctor_name}}  {{date}}  {{time}}  {{token}}  {{clinic_name}}  {{clinic_phone}}  {{clinic_address}}';

/** What the clinic changed, from the saved JSON: only the known messages, only text, emoji removed. Anything unreadable = nothing changed. */
export function parseWaOverrides(json: string | null | undefined): Record<string, string> {
  const text = (json ?? '').trim();
  if (!text) return {};
  try {
    const o = JSON.parse(text);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out: Record<string, string> = {};
    for (const t of WA_TEMPLATE_TYPES) {
      const v = (o as Record<string, unknown>)[t.key];
      if (typeof v === 'string' && v.trim()) out[t.key] = cleanForWhatsApp(v);       // an emptied message falls back to the built-in wording
    }
    return out;
  } catch { return {}; }
}

/** All seven messages as they will be sent: the built-in wording with the clinic's changes laid over it. */
export function resolveWaTemplates(json: string | null | undefined): Record<string, string> {
  return { ...DEFAULT_WA_TEMPLATES, ...parseWaOverrides(json) };
}

/** The text to save: only the messages that differ from the built-in wording ('' when none do). */
export function serializeWaTemplates(templates: Record<string, string>): string {
  const changed: Record<string, string> = {};
  for (const t of WA_TEMPLATE_TYPES) {
    const v = templates[t.key];
    if (typeof v === 'string' && v.trim() && v !== DEFAULT_WA_TEMPLATES[t.key]) changed[t.key] = v;
  }
  return Object.keys(changed).length ? JSON.stringify(changed) : '';
}

/** The old browser-storage copies (this computer only) — read once to carry the clinic's wording into the saved setting. */
export const OLD_LOCAL_KEYS = ['curedesk_wa_m1_templates_v2', 'curedesk_wa_m1_templates_v1'];

/** What the old storage held that differs from the built-in wording (cleaned of emoji), or {} — never throws, and never touches storage unavailable. */
export function readOldLocalOverrides(storage: Pick<Storage, 'getItem'> | null | undefined): Record<string, string> {
  if (!storage) return {};
  for (const key of OLD_LOCAL_KEYS) {                      // the newer copy wins; the old v1 copy is only used when there is no v2
    let raw: string | null = null;
    try { raw = storage.getItem(key); } catch { raw = null; }
    if (raw === null) continue;
    const found = parseWaOverrides(raw);
    const changed: Record<string, string> = {};
    for (const [k, v] of Object.entries(found)) if (v !== cleanForWhatsApp(DEFAULT_WA_TEMPLATES[k] ?? '')) changed[k] = v;
    return changed;
  }
  return {};
}
