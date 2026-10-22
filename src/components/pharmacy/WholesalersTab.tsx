/**
 * Wholesalers — the suppliers the clinic buys from, with what has been bought and what is owed to each TODAY.
 * (This used to be a popup hidden behind a button in Purchases.) Paying a supplier is still done on each bill under Purchases;
 * "View bills" jumps there with this supplier's bills.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Store } from 'lucide-react';
import { Modal } from '../Modal';
import { EmptyState } from '../EmptyState';
import { useToast } from '../../hooks/useToast';
import { cn, fmtDate, formatINR } from '../../lib/utils';
import type { SupplierSummaryRow, Wholesaler } from '../../types';
import { Field } from './shared';
import { PaySupplierModal } from './PaySupplierModal';

const NONE: Omit<SupplierSummaryRow, 'wholesaler_id'> = { bills: 0, total_bought: 0, owed: 0, unknown_bills: 0, open_bills: 0, last_bill_date: null };

export function WholesalersTab({ onViewBills }: { onViewBills: (w: { id: number; name: string }) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Partial<Wholesaler> | null>(null);
  const [paying, setPaying] = useState<{ id: number; name: string } | null>(null);

  const { data: wholesalers = [], isLoading } = useQuery({
    queryKey: ['wholesalers-all'],
    queryFn: () => window.electronAPI.wholesalers.list({ activeOnly: false }),
  });
  const { data: summary = [] } = useQuery({
    queryKey: ['wholesalers-summary'],
    queryFn: () => window.electronAPI.wholesalers.summary(),
    refetchInterval: 60_000,
  });
  const refresh = () => { for (const k of ['wholesalers', 'wholesalers-all', 'wholesalers-summary']) qc.invalidateQueries({ queryKey: [k] }); };

  const save = useMutation({
    mutationFn: (w: Partial<Wholesaler>) => window.electronAPI.wholesalers.upsert(w),
    onSuccess: () => { refresh(); toast('Wholesaler saved'); setEditing(null); },
    onError: (e: any) => toast(String(e?.message || e), 'error'),
  });
  const deactivate = useMutation({
    mutationFn: (id: number) => window.electronAPI.wholesalers.delete(id),
    onSuccess: () => { refresh(); toast('Marked inactive'); },
  });

  const rows = useMemo(() => {
    const byId = new Map(summary.map((s) => [s.wholesaler_id, s]));
    const t = q.trim().toLowerCase();
    return wholesalers
      .filter((w) => (showInactive || w.is_active === 1)
        && (!t || [w.name, w.contact_person, w.phone, w.drug_license_no, w.gstin].some((x) => (x || '').toLowerCase().includes(t))))
      .map((w) => ({ w, s: byId.get(w.id) ?? { wholesaler_id: w.id, ...NONE } }))
      .sort((a, b) => (b.w.is_active - a.w.is_active) || (b.s.owed - a.s.owed) || a.w.name.localeCompare(b.w.name));
  }, [wholesalers, summary, q, showInactive]);

  const totalOwed = rows.reduce((n, r) => n + r.s.owed, 0);
  const unknown = rows.reduce((n, r) => n + r.s.unknown_bills, 0);
  const inactiveCount = wholesalers.filter((w) => w.is_active !== 1).length;

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input className="input pl-9" placeholder="Search by name / licence / GSTIN / phone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {inactiveCount > 0 && (
            <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-300">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive ({inactiveCount})
            </label>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-sm" title="What the clinic owes its suppliers today, on bills whose payments are recorded">
            <span className="text-gray-500 dark:text-slate-400">You owe:</span>{' '}
            <span className={cn('font-bold', totalOwed > 0.004 ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400')}>{formatINR(totalOwed)}</span>
            {unknown > 0 && <span className="text-[10px] text-amber-700 dark:text-amber-300 ml-1">+ {unknown} bill{unknown === 1 ? '' : 's'} with unknown payment</span>}
          </div>
          <button className="btn-primary text-xs" onClick={() => setEditing({ name: '', drug_license_no: '', is_active: 1 })}>
            <Plus className="w-3.5 h-3.5" /> Add Wholesaler
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-xs text-gray-500 py-8 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Store} title={q ? 'No wholesaler matches' : 'No wholesalers yet'} description="Add the suppliers you buy from. Every purchase bill is recorded against one of them, with their drug licence number." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                <th className="py-2">Wholesaler</th>
                <th className="py-2">Licence · GSTIN · phone</th>
                <th className="py-2 text-right">Bills</th>
                <th className="py-2 text-right">Bought</th>
                <th className="py-2 text-right">You owe</th>
                <th className="py-2 pl-6">Last bill</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ w, s }) => (
                <tr key={w.id} className={cn('border-b border-gray-100 dark:border-slate-800', w.is_active !== 1 && 'opacity-60')}>
                  <td className="py-2">
                    <div className="font-medium text-gray-900 dark:text-slate-100">
                      {w.name}
                      {w.is_active !== 1 && <span className="badge bg-gray-200 text-gray-600 ml-2 align-middle">Inactive</span>}
                    </div>
                    {w.contact_person && <div className="text-[11px] text-gray-500 dark:text-slate-400">{w.contact_person}</div>}
                  </td>
                  <td className="py-2 text-xs">
                    <div className="font-mono">{w.drug_license_no}</div>
                    <div className="font-mono text-gray-500 dark:text-slate-400">{w.gstin || '—'}</div>
                    <div className="text-gray-500 dark:text-slate-400">{w.phone || '—'}</div>
                  </td>
                  <td className="py-2 text-right tabular-nums">{s.bills}</td>
                  <td className="py-2 text-right tabular-nums">{s.bills > 0 ? formatINR(s.total_bought) : <span className="text-gray-400">—</span>}</td>
                  <td className="py-2 text-right tabular-nums">
                    {s.owed > 0.004 ? <span className="font-semibold text-red-700 dark:text-red-400">{formatINR(s.owed)}</span> : <span className="text-gray-400">—</span>}
                    {s.unknown_bills > 0 && (
                      <div className="text-[10px] text-amber-700 dark:text-amber-300" title="Marked part-paid before payments were tracked — open the bill under Purchases to enter what was paid">
                        + {s.unknown_bills} unknown
                      </div>
                    )}
                  </td>
                  <td className="py-2 pl-6 text-xs text-gray-500 dark:text-slate-400">{s.last_bill_date ? fmtDate(s.last_bill_date) : '—'}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button className="btn-primary text-xs mr-1" disabled={s.owed <= 0.004}
                      title={s.owed <= 0.004 ? 'Nothing is owed to this supplier on bills with recorded payments' : `Pay ${w.name}: one payment settles their unpaid bills, oldest first`}
                      onClick={() => setPaying({ id: w.id, name: w.name })}>
                      Pay supplier
                    </button>
                    <button className="btn-ghost text-xs" disabled={s.bills === 0} title={s.bills === 0 ? 'No bills from this supplier yet' : 'See this supplier’s bills under Purchases'} onClick={() => onViewBills({ id: w.id, name: w.name })}>
                      View bills
                    </button>
                    <button className="btn-ghost text-xs" title="Edit this wholesaler" aria-label={`Edit ${w.name}`} onClick={() => setEditing(w)}><Pencil className="w-3.5 h-3.5" /></button>
                    {w.is_active === 1 && <button className="text-xs text-red-600 hover:underline ml-2" onClick={() => deactivate.mutate(w.id)}>Deactivate</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-3">
        “You owe” is the unpaid part of each bill. <b>Pay supplier</b> settles their bills oldest-first in one payment; to pay a single bill, open it under <b>Purchases</b>.
      </div>
      {paying && <PaySupplierModal supplier={paying} onClose={() => setPaying(null)} />}

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
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.is_active !== 0} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked ? 1 : 0 })} />
              <span>Active (can be chosen on a new purchase bill)</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => save.mutate(editing)} disabled={save.isPending || !editing.name || !editing.drug_license_no}>
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
