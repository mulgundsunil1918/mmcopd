/**
 * Check the bill — the screen between "ChatGPT read it" and "it is in my stock".
 *
 * Nothing here has touched the stock. Every line is shown against the name printed on the bill; a box that still needs filling is RED; what one unit
 * will cost and the profit on it are shown as on the purchase bill. A line that has a problem can be SET ASIDE: the others are imported now and the
 * set-aside ones wait (with the bill's picture) to be finished later. At the bottom, the person types IMPORT — and the main process checks the very
 * same rules again before it saves anything.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Eye, EyeOff, Loader2, PackageCheck, Pause } from 'lucide-react';
import { HelpTip } from '../../HelpTip';
import { cn, formatINR, newRef, refFor, todayISO } from '../../../lib/utils';
import { pharmacyGstOn } from '../../../lib/pharmacyGst';
import { fileToBase64 } from '../../../lib/base64';
import {
  addAsNew, billTotals, chooseDrug, checkDraft, clearChoice, confirmLine, lineMoney, patchBill, patchLine, setAside, summarize,
} from '../../../lib/billImport';
import type { Draft, DraftBill, DraftLine, ImportResult, NewDrugSpec, Problem } from '../../../lib/billImport';
import { PhotoPanel, type BillPicture } from './PhotoPanel';
import { LineCard, type LineActs } from './LineCard';
import { Banner, Section, Tip, errCls, numOrNull, selectAll } from './ui';

type Imported = Extract<ImportResult, { ok: true }>;

export function ReviewScreen({ initial, notices, duplicate, picture, photoFile, waitingId, title, onBack, onImported }: {
  initial: Draft;
  notices: string[];
  duplicate: { id: number; date: string } | null;
  picture: BillPicture | null;
  /** The picture to save with the purchase (a new upload). A waiting bill's picture is already saved. */
  photoFile: File | null;
  waitingId: number | null;
  title: string;
  onBack: () => void;
  onImported: (r: Imported) => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [dup, setDup] = useState<{ key: string; row: { id: number; date: string } } | null>(() =>
    duplicate && initial.bill.wholesaler_id !== null ? { key: `${initial.bill.wholesaler_id}|${initial.bill.invoice_number.trim().toLowerCase()}`, row: duplicate } : null);
  const [claimOverride, setClaimOverride] = useState<boolean | null>(null);
  const [showPhoto, setShowPhoto] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');
  const [attempt] = useState(newRef);

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: drugs = [] } = useQuery({ queryKey: ['pharmacy-drugs-active'], queryFn: () => window.electronAPI.pharmacy.listDrugs({ activeOnly: true }) });
  const { data: wholesalers = [] } = useQuery({ queryKey: ['wholesalers'], queryFn: () => window.electronAPI.wholesalers.list({ activeOnly: true }) });
  const gstCharged = pharmacyGstOn(settings);
  const claimable = claimOverride ?? gstCharged;

  // ---- is this invoice already recorded? (asked as the supplier / number change) ----
  useEffect(() => {
    const no = draft.bill.invoice_number.trim();
    const sid = draft.bill.wholesaler_id;
    if (!no || sid === null) { setDup(null); return; }
    const key = `${sid}|${no.toLowerCase()}`;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const row = await window.electronAPI.purchaseImport.checkInvoice(sid, no);
        if (live) setDup(row ? { key, row } : null);
      } catch { /* the main process checks again when IMPORT is pressed */ }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [draft.bill.wholesaler_id, draft.bill.invoice_number]);

  const check = useMemo(() => checkDraft(draft, {
    today: todayISO(),
    existingInvoice: (id, no) => (id !== null && dup && dup.key === `${id}|${no.trim().toLowerCase()}` ? dup.row : null),
  }), [draft, dup]);
  const money = useMemo(() => lineMoney(draft, { gstInCost: !claimable, gstCharged }), [draft, claimable, gstCharged]);
  const totals = useMemo(() => billTotals(draft, !claimable), [draft, claimable]);
  const summary = useMemo(() => summarize(draft), [draft]);

  const byLine = useMemo(() => {
    const m = new Map<number, Problem[]>();
    for (const p of check.problems) if (p.line !== null) m.set(p.line, [...(m.get(p.line) ?? []), p]);
    return m;
  }, [check.problems]);
  const billProblems = check.problems.filter((p) => p.line === null);
  const billErrors = billProblems.filter((p) => p.severity === 'error');
  const billBad = (f: string) => billErrors.some((p) => p.field === f);
  /** Bill-level notes that have no box of their own (the date and the totals are shown beside the fields they are about). */
  const worthALook = billProblems.filter((p) => p.severity === 'warn' && p.field !== 'invoice_date' && p.field !== 'totals');
  const linesWithErrors = draft.lines.filter((l) => !l.aside && (byLine.get(l.id) ?? []).some((p) => p.severity === 'error'));

  // ---- the things a card can do (one stable object) ----
  const acts = useMemo<LineActs>(() => ({
    patch: (id, patch) => setDraft((d) => patchLine(d, id, patch)),
    choose: (id, drugId) => setDraft((d) => chooseDrug(d, id, drugId)),
    confirm: (id) => setDraft((d) => confirmLine(d, id)),
    addNew: (id) => setDraft((d) => addAsNew(d, id)),
    newSpec: (id, spec: NewDrugSpec) => setDraft((d) => addAsNew(d, id, spec)),
    clearNew: (id) => setDraft((d) => clearChoice(d, id)),
    aside: (id, aside) => setDraft((d) => setAside(d, id, aside)),
  }), []);
  const bill = (patch: Partial<DraftBill>) => setDraft((d) => patchBill(d, patch));

  const scrollTo = useCallback((elId: string) => document.getElementById(elId)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), []);
  const firstProblem = () => {
    const first = check.problems.find((p) => p.severity === 'error');
    if (!first) return;
    scrollTo(first.line !== null ? `imp-line-${first.line}` : 'imp-bill-top');
  };
  const setAsideBroken = () => setDraft((d) => ({ ...d, lines: d.lines.map((l) => (linesWithErrors.some((x) => x.id === l.id) ? { ...l, aside: true } : l)) }));

  // ---- the final step ----
  const typedOk = typed.trim().toUpperCase() === 'IMPORT';
  const importNow = async () => {
    if (!check.ready || !typedOk || busy) return;
    setBusy(true); setServerError('');
    try {
      const photo = photoFile ? { name: photoFile.name, base64: await fileToBase64(photoFile) } : null;
      const res = await window.electronAPI.purchaseImport.create({
        draft, confirm: typed.trim(), client_ref: refFor(attempt, draft), photo, waiting_id: waitingId, gst_in_cost: !claimable,
      });
      if (!res.ok) { setServerError(res.error); return; }
      onImported(res);
    } catch (e: any) {
      setServerError(String(e?.message || e || 'Could not import the bill.'));
    } finally { setBusy(false); }
  };

  const b = draft.bill;
  const rec = check.reconciliation;
  const visibleLines = onlyProblems ? draft.lines.filter((l) => !l.aside && (byLine.get(l.id) ?? []).some((p) => p.severity === 'error')) : draft.lines;
  const dueNow = Math.max(0, totals.total - b.paid_now);
  const showPic = !!picture && showPhoto;

  return (
    <div className={cn('grid gap-4', showPic ? 'lg:grid-cols-[minmax(300px,36%)_minmax(0,1fr)]' : 'grid-cols-1')}>
      {showPic && picture && (
        <div className="lg:sticky lg:top-0 self-start" style={{ height: 'calc(92vh - 8.5rem)' }}>
          <PhotoPanel picture={picture} onHide={() => setShowPhoto(false)} />
        </div>
      )}

      <div className="space-y-4 min-w-0">
        {/* heading */}
        <div id="imp-bill-top" className="flex items-start justify-between gap-3 flex-wrap scroll-mt-4">
          <div>
            <button type="button" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-700 dark:text-slate-400" onClick={onBack}><ArrowLeft className="w-3.5 h-3.5" /> {title}</button>
            <h3 className="text-base font-bold text-gray-900 dark:text-slate-100">Check the bill against the paper</h3>
            <p className="text-xs text-gray-600 dark:text-slate-300 max-w-3xl">
              Nothing is in your stock yet. Compare each line with the bill, fix the <b className="text-red-700 dark:text-red-300">red boxes</b>, and when everything is right type <b>IMPORT</b> at the bottom.
              A line you cannot settle can be <b>set aside</b> — the others are imported now and that one waits.
            </p>
          </div>
          {picture && (
            <button type="button" className="btn-secondary text-xs" onClick={() => setShowPhoto((v) => !v)}>{showPhoto ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />} {showPhoto ? 'Hide the bill picture' : 'Show the bill picture'}</button>
          )}
        </div>

        {notices.length > 0 && (
          <Banner tone="amber" title="About the file">
            <ul className="list-disc pl-5 space-y-0.5">{notices.slice(0, 6).map((n, i) => <li key={i}>{n}</li>)}</ul>
          </Banner>
        )}
        {b.pages_seen && <div className="text-[11px] text-gray-500 dark:text-slate-400">ChatGPT says it saw: pages {b.pages_seen}. {b.notes && <>Its note: <i>{b.notes}</i></>}</div>}

        {/* supplier + invoice */}
        <Section title="Supplier and invoice" hint="As printed on the bill. The invoice number and date are what stop the same bill being entered twice.">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="label">Supplier *</label>
              <select className={cn('input', errCls(billBad('supplier')))} value={b.wholesaler_id ?? 'new'}
                onChange={(e) => bill({ wholesaler_id: e.target.value === 'new' ? null : Number(e.target.value) })}>
                <option value="new">＋ A new supplier (not in my Wholesalers list yet)</option>
                {wholesalers.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.drug_license_no})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Invoice number *</label>
              <input className={cn('input font-mono', errCls(billBad('invoice_number')))} value={b.invoice_number} onChange={(e) => bill({ invoice_number: e.target.value })} />
            </div>
            <div>
              <label className="label">Invoice date *</label>
              <input type="date" className={cn('input', errCls(billBad('invoice_date')))} value={b.invoice_date} onChange={(e) => bill({ invoice_date: e.target.value })} />
              {b.invoice_date_printed && b.invoice_date_printed !== b.invoice_date && <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">bill: {b.invoice_date_printed}</div>}
            </div>
          </div>
          {b.wholesaler_id === null && (
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/10 p-3 space-y-2">
              <div className="text-xs font-semibold text-blue-900 dark:text-blue-100">This supplier is not in your Wholesalers list. It will be added when you import — it needs its drug licence number.</div>
              {b.supplier_suggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-gray-600 dark:text-slate-300">Is it one of these?</span>
                  {b.supplier_suggestions.map((s) => (
                    <button key={s.id} type="button" className="btn-secondary text-xs px-2 py-1" onClick={() => bill({ wholesaler_id: s.id })} title={s.reason}>{s.name}</button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div><label className="label">Supplier name *</label><input className={cn('input', errCls(billBad('supplier') && !b.supplier_name.trim()))} value={b.supplier_name} onChange={(e) => bill({ supplier_name: e.target.value })} /></div>
                <div>
                  <Tip label="Drug licence no *" title="Drug licence number"><p>The supplier’s drug licence number (“DL No.” or “D.L.”) printed on the bill. Pharmacy records need it for every supplier.</p></Tip>
                  <input className={cn('input font-mono', errCls(billBad('supplier') && !!b.supplier_name.trim() && !b.supplier_license.trim()))} value={b.supplier_license} onChange={(e) => bill({ supplier_license: e.target.value })} />
                </div>
                <div><label className="label">GSTIN</label><input className="input font-mono" value={b.supplier_gstin} onChange={(e) => bill({ supplier_gstin: e.target.value })} /></div>
              </div>
            </div>
          )}
          {billProblems.filter((p) => ['supplier', 'invoice_number', 'invoice_date'].includes(p.field ?? '')).map((p, i) => (
            <div key={i} className={cn('text-xs', p.severity === 'error' ? 'text-red-700 dark:text-red-300' : 'text-amber-800 dark:text-amber-300')}>{p.severity === 'error' ? '●' : '▲'} {p.message}</div>
          ))}
          {b.part_of && <div className="text-xs text-blue-800 dark:text-blue-200">This is a later part of invoice <b>{b.part_of}</b> — the lines that were set aside earlier.</div>}
        </Section>

        {/* what still needs doing */}
        {check.errors > 0 && (
          <Banner tone="red" title={`${check.errors} thing${check.errors === 1 ? '' : 's'} to fix before this can be imported`}>
            <ul className="space-y-0.5">
              {check.problems.filter((p) => p.severity === 'error').slice(0, 6).map((p, i) => {
                const l = p.line !== null ? draft.lines.find((x) => x.id === p.line) : null;
                return (
                  <li key={i}>
                    <button type="button" className="text-left underline decoration-dotted hover:text-red-950 dark:hover:text-red-100" onClick={() => scrollTo(p.line !== null ? `imp-line-${p.line}` : 'imp-bill-top')}>
                      {l ? `Line ${l.line_no} (${l.printed_name}): ` : ''}{p.message}
                    </button>
                  </li>
                );
              })}
              {check.errors > 6 && <li>…and {check.errors - 6} more (each is marked in red below).</li>}
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" className="btn-secondary text-xs px-2.5 py-1.5" onClick={firstProblem}>Show me the first one</button>
              {linesWithErrors.length > 0 && linesWithErrors.length < check.importing && (
                <button type="button" className="btn-secondary text-xs px-2.5 py-1.5" onClick={setAsideBroken}>
                  <Pause className="w-3.5 h-3.5" /> Set aside the {linesWithErrors.length} line{linesWithErrors.length === 1 ? '' : 's'} with problems — import the rest
                </button>
              )}
            </div>
          </Banner>
        )}

        {worthALook.length > 0 && (
          <Banner tone="amber" title="Worth a look">
            <ul className="list-disc pl-5 space-y-0.5">{worthALook.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
          </Banner>
        )}

        {/* the lines */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">Medicines on this bill ({draft.lines.length})</h3>
            <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-300">
              <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only lines with problems
            </label>
          </div>
          {visibleLines.map((l) => (
            <LineCard key={l.id} line={l} problems={byLine.get(l.id) ?? []} money={money.get(l.id)} drugs={drugs} acts={acts} />
          ))}
          {onlyProblems && visibleLines.length === 0 && <div className="text-xs text-emerald-700 dark:text-emerald-300">No line has a problem now. 🎉</div>}
        </div>

        {/* the bill's money */}
        <Section title="The bill’s money" hint="The same working as the purchase bill: what is saved is what you see here.">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="card p-3 bg-gray-50 dark:bg-slate-900 md:col-span-2">
              <div className="flex justify-between text-xs"><span>Goods (at supplier rates)</span><span>{formatINR(totals.subtotal)}</span></div>
              {totals.line_discount > 0 && <div className="flex justify-between text-xs text-emerald-700 dark:text-emerald-300"><span>Line discounts</span><span>− {formatINR(totals.line_discount)}</span></div>}
              <div className="flex justify-between text-xs items-center">
                <span className="inline-flex items-center gap-1">Invoice discount
                  <HelpTip title="Invoice discount"><p>A discount on the WHOLE bill — on the dealer’s bill it appears near the bottom as “Discount” or “Less”. It is filled in from the bill when it is more than the lines’ own discounts; correct it if it is wrong.</p><p>It is shared over the lines in proportion to their value, so it lowers what each unit cost you.</p></HelpTip>
                </span>
                <input type="number" min={0} step="0.01" onFocus={selectAll} className={cn('input w-28 text-right py-1', errCls(billBad('discount')))} value={b.discount} onChange={(e) => bill({ discount: Number(e.target.value) || 0 })} />
              </div>
              {b.interstate
                ? <div className="flex justify-between text-xs"><span>IGST</span><span>{formatINR(totals.igst)}</span></div>
                : <>
                    <div className="flex justify-between text-xs"><span>CGST</span><span>{formatINR(totals.cgst)}</span></div>
                    <div className="flex justify-between text-xs"><span>SGST</span><span>{formatINR(totals.sgst)}</span></div>
                  </>}
              <div className="flex justify-between text-xs items-center">
                <span className="inline-flex items-center gap-1">Freight / other charges
                  <HelpTip title="Freight / other charges"><p>Transport, packing or any other charge on the bill that is not a medicine. It is shared over the lines and added to what each unit cost you.</p></HelpTip>
                </span>
                <input type="number" min={0} step="0.01" onFocus={selectAll} className={cn('input w-28 text-right py-1', errCls(billBad('other')))} value={b.other_charges} onChange={(e) => bill({ other_charges: Number(e.target.value) || 0 })} />
              </div>
              <div className="flex justify-between text-xs items-center">
                <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={b.round_off === 'auto'} onChange={(e) => bill({ round_off: e.target.checked ? 'auto' : 0 })} /> Round off to nearest ₹</label>
                <span>{totals.round_off >= 0 ? '+' : '−'} {formatINR(Math.abs(totals.round_off))}</span>
              </div>
              <div className="flex justify-between text-sm font-bold pt-2 border-t border-gray-300 dark:border-slate-700 mt-1">
                <span>{summary.aside > 0 ? 'Total of the lines being imported now' : 'Total'}</span>
                <span className="text-blue-700 dark:text-blue-300">{formatINR(totals.total)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600 dark:text-slate-300">
                <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={b.interstate} onChange={(e) => bill({ interstate: e.target.checked })} /> Supplier is in another state (IGST)</label>
                <label className="inline-flex items-center gap-1.5" title="Tick if the clinic claims input tax credit on this GST. If not, the GST becomes part of what the stock cost.">
                  <input type="checkbox" checked={claimable} onChange={(e) => setClaimOverride(e.target.checked)} /> GST on this bill can be claimed back
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <div><label className="label">Paid now (₹)</label><input type="number" min={0} step="0.01" onFocus={selectAll} className={cn('input text-right', errCls(billErrors.some((p) => p.field === 'paid')))} value={b.paid_now} onChange={(e) => bill({ paid_now: Number(e.target.value) || 0 })} /></div>
              <div>
                <label className="label">Payment mode</label>
                <select className="input" value={b.pay_mode} onChange={(e) => bill({ pay_mode: e.target.value })}>
                  <option value="">—</option><option>Cash</option><option>Cheque</option><option>Bank</option><option>UPI</option><option>Credit</option>
                </select>
              </div>
              {dueNow > 0 && <div className="text-xs text-gray-600 dark:text-slate-300">{formatINR(dueNow)} still to pay the supplier</div>}
            </div>
          </div>

          {/* does the bill add up? */}
          {rec.difference !== null && (
            <div className={cn('rounded-lg border p-3 text-xs', rec.ok ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-900 dark:text-emerald-200' : b.totals_ack ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200' : 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-200')}>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>The bill says: <b>{formatINR(rec.printed_net as number)}</b></span>
                <span>CureDesk makes the {summary.aside > 0 ? 'whole bill' : 'lines'}: <b>{formatINR(rec.computed_total)}</b>{rec.aside_printed > 0 && <span className="opacity-80"> (including {formatINR(rec.aside_printed)} of set-aside lines, from their printed amounts)</span>}</span>
                <span className="font-semibold">{rec.ok ? '✓ They agree' : `${(rec.difference as number) > 0 ? 'Short by' : 'Over by'} ${formatINR(Math.abs(rec.difference as number))}`}</span>
              </div>
              {!rec.ok && (
                <label className="mt-1.5 inline-flex items-center gap-1.5 font-medium">
                  <input type="checkbox" checked={b.totals_ack} onChange={(e) => bill({ totals_ack: e.target.checked })} />
                  I have checked this difference — import anyway
                </label>
              )}
              {!rec.ok && <p className="mt-1 opacity-90">A line may be misread or missing, or the bill has a discount or charge you have not entered above. Compare the totals with the paper first.</p>}
            </div>
          )}
        </Section>

        {/* the last step */}
        <div className="sticky bottom-0 -mx-5 -mb-5 px-5 py-3 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] z-10">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="text-sm min-w-[240px] flex-1">
              {check.ready ? (
                <span className="text-gray-800 dark:text-slate-100">
                  Ready: <b>{summary.lines}</b> medicine line{summary.lines === 1 ? '' : 's'} · <b>{summary.units}</b> units{summary.free_units > 0 && <> (incl. {summary.free_units} free)</>} · <b>{formatINR(summary.total)}</b>
                  {summary.new_medicines > 0 && <> · <b>{summary.new_medicines}</b> new medicine{summary.new_medicines === 1 ? '' : 's'} added to the Drug List</>}
                  {b.wholesaler_id === null && <> · new supplier added</>}
                  {summary.aside > 0 && <> · <b>{summary.aside}</b> set aside to finish later</>}
                  {check.warnings > 0 && <span className="text-amber-700 dark:text-amber-300"> · {check.warnings} note{check.warnings === 1 ? '' : 's'} (▲) worth a look</span>}
                </span>
              ) : (
                <span className="text-red-700 dark:text-red-300">
                  {check.errors} thing{check.errors === 1 ? '' : 's'} to fix first.{' '}
                  <button type="button" className="underline" onClick={firstProblem}>Show me</button>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-slate-300">
                Type IMPORT
                <HelpTip title="Why type IMPORT?" align="right">
                  <p>Importing adds stock to your shelves and the amount to what you owe the supplier. Typing the word is your last check that you have compared every line with the bill.</p>
                  <p>Until you do, nothing in your stock changes.</p>
                </HelpTip>
              </label>
              <input className="input w-36 uppercase tracking-widest text-center font-semibold" placeholder="IMPORT" disabled={!check.ready || busy} value={typed} onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') importNow(); }} aria-label="Type IMPORT to confirm" />
              <button className="btn-success" disabled={!check.ready || !typedOk || busy} onClick={importNow}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />} {busy ? 'Importing…' : 'Import to stock'}
              </button>
            </div>
          </div>
          {serverError && <Banner tone="red" title="Could not import" className="mt-2">{serverError}</Banner>}
        </div>
      </div>
    </div>
  );
}
