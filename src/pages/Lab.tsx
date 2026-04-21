import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Plus, Pencil, FileText, Beaker, Clipboard, CheckCircle2 } from 'lucide-react';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../hooks/useToast';
import { cn, fmtDateTime, formatINR } from '../lib/utils';
import type { LabTest } from '../types';

type Tab = 'orders' | 'catalog';

export function Lab() {
  const [tab, setTab] = useState<Tab>('orders');

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Laboratory</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">Test catalog, orders, sample collection, and result entry.</p>
        </div>
        <div className="flex gap-2 bg-gray-100 dark:bg-slate-700 p-1 rounded-lg">
          <TabBtn active={tab === 'orders'} onClick={() => setTab('orders')} icon={<Clipboard className="w-3.5 h-3.5" />}>Orders</TabBtn>
          <TabBtn active={tab === 'catalog'} onClick={() => setTab('catalog')} icon={<Beaker className="w-3.5 h-3.5" />}>Test Catalog</TabBtn>
        </div>
      </div>

      {tab === 'orders' ? <OrdersView /> : <CatalogView />}
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

function OrdersView() {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<string>('ordered');
  const [activeOrder, setActiveOrder] = useState<number | null>(null);

  const { data: orders = [] } = useQuery({
    queryKey: ['lab-orders', filter],
    queryFn: () => window.electronAPI.lab.listOrders({ status: filter || undefined }),
    refetchInterval: 30_000,
  });

  const { data: items = [] } = useQuery({
    queryKey: ['lab-order-items', activeOrder],
    queryFn: () => window.electronAPI.lab.getOrderItems(activeOrder!),
    enabled: !!activeOrder,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => window.electronAPI.lab.updateOrderStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab-orders'] });
      toast('Status updated');
    },
  });

  const saveResults = useMutation({
    mutationFn: ({ orderId, results }: { orderId: number; results: any[] }) =>
      window.electronAPI.lab.updateResults(orderId, results),
    onSuccess: (_data, v) => {
      qc.invalidateQueries({ queryKey: ['lab-order-items', v.orderId] });
      toast('Results saved');
    },
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-1 card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide">Orders</div>
          <select className="input w-auto text-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All</option>
            <option value="ordered">Ordered</option>
            <option value="sample_collected">Collected</option>
            <option value="reported">Reported</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        {orders.length === 0 ? (
          <EmptyState icon={FlaskConical} title="No orders" description="Orders created from consultations or directly will appear here." />
        ) : (
          <ul className="space-y-1 max-h-[70vh] overflow-auto">
            {orders.map((o) => (
              <li
                key={o.id}
                onClick={() => setActiveOrder(o.id)}
                className={cn(
                  'rounded-lg p-2.5 border cursor-pointer transition',
                  activeOrder === o.id ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/40' : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/40'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-gray-600 dark:text-slate-300">{o.order_number}</span>
                  <StatusPill status={o.status} />
                </div>
                <div className="text-sm text-gray-900 dark:text-slate-100 mt-0.5">{o.patient_name}</div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400">{o.patient_uhid}{o.doctor_name ? ` · ${o.doctor_name}` : ''}</div>
                <div className="text-[10px] text-gray-400 dark:text-slate-500">{fmtDateTime(o.ordered_at)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="lg:col-span-2">
        {!activeOrder ? (
          <div className="card p-6">
            <EmptyState icon={FileText} title="Select an order" description="Click a lab order to collect sample / enter results / print." />
          </div>
        ) : (
          <OrderDetail
            orderId={activeOrder}
            items={items}
            onStatus={(s) => setStatus.mutate({ id: activeOrder, status: s })}
            onSaveResults={(results) => saveResults.mutate({ orderId: activeOrder, results })}
          />
        )}
      </div>
    </div>
  );
}

function OrderDetail({
  orderId, items, onStatus, onSaveResults,
}: {
  orderId: number;
  items: any[];
  onStatus: (s: string) => void;
  onSaveResults: (r: any[]) => void;
}) {
  const [draft, setDraft] = useState<Record<number, { result: string; is_abnormal: number }>>({});
  const setField = (id: number, patch: any) => setDraft((d) => ({ ...d, [id]: { ...(d[id] || { result: '', is_abnormal: 0 }), ...patch } }));

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Order #{orderId} — Items</div>
        <div className="flex gap-2">
          <button className="btn-secondary text-xs" onClick={() => onStatus('sample_collected')}>
            <CheckCircle2 className="w-3.5 h-3.5" /> Sample Collected
          </button>
          <button
            className="btn-primary text-xs"
            onClick={() => onSaveResults(Object.entries(draft).map(([id, v]) => ({ id: Number(id), result: v.result, is_abnormal: v.is_abnormal })))}
          >
            Save Results
          </button>
          <button className="btn-success text-xs" onClick={() => onStatus('reported')}>
            Mark Reported
          </button>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
            <th className="py-2">Test</th>
            <th className="py-2">Ref Range</th>
            <th className="py-2 w-48">Result</th>
            <th className="py-2 w-20">Unit</th>
            <th className="py-2">Abnormal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-gray-100 dark:border-slate-800">
              <td className="py-2 font-medium text-gray-900 dark:text-slate-100">{it.test_name}</td>
              <td className="py-2 text-xs text-gray-500 dark:text-slate-400">{it.ref_range || '—'}</td>
              <td className="py-2">
                <input
                  className="input"
                  defaultValue={it.result || ''}
                  onChange={(e) => setField(it.id, { result: e.target.value })}
                />
              </td>
              <td className="py-2 text-xs text-gray-500 dark:text-slate-400">{it.unit || '—'}</td>
              <td className="py-2">
                <input
                  type="checkbox"
                  defaultChecked={!!it.is_abnormal}
                  onChange={(e) => setField(it.id, { is_abnormal: e.target.checked ? 1 : 0 })}
                />
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={5} className="text-center py-6 text-xs text-gray-500">No test items.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    ordered: 'bg-blue-100 text-blue-700',
    sample_collected: 'bg-amber-100 text-amber-800',
    reported: 'bg-emerald-100 text-emerald-700',
    cancelled: 'bg-red-100 text-red-700',
  };
  return <span className={cn('badge', map[status] || 'bg-gray-100 text-gray-700')}>{status.replace('_', ' ')}</span>;
}

function CatalogView() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<LabTest> | null>(null);

  const { data: tests = [] } = useQuery({
    queryKey: ['lab-tests', false],
    queryFn: () => window.electronAPI.lab.listTests(false),
  });

  const save = useMutation({
    mutationFn: (t: Partial<LabTest>) => window.electronAPI.lab.upsertTest(t),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lab-tests', false] }); toast('Test saved'); setEditing(null); },
  });

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide">{tests.length} tests</div>
        <button className="btn-primary" onClick={() => setEditing({ is_active: 1, price: 0 })}>
          <Plus className="w-4 h-4" /> Add Test
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
            <th className="py-2">Test Name</th>
            <th className="py-2">Sample</th>
            <th className="py-2">Ref Range</th>
            <th className="py-2">Unit</th>
            <th className="py-2 text-right">Price</th>
            <th className="py-2">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tests.map((t) => (
            <tr key={t.id} className="border-b border-gray-100 dark:border-slate-800">
              <td className="py-2 font-medium text-gray-900 dark:text-slate-100">{t.name}</td>
              <td className="py-2 text-gray-600 dark:text-slate-300">{t.sample_type || '—'}</td>
              <td className="py-2 text-xs text-gray-600 dark:text-slate-300">{t.ref_range || '—'}</td>
              <td className="py-2 text-xs text-gray-600 dark:text-slate-300">{t.unit || '—'}</td>
              <td className="py-2 text-right">{formatINR(t.price)}</td>
              <td className="py-2">
                <span className={t.is_active ? 'badge bg-green-100 text-green-700' : 'badge bg-gray-200 text-gray-600'}>
                  {t.is_active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td className="py-2 text-right">
                <button className="btn-ghost text-xs" onClick={() => setEditing(t)}>
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit Test' : 'Add Test'}>
        {editing && (
          <div className="space-y-3">
            <Row label="Test Name *">
              <input className="input" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Row>
            <div className="grid grid-cols-2 gap-3">
              <Row label="Price (₹)">
                <input type="number" className="input" value={editing.price ?? 0} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} />
              </Row>
              <Row label="Sample Type">
                <input className="input" value={editing.sample_type || ''} onChange={(e) => setEditing({ ...editing, sample_type: e.target.value })} />
              </Row>
              <Row label="Reference Range">
                <input className="input" value={editing.ref_range || ''} onChange={(e) => setEditing({ ...editing, ref_range: e.target.value })} />
              </Row>
              <Row label="Unit">
                <input className="input" value={editing.unit || ''} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} />
              </Row>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
