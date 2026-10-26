/**
 * What a printed bill line IS, read from the bill's own words and codes — never from a guess.
 *
 * Pure helpers shared by the reader (draft.ts), the checks (check.ts) and the screens:
 *   · consumables (syringes, cannulas, sutures, tapes, bed sheets) are told apart from medicines by what the bill prints (ChatGPT's own "not a medicine"
 *     note, the HSN code, plain words in the name) — they have no generic name, no strength and no schedule, and some print no batch or expiry;
 *   · a "no expiry" batch is stored with one far-off date (the column is NOT NULL and the app sorts by it) and shown as "No expiry" everywhere;
 *   · billing notes typed into a name ("-NO DISC") are not part of the medicine's name;
 *   · a strength the bill prints in the name itself ("KLOTIN INJ 500MG") is the bill's own word, so it may be offered without any lookup;
 *   · a free-goods offer typed into the name ("… 1+1") and the "page 1 of 2" of a bill that was read only in part.
 */
import { cleanText } from './normalize';
export { NO_EXPIRY, isNoExpiry, expiryLabel } from '../expiry';

/** The batch name given to a consumable whose box prints no batch number. */
export const NO_BATCH = 'NO BATCH';

export type ItemType = 'medicine' | 'consumable';

/** HSN chapters/headings of things that are not medicines: instruments & syringes & cannulas (9018), appliances (9019, 9021), dressings & tapes (3005), sutures & haemostats (300610), plastic sheets (3920-3926), gloves (4014-4015), cloth (6307), wadding (5601). */
const CONSUMABLE_HSN = ['9018', '9019', '9021', '3005', '300610', '3920', '3921', '3923', '3926', '4014', '4015', '6307', '5601'];
const CONSUMABLE_WORDS = /\b(syringes?|needles?|cannulas?|catheters?|i\.?\s?v\.?\s?set|infusion set|drip set|sutures?|bandages?|dressings?|gauze|gloves?|masks?|bed\s?sheets?|diapers?|swabs?|scalpel|blades?|lancets?|aprons?|gowns?|drapes?|tapes?|plasters?|cotton|fixator)\b/i;

/** Is this bill line a consumable rather than a medicine? Only what the bill (or ChatGPT's note about it) says. */
export function looksConsumable(o: { name: string; hsn: string; flags: string }): boolean {
  if (/not a standard medicine/i.test(o.flags)) return false;                 // homeopathic / ayurvedic: still a medicine
  if (/not a medicine/i.test(o.flags)) return true;
  const hsn = cleanText(o.hsn).replace(/\D/g, '');
  if (hsn && CONSUMABLE_HSN.some((p) => hsn.startsWith(p))) return true;
  return CONSUMABLE_WORDS.test(cleanText(o.name));
}

/** A billing note typed into the name ("…-NO DISC", "(NO DISC)") is not part of the medicine's name. */
export function stripBillingNotes(name: string): string {
  return cleanText(name).replace(/[\s\-–(]*\bno\s*disc(?:ount)?\b[\s)]*$/i, '').replace(/[\s\-–]+$/, '').trim();
}

/**
 * The strength the bill prints in the name itself: "KLOTIN INJ 500MG" → "500 mg", "LOX TOPICAL 4%" → "4%", "NOVACLAV 1.2G INJ" → "1.2 g".
 * Empty when it prints none, prints a combination ("2% + ADRENALINE"), or prints two different strengths. Never a guess: the number and unit are the bill's own.
 */
export function printedStrength(name: string): string {
  const t = cleanText(name).toLowerCase();
  if (t.includes('+')) return '';
  const found = new Set<string>();
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(mg|mcg|µg|ug|gm|g|iu|%)(?![a-z])(?:\s*\/\s*(\d*(?:\.\d+)?)\s*(ml|l|g|gm|dose)(?![a-z]))?/g)) {
    const unit = m[2] === 'gm' ? 'g' : m[2] === 'ug' || m[2] === 'µg' ? 'mcg' : m[2] === 'iu' ? 'IU' : m[2];
    let s = unit === '%' ? `${m[1]}%` : `${m[1]} ${unit}`;
    if (m[4]) s += `/${m[3] ? `${m[3]} ` : ''}${m[4] === 'gm' ? 'g' : m[4]}`;
    found.add(s);
  }
  return found.size === 1 ? [...found][0] : '';
}

/** A free-goods offer typed into the name ("… 1+1", "… 10+2"): two small numbers, the second not bigger than the first. */
export function schemeInName(name: string): { paid: number; free: number } | null {
  const m = cleanText(name).match(/(?:^|[\s(])(\d{1,2})\s*\+\s*(\d{1,2})(?=$|[\s)])/);
  if (!m) return null;
  const paid = Number(m[1]), free = Number(m[2]);
  return paid >= 1 && free >= 1 && free <= paid ? { paid, free } : null;
}

/**
 * "Pages seen" as ChatGPT wrote it ("2 of 2", "1/2", "page 1 of 2"). Returns the shortfall when the bill has more pages than were read —
 * no page reached its own total — else null (all read, or nothing that can be understood).
 */
export function pagesMissing(text: string): { seen: number; total: number } | null {
  const pairs = [...cleanText(text).toLowerCase().matchAll(/(\d+)\s*(?:of|out of|\/)\s*(\d+)/g)].map((m) => ({ seen: Number(m[1]), total: Number(m[2]) }));
  if (!pairs.length) return null;
  if (pairs.some((p) => p.seen >= p.total)) return null;
  return pairs.reduce((a, b) => (b.total > a.total ? b : a));
}

// ---------------------------------------------------------------------------------------------------------------- what ChatGPT looked up
/** Words ChatGPT sometimes writes INTO a lookup cell instead of leaving it empty and saying so in Flags. */
const NOT_A_VALUE = /^(ambiguous|not found|not available|n\/?a|unknown|none|nil|unconfirmed|not confirmed|not verified|\?+|—|-)$/i;
/**
 * A lookup cell as the VALUE it should be: "AMBIGUOUS" or "NOT FOUND" typed into Strength is not a strength, and a remark in brackets
 * ("1 mg/ml (strength not independently confirmed)") is not part of it — both would otherwise be offered as the new medicine's strength.
 */
export function lookupCell(v: unknown): string {
  const t = cleanText(v);
  if (NOT_A_VALUE.test(t)) return '';
  return t.replace(/\s*\((?=[^)]*\b(?:not (?:independently )?(?:confirmed|verified)|unconfirmed|unverified|uncertain|could not|not sure)\b)[^)]*\)\s*$/i, '').trim();
}

const NAME_NOISE = new Set(['inj', 'injection', 'inf', 'infusion', 'tab', 'tablet', 'tabs', 'cap', 'capsule', 'caps', 'syp', 'syrup', 'susp', 'suspension', 'drops', 'cream', 'ointment', 'gel',
  'amp', 'ampoule', 'ampule', 'vial', 'iv', 'im', 'ml', 'mg', 'gm', 'mcg', 'ltr', 'no', 'nw', 'for', 'of', 'the', 'and', 'with', 'plus', 'kit', 'set', 'strip', 'pack', 'disc', 'new', 'sol', 'solution', 'inf.']);
const lookWords = (s: string): string[] => (cleanText(s).toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !NAME_NOISE.has(w));
/** Two words are "the same name" if they are equal or share their first four letters (ONDANAUS / Ondansetron). */
const sameWord = (a: string, b: string): boolean => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));

/**
 * Does what ChatGPT looked up look like THIS line? ChatGPT once wrote Novaclav's composition on the row of "HYOKEM INJ" (the lookups slid one row).
 * A brand or generic that shares no word with the name as printed belongs to another line: it must not be offered as this medicine's composition.
 * True when nothing can be told (no lookup, or a name with no usable word).
 */
export function lookupFits(printedName: string, lookup: { brand: string; generic: string }): boolean {
  const printed = lookWords(printedName);
  const found = [...lookWords(lookup.brand), ...lookWords(lookup.generic)];
  if (!printed.length || !found.length) return true;
  return printed.some((p) => found.some((f) => sameWord(p, f)));
}
