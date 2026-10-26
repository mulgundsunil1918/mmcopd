/**
 * Demo-only stand-in for the purchaseImport channels (main/purchase-import.ts). It runs the SAME pure libraries the app uses
 * (lib/billImport: reading, matching, checking, sharing the bill's money between parts) over the demo's in-memory Drug List, suppliers and purchase
 * bills, so the website shows the real screens and the real rules. The Excel is read in the browser. Nothing here ships in the app.
 */
import {
  BILL_FIELDS, ITEM_COLUMNS, NOT_EXCEL_MESSAGE, SHEET_BILL, SHEET_ITEMS, aliasKey, buildDraft, buildTemplateWorkbook, checkDraft, looksLikeExcel, planParts, readBillRows, readWorkbook,
} from '../lib/billImport';
import { SAMPLE_BILLS, sampleBillFor } from './sample-bills';
import type { Draft, ImportCommit, ImportResult, ParseResult, WaitingGet, WaitingRow } from '../lib/billImport';
import { toPaise } from '../lib/pharmacyMath';
import { localISO } from '../lib/localDate';
import { base64ToBytes, bytesToBase64 } from '../lib/base64';
import type { DrugMaster, Wholesaler } from '../types';
import type { makeDemoPurchaseStore } from './demo-pharmacy-finance';

type Store = ReturnType<typeof makeDemoPurchaseStore>;
const clean = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');

interface Picture { name: string; mime: string; base64: string }
interface Waiting { id: number; row: WaitingRow; draft: Draft; photo: Picture | null; status: 'waiting' | 'done' | 'discarded' }

export function makeDemoBillImport(deps: {
  drugs: () => DrugMaster[]; addDrug: (d: DrugMaster) => DrugMaster;
  wholesalers: () => Wholesaler[]; addWholesaler: (w: Partial<Wholesaler>) => Wholesaler;
  store: Store;
}) {
  const aliases: { supplier_id: number; alias: string; drug_id: number }[] = [];
  const done = new Map<string, ImportResult>();
  const waiting: Waiting[] = [];
  const photos = new Map<string, Picture>();
  let nextWaiting = 1;
  const xlsx = () => import('xlsx');

  const existing = (supplierId: number | null, no: string) => {
    if (supplierId === null) return null;
    const hit = deps.store.all().find((p) => p.wholesaler_id === supplierId && p.invoice_number.trim().toLowerCase() === no.trim().toLowerCase());
    return hit ? { id: hit.id, date: String(hit.invoice_date).slice(0, 10) } : null;
  };

  return {
    // `which` (demo only) picks one of the owner's four real-world sample bills (src/demo/sample-bills.ts), dated around today
    template: async (withSample: boolean, which?: string): Promise<string> => {
      const X = await xlsx();
      const pick = which ? SAMPLE_BILLS.find((b) => b.key === which) : undefined;
      if (!pick) return bytesToBase64(buildTemplateWorkbook(X, !!withSample, localISO()));
      const b = sampleBillFor(pick, localISO());
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Field', 'Value'], ...BILL_FIELDS.map((f) => [f.label, b.bill[f.label] ?? ''])]), SHEET_BILL);
      const headers = ITEM_COLUMNS.map((c) => c.header);
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([headers, ...b.items.map((r) => headers.map((h) => r[h] ?? ''))]), SHEET_ITEMS);
      return bytesToBase64(new Uint8Array(X.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer));
    },

    parse: async (file: string): Promise<ParseResult> => {
      let data: Uint8Array;
      try { data = base64ToBytes(String(file ?? '')); } catch { data = new Uint8Array(0); }
      if (!looksLikeExcel(data)) return { ok: false, problems: [NOT_EXCEL_MESSAGE] };
      let rows;
      try { rows = readWorkbook(await xlsx(), data); } catch { return { ok: false, problems: ['That file could not be opened as an Excel file (.xlsx). Download the Excel from ChatGPT again.'] }; }
      const read = readBillRows(rows.billRows, rows.itemRows);
      if (read.problems.length) return { ok: false, problems: read.problems };
      const draft = buildDraft(read, {
        drugs: deps.drugs().map((d) => ({ id: d.id, name: d.name, generic_name: d.generic_name, form: d.form, strength: d.strength, is_active: d.is_active })),
        aliases: aliases.map((a) => ({ alias: a.alias, drug_id: a.drug_id, supplier_id: a.supplier_id })),
        suppliers: deps.wholesalers().filter((w) => w.is_active !== 0).map((w) => ({ id: w.id, name: w.name, gstin: w.gstin ?? null, drug_license_no: w.drug_license_no })),
        today: localISO(),
      });
      return { ok: true, draft, notices: read.notices, duplicate: existing(draft.bill.wholesaler_id, draft.bill.invoice_number) };
    },

    checkInvoice: async (supplierId: number | null, no: string) => existing(supplierId === null ? null : Number(supplierId), String(no ?? '')),

    create: async (input: ImportCommit): Promise<ImportResult> => {
      if (clean(input?.confirm).toUpperCase() !== 'IMPORT') return { ok: false, error: 'To add this bill to your stock, type IMPORT to confirm.' };
      const ref = clean(input?.client_ref);
      if (ref && done.has(ref)) { const first = done.get(ref) as ImportResult; return first.ok ? { ...first, duplicate: true } : first; }
      const draft = input?.draft;
      if (!draft?.bill || !Array.isArray(draft.lines)) return { ok: false, error: 'There is no bill to import.' };
      const result = checkDraft(draft, { today: localISO(), existingInvoice: existing });
      if (!result.ready) {
        const errs = result.problems.filter((p) => p.severity === 'error');
        return { ok: false, error: `This bill is not ready to import: ${errs.slice(0, 3).map((p) => p.message).join(' ')}`, problems: errs };
      }
      const plan = planParts(draft.bill, draft.lines);

      // ---- supplier ----
      let supplierId = draft.bill.wholesaler_id;
      let newSupplier = false;
      if (supplierId === null) {
        const name = clean(draft.bill.supplier_name);
        if (deps.wholesalers().some((w) => w.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `A supplier called "${name}" already exists (it may be switched off under Wholesalers) — choose it from the list, or switch it on first.` };
        supplierId = deps.addWholesaler({ name, drug_license_no: clean(draft.bill.supplier_license), gstin: clean(draft.bill.supplier_gstin) || null, is_active: 1 }).id;
        newSupplier = true;
      }
      // ---- medicines ----
      const created = new Map<string, number>();
      let newDrugs = 0;
      const lineDrug = new Map<number, number>();
      for (const l of plan.importLines) {
        if (l.new_drug) {
          const key = clean(l.new_drug.name).toLowerCase();
          let id = created.get(key) ?? deps.drugs().find((d) => d.name.toLowerCase() === key)?.id;
          if (id === undefined) {
            const nd = l.new_drug;
            id = deps.addDrug({
              name: clean(nd.name), generic_name: clean(nd.generic_name) || null, manufacturer: clean(l.manufacturer) || null, form: clean(nd.form) || null, strength: clean(nd.strength) || null,
              pack_size: nd.pack_size ?? null, schedule: nd.schedule, hsn_code: clean(nd.hsn_code) || null, gst_rate: l.gst_rate ?? 0, default_mrp: l.mrp ?? 0, low_stock_threshold: 10,
              barcode: null, is_active: 1, notes: null, created_at: localISO(), updated_at: localISO(),
            } as DrugMaster).id;
            newDrugs++;
          }
          created.set(key, id);
          lineDrug.set(l.id, id);
        } else lineDrug.set(l.id, l.drug_id as number);
      }
      let aliasesSaved = 0;
      for (const l of plan.importLines) {
        const key = aliasKey(l.printed_name);
        const id = lineDrug.get(l.id) as number;
        const auto = (l.match.kind === 'exact' || l.match.kind === 'alias') && l.match.candidates[0]?.id === id;
        if (!key || auto) continue;
        const have = aliases.find((a) => a.supplier_id === supplierId && a.alias === key);
        if (have) have.drug_id = id; else aliases.push({ supplier_id: supplierId as number, alias: key, drug_id: id });
        aliasesSaved++;
      }
      // ---- the bill ----
      const part = clean(draft.bill.part_of);
      const photoKey = input.photo?.base64 ? `demo-scan:${ref || Date.now()}` : null;
      if (photoKey && input.photo) {
        const ext = (clean(input.photo.name).split('.').pop() || '').toLowerCase();
        photos.set(photoKey, { name: input.photo.name, base64: input.photo.base64, mime: ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg' });
      }
      const finishing = input.waiting_id ? waiting.find((w) => w.id === input.waiting_id && w.status === 'waiting') : undefined;
      const res = deps.store.create({
        client_ref: ref || undefined, invoice_number: clean(draft.bill.invoice_number), wholesaler_id: supplierId as number, invoice_date: draft.bill.invoice_date, received_date: localISO(),
        discount: plan.header.discount, other_charges: plan.header.other_charges, interstate: draft.bill.interstate, round_off: plan.header.round_off,
        gst_in_cost: input.gst_in_cost === true, payment_mode: clean(draft.bill.pay_mode) || null, amount_paid: Math.max(0, Number(draft.bill.paid_now) || 0),
        notes: [`Imported from the bill (ChatGPT → Excel) on ${localISO()} · ${plan.importLines.length} line${plan.importLines.length === 1 ? '' : 's'}`, part ? `Later part of invoice ${part}` : ''].filter(Boolean).join('. '),
        items: plan.importLines.map((l) => ({
          drug_master_id: lineDrug.get(l.id) as number, batch_no: clean(l.batch), expiry: l.expiry, qty_received: l.qty as number, free_qty: l.free_qty || 0,
          purchase_price: l.rate as number, disc_pct: l.disc_pct || 0, mrp: l.mrp as number, selling_price: l.selling_price, gst_rate: l.gst_rate ?? 0,
        })),
      } as any);
      if (!res.ok) return { ok: false, error: res.error };
      const inv = res.invoice as { id: number; invoice_number: string; total: number };
      if (photoKey) (inv as any).scan_path = photoKey;

      // ---- the lines that wait ----
      let waitingId: number | null = null;
      if (plan.asideLines.length > 0) {
        const base = part || clean(draft.bill.invoice_number);
        const partNo = deps.store.all().filter((p) => p.wholesaler_id === supplierId && (p.invoice_number === base || p.invoice_number.startsWith(`${base} (part `))).length + 1;
        const remainder: Draft = {
          bill: {
            ...draft.bill, wholesaler_id: supplierId, invoice_number: `${base} (part ${partNo})`, part_of: base, discount: plan.rest.discount, other_charges: plan.rest.other_charges,
            round_off: plan.rest.round_off, paid_now: 0, totals_ack: false,
            printed: { ...draft.bill.printed, net: draft.bill.printed.net === null ? null : (toPaise(draft.bill.printed.net) - toPaise(plan.importedTotal)) / 100 },
          },
          lines: plan.asideLines.map((l) => ({ ...l, aside: false })),
        };
        const sup = deps.wholesalers().find((w) => w.id === supplierId);
        const photo = (photoKey ? photos.get(photoKey) : null) ?? finishing?.photo ?? null;
        const row: WaitingRow = {
          id: finishing ? finishing.id : nextWaiting++, supplier_name: sup?.name ?? null, invoice_number: remainder.bill.invoice_number, invoice_date: draft.bill.invoice_date,
          line_count: plan.asideLines.length, imported_invoice_id: inv.id, created_at: localISO(), has_photo: !!photo,
        };
        if (finishing) { finishing.row = row; finishing.draft = remainder; finishing.photo = photo; } else waiting.push({ id: row.id, row, draft: remainder, photo, status: 'waiting' });
        waitingId = row.id;
      } else if (finishing) finishing.status = 'done';

      const out: ImportResult = {
        ok: true, duplicate: false, invoice_id: inv.id, invoice_number: inv.invoice_number, lines: plan.importLines.length,
        batches: new Set(plan.importLines.map((l) => `${lineDrug.get(l.id)}|${clean(l.batch)}`)).size, total: inv.total, new_drugs: newDrugs, reactivated: 0, new_supplier: newSupplier,
        aliases_saved: aliasesSaved, waiting_id: waitingId, aside: plan.asideLines.length,
      };
      if (ref) done.set(ref, out);
      return out;
    },

    waiting: async (): Promise<WaitingRow[]> => waiting.filter((w) => w.status === 'waiting').map((w) => w.row).reverse(),
    waitingGet: async (id: number): Promise<WaitingGet> => {
      const w = waiting.find((x) => x.id === Number(id) && x.status === 'waiting');
      if (!w) return { ok: false, error: 'That waiting bill is no longer there.' };
      return { ok: true, draft: JSON.parse(JSON.stringify(w.draft)) as Draft, scan_path: w.photo ? `demo-wait:${w.id}` : null };
    },
    deleteWaiting: async (id: number) => {
      const w = waiting.find((x) => x.id === Number(id) && x.status === 'waiting');
      if (w) w.status = 'discarded';
      return { ok: !!w };
    },
    photo: async (file: string | null) => {
      if (!file) return null;
      if (file.startsWith('demo-wait:')) { const w = waiting.find((x) => x.id === Number(file.slice(10))); return w?.photo ?? null; }
      return photos.get(file) ?? null;
    },
  };
}
