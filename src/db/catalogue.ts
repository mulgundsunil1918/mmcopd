import type Database from 'better-sqlite3';
import { PHARMACY_CATALOG } from '../data/pharmacy-catalog';
import { PHARMACY_CATALOG_V1 } from '../data/pharmacy-catalog-v1';

/**
 * Brings a clinic's Drug List up to the current standard catalogue (pharmacy-catalog.ts) WITHOUT ever overwriting what the clinic did.
 *
 * What it does, per drug in the new catalogue:
 *   · the clinic already has it, and its composition (generic name, form, strength, pack size) is still EXACTLY what the old catalogue
 *     (pharmacy-catalog-v1.ts, frozen) shipped → nobody edited it, so it is corrected to the new composition (e.g. "100 ml" → "30 mg + 1 mg
 *     + 50 mg/5 ml");
 *   · the clinic already has it but those four values are anything else → the clinic changed them: left exactly as it is;
 *   · the clinic does not have it → added (see the two modes below).
 *   · SCHEDULE: a medicine the new list marks with a different schedule (the third-generation cephalosporins, levofloxacin, tramadol, rifampicin
 *     … are Schedule H1, not H) is corrected when the clinic's row still carries exactly the schedule the old list shipped. A schedule the clinic
 *     set itself (anything else) is left alone. Nothing else about the medicine changes.
 * Never touched, in any row: price (MRP), GST, low-stock level, barcode, notes, active flag, manufacturer — and no stock, batch or
 * bill, which do not live in drug_master at all. Prescriptions, bills and purchases point at a drug by its id, which never changes.
 *
 *   'upgrade' — runs ONCE when a clinic updates (db/migrations.ts). Adds only drugs that are NEW to the catalogue (never puts back one the
 *               clinic deleted), and only to a clinic that is still using the standard list (it holds ≥ STILL_USING_STANDARD_LIST of the old
 *               names). A clinic that pressed "Start fresh", or built its own list, is not handed 100 drugs it did not ask for.
 *   'manual'  — the "Load standard drug catalogue" button in Settings: adds every catalogue drug the list is missing.
 */
export const CATALOGUE_FLAG = 'drug_catalogue_v2';
/** The schedule correction (H → H1 …) runs once on its own too, for a clinic whose catalogue update ran before it existed. */
export const SCHEDULE_FLAG = 'drug_schedules_v2';
export const STILL_USING_STANDARD_LIST = 25;

export interface CatalogueRefresh { added: number; corrected: number; kept: number; rescheduled: number }

interface Composition { generic_name: string; form: string; strength: string; pack_size: number | null }
const key = (name: string) => name.trim().toLowerCase();
const compOf = (d: { generic_name?: string | null; form?: string | null; strength?: string | null; pack_size?: number | null }): Composition =>
  ({ generic_name: d.generic_name ?? '', form: d.form ?? '', strength: d.strength ?? '', pack_size: d.pack_size ?? null });
const same = (a: Composition, b: Composition) =>
  a.generic_name === b.generic_name && a.form === b.form && a.strength === b.strength && a.pack_size === b.pack_size;

const OLD_BY_NAME = new Map(PHARMACY_CATALOG_V1.map((d) => [key(d.name), d]));

/**
 * The schedule correction on its own: every medicine whose row still has the schedule the OLD list shipped, and which the new list marks
 * differently, gets the new one. Idempotent (a second run finds nothing). Returns how many rows it corrected.
 */
export function correctSchedules(db: Database.Database): number {
  const rows = db.prepare('SELECT id, name, schedule FROM drug_master').all() as { id: number; name: string; schedule: string }[];
  const set = db.prepare('UPDATE drug_master SET schedule=? WHERE id=? AND schedule=?');
  const byName = new Map<string, typeof rows>();
  for (const r of rows) byName.set(key(r.name), [...(byName.get(key(r.name)) ?? []), r]);
  let n = 0;
  db.transaction(() => {
    for (const d of PHARMACY_CATALOG) {
      const old = OLD_BY_NAME.get(key(d.name));
      if (!old || old.schedule === d.schedule) continue;
      for (const r of byName.get(key(d.name)) ?? []) if (r.schedule === old.schedule) n += set.run(d.schedule, r.id, old.schedule).changes;
    }
  })();
  return n;
}

export function refreshCatalogue(db: Database.Database, mode: 'upgrade' | 'manual'): CatalogueRefresh {
  const have = new Map<string, { id: number; generic_name: string | null; form: string | null; strength: string | null; pack_size: number | null }>();
  for (const r of db.prepare('SELECT id, name, generic_name, form, strength, pack_size FROM drug_master ORDER BY id').all() as any[]) {
    if (!have.has(key(r.name))) have.set(key(r.name), r);
  }
  let oldNamesHeld = 0;
  for (const k of OLD_BY_NAME.keys()) if (have.has(k)) oldNamesHeld++;
  const bringNew = mode === 'manual' || oldNamesHeld >= STILL_USING_STANDARD_LIST;

  const fix = db.prepare('UPDATE drug_master SET generic_name=?, form=?, strength=?, pack_size=? WHERE id=?');
  const add = db.prepare(
    `INSERT INTO drug_master (name, generic_name, form, strength, pack_size, schedule, gst_rate, default_mrp, low_stock_threshold, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, 1)`
  );
  let added = 0, corrected = 0, kept = 0;
  db.transaction(() => {
    for (const d of PHARMACY_CATALOG) {
      const k = key(d.name);
      const row = have.get(k);
      const old = OLD_BY_NAME.get(k);
      if (row) {
        const now = compOf(row), next = compOf(d);
        if (same(now, next)) continue;
        if (old && same(now, compOf(old))) { fix.run(next.generic_name, next.form, next.strength, next.pack_size, row.id); corrected++; }
        else kept++;
        continue;
      }
      if (mode === 'upgrade' && (old || !bringNew)) continue;   // a drug the clinic removed stays removed; nothing new goes to a clinic that left the standard list
      add.run(d.name, d.generic_name, d.form, d.strength, d.pack_size ?? null, d.schedule, d.gst_rate, d.default_mrp);
      added++;
    }
  })();
  const rescheduled = correctSchedules(db);
  return { added, corrected, kept, rescheduled };
}
