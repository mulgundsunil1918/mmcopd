import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Plus, Pencil, FileText, Beaker, Clipboard, CheckCircle2, Loader2, Printer, Search, X, Receipt } from 'lucide-react';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { LabPrint } from '../components/LabPrint';
import { useToast } from '../hooks/useToast';
import { cn, fmtDateTime, formatINR } from '../lib/utils';
import type { LabTest } from '../types';

type Tab = 'orders' | 'catalog';

// First-class lab departments (categories) — used for filter chips + labels.
const LAB_CATEGORIES = ['haematology', 'biochemistry', 'serology', 'microbiology', 'clinical_pathology', 'histopathology', 'radiology'] as const;
const CAT_LABEL: Record<string, string> = {
  haematology: 'Haematology', biochemistry: 'Biochemistry', serology: 'Serology',
  microbiology: 'Microbiology', clinical_pathology: 'Clinical Pathology',
  histopathology: 'Histopathology', radiology: 'Radiology', pathology: 'Pathology (other)',
};
const CAT_COLOR: Record<string, string> = {
  haematology: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  biochemistry: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  serology: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  microbiology: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  clinical_pathology: 'bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300',
  histopathology: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300',
  radiology: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  pathology: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300',
};
const catLabel = (c?: string) => CAT_LABEL[c || 'pathology'] || c || 'Pathology';

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
  const [newReqOpen, setNewReqOpen] = useState(false);
  const [printMode, setPrintMode] = useState<'bill' | 'report' | null>(null);

  const { data: orders = [] } = useQuery({
    queryKey: ['lab-orders', filter],
    queryFn: () => window.electronAPI.lab.listOrders({ status: filter || undefined }),
    refetchInterval: 30_000,
  });
  const activeOrderObj = orders.find((o) => o.id === activeOrder);

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
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setNewReqOpen(true)}>
          <Plus className="w-4 h-4" /> New Lab Request
        </button>
      </div>
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
            order={activeOrderObj}
            orderId={activeOrder}
            items={items}
            onStatus={(s) => setStatus.mutate({ id: activeOrder, status: s })}
            onSaveResults={(results) => saveResults.mutate({ orderId: activeOrder, results })}
            onPrint={(m) => setPrintMode(m)}
          />
        )}
      </div>
      </div>

      {newReqOpen && (
        <NewLabRequestModal
          onClose={() => setNewReqOpen(false)}
          onCreated={(orderId) => {
            qc.invalidateQueries({ queryKey: ['lab-orders'] });
            setNewReqOpen(false);
            setFilter('ordered');
            if (orderId) setActiveOrder(orderId);
            toast('Lab order created — bill raised for the counter', 'success');
          }}
        />
      )}
      {printMode && activeOrderObj && (
        <LabPrint order={activeOrderObj} items={items} mode={printMode} onClose={() => setPrintMode(null)} />
      )}
    </div>
  );
}

function OrderDetail({
  order, orderId, items, onStatus, onSaveResults, onPrint,
}: {
  order?: any;
  orderId: number;
  items: any[];
  onStatus: (s: string) => void;
  onSaveResults: (r: any[]) => void;
  onPrint: (mode: 'bill' | 'report') => void;
}) {
  const [draft, setDraft] = useState<Record<number, { result: string; is_abnormal: number }>>({});
  const setField = (id: number, patch: any) => setDraft((d) => ({ ...d, [id]: { ...(d[id] || { result: '', is_abnormal: 0 }), ...patch } }));

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
          {order?.order_number || `Order #${orderId}`}{order?.patient_name ? <span className="text-gray-400 font-normal"> · {order.patient_name}</span> : null}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-ghost text-xs" onClick={() => onPrint('bill')} title="Print the lab bill on letterhead">
            <Receipt className="w-3.5 h-3.5" /> Print Bill
          </button>
          <button className="btn-ghost text-xs" onClick={() => onPrint('report')} title="Print the results report on letterhead">
            <Printer className="w-3.5 h-3.5" /> Print Report
          </button>
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
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const { data: tests = [] } = useQuery({
    queryKey: ['lab-tests', false],
    queryFn: () => window.electronAPI.lab.listTests(false),
  });

  const save = useMutation({
    mutationFn: (t: Partial<LabTest>) => window.electronAPI.lab.upsertTest(t),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lab-tests', false] }); toast('Test saved'); setEditing(null); },
  });
  // Quick inline edits (price / active) — don't close the modal, just persist.
  const quick = useMutation({
    mutationFn: (t: Partial<LabTest>) => window.electronAPI.lab.upsertTest(t),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lab-tests', false] }),
  });
  const loadCatalog = useMutation({
    mutationFn: () => window.electronAPI.lab.loadStandardCatalog(),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['lab-tests', false] }); toast(r.added > 0 ? `Added ${r.added} tests — set your prices below` : 'Catalog already loaded', 'success'); },
  });

  const shown = tests.filter((t) =>
    (filter === 'all' || (t.category || 'pathology') === filter) &&
    (!search.trim() || t.name.toLowerCase().includes(search.toLowerCase())));

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex flex-wrap gap-1 p-1 rounded-lg bg-gray-100 dark:bg-slate-800/60 text-[11px] font-semibold">
            {['all', ...LAB_CATEGORIES].map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cn('px-2.5 py-1 rounded-md whitespace-nowrap', filter === f ? 'bg-white dark:bg-slate-900 text-fuchsia-700 shadow-sm' : 'text-gray-500')}>{f === 'all' ? 'All' : CAT_LABEL[f]}</button>
            ))}
          </div>
          <input className="input !py-1.5 !text-sm w-48" placeholder="Search tests…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={loadCatalog.isPending} onClick={() => loadCatalog.mutate()} title="Add the ~160 standard Indian lab + radiology tests (skips ones you already have)">
            {loadCatalog.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Load standard catalog
          </button>
          <button className="btn-primary" onClick={() => setEditing({ is_active: 1, price: 0, category: filter !== 'all' ? filter : 'biochemistry' })}>
            <Plus className="w-4 h-4" /> Add Test
          </button>
        </div>
      </div>
      <div className="text-[11px] text-gray-500">{shown.length} of {tests.length} tests · set the <b>price</b> inline and untick <b>Active</b> to hide tests you don't offer.</div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
              <th className="py-2">Test Name</th>
              <th className="py-2">Category</th>
              <th className="py-2">Sample</th>
              <th className="py-2 text-right w-28">Price ₹</th>
              <th className="py-2 text-center w-20">Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id} className="border-b border-gray-100 dark:border-slate-800">
                <td className="py-1.5 font-medium text-gray-900 dark:text-slate-100">{t.name}{t.unit ? <span className="text-[10px] text-gray-400"> · {t.unit}</span> : null}</td>
                <td className="py-1.5"><span className={cn('badge text-[10px]', CAT_COLOR[t.category || 'pathology'] || CAT_COLOR.pathology)}>{catLabel(t.category)}</span></td>
                <td className="py-1.5 text-gray-600 dark:text-slate-300 text-xs">{t.sample_type || '—'}</td>
                <td className="py-1.5 text-right">
                  <input type="number" className="input !py-1 !text-sm w-24 text-right" defaultValue={t.price}
                    onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== t.price) quick.mutate({ ...t, price: v }); }} />
                </td>
                <td className="py-1.5 text-center">
                  <input type="checkbox" className="w-4 h-4 accent-fuchsia-600" checked={t.is_active === 1} onChange={(e) => quick.mutate({ ...t, is_active: e.target.checked ? 1 : 0 })} />
                </td>
                <td className="py-1.5 text-right">
                  <button className="btn-ghost text-xs" onClick={() => setEditing(t)}><Pencil className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400 text-[12px]">
                No tests{search ? ' match your search' : ''}. Click <b>Load standard catalog</b> to add the common Indian investigations.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit Test' : 'Add Test'}>
        {editing && (
          <div className="space-y-3">
            <Row label="Test Name *">
              <input className="input" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Row>
            <div className="grid grid-cols-2 gap-3">
              <Row label="Category">
                <select className="input" value={editing.category || 'biochemistry'} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                  {LAB_CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
                </select>
              </Row>
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
              <span>Active (offered by this clinic)</span>
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

/** Raise a lab order directly from the Lab desk: pick a patient + tests. The
 *  order auto-raises an (unpaid) bill from the test prices, ready at the counter. */
function NewLabRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: (orderId?: number) => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [patient, setPatient] = useState<any | null>(null);
  const [doctorId, setDoctorId] = useState<number | ''>('');
  const [testSearch, setTestSearch] = useState('');
  const [selected, setSelected] = useState<Record<number, true>>({});
  const [notes, setNotes] = useState('');

  const { data: results = [] } = useQuery({
    queryKey: ['lab-patient-search', q],
    queryFn: () => window.electronAPI.patients.search(q),
    enabled: !patient,
  });
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });
  const { data: tests = [] } = useQuery({ queryKey: ['lab-tests', true], queryFn: () => window.electronAPI.lab.listTests(true) });

  const shownTests = tests.filter((t) => !testSearch.trim() || t.name.toLowerCase().includes(testSearch.toLowerCase()));
  const selCount = Object.keys(selected).length;
  const selTotal = tests.filter((t) => selected[t.id]).reduce((sum, t) => sum + (t.price || 0), 0);

  const create = useMutation({
    mutationFn: () => window.electronAPI.lab.createOrder({
      appointment_id: null,
      patient_id: patient.id,
      doctor_id: doctorId ? Number(doctorId) : null,
      notes: notes || undefined,
      items: tests.filter((t) => selected[t.id]).map((t) => ({ lab_test_id: t.id, test_name: t.name })),
    }),
    onSuccess: (order: any) => onCreated(order?.id),
    onError: (e: any) => toast(e?.message || 'Could not create order', 'error'),
  });

  return (
    <Modal open onClose={onClose} title="New Lab Request" size="lg">
      <div className="space-y-3">
        {!patient ? (
          <div>
            <label className="label">Patient</label>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5 pointer-events-none" />
              <input className="input pl-9" autoFocus placeholder="Search by name, phone or UHID…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {q.trim() && (
              <div className="mt-1 max-h-44 overflow-auto rounded-lg border border-gray-200 dark:border-slate-700">
                {results.length === 0 ? <div className="px-3 py-2 text-xs text-gray-500">No patients found.</div> :
                  results.map((p: any) => (
                    <button key={p.id} onClick={() => setPatient(p)} className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 border-b border-gray-100 dark:border-slate-800 last:border-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{p.first_name} {p.last_name}</div>
                      <div className="text-[11px] text-gray-500">{p.uhid} · {p.phone}</div>
                    </button>
                  ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2">
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{patient.first_name} {patient.last_name}</div>
              <div className="text-[11px] text-gray-500">{patient.uhid} · {patient.phone}</div>
            </div>
            <button className="btn-ghost text-xs" onClick={() => setPatient(null)}><X className="w-3.5 h-3.5" /> Change</button>
          </div>
        )}

        <div>
          <label className="label">Referring doctor (optional)</label>
          <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">— none —</option>
            {doctors.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">Tests</label>
            <input className="input !py-1 !text-xs w-44" placeholder="Filter tests…" value={testSearch} onChange={(e) => setTestSearch(e.target.value)} />
          </div>
          {tests.length === 0 ? (
            <div className="text-xs text-amber-600 p-2">No tests in the catalog yet — load the standard catalog in the <b>Test Catalog</b> tab first.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-auto p-1">
              {shownTests.map((t) => {
                const on = !!selected[t.id];
                return (
                  <label key={t.id} className={cn('flex items-center gap-2 p-2 rounded-lg border cursor-pointer text-sm', on ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-slate-700')}>
                    <input type="checkbox" checked={on} onChange={(e) => setSelected((sel) => { const c = { ...sel }; if (e.target.checked) c[t.id] = true; else delete c[t.id]; return c; })} />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-gray-900 dark:text-slate-100">{t.name}</span>
                      <span className="text-[10px] text-gray-500">{catLabel(t.category)} · ₹{t.price}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="label">Notes (optional)</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex items-center justify-between pt-2 border-t dark:border-slate-700">
          <div className="text-[12px] text-gray-600 dark:text-slate-300">
            {selCount} test{selCount === 1 ? '' : 's'} · <b>{formatINR(selTotal)}</b> <span className="text-gray-400">(auto-billed, unpaid)</span>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={!patient || selCount === 0 || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create &amp; raise bill
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
