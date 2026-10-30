import { SettingsLink } from '../components/Feature';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ScanLine, Plus, Pencil, Trash2, Clipboard, Layers, FileText, Printer, Receipt, X, Search,
  CheckCircle2, Loader2, Wallet, Ban, Download,
} from 'lucide-react';
import { PageHelp } from '../components/PageHelp';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { BillPrint } from '../components/billing/BillPrint';
import { RadiologyPrint } from '../components/radiology/RadiologyPrint';
import { NewRadiologyRequest } from '../components/radiology/NewRadiologyRequest';
import { RadiologyTestPicker } from '../components/radiology/RadiologyTestPicker';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { cn, fmtDateTime, formatINR, ageStringFull, newRef, refFor } from '../lib/utils';
import { MODALITY_LABEL, RADIOLOGY_MODALITIES } from '../data/radiology-catalog';
import type { RadiologyOrderDetail, RadiologyOrderRow, RadiologyTest, RadiologyModality } from '../types';

type Tab = 'orders' | 'catalog';
const splitNames = (s: string | null | undefined) => (s ? s.split('\u001f').filter(Boolean) : []);

const STATUS_STYLE: Record<string, string> = {
  ordered: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  done: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  reported: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};
const STATUS_LABEL: Record<string, string> = { ordered: 'Ordered', done: 'Scan done', reported: 'Reported', cancelled: 'Cancelled' };

function StatusPill({ status }: { status: string }) {
  return <span className={cn('badge', STATUS_STYLE[status] || 'bg-gray-100 text-gray-700')}>{STATUS_LABEL[status] || status}</span>;
}

function BillChip({ row }: { row: Pick<RadiologyOrderRow, 'bill_id' | 'bill_total' | 'bill_paid' | 'bill_status'> }) {
  if (!row.bill_id) return <span className="text-[10px] text-gray-400">no bill</span>;
  if (row.bill_status === 'cancelled') return <span className="text-[10px] text-red-500">bill cancelled</span>;
  const paid = Number(row.bill_paid || 0), total = Number(row.bill_total || 0);
  if (total > 0 && paid >= total - 0.01) return <span className="text-[10px] font-semibold text-emerald-600">Paid · {formatINR(total)}</span>;
  if (paid > 0) return <span className="text-[10px] font-semibold text-amber-600">Part paid · {formatINR(paid)} of {formatINR(total)}</span>;
  return <span className="text-[10px] font-semibold text-red-600">Unpaid · {formatINR(total)}</span>;
}

export function Radiology() {
  const [tab, setTab] = useState<Tab>('orders');
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100 inline-flex items-center gap-1.5">
            <ScanLine className="w-5 h-5 text-sky-500" /> Radiology<PageHelp page="radiology" />
          <span className="ml-3 font-normal inline-flex align-middle"><SettingsLink tab="lab" /></span></h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">X-Ray, ultrasound, CT, MRI — orders, billing, and written reports.</p>
        </div>
        <div className="flex gap-2 bg-gray-100 dark:bg-slate-700 p-1 rounded-lg">
          <TabBtn active={tab === 'orders'} onClick={() => setTab('orders')} icon={<Clipboard className="w-3.5 h-3.5" />}>Orders</TabBtn>
          <TabBtn active={tab === 'catalog'} onClick={() => setTab('catalog')} icon={<Layers className="w-3.5 h-3.5" />}>Catalogue &amp; Prices</TabBtn>
        </div>
      </div>
      {tab === 'orders' ? <OrdersView /> : <CatalogView />}
    </div>
  );
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition',
        active ? 'bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 shadow-sm' : 'text-gray-600 dark:text-slate-300')}>
      {icon} {children}
    </button>
  );
}

// =====================================================================
// ORDERS
// =====================================================================

function OrdersView() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'open' | 'reported' | 'cancelled' | ''>('open');
  const [win, setWin] = useState<'today' | 'week' | 'month' | 'quarter' | 'all'>('month');
  const [q, setQ] = useState('');
  const [activeId, setActiveId] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const { data: orders = [] } = useQuery({
    queryKey: ['radiology-orders', status, win, q],
    queryFn: () => window.electronAPI.radiology.listOrders({ status: status || undefined, window: win, q: q.trim() || undefined, sort: 'recent' }),
    refetchInterval: 20_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['radiology-orders'] });
    qc.invalidateQueries({ queryKey: ['radiology-order'] });
    qc.invalidateQueries({ queryKey: ['radiology-orders-patient'] });
    qc.invalidateQueries({ queryKey: ['bills'] });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setNewOpen(true)}>
          <Plus className="w-4 h-4" /> New Radiology Request
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ---- list ---- */}
        <div className="lg:col-span-1 card p-4">
          <div className="flex items-center gap-1 mb-2 flex-wrap">
            {([['open', 'To do'], ['reported', 'Reported'], ['cancelled', 'Cancelled'], ['', 'All']] as const).map(([v, l]) => (
              <button key={v || 'all'} onClick={() => setStatus(v as any)}
                className={cn('px-2.5 py-1 rounded-full text-[11px] font-semibold border transition',
                  status === v ? 'bg-sky-600 text-white border-sky-600' : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-sky-400')}>
                {l}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex gap-0.5 p-0.5 rounded-md bg-gray-100 dark:bg-slate-800/60 text-[11px] font-semibold">
              {([['today', 'Today'], ['week', '1 wk'], ['month', '1 mo'], ['quarter', '3 mo'], ['all', 'All']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setWin(v)}
                  className={cn('px-2 py-0.5 rounded', win === v ? 'bg-white dark:bg-slate-900 text-sky-700 shadow-sm' : 'text-gray-500')}>{l}</button>
              ))}
            </div>
          </div>
          <div className="relative mb-3">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5 pointer-events-none" />
            <input className="input pl-8 !py-1.5 text-xs" placeholder="Patient, UHID, phone or order no." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          {orders.length === 0 ? (
            <EmptyState icon={ScanLine} title="No radiology orders"
              description={status === 'open' ? 'Nothing waiting. Orders from a doctor appear here by themselves, or raise one with “New Radiology Request”.' : 'No orders match — widen the date range or filter.'} />
          ) : (
            <ul className="space-y-1 max-h-[68vh] overflow-auto">
              {orders.map((o) => {
                const names = splitNames(o.test_names);
                return (
                  <li key={o.id} onClick={() => setActiveId(o.id)}
                    className={cn('rounded-lg p-2.5 border cursor-pointer transition',
                      activeId === o.id ? 'border-sky-400 bg-sky-50 dark:bg-sky-900/30' : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/40')}>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-gray-600 dark:text-slate-300">{o.order_number}</span>
                      <StatusPill status={o.status} />
                    </div>
                    <div className="text-sm font-medium text-gray-900 dark:text-slate-100 mt-0.5">{o.patient_name}</div>
                    <div className="text-[11px] text-gray-500 dark:text-slate-400 truncate">
                      {names[0]}{names.length > 1 ? ` +${names.length - 1} more` : ''}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[10px] text-gray-400 dark:text-slate-500">{o.patient_uhid} · {fmtDateTime(o.ordered_at)}</span>
                      <BillChip row={o} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ---- detail ---- */}
        <div className="lg:col-span-2">
          {!activeId ? (
            <div className="card p-6">
              <EmptyState icon={FileText} title="Select an order" description="Click a radiology order to mark the scan done, write the report, take payment or print." />
            </div>
          ) : (
            <OrderDetail key={activeId} orderId={activeId} onChanged={refresh} />
          )}
        </div>
      </div>

      {newOpen && (
        <NewRadiologyRequest
          onClose={() => setNewOpen(false)}
          onCreated={(order) => { refresh(); setNewOpen(false); setStatus('open'); setActiveId(order.id); }}
        />
      )}
    </div>
  );
}

function OrderDetail({ orderId, onChanged }: { orderId: number; onChanged: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const { data: detail, isLoading } = useQuery({
    queryKey: ['radiology-order', orderId],
    queryFn: () => window.electronAPI.radiology.getOrder(orderId),
  });

  type Draft = { findings?: string; impression?: string; is_abnormal?: number };
  const [draft, setDraft] = useState<Record<number, Draft>>({});
  const [reporter, setReporter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [printMode, setPrintMode] = useState<null | 'report' | 'bill'>(null);

  // The radiologist's name: the one already on the report, else the last one used on this PC, else the signed-in user.
  useEffect(() => {
    if (!detail || reporter) return;
    let remembered = '';
    try { remembered = localStorage.getItem('radiology-reporter') || ''; } catch { /* storage blocked */ }
    setReporter(detail.reported_by || remembered || user?.display_name || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  const dirty = Object.keys(draft).length > 0;
  const hasText = useMemo(
    () => (detail?.items || []).some((it) => (draft[it.id]?.findings ?? it.findings ?? '').trim() || (draft[it.id]?.impression ?? it.impression ?? '').trim()),
    [detail, draft],
  );

  if (isLoading || !detail) {
    return <div className="card p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading order…</div>;
  }
  const o: RadiologyOrderDetail = detail;
  const locked = o.status === 'cancelled';
  const sexWord = o.patient_gender === 'M' ? 'Male' : o.patient_gender === 'F' ? 'Female' : o.patient_gender || '';
  const ageSex = [o.patient_dob ? ageStringFull(o.patient_dob) : '', sexWord].filter(Boolean).join(' · ');

  const setField = (id: number, patch: Draft) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const shown = (it: RadiologyOrderDetail['items'][number]) => ({
    findings: draft[it.id]?.findings ?? it.findings ?? '',
    impression: draft[it.id]?.impression ?? it.impression ?? '',
    abnormal: (draft[it.id]?.is_abnormal ?? it.is_abnormal) ? 1 : 0,
  });

  const payload = () => Object.entries(draft).map(([id, v]) => ({ id: Number(id), ...v }));
  const settle = (sent: Record<number, Draft>) =>
    setDraft((d) => { const n = { ...d }; for (const k of Object.keys(sent)) if (d[Number(k)] === sent[Number(k)]) delete n[Number(k)]; return n; });

  const save = async (finalize: boolean): Promise<boolean> => {
    if (finalize && !reporter.trim()) { toast('Enter the radiologist’s name — it prints on the report.', 'error'); return false; }
    setBusy(finalize ? 'final' : 'save');
    const sent = { ...draft };
    try {
      const r = await window.electronAPI.radiology.saveReport(orderId, payload(), { reportedBy: reporter.trim() || null, finalize });
      if (!r.ok) { toast(r.error, 'error'); return false; }
      try { if (reporter.trim()) localStorage.setItem('radiology-reporter', reporter.trim()); } catch { /* ignore */ }
      settle(sent);
      onChanged();
      toast(finalize ? 'Report marked ready.' : 'Saved.', 'success');
      return true;
    } catch (e: any) { toast(e?.message || 'Could not save the report.', 'error'); return false; }
    finally { setBusy(null); }
  };

  const markDone = async () => {
    setBusy('done');
    try {
      const r = await window.electronAPI.radiology.updateStatus(orderId, 'done');
      if (!r.ok) toast(r.error, 'error'); else { onChanged(); toast('Scan marked done.', 'success'); }
    } finally { setBusy(null); }
  };

  const removeScan = async (itemId: number, name: string) => {
    if (!window.confirm(`Remove “${name}” from this order?\n\nThe bill will be re-priced to match.`)) return;
    setBusy('rm' + itemId);
    try {
      const r = await window.electronAPI.radiology.removeItem(orderId, itemId);
      if (!r.ok) toast(r.error, 'error'); else { onChanged(); toast(r.note, r.billChanged ? 'success' : 'info'); }
    } finally { setBusy(null); }
  };

  const printReport = async () => {
    if (dirty && !(await save(false))) return;
    setPrintMode('report');
  };

  const TL = ({ label, at }: { label: string; at: string | null }) => (
    <div className={cn('text-[11px]', at ? 'text-gray-700 dark:text-slate-300' : 'text-gray-400 dark:text-slate-500')}>
      <span className="font-semibold">{label}</span> {at ? fmtDateTime(at) : '—'}
    </div>
  );

  return (
    <div className="card p-5 space-y-4">
      {/* header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 dark:text-slate-100 font-mono">{o.order_number}</span>
            <StatusPill status={o.status} />
          </div>
          <div className="text-base font-bold text-gray-900 dark:text-slate-100 mt-1">{o.patient_name}</div>
          <div className="text-[12px] text-gray-500 dark:text-slate-400">
            {o.patient_uhid}{ageSex ? ` · ${ageSex}` : ''}{o.patient_phone ? ` · ☎ ${o.patient_phone}` : ''}
          </div>
          <div className="text-[12px] text-gray-600 dark:text-slate-300 mt-0.5">
            {o.referred_by ? <>Referral <b>{o.referred_by}</b></> : <span className="text-gray-400">No referral</span>}
            {o.doctor_name ? <> · Consultant <b>{o.doctor_name}</b></> : null}
          </div>
          {o.clinical_info && <div className="text-[12px] text-gray-600 dark:text-slate-300 mt-1 italic">“{o.clinical_info}”</div>}
        </div>
        <div className="text-right space-y-0.5">
          <TL label="Ordered" at={o.ordered_at} />
          <TL label="Scan done" at={o.performed_at} />
          <TL label="Reported" at={o.reported_at} />
        </div>
      </div>

      {/* bill + money */}
      <BillStrip order={o} onChanged={onChanged} onPrintBill={() => setPrintMode('bill')} />

      {/* scans + report */}
      <div className="space-y-3">
        {o.items.map((it) => {
          const v = shown(it);
          const hasReport = !!(it.findings || it.impression);
          return (
            <div key={it.id} className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{it.test_name}</div>
                  <div className="text-[10px] text-gray-500 dark:text-slate-400">
                    {it.modality ? (MODALITY_LABEL[it.modality as RadiologyModality] ?? it.modality) : ''} · {it.price > 0 ? formatINR(it.price) : <span className="text-amber-600">no price — not billed</span>}
                  </div>
                </div>
                {!locked && o.status !== 'reported' && (
                  hasReport ? (
                    <span title="A report is written for this scan — clear it first to remove the scan" className="text-gray-300"><CheckCircle2 className="w-4 h-4" /></span>
                  ) : (
                    <button onClick={() => removeScan(it.id, it.test_name)} disabled={busy === 'rm' + it.id || o.items.length <= 1}
                      title={o.items.length <= 1 ? 'An order must keep at least one scan' : 'Remove this scan and re-price the bill'}
                      className="text-gray-400 hover:text-red-600 disabled:opacity-30">
                      <X className="w-4 h-4" />
                    </button>
                  )
                )}
              </div>
              {!locked && (
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <button type="button" className="btn-secondary text-xs py-1" title="Put the normal report for this scan into the boxes, then change only what is different"
                    onClick={async () => {
                      if ((v.findings || v.impression).trim() && !window.confirm('Replace what is written with the normal report?')) return;
                      const r = await window.electronAPI.radiology.normalReport(it.test_id ?? null, it.test_name);
                      if (!r.ok) { toast(r.error, 'error'); return; }
                      setField(it.id, { findings: r.findings, impression: r.impression, is_abnormal: 0 });
                      toast(r.source === 'clinic' ? 'Your normal report is filled in — change what is different' : 'The standard normal report is filled in — change what is different');
                    }}>Fill normal report</button>
                  {it.test_id && (v.findings || v.impression).trim() && (
                    <button type="button" className="btn-ghost text-xs py-1" title="Use this wording as the normal report for this scan from now on"
                      onClick={async () => { const r = await window.electronAPI.radiology.saveNormalReport(Number(it.test_id), v.findings, v.impression); toast(r.ok ? 'Saved as the normal report for this scan' : r.error, r.ok ? 'success' : 'error'); }}>Save as the normal report</button>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="label">Findings</label>
                  <textarea className="input" rows={4} disabled={locked} value={v.findings}
                    onChange={(e) => setField(it.id, { findings: e.target.value })}
                    placeholder="What the scan shows…" />
                </div>
                <div>
                  <label className="label flex items-center justify-between">
                    <span>Impression</span>
                    <label className="inline-flex items-center gap-1 text-[11px] font-normal text-gray-500 cursor-pointer">
                      <input type="checkbox" disabled={locked} checked={!!v.abnormal} onChange={(e) => setField(it.id, { is_abnormal: e.target.checked ? 1 : 0 })} /> Abnormal
                    </label>
                  </label>
                  <textarea className="input" rows={4} disabled={locked} value={v.impression}
                    onChange={(e) => setField(it.id, { impression: e.target.value })}
                    placeholder="The conclusion — prints in bold…" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* actions */}
      {!locked && (
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <div className="min-w-[14rem]">
            <label className="label">Reported by (radiologist)</label>
            <input className="input" value={reporter} onChange={(e) => setReporter(e.target.value)} placeholder="e.g. Dr. R. Iyer" />
          </div>
          <div className="flex-1" />
          <button className="btn-ghost text-xs" onClick={() => setAddOpen(true)} disabled={o.status === 'reported'} title="Add a scan the doctor did not order">
            <Plus className="w-3.5 h-3.5" /> Add scan
          </button>
          {o.status === 'ordered' && (
            <button className="btn-secondary text-xs" onClick={markDone} disabled={!!busy}>
              <CheckCircle2 className="w-3.5 h-3.5" /> Scan done
            </button>
          )}
          <button className="btn-secondary text-xs" onClick={() => save(false)} disabled={!!busy || !dirty}>
            {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} {o.status === 'reported' ? 'Save changes' : 'Save draft'}
          </button>
          {o.status !== 'reported' && (
            <button className="btn-success text-xs" onClick={() => save(true)} disabled={!!busy || (!hasText && !dirty)}>
              {busy === 'final' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Mark report ready
            </button>
          )}
          <button className="btn-primary text-xs" onClick={printReport} disabled={!hasText}
            title={hasText ? 'Print the report on the clinic letterhead' : 'Write the findings or impression first'}>
            <Printer className="w-3.5 h-3.5" /> Print report
          </button>
          {o.status !== 'reported' && (
            <button className="btn-ghost text-xs text-red-600" onClick={() => setCancelOpen(true)}>
              <Ban className="w-3.5 h-3.5" /> Cancel order
            </button>
          )}
        </div>
      )}

      {addOpen && (
        <AddScansModal order={o} onClose={() => setAddOpen(false)}
          onDone={(note, changed) => { setAddOpen(false); onChanged(); toast(note, changed ? 'success' : 'info'); }} />
      )}
      {cancelOpen && (
        <CancelModal order={o} onClose={() => setCancelOpen(false)}
          onDone={(note) => { setCancelOpen(false); onChanged(); toast(note, 'info'); }} />
      )}
      {printMode === 'report' && <RadiologyPrint orderId={orderId} onClose={() => setPrintMode(null)} />}
      {printMode === 'bill' && o.bill_id ? <BillPrint billId={Number(o.bill_id)} onClose={() => setPrintMode(null)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------

function BillStrip({ order, onChanged, onPrintBill }: { order: RadiologyOrderDetail; onChanged: () => void; onPrintBill: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'Cash' | 'UPI' | 'Card'>('Cash');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const payRef = useRef(newRef());   // one id per payment attempt; renewed after each payment that goes through

  if (!order.bill_id) {
    return (
      <div className="rounded-lg bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 px-3 py-2 text-[12px] text-gray-500 dark:text-slate-400">
        No bill for this order — none of its scans has a price (or auto-billing is off under Settings → Laboratory & Radiology).
      </div>
    );
  }
  const total = Number(order.bill_total || 0);
  const paid = Number(order.bill_paid || 0);
  const balance = Math.max(0, total - paid);
  const cancelled = order.bill_status === 'cancelled';

  const collect = async () => {
    const amt = Number(amount || balance);
    if (!(amt > 0)) return toast('Enter the amount received.', 'error');
    setBusy(true);
    try {
      const r = await window.electronAPI.billing.pay(Number(order.bill_id), amt, mode, user?.username, refFor(payRef.current, { bill: order.bill_id, amt, mode }));
      if (!r.ok) toast(r.error || 'Could not record the payment.', 'error');
      else { toast(`${formatINR(amt)} received (${mode}).`, 'success'); payRef.current = newRef(); setOpen(false); setAmount(''); onChanged(); }
    } catch (e: any) { toast(e?.message || 'Could not record the payment.', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[12px] text-gray-700 dark:text-slate-300">
          <Receipt className="w-3.5 h-3.5 inline -mt-0.5 mr-1 text-amber-600" />
          Bill <b className="font-mono">{order.bill_number}</b> · {formatINR(total)} · <BillChip row={order} />
        </div>
        <div className="flex gap-1.5">
          {!cancelled && balance > 0.009 && (
            <button className="btn-secondary text-xs" onClick={() => { setOpen((v) => !v); setAmount(String(balance)); }}>
              <Wallet className="w-3.5 h-3.5" /> Collect payment
            </button>
          )}
          <button className="btn-ghost text-xs" onClick={onPrintBill}><Printer className="w-3.5 h-3.5" /> Print bill</button>
        </div>
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100 dark:border-slate-800">
          <span className="text-[11px] text-gray-500">Amount ₹</span>
          <input type="number" className="input !w-28 !py-1" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {(['Cash', 'UPI', 'Card'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={cn('px-3 py-1 text-xs rounded-md border', mode === m ? 'bg-sky-600 text-white border-sky-600' : 'border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300')}>{m}</button>
          ))}
          <button className="btn-success text-xs" disabled={busy} onClick={collect}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Record payment
          </button>
        </div>
      )}
    </div>
  );
}

function AddScansModal({ order, onClose, onDone }: { order: RadiologyOrderDetail; onClose: () => void; onDone: (note: string, changed: boolean) => void }) {
  const toast = useToast();
  const [sel, setSel] = useState<Record<number, true>>({});
  const [busy, setBusy] = useState(false);
  const { data: tests = [] } = useQuery({ queryKey: ['radiology-tests', true], queryFn: () => window.electronAPI.radiology.listTests(true) });
  const have = useMemo(() => new Set(order.items.map((i) => i.test_name.toLowerCase())), [order.items]);
  const picked = tests.filter((t) => sel[t.id]);
  const extra = picked.reduce((s, t) => s + (Number(t.price) || 0), 0);

  const add = async () => {
    setBusy(true);
    try {
      const r = await window.electronAPI.radiology.addItems(order.id, picked.map((t) => ({ test_id: t.id })));
      if (!r.ok) toast(r.error, 'error'); else onDone(r.note, r.billChanged);
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Add scans to ${order.order_number}`} size="lg">
      <div className="space-y-3">
        <RadiologyTestPicker tests={tests} exclude={have} selected={sel}
          onToggle={(id, on) => setSel((s) => { const c = { ...s }; if (on) c[id] = true; else delete c[id]; return c; })} />
        <div className="text-[12px] text-gray-600 dark:text-slate-300">
          {picked.length} selected · adds <b>{formatINR(extra)}</b> to the bill.
          {picked.some((t) => !(t.price > 0)) && <span className="text-amber-600"> Unpriced scans are done but not billed.</span>}
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || picked.length === 0} onClick={add}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add &amp; re-price bill
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CancelModal({ order, onClose, onDone }: { order: RadiologyOrderDetail; onClose: () => void; onDone: (note: string) => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await window.electronAPI.radiology.cancelOrder(order.id, reason.trim() || undefined);
      if (!r.ok) toast(r.error, 'error'); else onDone(r.note);
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Cancel ${order.order_number}?`} size="sm">
      <div className="space-y-3">
        <p className="text-[13px] text-gray-600 dark:text-slate-300">
          The order is cancelled{order.bill_id ? <> and its unpaid bill <b>{order.bill_number}</b> is cancelled with it. A bill that was already paid is left for you to refund from Billing</> : null}.
        </p>
        <div>
          <label className="label">Reason <span className="text-gray-400 font-normal">(optional)</span></label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Patient left without the scan" />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Keep order</button>
          <button className="btn-danger" disabled={busy} onClick={go}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />} Cancel order</button>
        </div>
      </div>
    </Modal>
  );
}

// =====================================================================
// CATALOGUE & PRICES
// =====================================================================

function CatalogView() {
  const qc = useQueryClient();
  const toast = useToast();
  const [mod, setMod] = useState<string>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<RadiologyTest> | null>(null);

  const { data: tests = [] } = useQuery({ queryKey: ['radiology-tests', false], queryFn: () => window.electronAPI.radiology.listTests(false) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['radiology-tests'] }); };

  const save = useMutation({
    mutationFn: (t: Partial<RadiologyTest>) => window.electronAPI.radiology.upsertTest(t),
    onSuccess: (r) => { if (!r.ok) toast(r.error, 'error'); else { refresh(); setEditing(null); toast('Saved.', 'success'); } },
    onError: (e: any) => toast(e?.message || 'Could not save', 'error'),
  });
  const del = useMutation({
    mutationFn: (id: number) => window.electronAPI.radiology.bulkDeleteTests([id]),
    onSuccess: (r) => {
      if (!r.ok) { toast(r.error, 'error'); return; }
      refresh();
      toast(r.deactivated ? 'This scan has past orders, so it was switched off instead of deleted.' : 'Deleted.', 'info');
    },
  });
  const loadStd = useMutation({
    mutationFn: () => window.electronAPI.radiology.loadStandardCatalog(),
    onSuccess: (r) => { if (!r.ok) toast(r.error, 'error'); else { refresh(); toast(r.added > 0 ? `Added ${r.added} standard scans — set your prices below.` : 'The standard catalogue is already loaded.', 'success'); } },
  });

  const mods = RADIOLOGY_MODALITIES.filter((m) => tests.some((t) => t.modality === m));
  const needle = q.trim().toLowerCase();
  const shown = tests
    .filter((t) => mod === 'all' || t.modality === mod)
    .filter((t) => !needle || t.name.toLowerCase().includes(needle));
  const unpriced = tests.filter((t) => t.is_active && !(t.price > 0)).length;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
          Radiology catalogue <span className="text-xs font-normal text-gray-500">· {tests.length} scans{unpriced ? ` · ${unpriced} not priced` : ''}</span>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary text-xs" onClick={() => loadStd.mutate()} disabled={loadStd.isPending}>
            <Download className="w-3.5 h-3.5" /> Load standard catalogue
          </button>
          <button className="btn-primary text-xs" onClick={() => setEditing({ is_active: 1, price: 0, modality: mod !== 'all' ? (mod as RadiologyModality) : 'xray' })}>
            <Plus className="w-3.5 h-3.5" /> Add scan
          </button>
        </div>
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400">
        Set each scan&rsquo;s price — an order raises its bill from these. A scan left at ₹0 is carried out but never charged. Changing a price here never rewrites orders already placed.
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5 pointer-events-none" />
          <input className="input pl-8 !py-1.5 text-xs w-56" placeholder="Search scans…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {(['all', ...mods] as string[]).map((m) => (
          <button key={m} onClick={() => setMod(m)}
            className={cn('text-[11px] px-2 py-0.5 rounded-full border', mod === m ? 'bg-sky-600 text-white border-sky-600' : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-sky-400')}>
            {m === 'all' ? 'All' : MODALITY_LABEL[m as RadiologyModality]}
          </button>
        ))}
      </div>

      {tests.length === 0 ? (
        <EmptyState icon={Layers} title="No scans yet" description="Load the standard catalogue (about 55 common X-ray, ultrasound, CT and MRI scans), or add your own." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
              <th className="py-2">Scan</th><th className="py-2">Type</th><th className="py-2 w-32">Price (₹)</th><th className="py-2 w-16">Active</th><th className="py-2 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id} className={cn('border-b border-gray-100 dark:border-slate-800', !t.is_active && 'opacity-50')}>
                <td className="py-1.5 font-medium text-gray-900 dark:text-slate-100">{t.name}</td>
                <td className="py-1.5 text-xs text-gray-500">{MODALITY_LABEL[t.modality] ?? t.modality}</td>
                <td className="py-1.5">
                  <input type="number" min={0} className={cn('input !py-1 w-28 text-right', !(t.price > 0) && 'border-amber-300')}
                    key={`${t.id}-${t.price}`} defaultValue={t.price || ''} placeholder="0"
                    onBlur={(e) => { const v = Number(e.target.value || 0); if (v !== Number(t.price)) save.mutate({ ...t, price: v }); }} />
                </td>
                <td className="py-1.5">
                  <input type="checkbox" checked={!!t.is_active} onChange={(e) => save.mutate({ ...t, is_active: e.target.checked ? 1 : 0 })} />
                </td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  <button className="text-gray-400 hover:text-sky-600 mr-2" title="Edit" onClick={() => setEditing(t)}><Pencil className="w-3.5 h-3.5" /></button>
                  <button className="text-gray-400 hover:text-red-600" title="Delete" onClick={() => { if (window.confirm(`Delete “${t.name}” from the catalogue?`)) del.mutate(t.id); }}><Trash2 className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-xs text-gray-500">No scans match.</td></tr>}
          </tbody>
        </table>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit scan' : 'Add scan'} size="md">
        {editing && (
          <div className="space-y-3">
            <div>
              <label className="label">Name *</label>
              <input className="input" autoFocus value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. X-Ray Chest PA View" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Type</label>
                <select className="input" value={editing.modality || 'other'} onChange={(e) => setEditing({ ...editing, modality: e.target.value as RadiologyModality })}>
                  {RADIOLOGY_MODALITIES.map((m) => <option key={m} value={m}>{MODALITY_LABEL[m]}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Price (₹)</label>
                <input type="number" min={0} className="input" value={editing.price ?? 0} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} />
              </div>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
              <input type="checkbox" checked={editing.is_active !== 0} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked ? 1 : 0 })} /> Active (offered when ordering)
            </label>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" disabled={save.isPending || !(editing.name || '').trim()} onClick={() => save.mutate(editing)}>
                {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
