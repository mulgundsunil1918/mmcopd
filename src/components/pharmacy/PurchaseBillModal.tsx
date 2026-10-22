import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, X } from 'lucide-react';
import { Modal } from '../Modal';
import { QuickDrugModal } from './QuickDrugModal';
import { useToast } from '../../hooks/useToast';
import { cn, fmtDate, formatINR, newRef, todayISO } from '../../lib/utils';
import { computePurchase, profitMetrics, toPaise, validatePurchase } from '../../lib/pharmacyMath';
import type { PurchaseInvoiceInput } from '../../types';

/**
 * New Purchase Bill — a supplier's invoice, entered once, turning into stock batches.
 *
 * The screen sends quantities, rates and discounts; it never sends totals. The figures shown here come
 * from the SAME function the main process uses to work out what it stores (lib/pharmacyMath), so what
 * you see is what is saved. Cost per unit includes free units, discounts, freight and — when the clinic
 * cannot claim it back — GST, and each line previews the margin that cost leaves against the price you
 * will charge.
 *
 * Nothing is dropped silently: a half-filled line is reported by name instead of being skipped.
 */
type Line = {
  drug_master_id: number | null;
  drug_name?: string;
  batch_no: string;
  expiry: string;
  manufacture_date: string;
  qty_received: number;
  free_qty: number;
  purchase_price: number;
  disc_pct: number;
  mrp: number;
  selling_price: number | null;
  gst_rate: number;
  manufacturer_license_no: string;
};

/** Entering a number box selects what is in it, so typing replaces the 0 rather than sitting beside it. */
const selectAll = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

const blankLine = (): Line => ({
  drug_master_id: null, drug_name: '', batch_no: '', expiry: '', manufacture_date: '',
  qty_received: 0, free_qty: 0, purchase_price: 0, disc_pct: 0, mrp: 0, selling_price: null, gst_rate: 12,
  manufacturer_license_no: '',
});
/** A row the user never touched — ignored rather than treated as an error. */
const isBlank = (l: Line) => !l.drug_master_id && !l.batch_no && !l.expiry && !l.qty_received && !l.purchase_price && !l.mrp;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}

/** What this drug last cost, and how the rate being typed compares — a price creeping up is easy to miss on paper. */
function LastRateHint({ drugId, rate }: { drugId: number | null; rate: number }) {
  const { data } = useQuery({
    queryKey: ['drug-price-history', drugId],
    queryFn: () => window.electronAPI.analytics.drugPriceHistory(drugId as number),
    enabled: !!drugId,
  });
  const last = data && data.length ? data[data.length - 1] : null;
  if (!last) return null;
  const change = rate > 0 && last.rate > 0 ? ((rate - last.rate) / last.rate) * 100 : null;
  return (
    <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5 whitespace-nowrap">
      last {formatINR(last.rate)} · {fmtDate(last.date)}
      {change !== null && Math.abs(change) >= 0.5 && (
        <span className={cn('ml-1 font-semibold', change > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
          {change > 0 ? '+' : ''}{change.toFixed(1)}%
        </span>
      )}
    </div>
  );
}

export function NewPurchaseModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: wholesalers = [] } = useQuery({
    queryKey: ['wholesalers'],
    queryFn: () => window.electronAPI.wholesalers.list({ activeOnly: true }),
  });
  const { data: drugs = [] } = useQuery({
    queryKey: ['pharmacy-drugs-active'],
    queryFn: () => window.electronAPI.pharmacy.listDrugs({ activeOnly: true }),
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });

  // Does the clinic charge GST on its sales? Then input GST is claimed back (not a cost) and sale revenue is shown without GST.
  const gstCharged = !!settings?.gst_enabled
    && settings?.gst_registration_type !== 'unregistered' && settings?.gst_registration_type !== 'composition';

  const [ref] = useState(newRef);   // one id per bill: saving the same attempt twice returns the first save
  const [header, setHeader] = useState({
    invoice_number: '', wholesaler_id: 0, invoice_date: todayISO(), received_date: todayISO(), notes: '',
  });
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [discount, setDiscount] = useState(0);
  const [otherCharges, setOtherCharges] = useState(0);
  const [interstate, setInterstate] = useState(false);
  const [claimOverride, setClaimOverride] = useState<boolean | null>(null);
  const [roundOff, setRoundOff] = useState(true);
  const [paidNow, setPaidNow] = useState(0);
  const [payMode, setPayMode] = useState('Cash');
  const [serverError, setServerError] = useState('');
  const [newDrugFor, setNewDrugFor] = useState<number | null>(null);   // the line that is waiting for a drug being added to the Drug List
  const claimable = claimOverride ?? gstCharged;

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((arr) => arr.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const used = useMemo(() => lines.filter((l) => !isBlank(l)), [lines]);
  const calc = useMemo(
    () => computePurchase(
      used.map((l) => ({ qty: l.qty_received, free_qty: l.free_qty, rate: l.purchase_price, disc_pct: l.disc_pct, gst_rate: l.gst_rate })),
      { header_discount: discount, other_charges: otherCharges, interstate, gst_in_cost: !claimable, round_off: roundOff ? 'auto' : 0 },
    ),
    [used, discount, otherCharges, interstate, claimable, roundOff],
  );
  const lineResult = new Map(used.map((l, i) => [l, calc.lines[i]]));

  // Every problem, in plain words, so nothing is skipped without the user knowing.
  const issues = useMemo(() => {
    const out: string[] = [];
    if (!header.invoice_number.trim()) out.push("Enter the supplier's invoice number.");
    if (!header.wholesaler_id) out.push('Choose the wholesaler this bill is from.');
    if (!header.invoice_date) out.push('Enter the invoice date.');
    used.forEach((l, i) => {
      const who = `Line ${i + 1}${l.drug_name ? ` (${l.drug_name})` : ''}`;
      if (!l.drug_master_id) out.push(`${who}: choose the medicine.`);
      if (!l.batch_no.trim()) out.push(`${who}: enter the batch number.`);
      if (!l.expiry) out.push(`${who}: enter the expiry date.`);
      if (!(l.mrp > 0)) out.push(`${who}: enter the MRP printed on the pack.`);
      if (l.selling_price !== null && toPaise(l.selling_price) > toPaise(l.mrp)) out.push(`${who}: the selling price cannot be higher than the MRP.`);
    });
    if (used.length === 0) out.push('Add at least one medicine line.');
    else {
      const v = validatePurchase(
        used.map((l) => ({ qty: l.qty_received, free_qty: l.free_qty, rate: l.purchase_price, disc_pct: l.disc_pct, gst_rate: l.gst_rate })),
        { header_discount: discount, other_charges: otherCharges },
      );
      if (v) out.push(v);
    }
    if (toPaise(paidNow) < 0) out.push('The amount paid cannot be negative.');
    if (toPaise(paidNow) > toPaise(calc.total)) out.push('The amount paid is more than the bill total.');
    return out;
  }, [header, used, discount, otherCharges, paidNow, calc.total]);

  const dueNow = Math.max(0, calc.total - paidNow);
  const statusLabel = calc.total > 0 && dueNow <= 0 ? 'Paid' : paidNow > 0 ? 'Part-paid' : 'Unpaid';

  const create = useMutation({
    mutationFn: () => {
      const payload: PurchaseInvoiceInput = {
        client_ref: ref,
        invoice_number: header.invoice_number.trim(),
        wholesaler_id: Number(header.wholesaler_id),
        invoice_date: header.invoice_date,
        received_date: header.received_date || undefined,
        discount, other_charges: otherCharges, interstate, gst_in_cost: !claimable,
        round_off: roundOff ? 'auto' : 0,
        payment_mode: payMode || null,
        amount_paid: paidNow,
        notes: header.notes || null,
        items: used.map((l) => ({
          drug_master_id: l.drug_master_id as number,
          batch_no: l.batch_no.trim(),
          expiry: l.expiry,
          manufacture_date: l.manufacture_date || null,
          qty_received: Number(l.qty_received),
          free_qty: Number(l.free_qty) || 0,
          purchase_price: Number(l.purchase_price),
          disc_pct: Number(l.disc_pct) || 0,
          mrp: Number(l.mrp),
          selling_price: l.selling_price,
          gst_rate: l.gst_rate,
          manufacturer_license_no: l.manufacturer_license_no.trim() || null,
        })),
      };
      return window.electronAPI.purchases.create(payload);
    },
    onSuccess: (res) => {
      if (!res.ok) { setServerError(res.error); toast(res.error, 'error'); return; }
      for (const k of ['purchases', 'pharmacy-drugs', 'pharmacy-drugs-active', 'pharmacy-alerts', 'pharmacy-clinic-stock', 'wholesalers-summary', 'pharmacy-batches', 'supplier-report', 'pharmacy-valuation', 'drug-price-history']) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      toast(res.duplicate
        ? 'This bill was already saved — nothing was added twice.'
        : `Purchase bill saved · ${used.length} batch${used.length === 1 ? '' : 'es'} added to stock`);
      onClose();
    },
    onError: (e: any) => { setServerError(e?.message || 'Save failed'); toast(e?.message || 'Save failed', 'error'); },
  });

  const canSubmit = issues.length === 0 && !create.isPending;

  return (
    <>
    <Modal open onClose={() => { if (newDrugFor === null) onClose(); }} title="New Purchase Bill" size="2xl">
      <div className="space-y-4">
        {/* Header */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Invoice Number *">
            <input className="input" placeholder="e.g. CIPLA-2026-001234" value={header.invoice_number} onChange={(e) => setHeader({ ...header, invoice_number: e.target.value })} />
          </Field>
          <Field label="Wholesaler *">
            <select className="input" value={header.wholesaler_id || ''} onChange={(e) => setHeader({ ...header, wholesaler_id: Number(e.target.value) })}>
              <option value="">— Select —</option>
              {wholesalers.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.drug_license_no})</option>)}
            </select>
          </Field>
          <Field label="Invoice Date *"><input type="date" className="input" value={header.invoice_date} onChange={(e) => setHeader({ ...header, invoice_date: e.target.value })} /></Field>
          <Field label="Received Date"><input type="date" className="input" value={header.received_date} onChange={(e) => setHeader({ ...header, received_date: e.target.value })} /></Field>
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="label mb-0">Line Items (each becomes a stock batch)</div>
            <button className="btn-ghost text-xs" onClick={() => setLines([...lines, blankLine()])}>
              <Plus className="w-3.5 h-3.5" /> Add line
            </button>
          </div>
          {/* One card per line — two rows that wrap on a narrow screen, so nothing ever scrolls sideways. Row 1 says WHAT arrived (and
              shows the result: the line value and what a unit really cost); row 2 is the quantities and money, in the order they are typed. */}
          <div className="space-y-3">
            {lines.map((l, idx) => {
              const r = lineResult.get(l);
              const price = l.selling_price ?? l.mrp;
              const net = gstCharged && l.gst_rate > 0 ? price / (1 + l.gst_rate / 100) : price;
              const m = r && r.unit_cost > 0 && price > 0 ? profitMetrics(net, r.unit_cost) : null;
              return (
                <div key={idx} className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 space-y-2">
                  <div className="flex gap-3 flex-wrap items-end">
                    <div className="w-5 pb-2.5 text-[11px] font-bold text-gray-400" title={`Line ${idx + 1}`}>{idx + 1}</div>
                    <div className="flex-1 min-w-[220px]">
                      <label className="label">Drug</label>
                      <select className="input" value={l.drug_master_id ?? ''} onChange={(e) => {
                        if (e.target.value === '__new__') { setNewDrugFor(idx); return; }     // not in the list: add it to the Drug List first
                        const dm = drugs.find((d) => d.id === Number(e.target.value));
                        setLine(idx, {
                          drug_master_id: dm ? dm.id : null,
                          drug_name: dm?.name,
                          mrp: l.mrp || (dm?.default_mrp ?? 0),
                          gst_rate: dm ? dm.gst_rate : l.gst_rate,
                        });
                      }}>
                        <option value="__new__">＋ Add this drug to the Drug List…</option>
                        <option value="">— Pick drug —</option>
                        {drugs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                    <div className="w-32"><label className="label">Batch *</label><input className="input font-mono" value={l.batch_no} onChange={(e) => setLine(idx, { batch_no: e.target.value })} /></div>
                    <div className="w-40"><label className="label">Mfg</label><input type="month" className="input" value={l.manufacture_date} onChange={(e) => setLine(idx, { manufacture_date: e.target.value })} /></div>
                    <div className="w-44"><label className="label">Expiry *</label><input type="date" className="input" value={l.expiry} onChange={(e) => setLine(idx, { expiry: e.target.value })} /></div>
                    <div className="w-24 text-right" title="Value of the line after discount, before GST">
                      <div className="label">Line ₹</div>
                      <div className="font-semibold text-sm py-1.5">{formatINR(r?.taxable ?? 0)}</div>
                    </div>
                    <div className="w-28 text-right" title="True cost of one unit: free units, discount, freight and unclaimable GST included">
                      <div className="label">Cost / unit</div>
                      {r && r.units > 0 ? (
                        <>
                          <div className="font-semibold text-sm leading-tight pt-1.5">{formatINR(r.unit_cost)}</div>
                          {m && m.marginPct !== null && (
                            <div className={cn('text-[10px] leading-tight', m.marginPct < 0 ? 'text-red-600 dark:text-red-400 font-semibold' : m.marginPct < 10 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-slate-400')}>
                              margin {m.marginPct.toFixed(1)}%
                            </div>
                          )}
                        </>
                      ) : <div className="text-gray-400 py-1.5">—</div>}
                    </div>
                    <button className="text-red-500 p-1 mb-1.5" tabIndex={-1} title="Remove this line" aria-label={`Remove line ${idx + 1}`}
                      onClick={() => setLines(lines.length > 1 ? lines.filter((_, i) => i !== idx) : [blankLine()])}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex gap-3 flex-wrap items-start pl-8">
                    <div className="w-24"><label className="label">Qty</label><input type="number" min={0} onFocus={selectAll} className="input text-right px-2" value={l.qty_received} onChange={(e) => setLine(idx, { qty_received: Number(e.target.value) })} /></div>
                    <div className="w-24"><label className="label" title="Free / scheme units received on top">Free</label><input type="number" min={0} onFocus={selectAll} className="input text-right px-2" value={l.free_qty} onChange={(e) => setLine(idx, { free_qty: Number(e.target.value) })} /></div>
                    <div className="w-32">
                      <label className="label" title="Supplier's rate per paid unit, before discount and GST">Buy ₹</label>
                      <input type="number" min={0} step="0.01" onFocus={selectAll} className="input text-right px-2" value={l.purchase_price} onChange={(e) => setLine(idx, { purchase_price: Number(e.target.value) })} />
                      <LastRateHint drugId={l.drug_master_id} rate={l.purchase_price} />
                    </div>
                    <div className="w-24"><label className="label" title="Trade discount on this line">Disc %</label><input type="number" min={0} max={100} step="0.01" onFocus={selectAll} className="input text-right px-2" value={l.disc_pct} onChange={(e) => setLine(idx, { disc_pct: Number(e.target.value) })} /></div>
                    <div className="w-32"><label className="label" title="Printed on the pack">MRP ₹</label><input type="number" min={0} step="0.01" onFocus={selectAll} className="input text-right px-2" value={l.mrp} onChange={(e) => setLine(idx, { mrp: Number(e.target.value) })} /></div>
                    <div className="w-32"><label className="label" title="What you will charge. Blank = sell at MRP">Sell ₹</label><input type="number" min={0} step="0.01" onFocus={selectAll} className="input text-right px-2" placeholder="= MRP" value={l.selling_price ?? ''} onChange={(e) => setLine(idx, { selling_price: e.target.value === '' ? null : Number(e.target.value) })} /></div>
                    <div className="w-24">
                      <label className="label">GST %</label>
                      <select className="input px-2" value={l.gst_rate} onChange={(e) => setLine(idx, { gst_rate: Number(e.target.value) })}>
                        {[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                    <div className="w-44"><label className="label">Mfg. Lic.</label><input className="input font-mono text-[11px]" value={l.manufacturer_license_no} onChange={(e) => setLine(idx, { manufacturer_license_no: e.target.value })} /></div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">
            Cost / unit = (value after discount + freight{claimable ? '' : ' + GST'}) ÷ all units received, free ones included.
            Margin = (price you charge − cost) ÷ price{gstCharged ? ', with GST taken out of the price' : ''}.
          </div>
        </div>

        {/* Totals + payment */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="card p-3 bg-gray-50 dark:bg-slate-900 col-span-2">
            <div className="flex justify-between text-xs"><span>Goods (at supplier rates)</span><span>{formatINR(calc.subtotal)}</span></div>
            {calc.line_discount > 0 && (
              <div className="flex justify-between text-xs text-emerald-700 dark:text-emerald-300"><span>Line discounts</span><span>− {formatINR(calc.line_discount)}</span></div>
            )}
            <div className="flex justify-between text-xs items-center">
              <span>Invoice discount</span>
              <input type="number" min={0} step="0.01" className="input w-24 text-right py-1" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
            </div>
            {interstate
              ? <div className="flex justify-between text-xs"><span>IGST</span><span>{formatINR(calc.igst)}</span></div>
              : <>
                  <div className="flex justify-between text-xs"><span>CGST</span><span>{formatINR(calc.cgst)}</span></div>
                  <div className="flex justify-between text-xs"><span>SGST</span><span>{formatINR(calc.sgst)}</span></div>
                </>}
            <div className="flex justify-between text-xs items-center">
              <span>Freight / other charges</span>
              <input type="number" min={0} step="0.01" className="input w-24 text-right py-1" value={otherCharges} onChange={(e) => setOtherCharges(Number(e.target.value))} />
            </div>
            <div className="flex justify-between text-xs items-center">
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={roundOff} onChange={(e) => setRoundOff(e.target.checked)} /> Round off to nearest ₹</label>
              <span>{calc.round_off >= 0 ? '+' : '−'} {formatINR(Math.abs(calc.round_off))}</span>
            </div>
            <div className="flex justify-between text-sm font-bold pt-2 border-t border-gray-300 dark:border-slate-700 mt-1">
              <span>Total</span>
              <span className="text-blue-700 dark:text-blue-300">{formatINR(calc.total)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600 dark:text-slate-300">
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={interstate} onChange={(e) => setInterstate(e.target.checked)} /> Supplier is in another state (IGST)</label>
              <label className="inline-flex items-center gap-1.5" title="Tick if the clinic claims input tax credit on this GST. If not, the GST becomes part of what the stock cost.">
                <input type="checkbox" checked={claimable} onChange={(e) => setClaimOverride(e.target.checked)} /> GST on this bill can be claimed back
              </label>
            </div>
          </div>
          <div className="space-y-2">
            <Field label="Paid now (₹)">
              <input type="number" min={0} step="0.01" className="input text-right" value={paidNow} onChange={(e) => setPaidNow(Number(e.target.value))} />
            </Field>
            <Field label="Payment Mode">
              <select className="input" value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                <option value="">—</option>
                <option>Cash</option><option>Cheque</option><option>Bank</option><option>UPI</option><option>Credit</option>
              </select>
            </Field>
            <div className="text-xs">
              <span className={cn('badge',
                statusLabel === 'Paid' ? 'bg-green-100 text-green-700' : statusLabel === 'Part-paid' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700')}>{statusLabel}</span>
              {dueNow > 0 && <span className="ml-2 text-gray-600 dark:text-slate-300">{formatINR(dueNow)} still to pay the supplier</span>}
            </div>
          </div>
        </div>

        <Field label="Notes">
          <textarea className="input" rows={2} value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} />
        </Field>

        {(issues.length > 0 || serverError) && (
          <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-2.5 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-1.5 font-semibold mb-1"><AlertTriangle className="w-3.5 h-3.5" /> {serverError ? 'Could not save' : 'Before you can save'}</div>
            <ul className="list-disc pl-5 space-y-0.5">
              {serverError && <li>{serverError}</li>}
              {issues.slice(0, 6).map((m, i) => <li key={i}>{m}</li>)}
              {issues.length > 6 && <li>…and {issues.length - 6} more</li>}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!canSubmit} onClick={() => { setServerError(''); create.mutate(); }}>
            {create.isPending ? 'Saving…' : 'Save Invoice & Add to Stock'}
          </button>
        </div>
      </div>
    </Modal>
    {newDrugFor !== null && (
      <QuickDrugModal
        onClose={() => setNewDrugFor(null)}
        onCreated={(d) => {
          const idx = newDrugFor;
          setNewDrugFor(null);
          // the new drug is picked straight into the line that asked for it
          setLines((arr) => arr.map((l, k) => (k === idx ? { ...l, drug_master_id: d.id, drug_name: d.name, mrp: l.mrp || (d.default_mrp ?? 0), gst_rate: d.gst_rate } : l)));
        }}
      />
    )}
    </>
  );
}
