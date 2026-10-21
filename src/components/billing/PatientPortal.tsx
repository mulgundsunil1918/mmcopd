/**
 * Billing patient portal — pick a patient and see everything about their money in one place: what has been billed
 * and paid (every department, counter pharmacy sales included), what is still to collect, and what could be billed
 * now (a visit with no bill, a lab or radiology order with no bill, a prescription not yet dispensed).
 *
 * All figures come from one function in the main process (main/billing-portal.ts) — the same rule Accounts and
 * Analytics use for "outstanding" — so this screen can never disagree with them.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, BedDouble, FlaskConical, Pill, Plus, Printer, Receipt, ScanLine, Search, Stethoscope, Wallet,
} from 'lucide-react';
import { EmptyState } from '../EmptyState';
import { BillPrint } from './BillPrint';
import { QuickBillModal } from './QuickBillModal';
import { AdmissionBillWorkspace } from './AdmissionBillWorkspace';
import { PharmacySaleReceipt } from '../pharmacy/PharmacySaleReceipt';
import { CollectPaymentModal, type CollectTarget } from './CollectPaymentModal';
import { useToast } from '../../hooks/useToast';
import { useLicensedModules } from '../../hooks/useLicensedModules';
import { cn, fmtDate, fmtDateTime, formatINR } from '../../lib/utils';
import type { PortalKind, PortalLine, PortalStatus, PortalTodo } from '../../lib/billingPortal';

const KIND: Record<PortalKind, { label: string; badge: string }> = {
  consultation: { label: 'Consultation', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200' },
  lab: { label: 'Lab', badge: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-200' },
  radiology: { label: 'Radiology', badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200' },
  pharmacy: { label: 'Pharmacy', badge: 'bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-200' },
  // A pharmacy bill typed by hand never touched stock, cost or profit, so it is labelled differently everywhere.
  pharmacy_manual: { label: 'Hand-typed pharmacy', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  ipd: { label: 'IPD', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200' },
  service: { label: 'Service', badge: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-200' },
};

const STATUS: Record<PortalStatus, { label: string; cls: string }> = {
  paid: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' },
  part_paid: { label: 'Part-paid', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  unpaid: { label: 'Unpaid', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400' },
};

const TODO_ICON: Record<PortalTodo['kind'], typeof Receipt> = {
  bill_due: Wallet, ipd_running: BedDouble, consultation_unbilled: Stethoscope,
  lab_unbilled: FlaskConical, radiology_unbilled: ScanLine, rx_pending: Pill,
};

/* ============================ patient search ============================ */

export function PortalSearch({ onPick, autoFocus }: { onPick: (p: { id: number }) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const { data: results = [], isFetching } = useQuery({
    queryKey: ['portal-patient-search', q],
    queryFn: () => window.electronAPI.patients.search(q.trim()),
    enabled: q.trim().length >= 2,
  });
  const shown = results.slice(0, 8);
  return (
    <div className="relative">
      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        className="input pl-9"
        autoFocus={autoFocus}
        placeholder="Find a patient — name, phone or UHID — to see all their billing"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { onPick(shown[0]); setQ(''); } }}
      />
      {q.trim().length >= 2 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-auto rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg divide-y divide-gray-100 dark:divide-slate-800">
          {shown.length === 0 ? (
            <li className="px-3 py-2 text-xs text-gray-500">{isFetching ? 'Searching…' : 'No patient found.'}</li>
          ) : shown.map((p: any) => (
            <li key={p.id} className="px-3 py-2 cursor-pointer hover:bg-blue-50/60 dark:hover:bg-slate-800 text-sm"
              onClick={() => { onPick(p); setQ(''); }}>
              <div className="font-medium text-gray-900 dark:text-slate-100">{p.first_name} {p.last_name}</div>
              <div className="text-[11px] text-gray-500 dark:text-slate-400">{p.uhid}{p.phone ? ` · ${p.phone}` : ''}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ============================ the portal ============================ */

export function PatientPortal({ patientId, onBack, onBillVisit }: {
  patientId: number;
  onBack: () => void;
  /** Open the consultation bill form for a visit (the form lives with the Billing queue). */
  onBillVisit: (appointmentId: number) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { has } = useLicensedModules();
  const [kindFilter, setKindFilter] = useState<'all' | PortalKind>('all');
  const [onlyDue, setOnlyDue] = useState(false);
  const [collect, setCollect] = useState<{ target: CollectTarget; label: string; due: number } | null>(null);
  const [printBill, setPrintBill] = useState<number | null>(null);
  const [printSale, setPrintSale] = useState<number | null>(null);
  const [openAdmission, setOpenAdmission] = useState<number | null>(null);
  const [quick, setQuick] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['billing-portal', patientId],
    queryFn: () => window.electronAPI.billing.patientPortal(patientId),
    refetchInterval: 20_000,
  });

  const refresh = () => {
    for (const k of ['billing-portal', 'bills', 'billing-queue', 'bill-admissions', 'pharmacy-sales', 'portal-walkins', 'finance', 'receivables']) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  };

  const billOrder = useMutation({
    mutationFn: async (t: PortalTodo) => {
      const kind = t.kind === 'lab_unbilled' ? 'lab' : 'radiology';
      let r = await window.electronAPI.billing.createOrderBill(kind, t.order_id!);
      if (!r.ok && r.needs_confirm) {
        if (!window.confirm(`${r.error}\n\nBill these tests anyway?`)) return null;
        r = await window.electronAPI.billing.createOrderBill(kind, t.order_id!, { force: true });
      }
      return r;
    },
    onSuccess: (r) => {
      if (!r) return;
      if (r.ok) { toast(`Bill ${r.bill_number} raised — ${formatINR(r.total)}`); refresh(); }
      else toast(r.error, 'error');
    },
    onError: (e: any) => toast(e?.message || 'Could not raise the bill', 'error'),
    onSettled: () => setBusyKey(null),
  });

  if (isLoading) return <div className="card p-8 text-center text-sm text-gray-500">Loading the patient's billing…</div>;
  if (error || !data) {
    return (
      <div className="card p-6">
        <div className="text-sm text-red-600 mb-3">{(error as any)?.message || 'Could not load this patient\'s billing.'}</div>
        <button className="btn-secondary" onClick={onBack}><ArrowLeft className="w-4 h-4" /> Back to Billing</button>
      </div>
    );
  }

  const { patient, summary, todo, history } = data;
  const counts = history.reduce<Record<string, number>>((m, h) => { m[h.kind] = (m[h.kind] || 0) + 1; return m; }, {});
  const rows = history.filter((h) => (kindFilter === 'all' || h.kind === kindFilter) && (!onlyDue || h.due > 0));
  const age = patient.dob ? Math.max(0, Math.floor((Date.now() - new Date(patient.dob).getTime()) / 31_557_600_000)) : null;

  const runTodo = (t: PortalTodo) => {
    switch (t.kind) {
      case 'bill_due':
        setCollect({ target: t.sale_id ? { saleId: t.sale_id } : { billId: t.bill_id! }, label: t.title, due: t.due! });
        break;
      case 'ipd_running': setOpenAdmission(t.admission_id!); break;
      case 'consultation_unbilled': onBillVisit(t.appointment_id!); break;
      case 'lab_unbilled': case 'radiology_unbilled': setBusyKey(t.key); billOrder.mutate(t); break;
      case 'rx_pending': navigate('/pharmacy'); break;
    }
  };
  const todoAction = (t: PortalTodo): string => {
    switch (t.kind) {
      case 'bill_due': return 'Collect';
      case 'ipd_running': return 'Open bill';
      case 'consultation_unbilled': case 'lab_unbilled': case 'radiology_unbilled': return 'Bill now';
      case 'rx_pending': return 'Open Pharmacy';
    }
  };

  const Tile = ({ label, value, tone, sub }: { label: string; value: number; tone: string; sub?: string }) => (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/60 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400 font-semibold">{label}</div>
      <div className={cn('text-xl font-bold tabular-nums mt-0.5', tone)}>{formatINR(value)}</div>
      {sub && <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* ===== who ===== */}
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <button className="btn-ghost text-xs" onClick={onBack} title="Back to the billing lists"><ArrowLeft className="w-4 h-4" /> All billing</button>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-slate-100">{patient.name}</h2>
              <div className="text-xs text-gray-500 dark:text-slate-400">
                {patient.uhid}
                {patient.phone ? ` · ${patient.phone}` : ''}
                {age !== null ? ` · ${age} yrs` : ''}
                {patient.gender ? ` · ${patient.gender}` : ''}
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn-primary text-xs" onClick={() => setQuick('opd_consult')}><Plus className="w-3.5 h-3.5" /> New bill</button>
            {has('pharmacy') && (
              <button className="btn-secondary text-xs" title="Opens the Pharmacy counter with this patient already chosen, so the sale goes on their bill"
                onClick={() => navigate('/pharmacy', { state: { counterPatient: { id: patient.id, uhid: patient.uhid, first_name: patient.name.split(' ')[0] ?? '', last_name: patient.name.split(' ').slice(1).join(' '), phone: patient.phone ?? '' } } })}>
                <Pill className="w-3.5 h-3.5" /> Sell medicines
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <Tile label="Billed" value={summary.billed} tone="text-gray-900 dark:text-slate-100" sub={`${summary.bills} bill${summary.bills === 1 ? '' : 's'}${summary.pharmacy_sales ? ` · ${summary.pharmacy_sales} pharmacy sale${summary.pharmacy_sales === 1 ? '' : 's'}` : ''}`} />
          <Tile label="Received" value={summary.received} tone="text-emerald-600" />
          <Tile label="Still to collect" value={summary.outstanding} tone={summary.outstanding > 0 ? 'text-red-600' : 'text-gray-400'} />
          <Tile label="Advance held" value={summary.credit_held} tone={summary.credit_held > 0 ? 'text-blue-600' : 'text-gray-400'}
            sub={summary.credit_held > 0 ? 'unused deposit — may be owed back' : undefined} />
        </div>
      </div>

      {/* ===== what can be done now ===== */}
      <div className="card p-4">
        <div className="text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-2">
          To collect or bill now{todo.length ? ` · ${todo.length}` : ''}
        </div>
        {todo.length === 0 ? (
          <div className="text-[13px] text-gray-500 dark:text-slate-400 py-2">
            Nothing is waiting — every bill for this patient is paid, and there is no visit, lab order or scan left without a bill.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {todo.map((t) => {
              const Icon = TODO_ICON[t.kind];
              const unavailable = (t.kind === 'rx_pending' && !has('pharmacy'))
                || ((t.kind === 'lab_unbilled' || t.kind === 'radiology_unbilled') && !has('lab'));
              return (
                <li key={t.key} className="flex items-center gap-3 py-2.5">
                  <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                    t.due ? 'bg-red-50 text-red-600 dark:bg-red-900/30' : 'bg-blue-50 text-blue-600 dark:bg-blue-900/30')}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-gray-900 dark:text-slate-100 truncate">{t.title}</div>
                    <div className="text-[11px] text-gray-500 dark:text-slate-400 truncate">
                      {t.date_is_local ? fmtDate(t.date) : fmtDateTime(t.date)}{t.detail ? ` · ${t.detail}` : ''}
                    </div>
                  </div>
                  {(t.due ?? t.amount) != null && (
                    <div className={cn('text-sm font-semibold tabular-nums', t.due ? 'text-red-600' : 'text-gray-700 dark:text-slate-200')}>
                      {formatINR((t.due ?? t.amount) as number)}
                    </div>
                  )}
                  <button className={cn(t.due ? 'btn-primary' : 'btn-secondary', 'text-xs whitespace-nowrap')}
                    disabled={unavailable || busyKey === t.key} onClick={() => runTodo(t)}>
                    {busyKey === t.key ? 'Working…' : todoAction(t)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ===== everything already billed ===== */}
      <div className="card p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div className="text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide">Everything billed · {history.length}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg">
              {(['all', ...(Object.keys(KIND) as PortalKind[]).filter((k) => counts[k])] as ('all' | PortalKind)[]).map((k) => (
                <button key={k} onClick={() => setKindFilter(k)}
                  className={cn('px-2.5 py-1 rounded-md text-[11px] font-medium',
                    kindFilter === k ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 shadow-sm' : 'text-gray-600 dark:text-slate-400')}>
                  {k === 'all' ? 'All' : `${KIND[k].label} ${counts[k]}`}
                </button>
              ))}
            </div>
            <label className="text-[11px] text-gray-600 dark:text-slate-400 inline-flex items-center gap-1">
              <input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} /> Only unpaid
            </label>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={Receipt} title={history.length ? 'Nothing matches' : 'No bills yet'}
            description={history.length ? 'Change the filter above.' : 'Bills, lab and radiology charges, in-patient bills and pharmacy sales for this patient will appear here.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[760px]">
              <thead>
                <tr className="text-left text-[10px] uppercase text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="py-2">Date</th>
                  <th className="py-2">Bill</th>
                  <th className="py-2">Details</th>
                  <th className="py-2 text-right">Total</th>
                  <th className="py-2 text-right">Received</th>
                  <th className="py-2 text-right">Due</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h: PortalLine) => (
                  <tr key={h.key} className="border-b border-gray-50 dark:border-slate-800/60 align-top">
                    <td className="py-2 pr-2 whitespace-nowrap text-gray-600 dark:text-slate-400">{fmtDateTime(h.date)}</td>
                    <td className="py-2 pr-2">
                      <div className="font-mono text-[11px] text-gray-900 dark:text-slate-100">{h.number}</div>
                      <span className={cn('badge text-[9px]', KIND[h.kind].badge)}>{KIND[h.kind].label}{h.counter_sale ? ' · counter' : ''}</span>
                    </td>
                    <td className="py-2 pr-2 max-w-[260px]">
                      <div className="text-gray-800 dark:text-slate-200">{h.title}</div>
                      {h.detail && <div className="text-[11px] text-gray-500 dark:text-slate-400 truncate" title={h.detail}>{h.detail}</div>}
                      {h.doctor_name && <div className="text-[11px] text-gray-400">{h.doctor_name}</div>}
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold">{formatINR(h.total)}</td>
                    <td className="py-2 text-right tabular-nums text-emerald-600">{formatINR(h.paid + h.advance)}</td>
                    <td className={cn('py-2 text-right tabular-nums font-semibold', h.due > 0 ? 'text-red-600' : 'text-gray-400')}>{h.due > 0 ? formatINR(h.due) : '—'}</td>
                    <td className="py-2 pl-2"><span className={cn('badge text-[10px]', STATUS[h.status].cls)}>{STATUS[h.status].label}</span></td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {h.due > 0 && (h.bill_id || h.sale_id) && (
                        h.admission_id
                          ? <button className="btn-secondary text-[11px] py-1 px-2 mr-1" onClick={() => setOpenAdmission(h.admission_id!)}>Open bill</button>
                          : <button className="btn-primary text-[11px] py-1 px-2 mr-1"
                              onClick={() => setCollect({ target: h.sale_id ? { saleId: h.sale_id } : { billId: h.bill_id! }, label: `${h.title} ${h.number}`, due: h.due })}>Collect</button>
                      )}
                      <button className="btn-secondary text-[11px] py-1 px-2 inline-flex items-center gap-1"
                        title={`Print ${h.number}`}
                        onClick={() => (h.sale_id ? setPrintSale(h.sale_id) : setPrintBill(h.bill_id))}>
                        <Printer className="w-3 h-3" /> Print
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {collect && (
        <CollectPaymentModal target={collect.target} label={collect.label} due={collect.due}
          onClose={() => setCollect(null)} onDone={() => { setCollect(null); refresh(); }} />
      )}
      {printBill !== null && <BillPrint billId={printBill} onClose={() => setPrintBill(null)} />}
      {printSale !== null && <PharmacySaleReceipt saleId={printSale} onClose={() => setPrintSale(null)} />}
      {openAdmission !== null && (
        <AdmissionBillWorkspace admissionId={openAdmission} onClose={() => { setOpenAdmission(null); refresh(); }} />
      )}
      {quick && (
        <QuickBillModal presetType={quick}
          presetPatient={{ id: patient.id, first_name: patient.name.split(' ')[0] ?? '', last_name: patient.name.split(' ').slice(1).join(' '), uhid: patient.uhid, phone: patient.phone ?? '' }}
          onClose={() => { setQuick(null); refresh(); }} />
      )}
    </div>
  );
}
