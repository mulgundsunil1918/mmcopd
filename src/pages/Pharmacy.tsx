import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Pill, Plus, Search, AlertTriangle, Package, Clipboard, ShoppingCart, Trash2, Pencil,
  Layers, Truck, FileText, ChevronDown, ChevronRight, X,
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../hooks/useToast';
import { cn, fmtDate, fmtDateTime, formatINR, todayISO } from '../lib/utils';
import type {
  Drug, DrugMaster, DrugSchedule, DrugStockBatch, PurchaseInvoice, PurchaseInvoiceInput, Wholesaler,
} from '../types';
import { DispensingRegisterPrint } from '../components/DispensingRegisterPrint';
import { StockRegisterPrint } from '../components/StockRegisterPrint';
import { PurchaseRegisterPrint } from '../components/PurchaseRegisterPrint';
import { BarcodeScanModal } from '../components/BarcodeScanModal';
import { Scan } from 'lucide-react';

type Tab = 'dispense' | 'drugs' | 'batches' | 'purchases' | 'sales';

export function Pharmacy() {
  const [tab, setTab] = useState<Tab>('dispense');
  const [reportsOpen, setReportsOpen] = useState(false);

  const { data: alerts } = useQuery({
    queryKey: ['pharmacy-alerts'],
    queryFn: () => window.electronAPI.pharmacy.alerts(),
    refetchInterval: 60_000,
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Pharmacy</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Batch-tracked stock · FEFO dispensing · Schedule H register · Purchase invoices
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-2 bg-gray-100 dark:bg-slate-700 p-1 rounded-lg flex-wrap">
            <TabBtn active={tab === 'dispense'} onClick={() => setTab('dispense')} icon={<Clipboard className="w-3.5 h-3.5" />}>Dispense</TabBtn>
            <TabBtn active={tab === 'drugs'} onClick={() => setTab('drugs')} icon={<Package className="w-3.5 h-3.5" />}>Drug Master</TabBtn>
            <TabBtn active={tab === 'batches'} onClick={() => setTab('batches')} icon={<Layers className="w-3.5 h-3.5" />}>Stock & Batches</TabBtn>
            <TabBtn active={tab === 'purchases'} onClick={() => setTab('purchases')} icon={<Truck className="w-3.5 h-3.5" />}>Purchases</TabBtn>
            <TabBtn active={tab === 'sales'} onClick={() => setTab('sales')} icon={<ShoppingCart className="w-3.5 h-3.5" />}>Sales</TabBtn>
          </div>
          <button
            className="btn-secondary text-xs"
            onClick={() => setReportsOpen(true)}
          >
            <FileText className="w-3.5 h-3.5" /> Reports
          </button>
        </div>
      </div>

      {(alerts?.lowStock?.length || alerts?.expiringSoon?.length) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {alerts.lowStock.length > 0 && (
            <div className="rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/30 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4" /> Low Stock ({alerts.lowStock.length})
              </div>
              <ul className="text-[11px] text-amber-800 dark:text-amber-200 mt-2 space-y-0.5 max-h-24 overflow-auto">
                {alerts.lowStock.slice(0, 10).map((d) => (
                  <li key={d.id}>{d.name} — {d.stock_qty ?? 0} left (threshold {d.low_stock_threshold})</li>
                ))}
              </ul>
            </div>
          )}
          {alerts.expiringSoon.length > 0 && (
            <div className="rounded-lg border-2 border-red-400 bg-red-50 dark:bg-red-900/30 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-900 dark:text-red-200">
                <AlertTriangle className="w-4 h-4" /> Expiring within 90 days ({alerts.expiringSoon.length})
              </div>
              <ul className="text-[11px] text-red-800 dark:text-red-200 mt-2 space-y-0.5 max-h-24 overflow-auto">
                {alerts.expiringSoon.slice(0, 10).map((b) => (
                  <li key={b.id}>
                    {b.drug_name || `Drug #${b.drug_master_id}`} · Batch {b.batch_no} — expires {b.expiry}
                    {b.qty_remaining ? ` · ${b.qty_remaining} left` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'dispense' && <DispenseQueue />}
      {tab === 'drugs' && <DrugMasterTab />}
      {tab === 'batches' && <StockBatchesTab />}
      {tab === 'purchases' && <PurchasesTab />}
      {tab === 'sales' && <SalesTab />}

      {reportsOpen && <ReportsModal onClose={() => setReportsOpen(false)} />}
    </div>
  );
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
        active ? 'bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 shadow-sm' : 'text-gray-600 dark:text-slate-300'
      )}
    >
      {icon} {children}
    </button>
  );
}

/* ===================================================================
   DISPENSE QUEUE — pending Rx → batch-aware dispense form (FEFO)
   =================================================================== */
function DispenseQueue() {
  const [activeAppt, setActiveAppt] = useState<any | null>(null);
  const { data: pending = [], isLoading } = useQuery({
    queryKey: ['pharmacy-pending'],
    queryFn: () => window.electronAPI.pharmacy.pendingRx(),
    refetchInterval: 30_000,
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-1 card p-4">
        <div className="text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-3">Pending Rx · {pending.length}</div>
        {isLoading ? (
          <div className="text-xs text-gray-500 dark:text-slate-400">Loading…</div>
        ) : pending.length === 0 ? (
          <EmptyState icon={Pill} title="Nothing pending" description="Prescriptions from consultations will appear here once a doctor writes them." />
        ) : (
          <ul className="space-y-1 max-h-[70vh] overflow-auto">
            {pending.map((a: any) => (
              <li
                key={a.id}
                onClick={() => setActiveAppt(a)}
                className={cn(
                  'rounded-lg p-2.5 border cursor-pointer transition',
                  activeAppt?.id === a.id
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/40'
                    : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/40'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-gray-700 dark:text-slate-200">#{a.token_number}</span>
                  <span className="badge bg-fuchsia-100 text-fuchsia-700">{a.rx_count} drug{a.rx_count === 1 ? '' : 's'}</span>
                </div>
                <div className="text-sm text-gray-900 dark:text-slate-100 mt-0.5">{a.patient_name}</div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400">{a.doctor_name} · {fmtDate(a.appointment_date)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="lg:col-span-2">
        {activeAppt ? <DispenseForm appointment={activeAppt} onDone={() => setActiveAppt(null)} /> : (
          <div className="card p-6"><EmptyState icon={ShoppingCart} title="Select a pending Rx" description="Pick an appointment on the left to dispense." /></div>
        )}
      </div>
    </div>
  );
}

function DispenseForm({ appointment, onDone }: { appointment: any; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: rx = [] } = useQuery({
    queryKey: ['pharmacy-appt-rx', appointment.id],
    queryFn: () => window.electronAPI.pharmacy.getAppointmentRx(appointment.id),
  });
  const { data: drugs = [] } = useQuery({
    queryKey: ['pharmacy-drugs-active'],
    queryFn: () => window.electronAPI.pharmacy.listDrugs({ activeOnly: true }),
  });

  type Row = { drug_master_id?: number; drug_name: string; qty: number; rate: number; nextBatch?: string; nextExpiry?: string; stock?: number };
  const [rows, setRows] = useState<Row[]>([]);
  const [discount, setDiscount] = useState(0);
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [scanOpen, setScanOpen] = useState(false);

  // Scan flow inside dispense: add the matched drug as a new row.
  const handleScan = async (code: string) => {
    setScanOpen(false);
    const matches = await window.electronAPI.pharmacy.listDrugs({ q: code, activeOnly: true });
    const exact = matches.find((d) => (d.barcode || '').trim() === code.trim());
    if (!exact) {
      toast(`No drug with barcode ${code} — add it in Drug Master first`, 'error');
      return;
    }
    setRows((prev) => [
      ...prev,
      {
        drug_master_id: exact.id,
        drug_name: exact.name,
        qty: 1,
        rate: exact.mrp ?? exact.default_mrp ?? 0,
        nextBatch: exact.batch || undefined,
        nextExpiry: exact.expiry || undefined,
        stock: exact.stock_qty ?? 0,
      },
    ]);
    toast(`Added ${exact.name}`);
  };

  // When Rx items arrive, auto-fill rows from drug_master_id (preferred)
  // or fall back to fuzzy name match.
  useEffect(() => {
    if (rx.length === 0) { setRows([]); return; }
    const pre: Row[] = rx.map((r: any) => {
      let match = (r.drug_master_id ? drugs.find((d) => d.id === r.drug_master_id) : null) as any;
      if (!match) {
        const needle = (r.drug_name || '').toLowerCase().split(' ')[0];
        match = drugs.find((d) => d.name.toLowerCase().includes(needle));
      }
      return match
        ? {
            drug_master_id: match.id,
            drug_name: match.name,
            qty: 1,
            rate: match.mrp ?? match.default_mrp ?? 0,
            nextBatch: match.batch || undefined,
            nextExpiry: match.expiry || undefined,
            stock: match.stock_qty ?? 0,
          }
        : { drug_name: r.drug_name, qty: 1, rate: 0 };
    });
    setRows(pre);
  }, [appointment.id, rx.length, drugs.length]);

  const subtotal = useMemo(() => rows.reduce((s, r) => s + r.qty * r.rate, 0), [rows]);
  const total = Math.max(0, subtotal - discount);

  const sell = useMutation({
    mutationFn: () =>
      window.electronAPI.pharmacy.sell({
        appointment_id: appointment.id,
        patient_id: appointment.patient_id,
        items: rows.filter((r) => r.drug_name && r.qty > 0).map((r) => ({
          drug_master_id: r.drug_master_id,
          drug_name: r.drug_name,
          qty: r.qty,
          rate: r.rate,
        })),
        discount,
        payment_mode: paymentMode,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy-pending'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-sales'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-drugs'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-drugs-active'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-alerts'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-batches'] });
      toast(`Dispensed — ${formatINR(total)}`);
      onDone();
    },
    onError: (e: any) => toast(e?.message || 'Dispense failed', 'error'),
  });

  const setRow = (idx: number, patch: Partial<Row>) =>
    setRows((r) => { const n = [...r]; n[idx] = { ...n[idx], ...patch }; return n; });

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-slate-700 mb-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{appointment.patient_name}</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">{appointment.patient_uhid} · {appointment.doctor_name}</div>
        </div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400">Token #{appointment.token_number} · {fmtDate(appointment.appointment_date)}</div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
            <th className="py-2">Drug</th>
            <th className="py-2 w-20 text-right">Qty</th>
            <th className="py-2 w-24 text-right">Rate</th>
            <th className="py-2 w-28 text-right">Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx} className="border-b border-gray-100 dark:border-slate-800 align-top">
              <td className="py-1.5 pr-2">
                <input
                  list="drugs-list"
                  className="input"
                  value={r.drug_name}
                  onChange={(e) => {
                    const match = drugs.find((d) => d.name === e.target.value);
                    setRow(idx, match
                      ? {
                          drug_master_id: match.id,
                          drug_name: match.name,
                          rate: match.mrp ?? match.default_mrp ?? 0,
                          nextBatch: match.batch || undefined,
                          nextExpiry: match.expiry || undefined,
                          stock: match.stock_qty ?? 0,
                        }
                      : { drug_master_id: undefined, drug_name: e.target.value, nextBatch: undefined, nextExpiry: undefined, stock: undefined }
                    );
                  }}
                />
                {r.nextBatch && (
                  <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">
                    FEFO batch <span className="font-mono">{r.nextBatch}</span>
                    {r.nextExpiry && <> · exp {r.nextExpiry}</>}
                    {r.stock != null && <> · {r.stock} in stock</>}
                  </div>
                )}
                {r.drug_master_id != null && (r.stock ?? 0) < r.qty && (
                  <div className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">
                    ⚠ Only {r.stock} in stock
                  </div>
                )}
              </td>
              <td className="py-1.5 px-1">
                <input type="number" className="input text-right" value={r.qty} onChange={(e) => setRow(idx, { qty: Number(e.target.value) })} />
              </td>
              <td className="py-1.5 px-1">
                <input type="number" className="input text-right" value={r.rate} onChange={(e) => setRow(idx, { rate: Number(e.target.value) })} />
              </td>
              <td className="py-1.5 px-1 text-right font-medium">{formatINR(r.qty * r.rate)}</td>
              <td>
                <button className="text-red-500 hover:text-red-700 p-1" onClick={() => setRows(rows.filter((_, i) => i !== idx))}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="drugs-list">
        {drugs.map((d) => <option key={d.id} value={d.name} />)}
      </datalist>

      <div className="flex gap-2 mt-2">
        <button className="btn-ghost text-xs" onClick={() => setRows([...rows, { drug_name: '', qty: 1, rate: 0 }])}>
          <Plus className="w-3.5 h-3.5" /> Add drug
        </button>
        <button className="btn-ghost text-xs" onClick={() => setScanOpen(true)} title="Scan drug barcode (USB scanner or camera)">
          <Scan className="w-3.5 h-3.5" /> Scan
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div className="label">Payment Mode</div>
          <div className="flex gap-2">
            {['Cash','Card','UPI'].map((m) => (
              <button key={m} type="button" onClick={() => setPaymentMode(m)}
                className={cn('px-3 py-1.5 text-xs rounded-md border',
                  paymentMode === m ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200'
                )}>{m}</button>
            ))}
          </div>
        </div>
        <div className="card p-3 bg-gray-50 dark:bg-slate-900">
          <div className="flex justify-between text-xs"><span>Subtotal</span><span>{formatINR(subtotal)}</span></div>
          <div className="flex justify-between text-xs items-center"><span>Discount</span>
            <input type="number" className="input w-24 text-right py-1" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
          </div>
          <div className="flex justify-between text-sm font-bold pt-2 border-t border-gray-300 dark:border-slate-700 mt-1">
            <span>Total</span><span className="text-blue-700 dark:text-blue-300">{formatINR(total)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-success" onClick={() => sell.mutate()} disabled={sell.isPending || rows.length === 0}>
          {sell.isPending ? 'Dispensing…' : 'Dispense (FEFO) & Charge'}
        </button>
      </div>

      <BarcodeScanModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={handleScan}
        hint="Scan a drug barcode to add it to this dispense. Drug must already be in Drug Master with a barcode set."
      />
    </div>
  );
}

/* ===================================================================
   DRUG MASTER (catalog only — stock lives in batches tab)
   =================================================================== */
const SCHEDULES: { value: DrugSchedule; label: string }[] = [
  { value: 'OTC', label: 'OTC (over the counter)' },
  { value: 'H', label: 'H (Rx required)' },
  { value: 'H1', label: 'H1 (Rx + register entry)' },
  { value: 'G', label: 'G (caution: hospital use)' },
  { value: 'X', label: 'X (narcotic — locked storage)' },
];

function DrugMasterTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<DrugMaster> | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const { data: drugs = [] } = useQuery({
    queryKey: ['pharmacy-drugs', q, false],
    queryFn: () => window.electronAPI.pharmacy.listDrugs({ q, activeOnly: false }),
  });
  const save = useMutation({
    mutationFn: (d: Partial<DrugMaster>) => window.electronAPI.pharmacy.upsertDrug(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy-drugs'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-drugs-active'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-alerts'] });
      toast('Saved'); setEditing(null);
    },
  });

  // Scan flow: lookup the barcode in the master.
  // - If exactly one match → open it for editing.
  // - If no match → open Add Drug pre-filled with the scanned barcode.
  const handleScan = async (code: string) => {
    setScanOpen(false);
    const matches = await window.electronAPI.pharmacy.listDrugs({ q: code, activeOnly: false });
    const exact = matches.find((d) => (d.barcode || '').trim() === code.trim());
    if (exact) {
      setEditing(exact);
      toast(`Matched: ${exact.name}`);
    } else {
      setEditing({ is_active: 1, low_stock_threshold: 10, default_mrp: 0, schedule: 'OTC', gst_rate: 12, barcode: code });
      toast(`No match — pre-filling new drug with barcode ${code}`, 'info');
    }
  };

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="input pl-9" placeholder="Search by name / generic / barcode" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn-secondary" onClick={() => setScanOpen(true)} title="Scan barcode (USB scanner or camera)">
          <Scan className="w-4 h-4" /> Scan
        </button>
        <button className="btn-primary" onClick={() => setEditing({ is_active: 1, low_stock_threshold: 10, default_mrp: 0, schedule: 'OTC', gst_rate: 12 })}>
          <Plus className="w-4 h-4" /> Add Drug
        </button>
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400 mb-2">
        💡 Add drug definitions here. Stock + batches come from <b>Purchases</b> (the legal source) or manual entry in <b>Stock & Batches</b>.
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
            <th className="py-2">Name</th>
            <th className="py-2">Form / Strength</th>
            <th className="py-2">Schedule</th>
            <th className="py-2 text-right">MRP</th>
            <th className="py-2 text-right">Stock</th>
            <th className="py-2">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {drugs.map((d) => {
            const stock = (d as any).stock_qty ?? 0;
            const low = stock <= d.low_stock_threshold;
            return (
              <tr key={d.id} className="border-b border-gray-100 dark:border-slate-800">
                <td className="py-2">
                  <div className="font-medium text-gray-900 dark:text-slate-100">{d.name}</div>
                  <div className="text-[11px] text-gray-500 dark:text-slate-400">{d.generic_name || '—'}{d.manufacturer ? ` · ${d.manufacturer}` : ''}</div>
                </td>
                <td className="py-2 text-gray-600 dark:text-slate-300">{d.form || '—'} {d.strength ? `· ${d.strength}` : ''}</td>
                <td className="py-2"><ScheduleBadge schedule={d.schedule} /></td>
                <td className="py-2 text-right">{formatINR(d.default_mrp)}</td>
                <td className={cn('py-2 text-right font-semibold', low ? 'text-amber-700 dark:text-amber-300' : '')}>{stock}</td>
                <td className="py-2">
                  {d.is_active
                    ? (low ? <span className="badge bg-amber-100 text-amber-800">Low</span> : <span className="badge bg-green-100 text-green-700">Active</span>)
                    : <span className="badge bg-gray-200 text-gray-600">Inactive</span>}
                </td>
                <td className="py-2 text-right">
                  <button className="btn-ghost text-xs" onClick={() => setEditing(d)}><Pencil className="w-3.5 h-3.5" /> Edit</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit Drug' : 'Add Drug to Master'} size="lg">
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name *"><input className="input" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Generic Name"><input className="input" value={editing.generic_name || ''} onChange={(e) => setEditing({ ...editing, generic_name: e.target.value })} /></Field>
              <Field label="Manufacturer"><input className="input" placeholder="e.g. GSK / Cipla" value={editing.manufacturer || ''} onChange={(e) => setEditing({ ...editing, manufacturer: e.target.value })} /></Field>
              <Field label="Schedule">
                <select className="input" value={editing.schedule || 'OTC'} onChange={(e) => setEditing({ ...editing, schedule: e.target.value as DrugSchedule })}>
                  {SCHEDULES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Form"><input className="input" placeholder="Tab / Syrup / Inj" value={editing.form || ''} onChange={(e) => setEditing({ ...editing, form: e.target.value })} /></Field>
              <Field label="Strength"><input className="input" placeholder="500mg / 10mg" value={editing.strength || ''} onChange={(e) => setEditing({ ...editing, strength: e.target.value })} /></Field>
              <Field label="Pack Size"><input type="number" className="input" placeholder="10 (tabs/strip)" value={editing.pack_size ?? ''} onChange={(e) => setEditing({ ...editing, pack_size: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
              <Field label="Default MRP (₹)"><input type="number" className="input" value={editing.default_mrp ?? 0} onChange={(e) => setEditing({ ...editing, default_mrp: Number(e.target.value) })} /></Field>
              <Field label="HSN Code"><input className="input" placeholder="30049099" value={editing.hsn_code || ''} onChange={(e) => setEditing({ ...editing, hsn_code: e.target.value })} /></Field>
              <Field label="GST Rate (%)">
                <select className="input" value={editing.gst_rate ?? 12} onChange={(e) => setEditing({ ...editing, gst_rate: Number(e.target.value) })}>
                  {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
                </select>
              </Field>
              <Field label="Barcode (EAN/UPC)"><input className="input" placeholder="optional" value={editing.barcode || ''} onChange={(e) => setEditing({ ...editing, barcode: e.target.value })} /></Field>
              <Field label="Low-stock Threshold"><input type="number" className="input" value={editing.low_stock_threshold ?? 10} onChange={(e) => setEditing({ ...editing, low_stock_threshold: Number(e.target.value) })} /></Field>
            </div>
            <Field label="Notes">
              <textarea className="input" rows={2} value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm pt-1">
              <input type="checkbox" checked={editing.is_active === 1} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked ? 1 : 0 })} />
              <span>Active (shows up in dispense + alerts)</span>
            </label>
            <div className="flex justify-end gap-2 pt-3">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => save.mutate(editing)} disabled={save.isPending || !editing.name}>
                {save.isPending ? 'Saving…' : 'Save Drug'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <BarcodeScanModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={handleScan}
        hint="Scan the outer carton barcode. If it matches an existing drug we open it; otherwise we pre-fill a new drug with this barcode."
      />
    </section>
  );
}

/* ===================================================================
   STOCK & BATCHES — per-drug accordion of batches sorted by expiry
   =================================================================== */
function StockBatchesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [editing, setEditing] = useState<(Partial<DrugStockBatch> & { drug_master_id: number; drug_name?: string }) | null>(null);

  const { data: drugs = [] } = useQuery({
    queryKey: ['pharmacy-drugs', q, true],
    queryFn: () => window.electronAPI.pharmacy.listDrugs({ q, activeOnly: true }),
  });

  const save = useMutation({
    mutationFn: (b: Partial<DrugStockBatch>) => window.electronAPI.pharmacy.upsertBatch(b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy-drugs'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-drugs-active'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-alerts'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-batches'] });
      toast('Batch saved');
      setEditing(null);
    },
  });

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="input pl-9" placeholder="Search drug" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400">
          Click a drug to expand its batches. Stock dispenses FEFO — earliest expiry first.
        </div>
      </div>

      <ul className="divide-y divide-gray-100 dark:divide-slate-800">
        {drugs.map((d) => {
          const isOpen = openId === d.id;
          const stock = (d as any).stock_qty ?? 0;
          const low = stock <= d.low_stock_threshold;
          return (
            <li key={d.id}>
              <button
                className="w-full flex items-center gap-3 py-2.5 px-2 hover:bg-gray-50 dark:hover:bg-slate-800/40 text-left"
                onClick={() => setOpenId(isOpen ? null : d.id)}
              >
                {isOpen ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{d.name}</div>
                  <div className="text-[11px] text-gray-500 dark:text-slate-400">
                    {d.form || ''} {d.strength ? `· ${d.strength}` : ''} {d.manufacturer ? `· ${d.manufacturer}` : ''}
                  </div>
                </div>
                <ScheduleBadge schedule={d.schedule} />
                <div className={cn('text-sm font-bold w-16 text-right', low ? 'text-amber-700 dark:text-amber-300' : '')}>
                  {stock}
                </div>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing({ drug_master_id: d.id, drug_name: d.name, batch_no: '', expiry: '', qty_received: 0, qty_remaining: 0, mrp: d.default_mrp, is_active: 1 });
                  }}
                >
                  <Plus className="w-3.5 h-3.5" /> Batch
                </button>
              </button>
              {isOpen && <BatchList drugMasterId={d.id} drugName={d.name} drugDefaultMrp={d.default_mrp} onEdit={(b) => setEditing({ ...b, drug_master_id: d.id, drug_name: d.name })} />}
            </li>
          );
        })}
      </ul>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit Batch · ${editing.drug_name}` : `New Batch · ${editing?.drug_name}`} size="md">
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Batch No *"><input className="input font-mono" value={editing.batch_no || ''} onChange={(e) => setEditing({ ...editing, batch_no: e.target.value })} /></Field>
              <Field label="Expiry *"><input type="date" className="input" value={editing.expiry || ''} onChange={(e) => setEditing({ ...editing, expiry: e.target.value })} /></Field>
              <Field label="Qty Received *"><input type="number" className="input" value={editing.qty_received ?? 0} onChange={(e) => setEditing({ ...editing, qty_received: Number(e.target.value) })} /></Field>
              <Field label="Qty Remaining"><input type="number" className="input" value={editing.qty_remaining ?? editing.qty_received ?? 0} onChange={(e) => setEditing({ ...editing, qty_remaining: Number(e.target.value) })} /></Field>
              <Field label="Purchase Price (₹)"><input type="number" className="input" value={editing.purchase_price ?? ''} onChange={(e) => setEditing({ ...editing, purchase_price: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
              <Field label="MRP (₹)"><input type="number" className="input" value={editing.mrp ?? 0} onChange={(e) => setEditing({ ...editing, mrp: Number(e.target.value) })} /></Field>
              <div className="col-span-2">
                <Field label="Manufacturer Lic. No."><input className="input" placeholder="optional — printed on strip" value={editing.manufacturer_license_no || ''} onChange={(e) => setEditing({ ...editing, manufacturer_license_no: e.target.value })} /></Field>
              </div>
            </div>
            <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
              💡 For wholesaler-bought stock, prefer creating a <b>Purchase Invoice</b> in the Purchases tab — that auto-creates batches AND records the bill for compliance. Manual batch entry is for samples / corrections only.
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => save.mutate(editing as DrugStockBatch)} disabled={save.isPending || !editing.batch_no || !editing.expiry}>
                {save.isPending ? 'Saving…' : 'Save Batch'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

function BatchList({ drugMasterId, drugName: _drugName, drugDefaultMrp: _drugDefaultMrp, onEdit }: { drugMasterId: number; drugName: string; drugDefaultMrp: number; onEdit: (b: DrugStockBatch) => void }) {
  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['pharmacy-batches', drugMasterId],
    queryFn: () => window.electronAPI.pharmacy.listBatches(drugMasterId),
  });
  if (isLoading) return <div className="text-xs text-gray-500 px-8 py-2">Loading batches…</div>;
  if (batches.length === 0) return <div className="text-xs text-gray-500 px-8 py-2 italic">No batches recorded yet — receive a purchase invoice or add one manually.</div>;
  return (
    <div className="px-8 pb-3 pt-1">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-100 dark:border-slate-800 text-left">
            <th className="py-1.5">Batch</th>
            <th className="py-1.5">Expiry</th>
            <th className="py-1.5 text-right">Received</th>
            <th className="py-1.5 text-right">Remaining</th>
            <th className="py-1.5 text-right">MRP</th>
            <th className="py-1.5">Mfg. Lic.</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => {
            const expDate = new Date(b.expiry);
            const days = Math.round((expDate.getTime() - Date.now()) / 86400000);
            const expired = days < 0;
            const expiringSoon = days >= 0 && days <= 90;
            return (
              <tr key={b.id} className="border-b border-gray-100 dark:border-slate-800">
                <td className="py-1.5 font-mono">{b.batch_no}</td>
                <td className={cn('py-1.5', expired ? 'text-red-600 font-bold' : expiringSoon ? 'text-amber-700' : '')}>
                  {b.expiry} {expired ? '(EXPIRED)' : expiringSoon ? `(in ${days}d)` : ''}
                </td>
                <td className="py-1.5 text-right">{b.qty_received}</td>
                <td className="py-1.5 text-right font-semibold">{b.qty_remaining}</td>
                <td className="py-1.5 text-right">{formatINR(b.mrp)}</td>
                <td className="py-1.5 text-[10px] font-mono text-gray-500">{b.manufacturer_license_no || '—'}</td>
                <td className="py-1.5 text-right">
                  <button className="text-xs text-blue-600 hover:underline" onClick={() => onEdit(b)}>Edit</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ===================================================================
   PURCHASES — wholesaler invoices + line items → auto-create batches
   =================================================================== */
function PurchasesTab() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayISO());
  const [creating, setCreating] = useState(false);
  const [whModalOpen, setWhModalOpen] = useState(false);

  const { data: invoices = [] } = useQuery({
    queryKey: ['purchases', from, to],
    queryFn: () => window.electronAPI.purchases.list({ from, to }),
  });

  const totalSpend = invoices.reduce((s, x) => s + Number(x.total || 0), 0);

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-xs text-gray-500">to</span>
          <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm">
            <span className="text-gray-500 dark:text-slate-400">Spend:</span>{' '}
            <span className="font-bold text-blue-700 dark:text-blue-300">{formatINR(totalSpend)}</span>
          </div>
          <button className="btn-secondary text-xs" onClick={() => setWhModalOpen(true)}>
            <Truck className="w-3.5 h-3.5" /> Wholesalers
          </button>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4" /> New Purchase Bill
          </button>
        </div>
      </div>

      {invoices.length === 0 ? (
        <EmptyState icon={Truck} title="No purchase invoices in range" description="Click 'New Purchase Bill' to record a wholesaler invoice. Line items auto-create stock batches." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
              <th className="py-2">Invoice #</th>
              <th className="py-2">Wholesaler (License)</th>
              <th className="py-2">Inv. Date</th>
              <th className="py-2 text-right">Total</th>
              <th className="py-2">Payment</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b border-gray-100 dark:border-slate-800">
                <td className="py-2 font-mono text-xs">{inv.invoice_number}</td>
                <td className="py-2">
                  {inv.wholesaler_name}
                  <div className="text-[10px] text-gray-500 dark:text-slate-400 font-mono">{inv.wholesaler_license_no}</div>
                </td>
                <td className="py-2 text-xs text-gray-500 dark:text-slate-400">{fmtDate(inv.invoice_date)}</td>
                <td className="py-2 text-right font-semibold">{formatINR(inv.total)}</td>
                <td className="py-2">
                  <span className={cn('badge',
                    inv.payment_status === 'paid' ? 'bg-green-100 text-green-700' :
                    inv.payment_status === 'partial' ? 'bg-amber-100 text-amber-700' :
                    'bg-red-100 text-red-700'
                  )}>{inv.payment_status}</span>
                  {inv.payment_mode && <span className="text-[11px] text-gray-500 dark:text-slate-400 ml-1">· {inv.payment_mode}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating && <NewPurchaseModal onClose={() => setCreating(false)} />}
      {whModalOpen && <WholesalersModal onClose={() => setWhModalOpen(false)} />}
    </section>
  );
}

function NewPurchaseModal({ onClose }: { onClose: () => void }) {
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

  const [header, setHeader] = useState<Partial<PurchaseInvoiceInput>>({
    invoice_number: '',
    invoice_date: todayISO(),
    received_date: todayISO(),
    payment_status: 'unpaid',
    payment_mode: 'Cash',
  });
  type Line = {
    drug_master_id: number | null;
    drug_name?: string;
    batch_no: string;
    expiry: string;
    qty_received: number;
    pack_qty?: number | null;
    free_qty: number;
    purchase_price: number;
    mrp: number;
    gst_rate: number;
    manufacturer_license_no?: string | null;
    line_total: number;
  };
  const [lines, setLines] = useState<Line[]>([{
    drug_master_id: null, batch_no: '', expiry: '', qty_received: 0, pack_qty: null,
    free_qty: 0, purchase_price: 0, mrp: 0, gst_rate: 12, line_total: 0,
  }]);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((arr) => {
      const n = [...arr];
      const merged = { ...n[i], ...patch };
      merged.line_total = Number(merged.qty_received) * Number(merged.purchase_price);
      n[i] = merged;
      return n;
    });

  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  const gstAmount = lines.reduce((s, l) => s + l.line_total * (l.gst_rate / 100), 0);
  const cgst = gstAmount / 2;
  const sgst = gstAmount / 2;
  const total = subtotal + gstAmount - Number(header.discount ?? 0);

  const create = useMutation({
    mutationFn: () => {
      const payload: PurchaseInvoiceInput = {
        invoice_number: header.invoice_number || '',
        wholesaler_id: Number(header.wholesaler_id),
        invoice_date: header.invoice_date || todayISO(),
        received_date: header.received_date,
        subtotal, cgst, sgst, igst: 0,
        discount: Number(header.discount ?? 0),
        total,
        payment_mode: header.payment_mode,
        payment_status: header.payment_status as any,
        notes: header.notes,
        items: lines.filter((l) => l.drug_master_id != null && l.batch_no && l.expiry && l.qty_received > 0).map((l) => ({
          drug_master_id: l.drug_master_id!,
          batch_no: l.batch_no,
          expiry: l.expiry,
          qty_received: l.qty_received,
          pack_qty: l.pack_qty ?? null,
          free_qty: l.free_qty,
          purchase_price: l.purchase_price,
          mrp: l.mrp,
          gst_rate: l.gst_rate,
          manufacturer_license_no: l.manufacturer_license_no ?? null,
          line_total: l.line_total,
        })),
      };
      return window.electronAPI.purchases.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-drugs'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-drugs-active'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-alerts'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-batches'] });
      toast(`Purchase invoice saved · ${lines.length} batches added to stock`);
      onClose();
    },
    onError: (e: any) => toast(e?.message || 'Save failed', 'error'),
  });

  const canSubmit = header.invoice_number && header.wholesaler_id && header.invoice_date &&
    lines.some((l) => l.drug_master_id != null && l.batch_no && l.expiry && l.qty_received > 0);

  return (
    <Modal open onClose={onClose} title="New Purchase Bill" size="xl">
      <div className="space-y-4">
        {/* Header */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Invoice Number *">
            <input className="input" placeholder="e.g. CIPLA-2026-001234" value={header.invoice_number} onChange={(e) => setHeader({ ...header, invoice_number: e.target.value })} />
          </Field>
          <Field label="Wholesaler *">
            <select className="input" value={header.wholesaler_id ?? ''} onChange={(e) => setHeader({ ...header, wholesaler_id: Number(e.target.value) })}>
              <option value="">— Select —</option>
              {wholesalers.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.drug_license_no})</option>)}
            </select>
          </Field>
          <Field label="Invoice Date *"><input type="date" className="input" value={header.invoice_date || ''} onChange={(e) => setHeader({ ...header, invoice_date: e.target.value })} /></Field>
          <Field label="Received Date"><input type="date" className="input" value={header.received_date || ''} onChange={(e) => setHeader({ ...header, received_date: e.target.value })} /></Field>
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="label mb-0">Line Items (each becomes a stock batch)</div>
            <button className="btn-ghost text-xs" onClick={() => setLines([...lines, { drug_master_id: null, batch_no: '', expiry: '', qty_received: 0, pack_qty: null, free_qty: 0, purchase_price: 0, mrp: 0, gst_rate: 12, line_total: 0 }])}>
              <Plus className="w-3.5 h-3.5" /> Add line
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="py-2 min-w-[180px]">Drug</th>
                  <th className="py-2 min-w-[100px]">Batch</th>
                  <th className="py-2 min-w-[120px]">Expiry</th>
                  <th className="py-2 w-16 text-right">Qty</th>
                  <th className="py-2 w-16 text-right">Free</th>
                  <th className="py-2 w-24 text-right">Buy ₹</th>
                  <th className="py-2 w-24 text-right">MRP ₹</th>
                  <th className="py-2 w-16 text-right">GST%</th>
                  <th className="py-2 min-w-[120px]">Mfg. Lic.</th>
                  <th className="py-2 w-24 text-right">Line ₹</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx} className="border-b border-gray-100 dark:border-slate-800">
                    <td className="py-1 pr-1">
                      <select className="input" value={l.drug_master_id ?? ''} onChange={(e) => {
                        const dm = drugs.find((d) => d.id === Number(e.target.value));
                        setLine(idx, {
                          drug_master_id: dm ? dm.id : null,
                          drug_name: dm?.name,
                          mrp: l.mrp || (dm?.default_mrp ?? 0),
                          gst_rate: l.gst_rate || (dm?.gst_rate ?? 12),
                        });
                      }}>
                        <option value="">— Pick drug —</option>
                        {drugs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </td>
                    <td className="py-1 px-1"><input className="input font-mono" value={l.batch_no} onChange={(e) => setLine(idx, { batch_no: e.target.value })} /></td>
                    <td className="py-1 px-1"><input type="date" className="input" value={l.expiry} onChange={(e) => setLine(idx, { expiry: e.target.value })} /></td>
                    <td className="py-1 px-1"><input type="number" className="input text-right" value={l.qty_received} onChange={(e) => setLine(idx, { qty_received: Number(e.target.value) })} /></td>
                    <td className="py-1 px-1"><input type="number" className="input text-right" value={l.free_qty} onChange={(e) => setLine(idx, { free_qty: Number(e.target.value) })} /></td>
                    <td className="py-1 px-1"><input type="number" className="input text-right" value={l.purchase_price} onChange={(e) => setLine(idx, { purchase_price: Number(e.target.value) })} /></td>
                    <td className="py-1 px-1"><input type="number" className="input text-right" value={l.mrp} onChange={(e) => setLine(idx, { mrp: Number(e.target.value) })} /></td>
                    <td className="py-1 px-1">
                      <select className="input" value={l.gst_rate} onChange={(e) => setLine(idx, { gst_rate: Number(e.target.value) })}>
                        {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="py-1 px-1"><input className="input font-mono text-[10px]" value={l.manufacturer_license_no || ''} onChange={(e) => setLine(idx, { manufacturer_license_no: e.target.value })} /></td>
                    <td className="py-1 px-1 text-right font-semibold">{formatINR(l.line_total)}</td>
                    <td>
                      <button className="text-red-500 p-1" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                        <X className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals + payment */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="card p-3 bg-gray-50 dark:bg-slate-900 col-span-2">
            <div className="flex justify-between text-xs"><span>Subtotal</span><span>{formatINR(subtotal)}</span></div>
            <div className="flex justify-between text-xs"><span>CGST</span><span>{formatINR(cgst)}</span></div>
            <div className="flex justify-between text-xs"><span>SGST</span><span>{formatINR(sgst)}</span></div>
            <div className="flex justify-between text-xs items-center">
              <span>Discount</span>
              <input type="number" className="input w-24 text-right py-1" value={header.discount ?? 0} onChange={(e) => setHeader({ ...header, discount: Number(e.target.value) })} />
            </div>
            <div className="flex justify-between text-sm font-bold pt-2 border-t border-gray-300 dark:border-slate-700 mt-1">
              <span>Total</span>
              <span className="text-blue-700 dark:text-blue-300">{formatINR(total)}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Field label="Payment Status">
              <select className="input" value={header.payment_status} onChange={(e) => setHeader({ ...header, payment_status: e.target.value as any })}>
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
              </select>
            </Field>
            <Field label="Payment Mode">
              <select className="input" value={header.payment_mode || ''} onChange={(e) => setHeader({ ...header, payment_mode: e.target.value })}>
                <option value="">—</option>
                <option>Cash</option><option>Cheque</option><option>Bank</option><option>UPI</option><option>Credit</option>
              </select>
            </Field>
          </div>
        </div>

        <Field label="Notes">
          <textarea className="input" rows={2} value={header.notes || ''} onChange={(e) => setHeader({ ...header, notes: e.target.value })} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Saving…' : 'Save Invoice & Add to Stock'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function WholesalersModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: wholesalers = [] } = useQuery({
    queryKey: ['wholesalers-all'],
    queryFn: () => window.electronAPI.wholesalers.list({ activeOnly: false }),
  });
  const [editing, setEditing] = useState<Partial<Wholesaler> | null>(null);

  const save = useMutation({
    mutationFn: (w: Partial<Wholesaler>) => window.electronAPI.wholesalers.upsert(w),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wholesalers'] });
      qc.invalidateQueries({ queryKey: ['wholesalers-all'] });
      toast('Wholesaler saved');
      setEditing(null);
    },
  });
  const del = useMutation({
    mutationFn: (id: number) => window.electronAPI.wholesalers.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wholesalers'] });
      qc.invalidateQueries({ queryKey: ['wholesalers-all'] });
      toast('Marked inactive');
    },
  });

  return (
    <Modal open onClose={onClose} title="Wholesalers / Suppliers" size="lg">
      <div className="space-y-3">
        <div className="flex justify-end">
          <button className="btn-primary text-xs" onClick={() => setEditing({ name: '', drug_license_no: '', is_active: 1 })}>
            <Plus className="w-3.5 h-3.5" /> Add Wholesaler
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
              <th className="py-2">Name</th>
              <th className="py-2">Drug License No</th>
              <th className="py-2">GSTIN</th>
              <th className="py-2">Phone</th>
              <th className="py-2">Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {wholesalers.map((w) => (
              <tr key={w.id} className="border-b border-gray-100 dark:border-slate-800">
                <td className="py-2">{w.name}</td>
                <td className="py-2 font-mono text-xs">{w.drug_license_no}</td>
                <td className="py-2 text-xs">{w.gstin || '—'}</td>
                <td className="py-2 text-xs">{w.phone || '—'}</td>
                <td className="py-2">{w.is_active ? <span className="badge bg-green-100 text-green-700">Active</span> : <span className="badge bg-gray-200 text-gray-600">Inactive</span>}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  <button className="btn-ghost text-xs" onClick={() => setEditing(w)}><Pencil className="w-3.5 h-3.5" /> Edit</button>
                  {w.is_active === 1 && <button className="text-xs text-red-600 hover:underline ml-2" onClick={() => del.mutate(w.id)}>Deactivate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {editing && (
          <Modal open onClose={() => setEditing(null)} title={editing.id ? 'Edit Wholesaler' : 'Add Wholesaler'} size="md">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name *"><input className="input" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
                <Field label="Drug License No * (REQUIRED)"><input className="input font-mono" placeholder="e.g. KA-GDG-20B/2024-001" value={editing.drug_license_no || ''} onChange={(e) => setEditing({ ...editing, drug_license_no: e.target.value })} /></Field>
                <Field label="GSTIN"><input className="input font-mono" value={editing.gstin || ''} onChange={(e) => setEditing({ ...editing, gstin: e.target.value })} /></Field>
                <Field label="Contact Person"><input className="input" value={editing.contact_person || ''} onChange={(e) => setEditing({ ...editing, contact_person: e.target.value })} /></Field>
                <Field label="Phone"><input className="input" value={editing.phone || ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
                <Field label="Email"><input className="input" value={editing.email || ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
                <div className="col-span-2"><Field label="Address"><textarea className="input" rows={2} value={editing.address || ''} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></Field></div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn-primary" onClick={() => save.mutate(editing)} disabled={save.isPending || !editing.name || !editing.drug_license_no}>
                  {save.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </Modal>
  );
}

/* ===================================================================
   SALES HISTORY (unchanged structurally)
   =================================================================== */
function SalesTab() {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const { data: sales = [] } = useQuery({
    queryKey: ['pharmacy-sales', from, to],
    queryFn: () => window.electronAPI.pharmacy.listSales({ from, to }),
  });
  const totalRevenue = sales.reduce((s, x) => s + Number(x.total || 0), 0);
  return (
    <section className="card p-4">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-xs text-gray-500">to</span>
        <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="ml-auto text-sm">
          <span className="text-gray-500 dark:text-slate-400">Revenue:</span> <span className="font-bold text-emerald-700 dark:text-emerald-300">{formatINR(totalRevenue)}</span>
        </div>
      </div>
      {sales.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="No sales in range" />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
              <th className="py-2">Sale No</th>
              <th className="py-2">Patient</th>
              <th className="py-2">Date</th>
              <th className="py-2 text-right">Total</th>
              <th className="py-2">Mode</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id} className="border-b border-gray-100 dark:border-slate-800">
                <td className="py-2 font-mono text-xs">{s.sale_number}</td>
                <td className="py-2">{s.patient_name || '—'}<div className="text-[11px] text-gray-500">{s.patient_uhid || ''}</div></td>
                <td className="py-2 text-xs text-gray-500 dark:text-slate-400">{fmtDateTime(s.created_at)}</td>
                <td className="py-2 text-right font-semibold">{formatINR(s.total)}</td>
                <td className="py-2"><span className="badge bg-gray-100 text-gray-700">{s.payment_mode || '—'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ===================================================================
   REPORTS MENU — Schedule H register + stock register + purchase register
   =================================================================== */
function ReportsModal({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<'menu' | 'dispensing' | 'stock' | 'purchase'>('menu');
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayISO());
  const [schedule, setSchedule] = useState<DrugSchedule | 'ALL'>('H');
  const [includeExpired, setIncludeExpired] = useState(true);

  if (view === 'dispensing') {
    return (
      <DispensingRegisterPrint
        from={from}
        to={to}
        schedule={schedule === 'ALL' ? undefined : schedule}
        onClose={() => setView('menu')}
      />
    );
  }
  if (view === 'stock') {
    return <StockRegisterPrint includeExpired={includeExpired} onClose={() => setView('menu')} />;
  }
  if (view === 'purchase') {
    return <PurchaseRegisterPrint from={from} to={to} onClose={() => setView('menu')} />;
  }

  return (
    <Modal open onClose={onClose} title="Pharmacy Reports" size="lg">
      <div className="space-y-4">
        <div className="text-xs text-gray-600 dark:text-slate-300">
          Each register opens an A4 print preview — use your browser's <b>Print</b> dialog to print on paper or
          <b> "Save as PDF"</b>. Same data is also included in the Excel backup export.
        </div>

        {/* === Schedule H Dispensing Register === */}
        <div className="card p-3 space-y-2">
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">📋 Schedule H/H1 Dispensing Register</div>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            Per-batch register — every dispense slice with date, patient, drug, batch, expiry, qty, doctor.
            Required by Karnataka inspectors for Schedule H drugs.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Field label="From"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <Field label="Schedule">
              <select className="input" value={schedule} onChange={(e) => setSchedule(e.target.value as any)}>
                <option value="H">H only</option>
                <option value="H1">H1 only</option>
                <option value="ALL">All schedules</option>
              </select>
            </Field>
          </div>
          <div className="flex justify-end">
            <button className="btn-primary text-xs" onClick={() => setView('dispensing')}>
              <FileText className="w-3.5 h-3.5" /> Open Dispensing Register
            </button>
          </div>
        </div>

        {/* === Stock Register === */}
        <div className="card p-3 space-y-2">
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">📦 Stock Register</div>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            Every batch currently in stock, sorted by drug then expiry. Highlights expired (red) and
            expiring within 90 days (amber). Includes manufacturer license number per batch.
          </p>
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-200">
            <input type="checkbox" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} />
            <span>Include expired batches still in stock (recommended for inspector visit)</span>
          </label>
          <div className="flex justify-end">
            <button className="btn-primary text-xs" onClick={() => setView('stock')}>
              <FileText className="w-3.5 h-3.5" /> Open Stock Register
            </button>
          </div>
        </div>

        {/* === Purchase Register === */}
        <div className="card p-3 space-y-2">
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">🚚 Purchase Register</div>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            All purchase invoices in a date range with wholesaler drug license numbers, GST breakdown,
            and payment status. The inspector's traceability source for any batch.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <div className="flex justify-end">
            <button className="btn-primary text-xs" onClick={() => setView('purchase')}>
              <FileText className="w-3.5 h-3.5" /> Open Purchase Register
            </button>
          </div>
        </div>

        <div className="text-[11px] text-gray-500 dark:text-slate-400 italic px-1">
          💡 For a full data dump (all sheets, every table), use <b>Settings → Backup → Backup Now</b> — the
          generated <code>.xlsx</code> includes Drug Master, Batches, Wholesalers, Invoices, Sales, and Dispensing Register sheets.
        </div>

        <div className="flex justify-end">
          <button className="btn-secondary text-xs" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

/* ===================================================================
   SHARED HELPERS
   =================================================================== */
function ScheduleBadge({ schedule }: { schedule: DrugSchedule }) {
  const tones: Record<DrugSchedule, string> = {
    H: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
    H1: 'bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-100',
    G: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    X: 'bg-purple-200 text-purple-900 dark:bg-purple-900/60 dark:text-purple-100',
    OTC: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  };
  return <span className={cn('badge', tones[schedule])}>{schedule}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
