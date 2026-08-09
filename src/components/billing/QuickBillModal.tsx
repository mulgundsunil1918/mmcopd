import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, Plus, Trash2, Receipt, UserPlus, X } from 'lucide-react';
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

  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 1) * (Number(l.rate) || 0), 0);

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

        {/* Lines */}
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input className="input col-span-6" placeholder="Description (e.g. Consultation)" value={l.description}
                onChange={(e) => setLine(i, { description: e.target.value })} />
              <input className="input col-span-2" type="number" min={1} placeholder="Qty" value={l.qty}
                onChange={(e) => setLine(i, { qty: Number(e.target.value) })} />
              <input className="input col-span-3" type="number" min={0} placeholder="Amount ₹" value={l.rate}
                onChange={(e) => setLine(i, { rate: Number(e.target.value) })} />
              <button className="col-span-1 text-gray-400 hover:text-red-500" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button className="btn-ghost text-xs" onClick={addLine}><Plus className="w-3.5 h-3.5" /> Add line</button>
        </div>

        {/* Total + payment */}
        <div className="flex items-center justify-between flex-wrap gap-3 pt-3 border-t dark:border-slate-700">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12px]">
              <input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} /> Paid now
            </label>
            <select className="input w-28" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
              <option>Cash</option><option>UPI</option><option>Card</option>
            </select>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase text-gray-500">Subtotal{gstOn ? ' (GST added on save)' : ''}</div>
            <div className="text-xl font-extrabold tabular-nums">₹{subtotal.toLocaleString('en-IN')}</div>
          </div>
        </div>

        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy} onClick={() => save(true)}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />} Save &amp; Print
          </button>
          <button className="btn-secondary" disabled={busy} onClick={() => save(false)}>Save only</button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
