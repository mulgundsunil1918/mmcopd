import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, Plus, Trash2, Receipt, Eye, X } from 'lucide-react';
import { Modal } from '../Modal';
import { BillPrint } from './BillPrint';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { cn } from '../../lib/utils';

/**
 * Raise a bill from anywhere — OPD consultation, pharmacy, lab, or a quick
 * custom bill. Reusable: drop <QuickBillModal> behind any "New Bill" button.
 *
 * Two ways to name the payer:
 *   - search and attach a registered patient, or
 *   - just type a name (walk-in / custom bill, no record needed).
 *
 * Lines can be a one-click charge head (fills description + rate + GST) or a
 * free-text description + amount. GST is applied only when it is switched on in
 * Settings and the charge head is marked taxable.
 */
type Line = { description: string; qty: number; rate: number; charge_head_id?: number | null; gst_rate?: number; is_taxable?: boolean; hsn_sac?: string | null };

const BILL_TYPES: { id: string; label: string }[] = [
  { id: 'opd_consult', label: 'Consultation' },
  { id: 'pharmacy', label: 'Pharmacy' },
  { id: 'lab', label: 'Laboratory' },
  { id: 'custom', label: 'Custom' },
];

export function QuickBillModal({
  onClose, presetPatient, presetType = 'custom',
}: {
  onClose: () => void;
  presetPatient?: { id: number; first_name: string; last_name: string; uhid: string; phone: string } | null;
  presetType?: string;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const [billType, setBillType] = useState(presetType);
  const [q, setQ] = useState('');
  const [patient, setPatient] = useState<any | null>(presetPatient ?? null);
  const [customName, setCustomName] = useState('');
  const [lines, setLines] = useState<Line[]>([{ description: '', qty: 1, rate: 0 }]);
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [paidNow, setPaidNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [printBillId, setPrintBillId] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);   // pre-save on-screen preview

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: heads = [] } = useQuery({ queryKey: ['charge-heads-quick'], queryFn: () => window.electronAPI.chargeHeads.list() });
  const { data: results = [] } = useQuery({
    queryKey: ['patient-search-bill', q],
    queryFn: () => window.electronAPI.patients.search(q),
    enabled: q.trim().length >= 2 && !patient,
  });

  const gstOn = !!settings?.gst_enabled;

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLine = () => setLines((ls) => [...ls, { description: '', qty: 1, rate: 0 }]);
  const removeLine = (i: number) => setLines((ls) => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls);

  /** One-click add a configured charge head as a line. */
  const addHead = (h: any) => setLines((ls) => {
    const blank = ls.findIndex((l) => !l.description && !l.rate);
    const line: Line = { description: h.name, qty: 1, rate: h.default_rate, charge_head_id: h.id, gst_rate: h.gst_rate, is_taxable: !!h.is_taxable, hsn_sac: h.hsn_sac };
    if (blank >= 0) return ls.map((l, i) => i === blank ? line : l);
    return [...ls, line];
  });

  // Live totals. GST is charged per line only when it is enabled in Settings
  // AND the line is marked taxable (charge heads carry this; free-text lines
  // default to exempt, which is correct for consultations).
  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 1) * (Number(l.rate) || 0), 0);
  const gstAmount = gstOn
    ? lines.reduce((s, l) => {
        const amt = (Number(l.qty) || 1) * (Number(l.rate) || 0);
        return s + (l.is_taxable && l.gst_rate ? (amt * l.gst_rate) / 100 : 0);
      }, 0)
    : 0;
  const grandTotal = subtotal + gstAmount;
  const money = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

  const save = async (thenPrint: boolean) => {
    const validLines = lines.filter((l) => l.description.trim() && (Number(l.qty) * Number(l.rate)) >= 0 && (Number(l.rate) > 0 || Number(l.qty) > 0));
    if (validLines.length === 0) { toast('Add at least one line with a description and amount', 'error'); return; }
    if (!patient && !customName.trim()) { toast('Pick a patient or type a name', 'error'); return; }

    setBusy(true);
    try {
      const r = await window.electronAPI.billing.createStandalone({
        patient_id: patient?.id ?? null,
        patient_name: patient ? '' : customName.trim(),
        bill_type: billType,
        items: validLines.map((l) => ({
          description: l.description.trim(),
          qty: Number(l.qty) || 1,
          rate: Number(l.rate) || 0,
          charge_head_id: l.charge_head_id ?? null,
          gst_rate: gstOn ? (l.gst_rate ?? 0) : 0,
          is_taxable: gstOn ? !!l.is_taxable : false,
          hsn_sac: l.hsn_sac ?? null,
        })),
        payment_mode: paymentMode,
        paid_now: paidNow,
        performed_by: user?.username ?? null,
      });
      if (r.ok) {
        toast(`Bill ${r.bill_number} created`, 'success');
        if (thenPrint) setPrintBillId(r.id);
        else onClose();
      } else {
        toast(r.error, 'error');   // backend message verbatim
      }
    } catch (e: any) {
      toast(e?.message || 'Could not create the bill', 'error');
    } finally { setBusy(false); }
  };

  if (printBillId) {
    return <BillPrint billId={printBillId} onClose={onClose} />;
  }

  return (
    <Modal open onClose={onClose} title="New Bill" size="xl">
      <div className="space-y-4">
        {/* Bill type */}
        <div className="flex flex-wrap gap-1 p-1 rounded-lg bg-gray-100 dark:bg-slate-800/60 w-fit">
          {BILL_TYPES.map((t) => (
            <button key={t.id} onClick={() => setBillType(t.id)}
              className={cn('px-3 py-1.5 rounded-md text-[12px] font-semibold transition',
                billType === t.id ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-gray-600 dark:text-slate-400')}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Payer: registered patient OR typed name */}
        {patient ? (
          <div className="flex items-center justify-between rounded-lg border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/20 p-3">
            <div>
              <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{patient.first_name} {patient.last_name}</div>
              <div className="text-[11px] text-gray-500">{patient.uhid} · {patient.phone}</div>
            </div>
            <button className="btn-ghost text-xs" onClick={() => { setPatient(null); setQ(''); }}>Change</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label">Find registered patient</label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
                <input className="input pl-9" placeholder="Name, phone or UHID" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              {q.trim().length >= 2 && results.length > 0 && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700">
                  {results.map((p: any) => (
                    <button key={p.id} onClick={() => setPatient(p)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-b last:border-0 border-gray-100 dark:border-slate-800">
                      <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{p.first_name} {p.last_name}</div>
                      <div className="text-[11px] text-gray-500">{p.uhid} · {p.phone}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="label">…or just type a name (walk-in)</label>
              <input className="input" placeholder="Patient / payer name" value={customName} onChange={(e) => setCustomName(e.target.value)} />
              <div className="text-[10px] text-gray-500 mt-1">Use this for a quick bill with no patient record.</div>
            </div>
          </div>
        )}

        {/* Quick charge-head chips */}
        {heads.length > 0 && (
          <div>
            <div className="text-[11px] text-gray-500 mb-1">Quick add:</div>
            <div className="flex flex-wrap gap-1.5">
              {heads.filter((h: any) => h.applies_to !== 'ipd').map((h: any) => (
                <button key={h.id} onClick={() => addHead(h)}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] hover:border-blue-400 dark:border-slate-700">
                  <span className="w-2 h-2 rounded-sm" style={{ background: h.colour || '#94a3b8' }} />
                  {h.name} <span className="text-gray-400">₹{h.default_rate}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Lines — with clear column headers */}
        <div className="space-y-1.5">
          <div className={cn('grid gap-2 items-center px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500', gstOn ? 'grid-cols-12' : 'grid-cols-12')}>
            <div className={gstOn ? 'col-span-5' : 'col-span-6'}>Item / Service</div>
            <div className="col-span-2 text-center">Qty</div>
            <div className={gstOn ? 'col-span-2' : 'col-span-3'}>Rate (₹)</div>
            {gstOn && <div className="col-span-2 text-center">GST %</div>}
            <div className="col-span-1"></div>
          </div>
          {lines.map((l, i) => {
            const lineAmt = (Number(l.qty) || 1) * (Number(l.rate) || 0);
            return (
              <div key={i}>
                <div className="grid grid-cols-12 gap-2 items-center">
                  <input className={cn('input', gstOn ? 'col-span-5' : 'col-span-6')} placeholder="e.g. Consultation" value={l.description}
                    onChange={(e) => setLine(i, { description: e.target.value })} />
                  <input className="input col-span-2 text-center" type="number" min={1} value={l.qty}
                    onChange={(e) => setLine(i, { qty: Number(e.target.value) })} />
                  <input className={cn('input', gstOn ? 'col-span-2' : 'col-span-3')} type="number" min={0} value={l.rate}
                    onChange={(e) => setLine(i, { rate: Number(e.target.value) })} />
                  {gstOn && (
                    <select className="input col-span-2 text-[12px]"
                      value={l.is_taxable ? (l.gst_rate ?? 0) : -1}
                      onChange={(e) => { const v = Number(e.target.value); setLine(i, v < 0 ? { is_taxable: false, gst_rate: 0 } : { is_taxable: true, gst_rate: v }); }}>
                      <option value={-1}>Exempt</option>
                      {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
                    </select>
                  )}
                  <button className="col-span-1 flex justify-center text-gray-400 hover:text-red-500" onClick={() => removeLine(i)} title="Remove line"><Trash2 className="w-4 h-4" /></button>
                </div>
                {lineAmt > 0 && (
                  <div className="text-[10px] text-gray-400 text-right pr-10 mt-0.5">
                    line total: {money(lineAmt)}{gstOn && l.is_taxable && l.gst_rate ? ` + ${money(lineAmt * l.gst_rate / 100)} GST` : ''}
                  </div>
                )}
              </div>
            );
          })}
          <button className="btn-ghost text-xs" onClick={addLine}><Plus className="w-3.5 h-3.5" /> Add line</button>
        </div>

        {/* Payment + totals breakdown */}
        <div className="flex items-end justify-between flex-wrap gap-3 pt-3 border-t dark:border-slate-700">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12px]">
              <input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} /> Paid now
            </label>
            <select className="input w-28" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
              <option>Cash</option><option>UPI</option><option>Card</option>
            </select>
          </div>
          <div className="text-right text-[12px] min-w-[180px]">
            <div className="flex justify-between text-gray-500"><span>Subtotal</span><span className="tabular-nums">{money(subtotal)}</span></div>
            {gstOn && gstAmount > 0 && (
              <div className="flex justify-between text-gray-500"><span>GST (CGST + SGST)</span><span className="tabular-nums">{money(gstAmount)}</span></div>
            )}
            <div className="flex justify-between font-extrabold text-gray-900 dark:text-slate-100 text-lg mt-1 pt-1 border-t dark:border-slate-700">
              <span>Total</span><span className="tabular-nums">{money(grandTotal)}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy} onClick={() => save(true)}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />} Save &amp; Print
          </button>
          <button className="btn-secondary" disabled={busy} onClick={() => setPreview(true)}>
            <Eye className="w-4 h-4" /> Preview
          </button>
          <button className="btn-secondary" disabled={busy} onClick={() => save(false)}>Save only</button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>

      {preview && (
        <PreviewOverlay
          clinic={settings}
          payerName={patient ? `${patient.first_name} ${patient.last_name}` : customName}
          payerSub={patient ? `${patient.uhid} · ${patient.phone}` : 'Walk-in'}
          lines={lines.filter((l) => l.description.trim())}
          gstOn={gstOn}
          money={money}
          onClose={() => setPreview(false)}
        />
      )}
    </Modal>
  );
}

/** On-screen bill preview BEFORE saving — computed client-side, no DB write. */
function PreviewOverlay({ clinic, payerName, payerSub, lines, gstOn, money, onClose }: {
  clinic: any; payerName: string; payerSub: string; lines: Line[]; gstOn: boolean; money: (n: number) => string; onClose: () => void;
}) {
  const rows = lines.map((l) => {
    const amt = (Number(l.qty) || 1) * (Number(l.rate) || 0);
    const gst = gstOn && l.is_taxable && l.gst_rate ? (amt * l.gst_rate) / 100 : 0;
    return { ...l, amt, gst };
  });
  const subtotal = rows.reduce((s, r) => s + r.amt, 0);
  const gstTotal = rows.reduce((s, r) => s + r.gst, 0);
  const isTax = gstOn && gstTotal > 0;

  return (
    <div className="fixed inset-0 z-[210] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white text-slate-900 rounded-lg shadow-2xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b-2 pb-2" style={{ borderColor: '#1e3a8a' }}>
          <div className="font-extrabold uppercase" style={{ color: '#1e3a8a', fontSize: 18 }}>{clinic?.clinic_name || 'CureDesk HMS'}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="text-center my-2">
          <span className="inline-block px-3 py-0.5 rounded font-bold text-[12px]" style={{ background: '#eff6ff', color: '#1e3a8a' }}>
            {!gstOn ? 'RECEIPT (DRAFT)' : isTax ? 'TAX INVOICE (DRAFT)' : 'BILL OF SUPPLY (DRAFT)'}
          </span>
        </div>
        <div className="text-[12px] mb-2"><b>Bill to:</b> {payerName || '—'} <span className="text-slate-500">· {payerSub}</span></div>
        <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f1f5f9' }}>
            <th style={cell}>Item</th><th style={cell}>Qty</th><th style={cell}>Rate</th>
            {isTax && <th style={cell}>GST</th>}<th style={{ ...cell, textAlign: 'right' }}>Amount</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={isTax ? 5 : 4} style={{ ...cell, color: '#94a3b8' }}>No lines yet.</td></tr>}
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ ...cell, textAlign: 'left' }}>{r.description}</td>
                <td style={cell}>{r.qty}</td><td style={cell}>{money(r.rate)}</td>
                {isTax && <td style={cell}>{r.gst ? money(r.gst) : '—'}</td>}
                <td style={{ ...cell, textAlign: 'right' }}>{money(r.amt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 text-[13px] flex flex-col items-end gap-0.5">
          <div className="flex justify-between w-40"><span className="text-slate-500">Subtotal</span><span>{money(subtotal)}</span></div>
          {isTax && <div className="flex justify-between w-40"><span className="text-slate-500">GST</span><span>{money(gstTotal)}</span></div>}
          <div className="flex justify-between w-40 font-bold border-t pt-0.5"><span>Total</span><span>{money(subtotal + gstTotal)}</span></div>
        </div>
        <div className="text-[10px] text-slate-400 mt-3 text-center">This is a draft preview. Use “Save &amp; Print” to finalise and print the bill.</div>
      </div>
    </div>
  );
}

const cell: React.CSSProperties = { border: '1px solid #e2e8f0', padding: '3px 6px', textAlign: 'center' };
