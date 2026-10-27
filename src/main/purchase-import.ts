/**
 * Importing a supplier's bill from the Excel ChatGPT made (Pharmacy → Purchases → Import bill).
 *
 * Plain functions over a database handle (no Electron), so every rule can be tested against a real database:
 *   · parseBillFile   the uploaded file → a draft the screen can show (header, lines, which medicine each is, what is missing);
 *   · commitImport    the checked draft → a normal purchase bill, in ONE transaction — and only if the typed word IMPORT came with it;
 *   · the waiting list  lines the pharmacist set aside, kept (with the bill's photo) until they are finished or thrown away.
 *
 * The rules that make it safe:
 *   · NOTHING reaches stock without the person typing IMPORT; the phrase is checked HERE as well as on the screen;
 *   · the checks (lib/billImport/check.ts) are run again here on whatever the screen sent, so a stale or doctored screen cannot get a bad bill in;
 *   · a new medicine or supplier is created ONLY when the person asked for it on that line — never from ChatGPT's lookup alone;
 *   · it is an ordinary purchase bill (createPurchase): the same totals, stock costing, FEFO batches and "already recorded" guard as typing it in;
 *   · all or nothing: any failure leaves no half-saved bill, no stray medicine, no stray supplier;
 *   · saved twice (a double click) is saved once: the same client_ref returns the first.
 */
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { createPurchase, getPurchase, isIsoDate, localISO, type PurchaseIn } from './pharmacy-finance';
import {
  NOT_EXCEL_MESSAGE, aliasKey, buildDraft, buildTemplateWorkbook, checkDraft, looksLikeExcel, planParts, readBillRows, readWorkbook,
  NO_BATCH, NO_EXPIRY,
  type Draft, type DraftLine, type ImportCommit, type ImportResult, type NewDrugSpec, type ParseResult, type WaitingGet, type WaitingRow,
} from '../lib/billImport';
export type { ImportCommit, ImportResult, ParseResult, WaitingRow };
import { toPaise } from '../lib/pharmacyMath';

const clean = (v: unknown): string => String(v ?? '').trim().replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------------------------------------------- template
/** The Excel (empty, or with a sample bill) as base64 text. */
export function importTemplate(withSample: boolean): string {
  return Buffer.from(buildTemplateWorkbook(XLSX, withSample, localISO())).toString('base64');
}

// ---------------------------------------------------------------------------------------------------------------- reading a file
const existingInvoice = (db: Database.Database) => (wholesalerId: number | null, invoiceNumber: string) => {
  if (wholesalerId === null) return null;
  const r = db.prepare('SELECT id, invoice_date AS date FROM purchase_invoices WHERE wholesaler_id=? AND lower(trim(invoice_number))=lower(?)').get(wholesalerId, invoiceNumber.trim()) as { id: number; date: string } | undefined;
  return r ?? null;
};

/** Context from the clinic's own lists: its drugs, what it taught the matcher before, its suppliers. */
function context(db: Database.Database) {
  return {
    drugs: db.prepare("SELECT id, name, generic_name, form, strength, is_active, COALESCE(item_type, 'medicine') AS item_type FROM drug_master").all() as { id: number; name: string; generic_name: string | null; form: string | null; strength: string | null; is_active: number; item_type: string }[],
    aliases: (db.prepare('SELECT alias, drug_master_id AS drug_id, supplier_id FROM purchase_name_aliases').all() as { alias: string; drug_id: number; supplier_id: number | null }[]),
    suppliers: db.prepare('SELECT id, name, gstin, drug_license_no, is_active FROM wholesalers').all() as { id: number; name: string; gstin: string | null; drug_license_no: string | null; is_active: number }[],
    today: localISO(),
  };
}

export const MAX_EXCEL_BYTES = 20 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

/** What the screen sent as the file: base64 text (what crosses the app's IPC), or raw bytes (a test, a script). */
const bytesOf = (v: unknown): Uint8Array => (typeof v === 'string' ? new Uint8Array(Buffer.from(v, 'base64')) : v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(0));

export function parseBillFile(db: Database.Database, file: string | Uint8Array | ArrayBuffer): ParseResult {
  const data = bytesOf(file);
  if (!looksLikeExcel(data)) return { ok: false, problems: [NOT_EXCEL_MESSAGE] };
  if (data.byteLength > MAX_EXCEL_BYTES) return { ok: false, problems: ['That Excel file is too big (over 20 MB). A supplier bill should be a few hundred kilobytes — check it is the right file.'] };
  let rows;
  try { rows = readWorkbook(XLSX, data); }
  catch { return { ok: false, problems: ['That file could not be opened as an Excel file (.xlsx). Download the Excel from ChatGPT again.'] }; }
  const read = readBillRows(rows.billRows, rows.itemRows);
  if (read.problems.length) return { ok: false, problems: read.problems };
  const draft = buildDraft(read, context(db));
  const dup = existingInvoice(db)(draft.bill.wholesaler_id, draft.bill.invoice_number);
  return { ok: true, draft, notices: read.notices, duplicate: dup };
}

export function checkInvoiceNumber(db: Database.Database, wholesalerId: number | null, invoiceNumber: string) {
  return existingInvoice(db)(wholesalerId === null ? null : Number(wholesalerId), String(invoiceNumber ?? ''));
}

// ---------------------------------------------------------------------------------------------------------------- the commit
const SCHEDULES = ['OTC', 'H', 'H1', 'G', 'X'];

function savePhoto(dir: string, photo: { name: string; data: Uint8Array }, tag: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const ext = (path.extname(String(photo.name || '')).toLowerCase().match(/^\.(jpe?g|png|webp|gif|heic|pdf|bmp|tiff?)$/) ?? ['.jpg'])[0];
  const safe = tag.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 40) || 'bill';
  const file = path.join(dir, `${safe}-${Date.now().toString(36)}${ext}`);
  fs.writeFileSync(file, photo.data);
  return file;
}

export function commitImport(db: Database.Database, input: ImportCommit, opts: { by?: string | null; scanDir: string }): ImportResult {
  if (clean(input?.confirm).toUpperCase() !== 'IMPORT') return { ok: false, error: 'To add this bill to your stock, type IMPORT to confirm.' };
  const ref = clean(input?.client_ref);
  if (ref) {
    const hit = db.prepare('SELECT id, invoice_number, total FROM purchase_invoices WHERE client_ref=?').get(ref) as { id: number; invoice_number: string; total: number } | undefined;
    if (hit) return { ok: true, duplicate: true, invoice_id: hit.id, invoice_number: hit.invoice_number, lines: 0, batches: 0, total: hit.total, new_drugs: 0, reactivated: 0, new_supplier: false, aliases_saved: 0, waiting_id: null, aside: 0 };
  }
  if (!input?.draft || !input.draft.bill || !Array.isArray(input.draft.lines)) return { ok: false, error: 'There is no bill to import.' };
  // a consumable (syringe, bed sheet…) is judged from the Drug List itself, never from what the screen says, so a stale or doctored screen cannot skip the batch / expiry rule
  const typeOf = db.prepare("SELECT COALESCE(item_type, 'medicine') AS t FROM drug_master WHERE id=?");
  const draft: Draft = {
    ...input.draft,
    lines: input.draft.lines.map((l) => (l.drug_id !== null && !l.new_drug ? { ...l, consumable: (typeOf.get(l.drug_id) as { t: string } | undefined)?.t === 'consumable' } : { ...l, consumable: false })),
  };
  const photoBytes = input.photo?.base64 ? bytesOf(input.photo.base64) : null;
  if (photoBytes && photoBytes.byteLength > MAX_PHOTO_BYTES) return { ok: false, error: 'The bill photo is too big (over 20 MB). Use a smaller picture or a PDF.' };

  // the same checks as on the screen, on what the screen sent
  const result = checkDraft(draft, { today: localISO(), existingInvoice: existingInvoice(db) });
  if (!result.ready) {
    const errs = result.problems.filter((p) => p.severity === 'error');
    return { ok: false, error: `This bill is not ready to import: ${errs.slice(0, 3).map((p) => p.message).join(' ')}${errs.length > 3 ? ` (and ${errs.length - 3} more)` : ''}`, problems: errs };
  }

  const plan = planParts(draft.bill, draft.lines);
  const finishing = input.waiting_id ? (db.prepare("SELECT id, scan_path FROM purchase_import_waiting WHERE id=? AND status='waiting'").get(Number(input.waiting_id)) as { id: number; scan_path: string | null } | undefined) : undefined;
  let photoPath: string | null = finishing?.scan_path ?? null;
  let wrotePhoto = false, committed = false;
  let newDrugs = 0, reactivated = 0, newSupplier = false, supplierSwitchedOn = false, aliasesSaved = 0, waitingId: number | null = null;
  try {
    if (photoBytes && input.photo) { photoPath = savePhoto(opts.scanDir, { name: input.photo.name, data: photoBytes }, `${draft.bill.invoice_number}`); wrotePhoto = true; }
    let invoice!: { id: number; duplicate: boolean };
    const tx = db.transaction(() => {
      // ---- the supplier ----
      let supplierId = draft.bill.wholesaler_id;
      // A supplier that was deleted from the Wholesalers list while it still had bills is only SWITCHED OFF: importing a bill from it switches it on again
      // (it is never a reason to refuse the bill, and never a reason to make a second supplier of the same name).
      const switchOn = (id: number) => { if (db.prepare('UPDATE wholesalers SET is_active=1 WHERE id=? AND is_active<>1').run(id).changes > 0) supplierSwitchedOn = true; };
      if (supplierId !== null) {
        if (!db.prepare('SELECT 1 FROM wholesalers WHERE id=?').get(supplierId)) throw new Error('The supplier chosen for this bill no longer exists.');
        switchOn(supplierId);
      } else {
        const name = clean(draft.bill.supplier_name), lic = clean(draft.bill.supplier_license);
        if (!name || !lic) throw new Error('A new supplier needs a name and a drug licence number.');
        const same = db.prepare('SELECT id, is_active, gstin FROM wholesalers WHERE lower(name)=lower(?) ORDER BY is_active DESC, id LIMIT 1').get(name) as { id: number; is_active: number; gstin: string | null } | undefined;
        if (same && same.is_active === 1) throw new Error(`A supplier called "${name}" already exists — choose it from the Supplier list on this screen instead of adding it again.`);
        if (same) {                                      // the same supplier, switched off: use it again rather than make a twin
          supplierId = same.id;
          switchOn(same.id);
          if (!same.gstin && clean(draft.bill.supplier_gstin)) db.prepare('UPDATE wholesalers SET gstin=? WHERE id=?').run(clean(draft.bill.supplier_gstin), same.id);
        } else {
          supplierId = Number(db.prepare('INSERT INTO wholesalers (name, drug_license_no, gstin, is_active) VALUES (?, ?, ?, 1)').run(name, lic, clean(draft.bill.supplier_gstin) || null).lastInsertRowid);
          newSupplier = true;
        }
      }

      // ---- the medicines: existing ones are checked, new ones created once each ----
      const created = new Map<string, number>();
      const getDrug = db.prepare('SELECT id, name, is_active FROM drug_master WHERE id=?');
      const byName = db.prepare('SELECT id, is_active FROM drug_master WHERE lower(name)=lower(?) ORDER BY is_active DESC, id LIMIT 1');
      const wake = db.prepare("UPDATE drug_master SET is_active=1, updated_at=datetime('now') WHERE id=?");
      const insDrug = db.prepare(`INSERT INTO drug_master (name, generic_name, manufacturer, form, strength, pack_size, schedule, hsn_code, gst_rate, default_mrp, low_stock_threshold, is_active, item_type)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 10, 1, ?)`);
      const drugFor = (l: DraftLine): number => {
        if (l.new_drug) {
          const nd: NewDrugSpec = l.new_drug;
          const key = clean(nd.name).toLowerCase();
          if (created.has(key)) return created.get(key) as number;
          const same = byName.get(clean(nd.name)) as { id: number; is_active: number } | undefined;
          if (same) {                                                                  // already in the Drug List by that name (added a moment ago, by a repeat, or switched off): never twice
            if (!same.is_active) { wake.run(same.id); reactivated++; }                 // a switched-off medicine the person is adding again is the same medicine: switch it back on, or its stock would be hidden
            created.set(key, same.id); return same.id;
          }
          const cons = nd.item_type === 'consumable';
          if (!cons && !SCHEDULES.includes(nd.schedule)) throw new Error(`Line ${l.line_no}: choose the schedule of the new medicine.`);
          const id = Number(insDrug.run(clean(nd.name), cons ? null : clean(nd.generic_name) || null, clean(l.manufacturer) || null, clean(nd.form) || (cons ? 'Consumable' : null), cons ? null : clean(nd.strength) || null,
            nd.pack_size && nd.pack_size > 0 ? Math.floor(nd.pack_size) : null, cons ? 'OTC' : nd.schedule, clean(nd.hsn_code) || null, l.gst_rate ?? 0, l.mrp ?? 0, cons ? 'consumable' : 'medicine').lastInsertRowid);
          created.set(key, id); newDrugs++;
          return id;
        }
        const row = getDrug.get(l.drug_id as number) as { id: number; name: string; is_active: number } | undefined;
        if (!row) throw new Error(`Line ${l.line_no} (${l.printed_name}): that medicine is no longer in the Drug List.`);
        if (!row.is_active) throw new Error(`Line ${l.line_no} (${l.printed_name}): "${row.name}" is switched off in your Drug List. Switch it on again there, or choose another medicine.`);
        return row.id;
      };
      const lineDrug = new Map<number, number>();
      for (const l of plan.importLines) lineDrug.set(l.id, drugFor(l));

      // ---- remember what the person confirmed, for this supplier ----
      const putAlias = db.prepare('INSERT INTO purchase_name_aliases (supplier_id, alias, drug_master_id) VALUES (?, ?, ?) ON CONFLICT(supplier_id, alias) DO UPDATE SET drug_master_id=excluded.drug_master_id');
      for (const l of plan.importLines) {
        const key = aliasKey(l.printed_name);
        if (!key) continue;
        const id = lineDrug.get(l.id) as number;
        const auto = (l.match.kind === 'exact' || l.match.kind === 'alias') && l.match.candidates[0]?.id === id;
        if (!auto) { putAlias.run(supplierId, key, id); aliasesSaved++; }
      }

      // ---- the bill itself: an ordinary purchase ----
      const part = clean(draft.bill.part_of);
      const payload: PurchaseIn = {
        client_ref: ref || null,
        invoice_number: clean(draft.bill.invoice_number),
        wholesaler_id: supplierId as number,
        invoice_date: draft.bill.invoice_date,
        received_date: localISO(),
        discount: plan.header.discount, other_charges: plan.header.other_charges, interstate: draft.bill.interstate, round_off: plan.header.round_off,
        gst_in_cost: typeof input.gst_in_cost === 'boolean' ? input.gst_in_cost : undefined,
        payment_mode: clean(draft.bill.pay_mode) || null, amount_paid: Math.max(0, Number(draft.bill.paid_now) || 0),
        scan_path: photoPath,
        notes: [
          `Imported from the bill (ChatGPT → Excel) on ${localISO()} · ${plan.importLines.length} line${plan.importLines.length === 1 ? '' : 's'}`,
          plan.asideLines.length ? `${plan.asideLines.length} medicine${plan.asideLines.length === 1 ? '' : 's'} set aside to finish later` : '',
          part ? `Later part of invoice ${part}` : '',
          clean(draft.bill.notes),
        ].filter(Boolean).join('. '),
        items: plan.importLines.map((l) => {
          // a consumable that prints no batch / expiry is stored as "NO BATCH" / "No expiry" (the checks above let it through for that reason only)
          const cons = l.new_drug ? l.new_drug.item_type === 'consumable' : l.consumable === true;
          return {
          drug_master_id: lineDrug.get(l.id) as number, batch_no: clean(l.batch) || (cons ? NO_BATCH : ''), expiry: l.expiry || (cons ? NO_EXPIRY : ''), qty_received: l.qty as number, free_qty: l.free_qty || 0,
          purchase_price: l.rate as number, disc_pct: l.disc_pct || 0, mrp: l.mrp as number, selling_price: l.selling_price, gst_rate: l.gst_rate ?? 0,
          }; }),
      };
      if (!isIsoDate(payload.invoice_date)) throw new Error('The invoice date is not valid.');
      invoice = createPurchase(db, payload, opts.by ?? null);

      // ---- the lines that wait ----
      {
        if (plan.asideLines.length > 0) {
          const base = part || clean(draft.bill.invoice_number);
          const likeBase = base.replace(/[\\%_]/g, (c) => `\\${c}`);                     // a % or _ in an invoice number must match itself, not "anything"
          const partNo = (db.prepare("SELECT COUNT(*) AS c FROM purchase_invoices WHERE wholesaler_id=? AND (invoice_number=? OR invoice_number LIKE ? ESCAPE '\\')").get(supplierId, base, `${likeBase} (part %`) as { c: number }).c + 1;
          const remainder: Draft = {
            bill: {
              ...draft.bill, wholesaler_id: supplierId, invoice_number: `${base} (part ${partNo})`, part_of: base,
              discount: plan.rest.discount, other_charges: plan.rest.other_charges, round_off: plan.rest.round_off, paid_now: 0, totals_ack: false,
              printed: { ...draft.bill.printed, net: draft.bill.printed.net === null ? null : (toPaise(draft.bill.printed.net) - toPaise(plan.importedTotal)) / 100 },
            },
            lines: plan.asideLines.map((l) => ({ ...l, aside: false })),
          };
          const sql = finishing
            ? db.prepare(`UPDATE purchase_import_waiting SET wholesaler_id=?, supplier_name=?, invoice_number=?, invoice_date=?, imported_invoice_id=?, line_count=?, payload_json=?, scan_path=COALESCE(?, scan_path), status='waiting', updated_at=datetime('now') WHERE id=?`)
            : db.prepare('INSERT INTO purchase_import_waiting (wholesaler_id, supplier_name, invoice_number, invoice_date, imported_invoice_id, line_count, payload_json, scan_path, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
          const args = [supplierId, clean(draft.bill.supplier_name), remainder.bill.invoice_number, draft.bill.invoice_date, invoice.id, plan.asideLines.length, JSON.stringify(remainder), photoPath];
          const info = finishing ? sql.run(...args, finishing.id) : sql.run(...args, opts.by ?? null);
          waitingId = finishing ? finishing.id : Number(info.lastInsertRowid);
        } else if (finishing) {
          db.prepare("UPDATE purchase_import_waiting SET status='done', imported_invoice_id=?, updated_at=datetime('now') WHERE id=?").run(invoice.id, finishing.id);
        }
      }
    });
    tx();
    committed = true;
    const inv = getPurchase(db, invoice.id) as { invoice_number: string; total: number; items: unknown[] } | null;
    const batches = (db.prepare('SELECT COUNT(DISTINCT drug_master_id || \'|\' || batch_no) AS c FROM purchase_invoice_items WHERE invoice_id=?').get(invoice.id) as { c: number }).c;
    return { ok: true, duplicate: invoice.duplicate, invoice_id: invoice.id, invoice_number: inv?.invoice_number ?? draft.bill.invoice_number, lines: plan.importLines.length, batches, total: inv?.total ?? plan.importedTotal, new_drugs: newDrugs, reactivated, new_supplier: newSupplier, supplier_switched_on: supplierSwitchedOn, aliases_saved: aliasesSaved, waiting_id: waitingId, aside: plan.asideLines.length };
  } catch (e: any) {
    if (photoPath && wrotePhoto && !committed) { try { fs.rmSync(photoPath, { force: true }); } catch { /* nothing to clean */ } }   // never remove the picture of a bill that was saved
    return { ok: false, error: String(e?.message || e || 'Could not import the bill.') };
  }
}

// ---------------------------------------------------------------------------------------------------------------- the waiting list
export function listWaiting(db: Database.Database): WaitingRow[] {
  return (db.prepare("SELECT id, supplier_name, invoice_number, invoice_date, line_count, imported_invoice_id, created_at, scan_path FROM purchase_import_waiting WHERE status='waiting' ORDER BY id DESC").all() as any[])
    .map((r) => ({ id: r.id, supplier_name: r.supplier_name, invoice_number: r.invoice_number, invoice_date: r.invoice_date, line_count: r.line_count, imported_invoice_id: r.imported_invoice_id, created_at: r.created_at, has_photo: !!r.scan_path }));
}

/** The waiting draft, ready to be opened again — its medicines re-matched against today's Drug List (a drug added since may now match). */
export function getWaiting(db: Database.Database, id: number): WaitingGet {
  const row = db.prepare("SELECT payload_json, scan_path FROM purchase_import_waiting WHERE id=? AND status='waiting'").get(Number(id)) as { payload_json: string; scan_path: string | null } | undefined;
  if (!row) return { ok: false, error: 'That waiting bill is no longer there.' };
  let draft: Draft;
  try { draft = JSON.parse(row.payload_json) as Draft; } catch { return { ok: false, error: 'That waiting bill could not be read.' }; }
  // a medicine that has been deleted from the Drug List since: back to "choose the medicine"
  for (const l of draft.lines) {
    if (l.drug_id !== null && !db.prepare('SELECT 1 FROM drug_master WHERE id=? AND is_active=1').get(l.drug_id)) { l.drug_id = null; l.confirmed = false; }
  }
  if (draft.bill.wholesaler_id !== null && !db.prepare('SELECT 1 FROM wholesalers WHERE id=?').get(draft.bill.wholesaler_id)) draft.bill.wholesaler_id = null;
  return { ok: true, draft, scan_path: row.scan_path };
}

export function discardWaiting(db: Database.Database, id: number): boolean {
  return db.prepare("UPDATE purchase_import_waiting SET status='discarded', updated_at=datetime('now') WHERE id=? AND status='waiting'").run(Number(id)).changes > 0;
}

/**
 * The bill's picture, only from the folder this feature writes to. The file is found by its NAME inside that folder, so a path saved on another PC
 * (or before a restore onto a new computer) still finds the picture, and a path that points anywhere else never leaves the folder.
 */
export function readScan(scanDir: string, file: string | null): { name: string; mime: string; base64: string } | null {
  if (!file) return null;
  const name = path.basename(String(file).replace(/\\/g, '/'));
  if (!name || name === '.' || name === '..') return null;
  const abs = path.join(path.resolve(scanDir), name);
  try { if (!fs.statSync(abs).isFile()) return null; } catch { return null; }
  const ext = path.extname(abs).toLowerCase();
  const mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
  return { name, mime, base64: fs.readFileSync(abs).toString('base64') };
}
