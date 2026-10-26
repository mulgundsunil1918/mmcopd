/**
 * "The same medicine under another brand" — one rule, shared by the main process, the screens and the website demo.
 *
 * A pharmacy holds Dolo 650, Crocin 650 and a plain "Paracetamol 650 mg Tablet": three names for ONE medicine (same ingredient, same
 * strength, same form). The owner's rule is that they must not live as unrelated stock rows — "Paracetamol 650 mg should stick with
 * any brand they add". Nothing is merged or moved: every brand stays its own drug (its own price, GST, batches, sales history), and
 * what ties them together is only their COMPOSITION. A brand added later joins the others the moment it is saved with the same
 * ingredient, strength and form — nobody has to link anything by hand.
 *
 * The composition key is deliberately strict, because a wrong match is worse than a missed one:
 *   - ingredient AND strength AND form must all be written; a drug missing any of them is never grouped;
 *   - "650 mg" = "650mg", ingredient order and case do not matter ("Ibuprofen + Paracetamol" = "paracetamol + ibuprofen" when each
 *     ingredient keeps its own strength), but "100 mg" ≠ "100 mg SR", "250 mg/5 ml" ≠ "125 mg/5 ml", Tablet ≠ Syrup ≠ Suspension.
 */

/** The form words a catalogue or a hand-typed list uses, folded to one spelling each. */
const FORM_WORDS: Record<string, string> = {
  tablet: 'tablet', tablets: 'tablet', tab: 'tablet', tabs: 'tablet',
  capsule: 'capsule', capsules: 'capsule', cap: 'capsule', caps: 'capsule',
  syrup: 'syrup', suspension: 'suspension', susp: 'suspension',
  drops: 'drops', drop: 'drops',
  injection: 'injection', inj: 'injection', infusion: 'injection',
  ointment: 'ointment', cream: 'cream', gel: 'gel', inhaler: 'inhaler', respules: 'respules', respule: 'respules',
  sachet: 'sachet', solution: 'solution', spray: 'spray',
};
/** Words that describe an amount, never a brand. */
const UNIT_WORDS = new Set(['mg', 'mcg', 'ug', 'g', 'gm', 'ml', 'iu', 'l', 'w', 'v', 'per', 'of', 'and', 'in']);

const squash = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const parts = (s: unknown) => squash(s).split('+').map((x) => x.trim()).filter(Boolean);

/** "650 mg" → "650mg", "250 mg / 5 ml" → "250mg/5ml". An amount per volume written on the last ingredient applies to the others too. */
function strengthParts(strength: unknown): string[] {
  const raw = parts(strength).map((p) => p.replace(/\s+/g, ''));
  const tail = raw.length ? raw[raw.length - 1].match(/\/[^/]+$/)?.[0] : undefined;
  return tail ? raw.map((p) => (p.includes('/') ? p : p + tail)) : raw;
}

function formOf(form: unknown): string {
  const f = squash(form);
  if (!f) return '';
  const first = f.split(' ')[0];
  return FORM_WORDS[f] || FORM_WORDS[first] || f;
}

export interface MedicineLike {
  id: number;
  name: string;
  generic_name?: string | null;
  strength?: string | null;
  form?: string | null;
  is_active?: number | boolean | null;
}

/** A strength that states an AMOUNT of the medicine ("650mg", "250mg/5ml", "0.5%"). A volume alone ("500ml" of a drip) or a dash does not. */
const AMOUNT = /\d\.?\d*(?:mg|mcg|µg|ug|g|gm|iu|%|units?|billion|million|cfu|lac|mu)/;

/** The composition key of a drug — null when it does not say its ingredient, strength and form (then it is never grouped). */
export function medicineKey(d: Pick<MedicineLike, 'generic_name' | 'strength' | 'form'>): string | null {
  const gen = parts(d.generic_name);
  const str = strengthParts(d.strength);
  const form = formOf(d.form);
  if (!gen.length || !str.length || !form) return null;
  if (!str.every((p) => AMOUNT.test(p))) return null;         // "Dextrose 5%" and "Dextrose 10%" are both "500 ml": that says nothing about WHICH medicine
  // pair each ingredient with its own strength so the order it is written in does not matter; when the counts differ the
  // strength is one figure for the whole product ("1 g"), so the ingredients are simply sorted
  const body = gen.length === str.length
    ? gen.map((g, i) => `${g}:${str[i]}`).sort().join('+')
    : `${[...gen].sort().join('+')}#${str.join('+')}`;
  return `${body}|${form}`;
}

/** True when the name is only the ingredient / strength / form (e.g. "Paracetamol 650 mg Tablet"), i.e. no brand word in it. */
export function isGenericNamed(d: Pick<MedicineLike, 'name' | 'generic_name' | 'strength' | 'form'>): boolean {
  const allowed = new Set<string>(UNIT_WORDS);
  const add = (s: unknown) => (String(s ?? '').toLowerCase().match(/[a-z]+/g) || []).forEach((w) => allowed.add(w));
  add(d.generic_name); add(d.strength); add(d.form);
  Object.keys(FORM_WORDS).forEach((w) => allowed.add(w));
  const words = String(d.name ?? '').toLowerCase().match(/[a-z]+/g) || [];
  return words.length > 0 && words.every((w) => allowed.has(w));
}

export interface MedicineGroup<T extends MedicineLike> {
  /** The composition key, or null for a drug that is on its own. */
  key: string | null;
  rows: T[];
}

/** Group drugs that are the same medicine. A drug without a key (or alone with its key) is a group of one. Order = first appearance. */
export function groupByMedicine<T extends MedicineLike & { medicine_key?: string | null }>(rows: T[]): MedicineGroup<T>[] {
  const out: MedicineGroup<T>[] = [];
  const at = new Map<string, MedicineGroup<T>>();
  for (const r of rows) {
    const key = r.medicine_key !== undefined ? r.medicine_key : medicineKey(r);
    if (!key) { out.push({ key: null, rows: [r] }); continue; }
    const hit = at.get(key);
    if (hit) hit.rows.push(r);
    else { const g = { key, rows: [r] }; at.set(key, g); out.push(g); }
  }
  return out;
}

/** The other drugs that are the same medicine as `d` (not `d` itself). */
export function siblingsOf<T extends MedicineLike & { medicine_key?: string | null }>(rows: T[], d: T): T[] {
  const key = d.medicine_key !== undefined ? d.medicine_key : medicineKey(d);
  if (!key) return [];
  return rows.filter((r) => r.id !== d.id && (r.medicine_key !== undefined ? r.medicine_key : medicineKey(r)) === key);
}

/** What the group is called on screen: its generic-named drug if it has one ("Paracetamol 650 mg Tablet"), else ingredient + strength + form. */
export function medicineTitle<T extends MedicineLike>(rows: T[]): string {
  const generic = rows.find((r) => isGenericNamed(r));
  if (generic) return generic.name;
  const r = rows[0];
  return [r.generic_name, r.strength, r.form].filter(Boolean).join(' ') || r.name;
}

/** What a screen needs to tell about one drug's stock when it looks at the medicine as a whole. */
export interface StockLike { id: number; stock_qty: number; low_stock_threshold?: number | null; is_active?: number | boolean | null; next_expiry?: string | null }

/**
 * A medicine is out of stock when NONE of its brands has a unit, and low when what is left over all its brands is at or below the
 * highest low-stock level any of them has. One brand running out while another is on the shelf is not a shortage of the medicine.
 */
export function medicineStock<T extends StockLike>(rows: T[]): { stock: number; low: boolean; out: boolean; nextExpiry: string | null } {
  const live = rows.filter((r) => Number(r.is_active ?? 1) === 1);
  const stock = rows.reduce((s, r) => s + (Number(r.stock_qty) || 0), 0);
  const level = Math.max(0, ...live.map((r) => Number(r.low_stock_threshold) || 0));
  const exp = rows.filter((r) => (Number(r.stock_qty) || 0) > 0 && r.next_expiry).map((r) => String(r.next_expiry)).sort()[0] ?? null;
  const active = live.length > 0;
  return { stock, low: active && stock > 0 && stock <= level, out: active && stock <= 0, nextExpiry: exp };
}

/**
 * The brands to offer when `current` is on a bill: the other drugs of the same medicine that have stock, the one whose stock expires
 * first leading (that is the order the shelf is emptied in), then the one with the most units.
 */
export function otherBrandsInStock<T extends MedicineLike & StockLike & { medicine_key?: string | null }>(rows: T[], current: T): T[] {
  return siblingsOf(rows, current)
    .filter((r) => Number(r.is_active ?? 1) === 1 && (Number(r.stock_qty) || 0) > 0)
    .sort((a, b) => String(a.next_expiry || '9999').localeCompare(String(b.next_expiry || '9999')) || (Number(b.stock_qty) || 0) - (Number(a.stock_qty) || 0) || a.name.localeCompare(b.name));
}
