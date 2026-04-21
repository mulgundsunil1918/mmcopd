import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pill, Plus, Search, AlertTriangle, Package, Clipboard, ShoppingCart, Trash2, Pencil, Printer } from 'lucide-react';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../hooks/useToast';
import { cn, fmtDate, fmtDateTime, formatINR, todayISO } from '../lib/utils';
import type { Drug, PharmacySale } from '../types';

type Tab = 'dispense' | 'inventory' | 'sales';

export function Pharmacy() {
  const [tab, setTab] = useState<Tab>('dispense');

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
          <p className="text-xs text-gray-500 dark:text-slate-400">Dispense prescriptions, manage drug inventory, track sales.</p>
        </div>
        <div className="flex gap-2 bg-gray-100 dark:bg-slate-700 p-1 rounded-lg">
          <TabBtn active={tab === 'dispense'} onClick={() => setTab('dispense')} icon={<Clipboard className="w-3.5 h-3.5" />}>Dispense Queue</TabBtn>
          <TabBtn active={tab === 'inventory'} onClick={() => setTab('inventory')} icon={<Package className="w-3.5 h-3.5" />}>Inventory</TabBtn>
          <TabBtn active={tab === 'sales'} onClick={() => setTab('sales')} icon={<ShoppingCart className="w-3.5 h-3.5" />}>Sales History</TabBtn>
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
                {alerts.lowStock.slice(0, 10).map((d: Drug) => (
                  <li key={d.id}>{d.name} — {d.stock_qty} left (threshold {d.low_stock_threshold})</li>
                ))}
              </ul>
            </div>
          )}
          {alerts.expiringSoon.length > 0 && (
            <div className="rounded-lg border-2 border-red-400 bg-red-50 dark:bg-red-900/30 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-900 dark:text-red-200">
                <AlertTriangle className="w-4 h-4" /> Expiring within 30 days ({alerts.expiringSoon.length})
              </div>
              <ul className="text-[11px] text-red-800 dark:text-red-200 mt-2 space-y-0.5 max-h-24 overflow-auto">
                {alerts.expiringSoon.slice(0, 10).map((d: Drug) => (
                  <li key={d.id}>{d.name} — expires {d.expiry}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'dispense' ? <DispenseQueue /> : tab === 'inventory' ? <InventoryTab /> : <SalesTab />}
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

/* ---------- Dispense Queue ---------- */
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
    queryKey: ['pharmacy-drugs', '', true],
    queryFn: () => window.electronAPI.pharmacy.listDrugs({ activeOnly: true }),
  });

  type Row = { drug_id?: number; drug_name: string; qty: number; rate: number };
  const [rows, setRows] = useState<Row[]>([]);
  const [discount, setDiscount] = useState(0);
  const [paymentMode, setPaymentMode] = useState('Cash');

  // When Rx items arrive, auto-fill rows by fuzzy-matching the drug name against inventory
  useEffect(() => {
    if (rx.length === 0) { setRows([]); return; }
    const pre: Row[] = rx.map((r: any) => {
      const match = drugs.find((d) => d.name.toLowerCase().includes((r.drug_name || '').toLowerCase().split(' ')[0]));
      return match
        ? { drug_id: match.id, drug_name: match.name, qty: 1, rate: match.mrp }
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
        items: rows.filter((r) => r.drug_name && r.qty > 0),
        discount,
        payment_mode: paymentMode,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy-pending'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-sales'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-drugs'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-alerts'] });
      toast(`Dispensed — ${formatINR(total)}`);
      onDone();
    },
  });

  const setRow = (idx: number, patch: Partial<Row>) => setRows((r) => { const n = [...r]; n[idx] = { ...n[idx], ...patch }; return n; });

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
            <th className="py-2 w-28 text-right">Rate</th>
            <th className="py-2 w-28 text-right">Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx} className="border-b border-gray-100 dark:border-slate-800">
              <td className="py-1.5 pr-2">
                <input
                  list="drugs-list"
                  className="input"
                  value={r.drug_name}
                  onChange={(e) => {
                    const match = drugs.find((d) => d.name === e.target.value);
                    setRow(idx, match ? { drug_id: match.id, drug_name: match.name, rate: match.mrp } : { drug_id: undefined, drug_name: e.target.value });
                  }}
                />
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

      <button className="btn-ghost text-xs mt-2" onClick={() => setRows([...rows, { drug_name: '', qty: 1, rate: 0 }])}>
        <Plus className="w-3.5 h-3.5" /> Add drug
      </button>

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
          {sell.isPending ? 'Dispensing…' : 'Dispense & Charge'}
        </button>
      </div>
    </div>
  );
}

/* ---------- Inventory ---------- */
function InventoryTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<Drug> | null>(null);

  const { data: drugs = [] } = useQuery({
    queryKey: ['pharmacy-drugs', q, false],
    queryFn: () => window.electronAPI.pharmacy.listDrugs({ q, activeOnly: false }),
  });
  const save = useMutation({
    mutationFn: (d: Partial<Drug>) => window.electronAPI.pharmacy.upsertDrug(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-drugs'] }); qc.invalidateQueries({ queryKey: ['pharmacy-alerts'] }); toast('Saved'); setEditing(null); },
  });

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="input pl-9" placeholder="Search drug / generic" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={() => setEditing({ is_active: 1, stock_qty: 0, low_stock_threshold: 10, mrp: 0 })}>
          <Plus className="w-4 h-4" /> Add Drug
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
            <th className="py-2">Name</th>
            <th className="py-2">Form / Strength</th>
            <th className="py-2 text-right">MRP</th>
            <th className="py-2 text-right">Stock</th>
            <th className="py-2">Batch / Expiry</th>
            <th className="py-2">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {drugs.map((d) => {
            const low = d.stock_qty <= d.low_stock_threshold;
            return (
              <tr key={d.id} className="border-b border-gray-100 dark:border-slate-800">
                <td className="py-2">
                  <div className="font-medium text-gray-900 dark:text-slate-100">{d.name}</div>
                  <div className="text-[11px] text-gray-500 dark:text-slate-400">{d.generic_name || '—'}</div>
                </td>
                <td className="py-2 text-gray-600 dark:text-slate-300">{d.form || '—'} {d.strength ? `· ${d.strength}` : ''}</td>
                <td className="py-2 text-right">{formatINR(d.mrp)}</td>
                <td className={cn('py-2 text-right font-semibold', low ? 'text-amber-700 dark:text-amber-300' : '')}>{d.stock_qty}</td>
                <td className="py-2 text-xs text-gray-600 dark:text-slate-300">
                  {d.batch || '—'}{d.expiry ? ` · exp ${d.expiry}` : ''}
                </td>
                <td className="py-2">
                  {d.is_active ? (low ? <span className="badge bg-amber-100 text-amber-800">Low</span> : <span className="badge bg-green-100 text-green-700">Active</span>) : <span className="badge bg-gray-200 text-gray-600">Inactive</span>}
                </td>
                <td className="py-2 text-right">
                  <button className="btn-ghost text-xs" onClick={() => setEditing(d)}><Pencil className="w-3.5 h-3.5" /> Edit</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit Drug' : 'Add Drug'} size="lg">
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Row label="Name *"><input className="input" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Row>
              <Row label="Generic Name"><input className="input" value={editing.generic_name || ''} onChange={(e) => setEditing({ ...editing, generic_name: e.target.value })} /></Row>
              <Row label="Form"><input className="input" placeholder="Tab / Syrup / Inj" value={editing.form || ''} onChange={(e) => setEditing({ ...editing, form: e.target.value })} /></Row>
              <Row label="Strength"><input className="input" placeholder="500mg / 10mg" value={editing.strength || ''} onChange={(e) => setEditing({ ...editing, strength: e.target.value })} /></Row>
              <Row label="MRP (₹)"><input type="number" className="input" value={editing.mrp ?? 0} onChange={(e) => setEditing({ ...editing, mrp: Number(e.target.value) })} /></Row>
              <Row label="Purchase Price"><input type="number" className="input" value={editing.purchase_price ?? 0} onChange={(e) => setEditing({ ...editing, purchase_price: Number(e.target.value) })} /></Row>
              <Row label="Batch"><input className="input" value={editing.batch || ''} onChange={(e) => setEditing({ ...editing, batch: e.target.value })} /></Row>
              <Row label="Expiry"><input type="date" className="input" value={editing.expiry || ''} onChange={(e) => setEditing({ ...editing, expiry: e.target.value })} /></Row>
              <Row label="Stock Qty"><input type="number" className="input" value={editing.stock_qty ?? 0} onChange={(e) => setEditing({ ...editing, stock_qty: Number(e.target.value) })} /></Row>
              <Row label="Low-stock Threshold"><input type="number" className="input" value={editing.low_stock_threshold ?? 10} onChange={(e) => setEditing({ ...editing, low_stock_threshold: Number(e.target.value) })} /></Row>
            </div>
            <label className="flex items-center gap-2 text-sm pt-1">
              <input type="checkbox" checked={editing.is_active === 1} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked ? 1 : 0 })} />
              <span>Active</span>
            </label>
            <div className="flex justify-end gap-2 pt-3">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => save.mutate(editing)} disabled={save.isPending || !editing.name}>
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

/* ---------- Sales History ---------- */
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
