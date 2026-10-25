import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHelp } from '../components/PageHelp';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Receipt, FileText, ListFilter, BedDouble, ShoppingBag, Trash2 } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { PrintHeader } from '../components/print/PrintHeader';
import { EmptyState } from '../components/EmptyState';
import { cn, fmtDate, fmtDateTime, formatINR, todayISO } from '../lib/utils';
import { useLicensedModules } from '../hooks/useLicensedModules';
import { AdmissionBillWorkspace } from '../components/billing/AdmissionBillWorkspace';
import { PatientPortal, PortalSearch } from '../components/billing/PatientPortal';
import { PharmacySaleReceipt } from '../components/pharmacy/PharmacySaleReceipt';
import { CollectPaymentModal } from '../components/billing/CollectPaymentModal';
import { CancelBillModal } from '../components/billing/CancelBillModal';
import { AdminPasswordModal } from '../components/AdminPasswordModal';
import { BillForm, Row, VisitBillModal } from '../components/billing/VisitBillModal';
import { useAuth, canAnyRole } from '../hooks/useAuth';
import { addDaysISO } from '../lib/localDate';
import type { AppointmentWithJoins, BillItem, BillWithJoins } from '../types';

type Tab = 'queue' | 'history' | 'ipd' | 'walkins';

export function Billing() {
  const { has } = useLicensedModules();
  const qc = useQueryClient();
  // Open on IPD when the clinic runs beds — that is where unsettled money sits.
  const [tab, setTab] = useState<Tab>(has('ipd') ? 'ipd' : 'queue');
  // The patient portal: pick a patient and the page shows everything about their billing. (`?patient=12` opens it directly.)
  const [params, setParams] = useSearchParams();
  const [portalId, setPortalId] = useState<number | null>(() => {
    const v = Number(params.get('patient'));
    return Number.isInteger(v) && v > 0 ? v : null;
  });
  const [visitToBill, setVisitToBill] = useState<number | null>(null);
  const [visitInvoice, setVisitInvoice] = useState<BillWithJoins | null>(null);

  const openPortal = (id: number) => { setPortalId(id); setParams({ patient: String(id) }, { replace: true }); };
  const closePortal = () => { setPortalId(null); setParams({}, { replace: true }); };
  const pickTab = (t: Tab) => { setTab(t); if (portalId !== null) closePortal(); };

  if (visitInvoice) {
    return (
      <div className="p-6">
        <Invoice bill={visitInvoice} onNew={() => { setVisitInvoice(null); qc.invalidateQueries({ queryKey: ['billing-portal'] }); }} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-gray-900 inline-flex items-center gap-1.5">Billing<PageHelp page="billing" /></h1>
          <p className="text-xs text-gray-500">Generate and reprint invoices. Pick a patient to see all their billing in one place, or open an admission to edit its charges and take payment.</p>
        </div>
        <div className="flex gap-2 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg">
          {/* IPD leads: an admitted patient's bill is the one that grows every day,
              carries the largest amount and has a deadline (discharge). OPD bills
              are settled at the counter in the same minute they are raised. */}
          {has('ipd') && (
            <TabButton active={portalId === null && tab === 'ipd'} onClick={() => pickTab('ipd')} icon={<BedDouble className="w-3.5 h-3.5" />}>IPD / Admissions</TabButton>
          )}
          <TabButton active={portalId === null && tab === 'queue'} onClick={() => pickTab('queue')} icon={<Receipt className="w-3.5 h-3.5" />}>Billing Queue</TabButton>
          <TabButton active={portalId === null && tab === 'history'} onClick={() => pickTab('history')} icon={<FileText className="w-3.5 h-3.5" />}>Billing History</TabButton>
          {has('pharmacy') && (
            <TabButton active={portalId === null && tab === 'walkins'} onClick={() => pickTab('walkins')} icon={<ShoppingBag className="w-3.5 h-3.5" />}>Pharmacy walk-ins</TabButton>
          )}
        </div>
      </div>

      <div className="max-w-xl"><PortalSearch onPick={(p) => openPortal(p.id)} /></div>

      {portalId !== null ? (
        <PatientPortal key={portalId} patientId={portalId} onBack={closePortal} onBillVisit={setVisitToBill} />
      ) : (
        <>
          {tab === 'queue' && <BillingQueue />}
          {tab === 'history' && <BillingHistory />}
          {tab === 'ipd' && <IpdBilling />}
          {tab === 'walkins' && <PharmacyWalkIns />}
        </>
      )}

      {visitToBill !== null && (
        <VisitBillModal appointmentId={visitToBill} onClose={() => setVisitToBill(null)}
          onGenerated={(b) => { setVisitToBill(null); setVisitInvoice(b); }} />
      )}
    </div>
  );
}


/**
 * Pharmacy counter sales made to a guest — someone who is not a registered patient. (A sale under a patient's name is
 * in that patient's billing and in Billing History instead.) Counted once in Accounts and Analytics like every sale.
 */
function PharmacyWalkIns() {
  const [from, setFrom] = useState(() => addDaysISO(todayISO(), -29));
  const [to, setTo] = useState(todayISO());
  const [q, setQ] = useState('');
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['portal-walkins', from, to, q],
    queryFn: () => window.electronAPI.pharmacy.counterSales({ from, to, scope: 'guest', q: q.trim() || undefined }),
    refetchInterval: 30_000,
  });
  const rows = data?.rows ?? [];
  const t = data?.totals;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-xs text-gray-500">to</span>
        <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        <input className="input max-w-xs text-sm" placeholder="Search guest name or sale number…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ml-auto flex gap-4 text-[11px]">
          <span className="text-gray-500 dark:text-slate-400">Sales <b className="text-gray-900 dark:text-slate-100 tabular-nums">{t?.count ?? 0}</b></span>
          <span className="text-gray-500 dark:text-slate-400">Total <b className="text-emerald-600 tabular-nums">{formatINR(t?.total ?? 0)}</b></span>
          {(t?.by_mode ?? []).map((m) => (
            <span key={m.mode} className="text-gray-500 dark:text-slate-400">{m.mode} <b className="tabular-nums text-gray-800 dark:text-slate-200">{formatINR(m.total)}</b></span>
          ))}
        </div>
      </div>
      <div className="card overflow-x-auto">
        {isLoading ? <div className="p-6 text-xs text-gray-500">Loading…</div> : rows.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="No walk-in sales in this period"
            description="Counter sales made without picking a patient appear here. Sales under a patient's name are in that patient's billing." />
        ) : (
          <table className="w-full text-[12px] min-w-[720px]">
            <thead>
              <tr className="text-left text-[10px] uppercase text-gray-500 border-b dark:border-slate-700">
                <th className="py-2 px-3">Sale</th>
                <th className="py-2 px-3">Date</th>
                <th className="py-2 px-3">Guest</th>
                <th className="py-2 px-3 text-right">Items</th>
                <th className="py-2 px-3 text-right">Total</th>
                <th className="py-2 px-3">Paid by</th>
                <th className="py-2 px-3">Sold by</th>
                <th className="py-2 px-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 dark:border-slate-800/60">
                  <td className="py-2 px-3 font-mono text-[11px]">{r.sale_number}</td>
                  <td className="py-2 px-3 text-gray-600 dark:text-slate-400">{fmtDateTime(r.created_at)}</td>
                  <td className="py-2 px-3">{r.customer_name || <span className="text-gray-400">No name taken</span>}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.item_count}</td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold">{formatINR(r.total)}</td>
                  <td className="py-2 px-3"><span className="badge bg-gray-100 text-gray-700">{r.payment_mode || '—'}</span></td>
                  <td className="py-2 px-3 text-gray-500">{r.sold_by || '—'}</td>
                  <td className="py-2 px-3 text-right">
                    <button className="btn-secondary text-[11px] py-1 px-2 inline-flex items-center gap-1" onClick={() => setReceiptId(r.id)}>
                      <Printer className="w-3 h-3" /> Print
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {receiptId !== null && <PharmacySaleReceipt saleId={receiptId} onClose={() => setReceiptId(null)} />}
    </div>
  );
}

/**
 * IPD / Admissions billing — every admission's bill in one list: currently
 * admitted (running bills, charges still accruing) and discharged. Clicking a row
 * opens the SAME admission bill the IPD screen uses, so there is one bill per
 * patient no matter which door you come through.
 */
function IpdBilling() {
  const [status, setStatus] = useState<'all' | 'admitted' | 'discharged'>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['bill-admissions', status, q],
    queryFn: () => window.electronAPI.billing.admissionList({ status, q: q.trim() || undefined }),
    refetchInterval: 30_000,
  });

  const totals = rows.reduce(
    (a, r) => ({
      billed: a.billed + r.total,
      collected: a.collected + r.paid + r.advance,
      due: a.due + Math.max(0, r.balance),
      // Money owed back — advance collected exceeds the final bill. Kept separate
      // from "outstanding" because it is the opposite direction of cash.
      refund: a.refund + Math.max(0, -r.balance),
    }),
    { billed: 0, collected: 0, due: 0, refund: 0 }
  );

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg">
          {(['all', 'admitted', 'discharged'] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={cn('px-3 py-1.5 rounded-md text-xs font-medium capitalize',
                status === s ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 shadow-sm' : 'text-gray-600 dark:text-slate-400')}>
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>
        <input className="input max-w-xs text-sm" placeholder="Search patient, UHID or IP number…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ml-auto flex gap-4 text-[11px]">
          <span className="text-gray-500 dark:text-slate-400">Billed <b className="text-gray-900 dark:text-slate-100 tabular-nums">{formatINR(totals.billed)}</b></span>
          <span className="text-gray-500 dark:text-slate-400">Received <b className="text-emerald-600 tabular-nums">{formatINR(totals.collected)}</b></span>
          <span className="text-gray-500 dark:text-slate-400">Outstanding <b className="text-red-600 tabular-nums">{formatINR(totals.due)}</b></span>
          {totals.refund > 0.5 && (
            <span className="text-gray-500 dark:text-slate-400">Refunds owed <b className="text-blue-600 tabular-nums">{formatINR(totals.refund)}</b></span>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto mt-4">
        {isLoading ? (
          <div className="p-6 text-xs text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No admissions" description="IPD bills appear here once a patient is admitted." />
        ) : (
          <table className="w-full text-[12px] min-w-[840px]">
            <thead>
              <tr className="text-left text-[10px] uppercase text-gray-500 border-b dark:border-slate-700">
                <th className="py-2 px-3">Patient</th>
                <th className="py-2 px-3">IP No.</th>
                <th className="py-2 px-3">Ward / Bed</th>
                <th className="py-2 px-3 text-right">Days</th>
                <th className="py-2 px-3 text-right">Bill</th>
                <th className="py-2 px-3 text-right">Received</th>
                <th className="py-2 px-3 text-right">Balance</th>
                <th className="py-2 px-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.admission_id}
                  onClick={() => setOpenId(r.admission_id)}
                  className="border-b border-gray-50 dark:border-slate-800/60 hover:bg-blue-50/50 dark:hover:bg-slate-800/50 cursor-pointer">
                  <td className="py-2 px-3">
                    <div className="font-semibold text-gray-900 dark:text-slate-100">{r.patient_name}</div>
                    <div className="text-[10px] text-gray-400">{r.patient_uhid}{r.doctor_name ? ` · ${r.doctor_name}` : ''}</div>
                  </td>
                  <td className="py-2 px-3 font-mono text-[11px]">{r.admission_number}</td>
                  <td className="py-2 px-3">{r.ward || '—'}{r.bed_number ? ` / ${r.bed_number}` : ''}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.days}</td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold">{formatINR(r.total)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-emerald-600">{formatINR(r.paid + r.advance)}</td>
                  <td className={cn('py-2 px-3 text-right tabular-nums font-semibold',
                    r.balance > 0.5 ? 'text-red-600' : r.balance < -0.5 ? 'text-blue-600' : 'text-gray-400')}>
                    {r.balance < -0.5
                      ? <span title="Advance exceeds the bill — this much is owed back to the patient">−{formatINR(Math.abs(r.balance))}</span>
                      : formatINR(Math.max(0, r.balance))}
                  </td>
                  <td className="py-2 px-3">
                    {r.status === 'admitted' ? (
                      r.discharge_status === 'requested'
                        ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Awaiting approval</span>
                        : <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">Admitted</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300">Discharged</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openId !== null && <AdmissionBillWorkspace admissionId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
        active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
      )}
    >
      {icon} {children}
    </button>
  );
}

function BillingQueue() {
  const [activeAppt, setActiveAppt] = useState<AppointmentWithJoins | null>(null);
  const [generatedBill, setGeneratedBill] = useState<BillWithJoins | null>(null);

  const { data: queue = [], isLoading } = useQuery({
    queryKey: ['billing-queue', todayISO()],
    queryFn: () => window.electronAPI.appointments.list({ date: todayISO(), status: 'Send to Billing' }),
    refetchInterval: 15_000,
  });

  if (generatedBill) {
    return <Invoice bill={generatedBill} onNew={() => { setGeneratedBill(null); setActiveAppt(null); }} />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-1 card p-4">
        <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Ready to bill · {queue.length}</div>
        {isLoading ? (
          <div className="text-xs text-gray-500">Loading…</div>
        ) : queue.length === 0 ? (
          <EmptyState icon={Receipt} title="Queue is empty" description="Appointments marked 'Send to Billing' appear here." />
        ) : (
          <ul className="space-y-1">
            {queue.map((a) => (
              <li
                key={a.id}
                onClick={() => setActiveAppt(a)}
                className={cn(
                  'rounded-lg p-3 cursor-pointer border transition',
                  activeAppt?.id === a.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-700">#{a.token_number}</span>
                  <span className="text-[11px] text-gray-500">{a.appointment_time}</span>
                </div>
                <div className="text-sm font-medium text-gray-900 mt-1">{a.patient_name}</div>
                <div className="text-[11px] text-gray-500">{a.doctor_name}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="lg:col-span-2">
        {activeAppt ? (
          <BillForm
            /* Keyed by appointment: without this, patient A's line items and
               discount stay on screen when you click patient B — and are posted
               against B. The per-doctor reset effect did not fire when both
               patients shared a doctor. */
            key={activeAppt.id}
            appointment={activeAppt} onGenerated={setGeneratedBill} />
        ) : (
          <div className="card p-6">
            <EmptyState icon={Receipt} title="Select an appointment" description="Choose a patient from the queue to generate a bill." />
          </div>
        )}
      </div>
    </div>
  );
}


function Invoice({ bill, onNew }: { bill: BillWithJoins; onNew: () => void }) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const items: BillItem[] = JSON.parse(bill.items_json);

  return (
    <div>
      <div className="flex justify-end gap-2 mb-4 no-print">
        <button className="btn-secondary" onClick={onNew}>New Bill</button>
        <button className="btn-primary" onClick={() => window.print()}>
          <Printer className="w-4 h-4" /> Print
        </button>
      </div>

      <div className="print-area card p-6 max-w-2xl mx-auto bg-white">
        <PrintHeader settings={settings ?? {}} accent="#111827" compact />
        <div className="flex items-end justify-between mt-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Invoice</div>
          <div className="text-right">
            <div className="font-bold text-gray-900">{bill.bill_number}</div>
            <div className="text-[11px] text-gray-500">{fmtDateTime(bill.created_at)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mt-5 text-sm">
          <div>
            <div className="text-[10px] uppercase text-gray-500 tracking-wide">Billed To</div>
            <div className="font-medium text-gray-900 mt-1">{bill.patient_name}</div>
            <div className="text-xs text-gray-600">UHID: {bill.patient_uhid}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-gray-500 tracking-wide">Consulting Doctor</div>
            <div className="font-medium text-gray-900 mt-1">{bill.doctor_name || '—'}</div>
          </div>
        </div>

        <table className="w-full mt-6 text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 border-y border-gray-200 text-left text-xs uppercase text-gray-500">
              <th className="py-2 px-2">Description</th>
              <th className="py-2 px-2 w-14 text-right">Qty</th>
              <th className="py-2 px-2 w-24 text-right">Rate</th>
              <th className="py-2 px-2 w-28 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx} className="border-b border-gray-100">
                <td className="py-2 px-2">{it.description}</td>
                <td className="py-2 px-2 text-right">{it.qty}</td>
                <td className="py-2 px-2 text-right">{formatINR(it.rate)}</td>
                <td className="py-2 px-2 text-right">{formatINR(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mt-4">
          <div className="w-64 space-y-1 text-sm">
            <Row label="Subtotal" value={formatINR(bill.subtotal)} />
            <Row label={`Discount${bill.discount_type === 'percent' ? ` (${bill.discount}%)` : ''}`} value={'- ' + formatINR(bill.subtotal - bill.total)} />
            <div className="flex justify-between pt-2 border-t border-gray-300 font-bold text-base">
              <span>Total</span>
              <span>{formatINR(bill.total)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500 pt-1">
              <span>Paid via</span>
              <span>{bill.payment_mode}</span>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-4 border-t border-gray-200 text-center text-[11px] text-gray-400">
          Thank you for visiting {settings?.clinic_name || 'our clinic'}. Get well soon.
        </div>
      </div>
    </div>
  );
}

/** Which department a bill came from — so a Radiology or Lab bill is not mistaken for a consultation. */
function BillKindBadge({ bill }: { bill: any }) {
  const t = bill?.bill_type;
  const map: Record<string, [string, string]> = {
    radiology: ['Radiology', 'bg-sky-100 text-sky-700'],
    lab: ['Lab', 'bg-fuchsia-100 text-fuchsia-700'],
    // A bill typed by hand in Quick Bill never touched stock, cost or profit; stock-based pharmacy sales are not bills at all
    // (they are listed beside the bills, with the green "Pharmacy" badge). The two are labelled differently on purpose.
    pharmacy: ['Hand-typed pharmacy', 'bg-amber-100 text-amber-800'],
    ipd: ['IPD', 'bg-red-100 text-red-700'],
  };
  const hit = map[t] ?? (bill?.bill_kind === 'misc' ? (['Service', 'bg-pink-100 text-pink-700'] as [string, string]) : null);
  if (!hit) return null;
  return <span className={`badge ml-2 align-middle text-[9px] ${hit[1]}`}>{hit[0]}</span>;
}

function BillingHistory() {
  const { has } = useLicensedModules();
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reprint, setReprint] = useState<BillWithJoins | null>(null);
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const [collect, setCollect] = useState<{ saleId: number; label: string; due: number } | null>(null);   // the rest of a credit sale
  const [cancelling, setCancelling] = useState<{ id: number; label: string; received: number } | null>(null);   // a wrongly raised bill
  const [erasingSale, setErasingSale] = useState<{ id: number; number: string; who: string; total: number } | null>(null);   // admin: delete a pharmacy counter sale
  const [erasing, setErasing] = useState<{ id: number; number: string; patient: string; total: number; received: number } | null>(null);   // admin: delete a bill outright
  const qc = useQueryClient();
  const toast = useToast();
  const { user, adminUnlocked } = useAuth();
  const canCancel = canAnyRole(user, ['manager'], adminUnlocked);

  const { data: bills = [], isLoading } = useQuery({
    queryKey: ['bills', q, from, to],
    queryFn: () => window.electronAPI.bills.list({ q, from, to }),
  });
  // Pharmacy counter sales made under a registered patient's name sit alongside that patient's other bills.
  // (Walk-in guest sales are their own tab; ward-dispensed medicines are on the IPD bill already.)
  const { data: sales } = useQuery({
    queryKey: ['bills-pharmacy', q, from, to],
    queryFn: () => window.electronAPI.pharmacy.counterSales({ from: from || undefined, to: to || undefined, scope: 'patient', q: q.trim() || undefined }),
    enabled: has('pharmacy'),
  });
  const merged = useMemo(() => {
    const list: { key: string; at: string; bill?: BillWithJoins; sale?: NonNullable<typeof sales>['rows'][number] }[] = [
      ...bills.map((b) => ({ key: `b${b.id}`, at: b.created_at, bill: b })),
      ...(sales?.rows ?? []).map((x) => ({ key: `s${x.id}`, at: x.created_at, sale: x })),
    ];
    return list.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [bills, sales]);

  if (reprint) {
    return <Invoice bill={reprint} onNew={() => setReprint(null)} />;
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative">
          <ListFilter className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="input pl-9 w-72" placeholder="Search patient or bill no" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="self-center text-xs text-gray-500">to</span>
        <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="text-xs text-gray-500 py-4">Loading…</div>
      ) : merged.length === 0 ? (
        <EmptyState icon={FileText} title="No bills found" />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-gray-200 text-xs uppercase text-gray-500">
              <th className="py-2">Bill No</th>
              <th className="py-2">Patient</th>
              <th className="py-2">Doctor</th>
              <th className="py-2">Date</th>
              <th className="py-2 text-right">Total</th>
              <th className="py-2">Mode</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {merged.map((row) => row.bill ? (
              <tr key={row.key} className="border-b border-gray-100 hover:bg-gray-50">
                <td className={cn('py-2 font-medium text-gray-900', (row.bill as any).status === 'cancelled' && 'line-through text-gray-400')}>
                  {row.bill.bill_number}
                  <BillKindBadge bill={row.bill} />
                  {(row.bill as any).status === 'cancelled' && <span className="badge ml-2 align-middle text-[9px] bg-gray-200 text-gray-600 no-underline">Cancelled</span>}
                </td>
                <td className="py-2">{row.bill.patient_name}<div className="text-[11px] text-gray-500">{row.bill.patient_uhid || (row.bill.patient_id ? '' : 'walk-in')}</div></td>
                <td className="py-2 text-gray-600">{row.bill.doctor_name || '—'}</td>
                <td className="py-2 text-gray-600">{fmtDate(row.bill.created_at)}</td>
                <td className="py-2 text-right font-semibold">{formatINR(row.bill.total)}</td>
                <td className="py-2"><span className="badge bg-gray-100 text-gray-700">{row.bill.payment_mode}</span></td>
                <td className="py-2 text-right whitespace-nowrap">
                  {canCancel && (row.bill as any).status !== 'cancelled' && !(row.bill as any).admission_id && (row.bill as any).bill_type !== 'ipd' && (
                    <button className="btn-ghost text-xs text-red-600"
                      title="Cancel this bill (wrong patient, never happened…) — any money received is recorded as a refund"
                      onClick={() => setCancelling({ id: row.bill!.id, label: `${row.bill!.bill_number} · ${row.bill!.patient_name}`, received: Math.max(0, Number((row.bill as any).amount_paid) || 0) })}>
                      Cancel
                    </button>
                  )}
                  <button className="btn-ghost text-xs" onClick={() => setReprint(row.bill!)}>
                    <Printer className="w-3.5 h-3.5" /> Reprint
                  </button>
                  {adminUnlocked && !(row.bill as any).admission_id && (row.bill as any).bill_type !== 'ipd' && (
                    <button className="btn-ghost text-xs text-red-600 hover:text-red-700"
                      title="Delete this bill completely (admin password) — unlike Cancel, nothing is kept on the books"
                      onClick={() => setErasing({ id: row.bill!.id, number: row.bill!.bill_number, patient: row.bill!.patient_name || 'walk-in', total: Number(row.bill!.total) || 0, received: Math.max(0, Number((row.bill as any).amount_paid) || 0) })}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              <tr key={row.key} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 font-medium text-gray-900">
                  {row.sale!.sale_number}
                  <span className="badge ml-2 align-middle text-[9px] bg-lime-100 text-lime-700">Pharmacy</span>
                </td>
                <td className="py-2">{row.sale!.patient_name}<div className="text-[11px] text-gray-500">{row.sale!.patient_uhid}</div></td>
                <td className="py-2 text-gray-600">—</td>
                <td className="py-2 text-gray-600">{fmtDate(row.sale!.created_at)}</td>
                <td className="py-2 text-right font-semibold">{formatINR(row.sale!.total)}</td>
                <td className="py-2">
                  <span className="badge bg-gray-100 text-gray-700">{row.sale!.payment_mode}</span>
                  {row.sale!.due > 0.004 && (
                    <div className="mt-0.5"><span className="badge bg-amber-100 text-amber-800">On credit · {formatINR(row.sale!.due)} due</span></div>
                  )}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {row.sale!.due > 0.004 && (
                    <button className="btn-primary text-xs py-1 px-2 mr-1"
                      onClick={() => setCollect({ saleId: row.sale!.id, label: `${row.sale!.patient_name || 'Pharmacy'} ${row.sale!.sale_number}`, due: row.sale!.due })}>
                      Collect
                    </button>
                  )}
                  <button className="btn-ghost text-xs" onClick={() => setReceiptId(row.sale!.id)}>
                    <Printer className="w-3.5 h-3.5" /> Reprint
                  </button>
                  {adminUnlocked && (
                    <button className="btn-ghost text-xs text-red-600 hover:text-red-700"
                      title="Delete this pharmacy sale (admin password) — the medicines go back on the shelf"
                      onClick={() => setErasingSale({ id: row.sale!.id, number: String(row.sale!.sale_number), who: String(row.sale!.patient_name || 'walk-in'), total: Number(row.sale!.total) || 0 })}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {receiptId !== null && <PharmacySaleReceipt saleId={receiptId} onClose={() => setReceiptId(null)} />}
      {collect && (
        <CollectPaymentModal target={{ saleId: collect.saleId }} label={collect.label} due={collect.due}
          onClose={() => setCollect(null)}
          onDone={() => {
            setCollect(null);
            for (const k of ['bills-pharmacy', 'pharmacy-sales', 'billing-portal', 'finance', 'receivables', 'portal-walkins']) qc.invalidateQueries({ queryKey: [k] });
          }} />
      )}
      {erasingSale && (
        <AdminPasswordModal
          title="Delete this pharmacy sale?" confirmLabel="Delete this sale" onClose={() => setErasingSale(null)}
          onConfirm={async (pw) => {
            const r = await window.electronAPI.admin.deleteSale(erasingSale.id, pw);
            if (r.ok) {
              toast(`Sale ${erasingSale.number} deleted`);
              for (const k of ['bills-pharmacy', 'pharmacy-sales', 'billing-portal', 'bills', 'finance', 'finance-summary', 'receivables', 'portal-walkins', 'pharmacy-clinic-stock', 'pharmacy-batches', 'pharmacy-drugs']) qc.invalidateQueries({ queryKey: [k] });
            }
            return r;
          }}
        >
          <div>Permanently delete sale <span className="font-bold">{erasingSale.number}</span> for <span className="font-bold">{erasingSale.who}</span> — {formatINR(erasingSale.total)}?</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">
            Erases the sale, its lines, its payments and its dispensing-register rows (for a Schedule H medicine that is a legal record). The medicines go back on the shelf.
            A copy of what was erased is kept in the audit log. Sales charged to an in-patient's bill cannot be deleted here.
          </div>
        </AdminPasswordModal>
      )}
      {erasing && (
        <AdminPasswordModal
          title="Delete this bill?" confirmLabel="Delete this bill" onClose={() => setErasing(null)}
          onConfirm={async (pw) => {
            const r = await window.electronAPI.admin.deleteBill(erasing.id, pw);
            if (r.ok) {
              toast(`Bill ${erasing.number} deleted`);
              for (const k of ['bills', 'billing-portal', 'finance', 'finance-summary', 'receivables', 'billing-queue', 'lab-orders', 'appointments', 'patient-log', 'stats']) qc.invalidateQueries({ queryKey: [k] });
            }
            return r;
          }}
        >
          <div>Permanently delete bill <span className="font-bold">{erasing.number}</span> for <span className="font-bold">{erasing.patient}</span> — {formatINR(erasing.total)}?</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">
            The bill, its lines and its payment records are erased{erasing.received > 0.004 ? <> — including <b>{formatINR(erasing.received)} received</b>, which will disappear from your accounts</> : null}.
            If money was taken and has to go back to the patient, use <b>Cancel</b> instead: it keeps the bill and records the refund. A copy of what was erased is kept in the audit log.
          </div>
        </AdminPasswordModal>
      )}
      {cancelling && (
        <CancelBillModal billId={cancelling.id} label={cancelling.label} received={cancelling.received}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            for (const k of ['bills', 'billing-portal', 'finance', 'receivables', 'billing-queue']) qc.invalidateQueries({ queryKey: [k] });
          }} />
      )}
    </div>
  );
}
