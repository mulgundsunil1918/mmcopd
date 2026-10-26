/**
 * Limits on the discount a person may give at the PHARMACY COUNTER, by role (Settings → Billing & IPD → Discounts →
 * "At the pharmacy counter"). One rule for the main process (which enforces it) and the screens (which only warn early).
 *
 * The limit is a percentage of the sale's value before the discount, kept as a JSON map { role: percent } in the setting
 * `pharmacy_discount_caps_json`. A role with NO number is not limited — so an update never starts refusing discounts a clinic
 * already gives; the owner sets the numbers deliberately. A malformed map is the one exception: it must never silently grant
 * more than the owner meant, so every non-admin role is held at 0% until the setting is fixed. Admin is never limited.
 */
import { toPaise } from './pharmacyMath';


/** Roles shown in Settings (admin is always unlimited). */
export const COUNTER_DISCOUNT_ROLES = [
  'pharmacist', 'receptionist', 'doctor', 'manager', 'nurse', 'ward_incharge', 'lab_tech', 'radiology_tech',
] as const;

/** The parsed map, or null when the stored text is not a usable map (see above). */
export function parseCounterCaps(json: string | null | undefined): Record<string, number> | null {
  const text = (json ?? '').trim();
  if (!text) return {};
  try {
    const o = JSON.parse(text);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const out: Record<string, number> = {};
    for (const [role, v] of Object.entries(o as Record<string, unknown>)) {
      if (v === null || v === undefined || v === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      out[role] = Math.max(0, Math.min(100, n));
    }
    return out;
  } catch {
    return null;
  }
}

/** The most (percent of the sale) this role may take off at the counter; null = no limit applies to it. */
export function counterDiscountCap(json: string | null | undefined, role: string | null | undefined): number | null {
  if (!role || role === 'admin') return null;
  const caps = parseCounterCaps(json);
  if (caps === null) return 0;                                  // malformed: hold everyone but admin at 0%
  return Object.prototype.hasOwnProperty.call(caps, role) ? caps[role] : null;
}

/** The largest discount, in whole paise, that a percent limit allows on a sale of `subtotalPaise`. */
export function capPaise(subtotalPaise: number, pct: number): number {
  return Math.floor((subtotalPaise * Math.max(0, Math.min(100, pct))) / 100 + 1e-9);
}

/**
 * The value of a sale in whole paise, added up the way the main process adds it: every line is rounded to the paisa first, then the lines are summed.
 * The sale screens use this (not a plain sum of rupees) so what they show, what a percentage comes to and what the receipt prints are the same figure.
 */
export function saleSubtotalPaise(lines: { qty: number; rate: number }[]): number {
  return lines.reduce((s, l) => s + toPaise(Number(l.qty) * Number(l.rate)), 0);
}

/**
 * What a discount of `pct` percent (given to at most two decimals) takes off a sale of `subtotalPaise`, in whole paise — never rounded up. It is the
 * same rule as capPaise above, on purpose: a person whose limit is 10% who types exactly 10 is never refused for half a paisa.
 */
export function percentDiscountPaise(subtotalPaise: number, pct: number): number {
  return capPaise(subtotalPaise, Math.round(Math.max(0, pct) * 100) / 100);
}
