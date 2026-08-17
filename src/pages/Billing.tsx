import { useEffect, useMemo, useState } from 'react';
import { PageHelp } from '../components/PageHelp';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Printer, Receipt, FileText, ListFilter, BedDouble } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { cn, fmtDate, fmtDateTime, formatINR, todayISO } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import { useLicensedModules } from '../hooks/useLicensedModules';
import { AdmissionBillWorkspace } from '../components/billing/AdmissionBillWorkspace';
import type { AppointmentWithJoins, BillItem, BillWithJoins, PaymentMode } from '../types';

type Tab = 'queue' | 'history' | 'ipd';

export function Billing() {
  const { has } = useLicensedModules();
  // Open on IPD when the clinic runs beds — that is where unsettled money sits.
  const [tab, setTab] = useState<Tab>(has('ipd') ? 'ipd' : 'queue');

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900 inline-flex items-center gap-1.5">Billing<PageHelp page="billing" /></h1>
          <p className="text-xs text-gray-500">Generate and reprint invoices. Click an admission to edit its charges, discount it and take payment.</p>
        </div>
        <div className="flex gap-2 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg">
          {/* IPD leads: an admitted patient's bill is the one that grows every day,
              carries the largest amount and has a deadline (discharge). OPD bills
              are settled at the counter in the same minute they are raised. */}
          {has('ipd') && (
            <TabButton active={tab === 'ipd'} onClick={() => setTab('ipd')} icon={<BedDouble className="w-3.5 h-3.5" />}>IPD / Admissions</TabButton>
          )}
          <TabButton active={tab === 'queue'} onClick={() => setTab('queue')} icon={<Receipt className="w-3.5 h-3.5" />}>Billing Queue</TabButton>
          <TabButton active={tab === 'history'} onClick={() => setTab('history')} icon={<FileText className="w-3.5 h-3.5" />}>Billing History</TabButton>
        </div>
      </div>

      {tab === 'queue' && <BillingQueue />}
      {tab === 'history' && <BillingHistory />}
      {tab === 'ipd' && <IpdBilling />}
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

function BillForm({ appointment, onGenerated }: { appointment: AppointmentWithJoins; onGenerated: (b: BillWithJoins) => void }) {
  const toast = useToast();
  const qc = useQueryClient();

  const { data: doctor } = useQuery({
    queryKey: ['doctors', appointment.doctor_id],
    queryFn: () => window.electronAPI.doctors.get(appointment.doctor_id),
  });

  const [items, setItems] = useState<BillItem[]>([{ description: 'Consultation Fee', qty: 1, rate: 500, amount: 500 }]);
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<'flat' | 'percent'>('flat');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');

  useEffect(() => {
    if (doctor) {
      setItems([{ description: 'Consultation Fee', qty: 1, rate: doctor.default_fee, amount: doctor.default_fee }]);
    }
  }, [doctor?.id]);

  const subtotal = useMemo(() => items.reduce((s, it) => s + Number(it.amount || 0), 0), [items]);
  const discountValue = discountType === 'percent' ? (subtotal * discount) / 100 : discount;
  const total = Math.max(0, subtotal - discountValue);

  const setItem = (idx: number, patch: Partial<BillItem>) => {
    setItems((arr) => {
      const next = [...arr];
      next[idx] = { ...next[idx], ...patch };
      next[idx].amount = Number(next[idx].qty || 0) * Number(next[idx].rate || 0);
      return next;
    });
  };

  const create = useMutation({
    mutationFn: () =>
      window.electronAPI.bills.create({
        appointment_id: appointment.id,
        patient_id: appointment.patient_id,
        items,
        discount,
        discount_type: discountType,
        payment_mode: paymentMode,
      }),
    onSuccess: (bill) => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['billing-queue'] });
      qc.invalidateQueries({ queryKey: ['bills'] });
      toast('Bill generated');
      onGenerated(bill);
    },
    onError: (e: any) => toast(e.message || 'Failed', 'error'),
  });

  return (
    <div className="card p-6">
      <div className="border-b border-gray-200 pb-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500">Token #{appointment.token_number} · {fmtDate(appointment.appointment_date)} {appointment.appointment_time}</div>
            <h2 className="text-base font-bold text-gray-900 mt-1">{appointment.patient_name}</h2>
            <div className="text-xs text-gray-500">{appointment.patient_uhid} · {appointment.patient_phone}</div>
          </div>
          <div className="text-right text-xs text-gray-600">
            <div>{appointment.doctor_name}</div>
            <div className="text-[11px] text-gray-400">{appointment.doctor_specialty}</div>
          </div>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-gray-200 text-xs uppercase text-gray-500">
            <th className="py-2">Description</th>
            <th className="py-2 w-16 text-right">Qty</th>
            <th className="py-2 w-28 text-right">Rate</th>
            <th className="py-2 w-28 text-right">Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => (
            <tr key={idx} className="border-b border-gray-100">
              <td className="py-1.5 pr-2">
                <input className="input" value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} />
              </td>
              <td className="py-1.5 px-1">
                <input type="number" className="input text-right" value={it.qty} onChange={(e) => setItem(idx, { qty: Number(e.target.value) })} />
              </td>
              <td className="py-1.5 px-1">
                <input type="number" className="input text-right" value={it.rate} onChange={(e) => setItem(idx, { rate: Number(e.target.value) })} />
              </td>
              <td className="py-1.5 px-1 text-right font-medium">{formatINR(it.amount)}</td>
              <td className="py-1.5 pl-2 text-right">
                {items.length > 1 && (
                  <button onClick={() => setItems(items.filter((_, i) => i !== idx))} className="text-red-500 hover:text-red-700">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="btn-ghost text-xs mt-2"
        onClick={() => setItems([...items, { description: '', qty: 1, rate: 0, amount: 0 }])}
      >
        <Plus className="w-3.5 h-3.5" /> Add line
      </button>

      <div className="mt-6 grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <div>
            <label className="label">Payment Mode</label>
            <div className="flex gap-2">
              {(['Cash', 'Card', 'UPI'] as PaymentMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMode(m)}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-md border',
                    paymentMode === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 text-gray-700'
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2 bg-gray-50 border border-gray-200 rounded-lg p-4">
          <Row label="Subtotal" value={formatINR(subtotal)} />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">Discount</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                className="input w-20 text-right py-1"
                value={discount}
                onChange={(e) => setDiscount(Number(e.target.value))}
              />
              <select
                className="input w-16 py-1"
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as any)}
              >
                <option value="flat">₹</option>
                <option value="percent">%</option>
              </select>
            </div>
          </div>
          <Row label="Discount value" value={'- ' + formatINR(discountValue)} />
          <div className="border-t border-gray-300 pt-2 flex items-center justify-between">
            <span className="text-sm font-bold">Total</span>
            <span className="text-lg font-bold text-blue-700">{formatINR(total)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-6">
        <button className="btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
          <Receipt className="w-4 h-4" /> {create.isPending ? 'Generating…' : 'Generate Bill'}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs text-gray-600">
      <span>{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
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

      <div className="print-area card p-8 max-w-2xl mx-auto bg-white">
        <div className="flex items-center justify-between pb-4 border-b-2 border-gray-900">
          <div className="flex items-center gap-3">
            {settings?.clinic_logo ? (
              <img src={settings.clinic_logo} alt="Logo" className="w-14 h-14 object-contain rounded-lg" style={{ background: '#ffffff' }} />
            ) : (
              <div className="w-14 h-14 rounded-lg bg-blue-600 text-white flex items-center justify-center text-2xl font-bold">M</div>
            )}
            <div>
              <div className="text-lg font-bold text-gray-900">{settings?.clinic_name || 'CureDesk HMS'}</div>
              <div className="text-[11px] text-gray-500">{settings?.clinic_address}</div>
              {settings?.clinic_phone && <div className="text-[11px] text-gray-500">Ph: {settings.clinic_phone}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">INVOICE</div>
            <div className="font-bold text-gray-900">{bill.bill_number}</div>
            <div className="text-[11px] text-gray-500 mt-1">{fmtDateTime(bill.created_at)}</div>
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

function BillingHistory() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reprint, setReprint] = useState<BillWithJoins | null>(null);

  const { data: bills = [], isLoading } = useQuery({
    queryKey: ['bills', q, from, to],
    queryFn: () => window.electronAPI.bills.list({ q, from, to }),
  });

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
      ) : bills.length === 0 ? (
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
            {bills.map((b) => (
              <tr key={b.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 font-medium text-gray-900">{b.bill_number}</td>
                <td className="py-2">{b.patient_name}<div className="text-[11px] text-gray-500">{b.patient_uhid}</div></td>
                <td className="py-2 text-gray-600">{b.doctor_name || '—'}</td>
                <td className="py-2 text-gray-600">{fmtDate(b.created_at)}</td>
                <td className="py-2 text-right font-semibold">{formatINR(b.total)}</td>
                <td className="py-2"><span className="badge bg-gray-100 text-gray-700">{b.payment_mode}</span></td>
                <td className="py-2 text-right">
                  <button className="btn-ghost text-xs" onClick={() => setReprint(b)}>
                    <Printer className="w-3.5 h-3.5" /> Reprint
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
