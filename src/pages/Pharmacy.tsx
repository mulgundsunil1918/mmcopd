import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { PageHelp } from '../components/PageHelp';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Pill, Plus, Search, AlertTriangle, Package, Clipboard, ShoppingCart, Trash2, Pencil,
  Layers, Truck, FileText, X, Store, FileSpreadsheet, Percent,
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { cn, fmtDate, fmtDateTime, formatINR, newRef, refFor, todayISO } from '../lib/utils';
import type { Drug, DrugMaster, DrugSchedule, Wholesaler } from '../types';
import { NewPurchaseModal } from '../components/pharmacy/PurchaseBillModal';
import { ImportBillModal } from '../components/pharmacy/billImport/ImportBillModal';
import { GstSwitch } from '../components/pharmacy/GstSwitch';
import { SetGstModal } from '../components/pharmacy/SetGstModal';
import { WAITING_KEY } from '../components/pharmacy/billImport/WaitingList';
import { PurchaseDetailModal } from '../components/pharmacy/PurchaseDetailModal';
import { ClinicStockTab, clinicCounts, useClinicStock, type ClinicFilter } from '../components/pharmacy/ClinicStockTab';
import { WholesalersTab } from '../components/pharmacy/WholesalersTab';
import { ReportsTab } from '../components/pharmacy/ReportsTab';
import { DrugEditModal, DRUG_QUERY_KEYS } from '../components/pharmacy/DrugEditModal';
import { ScheduleBadge, daysAgo } from '../components/pharmacy/shared';
import { BrandChoice, drugForRx } from '../components/pharmacy/BrandChoice';
import { isGenericNamed, otherBrandsInStock, siblingsOf } from '../lib/medicineGroups';
import { useCounterDiscountLimit } from '../components/pharmacy/useDiscountLimit';
import { PharmacySaleReceipt } from '../components/pharmacy/PharmacySaleReceipt';
import { AdminPasswordModal } from '../components/AdminPasswordModal';
import { CollectPaymentModal } from '../components/billing/CollectPaymentModal';
import {
  SalePaymentChoice, initialPayChoice, payDoneText, payFields, payProblem, usePayOptions, type PayChoice,
} from '../components/pharmacy/SalePaymentChoice';
import { DiscountRow, useSaleDiscount } from '../components/pharmacy/SaleDiscount';
import { Printer } from 'lucide-react';

type Tab = 'dispense' | 'druglist' | 'clinic' | 'purchases' | 'sales' | 'wholesalers' | 'reports';

/**
 * The rate a sale line starts at: what the batch FEFO will hand out NEXT is priced at (its selling
 * price, else its own MRP) — not the drug's default MRP, which goes stale as soon as a new batch
 * arrives with a different printed price. The rate stays editable.
 */
const defaultRate = (d: any): number => Number(d.next_selling_price ?? d.next_mrp ?? d.mrp ?? d.default_mrp ?? 0);

/**
 * "Add another brand": a new drug that starts as a copy of this one's composition (ingredient, strength, form, schedule, GST…) so it sits with the
 * same medicine automatically. The name, MRP and barcode are the new brand's own, so they start empty.
 */
const anotherBrandOf = (d: DrugMaster): Partial<DrugMaster> => ({
  is_active: 1, name: '', generic_name: d.generic_name, form: d.form, strength: d.strength, pack_size: d.pack_size, schedule: d.schedule,
  hsn_code: d.hsn_code, gst_rate: d.gst_rate, default_mrp: 0, low_stock_threshold: d.low_stock_threshold,
});

/** A sale line for a drug from the list: priced at the batch FEFO will hand out next, with what the shelf looks like. */
const rowFromDrug = (d: any, qty = 1) => ({
  drug_master_id: d.id as number,
  drug_name: d.name as string,
  qty,
  rate: defaultRate(d), listRate: defaultRate(d),
  nextBatch: (d.batch || undefined) as string | undefined,
  nextExpiry: (d.expiry || undefined) as string | undefined,
  stock: (d.stock_qty ?? 0) as number,
  schedule: d.schedule as DrugSchedule | undefined,
});

/**
 * A sale screen always shows ONE empty line at the bottom, ready to type a drug into — nobody has to press "Add drug". When that line gets a drug (or any
 * letters) a fresh empty one appears below it; a second empty line at the end is dropped again.
 */
const isBlankLine = (r: { drug_name: string; drug_master_id?: number }) => !r.drug_name.trim() && r.drug_master_id == null;
function withEntryLine<T extends { drug_name: string; drug_master_id?: number; qty: number; rate: number }>(rows: T[]): T[] {
  const out = [...rows];
  while (out.length > 1 && isBlankLine(out[out.length - 1]) && isBlankLine(out[out.length - 2])) out.pop();
  if (!out.length || !isBlankLine(out[out.length - 1])) out.push({ drug_name: '', qty: 1, rate: 0 } as T);
  return out;
}
/** A line that is really being sold (a drug with a quantity) — the empty entry line is not. */
const isRealLine = (r: { drug_name: string; qty: number }) => !!r.drug_name.trim() && r.qty > 0;
const hasRealLine = (rows: { drug_name: string; qty: number }[]) => rows.some(isRealLine);

export function Pharmacy() {
  const [tab, setTab] = useState<Tab>('dispense');
  // A filter chosen on "Drugs in my clinic" (or from the alert line on Dispense), and a supplier chosen with "View bills".
  const [stockFilter, setStockFilter] = useState<ClinicFilter>('all');
  const [supplier, setSupplier] = useState<{ id: number; name: string } | null>(null);

  const { data: stock = [] } = useClinicStock();
  const counts = useMemo(() => clinicCounts(stock), [stock]);

  // Clicking a tab itself always starts it fresh; only the alert line and "View bills" arrive pre-filtered.
  const go = (t: Tab) => { setStockFilter('all'); setSupplier(null); setTab(t); };
  const openStock = (f: ClinicFilter) => { setStockFilter(f); setSupplier(null); setTab('clinic'); };
  const viewSupplierBills = (w: { id: number; name: string }) => { setSupplier(w); setTab('purchases'); };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100 inline-flex items-center gap-1.5">Pharmacy<PageHelp page="pharmacy" /></h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Batch-tracked stock · FEFO dispensing · Schedule H register · Purchase invoices
          </p>
        </div>
        <GstSwitch />
      </div>

      <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 p-1 rounded-lg flex-wrap w-fit max-w-full" role="tablist" aria-label="Pharmacy">
        <TabBtn active={tab === 'dispense'} onClick={() => go('dispense')} icon={<Clipboard className="w-3.5 h-3.5" />}>Dispense</TabBtn>
        <TabBtn active={tab === 'druglist'} onClick={() => go('druglist')} icon={<Package className="w-3.5 h-3.5" />}>Drug List</TabBtn>
        <TabBtn active={tab === 'clinic'} onClick={() => go('clinic')} icon={<Layers className="w-3.5 h-3.5" />}>Drugs in my clinic</TabBtn>
        <TabBtn active={tab === 'purchases'} onClick={() => go('purchases')} icon={<Truck className="w-3.5 h-3.5" />}>Purchases</TabBtn>
        <TabBtn active={tab === 'sales'} onClick={() => go('sales')} icon={<ShoppingCart className="w-3.5 h-3.5" />}>Sales</TabBtn>
        <TabBtn active={tab === 'wholesalers'} onClick={() => go('wholesalers')} icon={<Store className="w-3.5 h-3.5" />}>Wholesalers</TabBtn>
        <TabBtn active={tab === 'reports'} onClick={() => go('reports')} icon={<FileText className="w-3.5 h-3.5" />}>Reports</TabBtn>
      </div>

      {tab === 'dispense' && <StockStrip counts={counts} onOpen={openStock} />}

      {tab === 'dispense' && <DispenseQueue />}
      {tab === 'druglist' && <DrugListTab />}
      {tab === 'clinic' && <ClinicStockTab filter={stockFilter} onFilter={setStockFilter} />}
      {tab === 'purchases' && <PurchasesTab supplier={supplier} onClearSupplier={() => setSupplier(null)} />}
      {tab === 'sales' && <SalesTab />}
      {tab === 'wholesalers' && <WholesalersTab onViewBills={viewSupplierBills} />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}

/** One slim line on Dispense: what needs attention on the shelf. Each part opens "Drugs in my clinic" already filtered to it. */
function StockStrip({ counts, onOpen }: { counts: Record<ClinicFilter, number>; onOpen: (f: ClinicFilter) => void }) {
  const items = ([
    { f: 'expired', n: counts.expired, text: 'expired', red: true },
    { f: 'out', n: counts.out, text: 'out of stock', red: true },
    { f: 'expiring', n: counts.expiring, text: 'expiring within 90 days', red: false },
    { f: 'low', n: counts.low, text: 'low on stock', red: false },
  ] as { f: ClinicFilter; n: number; text: string; red: boolean }[]).filter((i) => i.n > 0);
  if (items.length === 0) return null;
  return (
    <div className="flex items-center gap-x-4 gap-y-1 flex-wrap rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-100">
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
      {items.map((i) => (
        <button key={i.f} type="button" className={cn('hover:underline', i.red && 'font-semibold text-red-700 dark:text-red-300')} onClick={() => onOpen(i.f)}>
          <b className="tabular-nums">{i.n}</b> {i.text}
        </button>
      ))}
      <span className="opacity-70">— click one to see which drugs</span>
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
  // "Sell medicines" in a patient's billing portal lands here with that patient already chosen for the counter sale.
  const presetPatient = ((useLocation().state as any)?.counterPatient ?? null) as
    { id: number; uhid: string; first_name: string; last_name: string; phone: string } | null;
  const [counterOpen, setCounterOpen] = useState(!!presetPatient);
  const { data: pending = [], isLoading } = useQuery({
    queryKey: ['pharmacy-pending'],
    queryFn: () => window.electronAPI.pharmacy.pendingRx(),
    refetchInterval: 30_000,
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-1 card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide">
            Pending Rx · {pending.length}
          </div>
          <button
            className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => { setActiveAppt(null); setCounterOpen(true); }}
            title="Walk-in / over-the-counter sale (no prescription required)"
          >
            <ShoppingCart className="w-3.5 h-3.5" /> Counter Sale
          </button>
        </div>
        {isLoading ? (
          <div className="text-xs text-gray-500 dark:text-slate-400">Loading…</div>
        ) : pending.length === 0 ? (
          <EmptyState
            icon={Pill}
            title="Nothing pending"
            description="No prescriptions waiting. Click 'Counter Sale' on the right to dispense to a walk-in customer without a prescription."
          />
        ) : (
          <ul className="space-y-1 max-h-[70vh] overflow-auto">
            {pending.map((a: any) => (
              <li
                key={a.id}
                onClick={() => { setCounterOpen(false); setActiveAppt(a); }}
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
        {counterOpen ? (
          <CounterSaleForm initialPatient={presetPatient} onDone={() => setCounterOpen(false)} />
        ) : activeAppt ? (
          <DispenseForm
            /* Keyed by appointment — see the note in Billing.tsx. Discount and
               payment mode used to carry from the previous prescription. */
            key={activeAppt.id}
            appointment={activeAppt} onDone={() => setActiveAppt(null)} />
        ) : (
          <div className="card p-6">
            <EmptyState
              icon={ShoppingCart}
              title="Select a pending Rx — or click 'Counter Sale'"
              description="Click an appointment on the left to dispense a doctor's prescription, or click the green Counter Sale button to dispense to a walk-in customer without a prescription."
            />
          </div>
        )}
      </div>
    </div>
  );
}

function DispenseForm({ appointment, onDone }: { appointment: any; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();                                   // who made the sale is recorded on it
  const { data: rx = [] } = useQuery({
    queryKey: ['pharmacy-appt-rx', appointment.id],
    queryFn: () => window.electronAPI.pharmacy.getAppointmentRx(appointment.id),
  });
  const { data: drugs = [] } = useQuery({
    queryKey: ['pharmacy-drugs-active'],
    queryFn: () => window.electronAPI.pharmacy.listDrugs({ activeOnly: true }),
  });

  type Row = { drug_master_id?: number; drug_name: string; qty: number; rate: number; /** the batch's selling price the screen offered */ listRate?: number; nextBatch?: string; nextExpiry?: string; stock?: number; schedule?: DrugSchedule;
    /** the name the doctor wrote, when the line is filled from another brand of the same medicine */ swappedFrom?: string };
  const [rows, setRows] = useState<Row[]>(() => withEntryLine<Row>([]));
  const [pay, setPay] = useState<PayChoice>(initialPayChoice);       // paid now / on credit / charged to the in-patient bill
  const payOpts = usePayOptions(appointment.patient_id);
  const [receiptId, setReceiptId] = useState<number | null>(null);   // printed bill after dispensing
  // One id per sale attempt: the same attempt sent twice (double click, lost reply) is one sale.
  const [saleRef, setSaleRef] = useState(newRef);

  // When Rx items arrive, auto-fill rows from drug_master_id (preferred) or the written name. A prescription written for the GENERIC
  // ("Paracetamol 650 mg Tablet") that the shelf holds only under a brand (Dolo 650, Crocin 650) is filled from the brand that expires
  // first and says so; a prescription for a BRAND is never swapped by itself — the other brands are offered under the line instead.
  useEffect(() => {
    if (rx.length === 0) { setRows(withEntryLine<Row>([])); return; }
    const pre: Row[] = rx.map((r: any) => {
      const match = drugForRx(drugs as any[], r) as any;
      if (!match) return { drug_name: r.drug_name, qty: 1, rate: 0 };
      const alt = isGenericNamed(match) && (Number(match.stock_qty) || 0) <= 0 ? otherBrandsInStock(drugs as any[], match)[0] : undefined;
      return { ...rowFromDrug(alt || match), swappedFrom: alt ? match.name : undefined };
    });
    setRows(withEntryLine(pre));
  }, [appointment.id, rx.length, drugs.length]);

  // Medicines charged to an in-patient's bill are priced at the batch's selling price: the rate is shown, not editable (the main process
  // re-prices them anyway). A line that uses two batches is priced per batch on the bill.
  const wardLocked = pay.how === 'ipd';
  const priceOf = (r: Row) => (wardLocked ? (r.listRate ?? r.rate) : r.rate);
  const subtotal = useMemo(() => rows.reduce((s, r) => s + r.qty * priceOf(r), 0), [rows, wardLocked]);
  const disc = useSaleDiscount(subtotal);                      // typed as a percentage (first choice) or in rupees — whichever the person types counts
  const discount = disc.amount;
  const total = Math.max(0, subtotal - discount);
  const payBlocked = payProblem(pay, payOpts, total, discount);
  const lim = useCounterDiscountLimit(subtotal, discount);     // the signed-in role's limit on a counter discount, if the clinic set one

  const sell = useMutation({
    mutationFn: () => {
      const payload = {
        appointment_id: appointment.id,
        patient_id: appointment.patient_id,
        items: rows.filter(isRealLine).map((r) => ({
          drug_master_id: r.drug_master_id,
          drug_name: r.drug_name,
          qty: r.qty,
          rate: priceOf(r),
        })),
        discount,
        discount_pct: disc.pct,
        ...payFields(pay, payOpts),
      };
      return window.electronAPI.pharmacy.sell({ ...payload, sold_by: user?.username, client_ref: refFor(saleRef, payload) });
    },
    onSuccess: (sale: any) => {
      setSaleRef(newRef());
      qc.invalidateQueries({ queryKey: ['pharmacy-pending'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-sales'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-drugs'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-drugs-active'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-alerts'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-clinic-stock'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-batches'] });
      // A sale on credit or on an in-patient bill changes what the patient owes — keep Billing, Accounts and Analytics in step.
      for (const k of ['billing-portal', 'bills', 'bill-admissions', 'finance', 'receivables']) qc.invalidateQueries({ queryKey: [k] });
      toast(`Dispensed — ${payDoneText(pay, payOpts, total)}`);
      // Offer the printed bill before closing.
      if (sale?.id) setReceiptId(Number(sale.id));
      else onDone();
    },
    onError: (e: any) => toast(e?.message || 'Dispense failed', 'error'),
  });

  const setRow = (idx: number, patch: Partial<Row>) =>
    setRows((r) => { const n = [...r]; n[idx] = { ...n[idx], ...patch }; return withEntryLine(n); });

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
                  placeholder={isBlankLine(r) ? 'Type a drug name…' : 'Search drug…'}
                  value={r.drug_name}
                  onChange={(e) => {
                    const match = drugs.find((d) => d.name === e.target.value);
                    setRow(idx, match
                      ? {
                          drug_master_id: match.id,
                          drug_name: match.name,
                          rate: defaultRate(match), listRate: defaultRate(match),
                          nextBatch: match.batch || undefined,
                          nextExpiry: match.expiry || undefined,
                          stock: match.stock_qty ?? 0,
                          schedule: match.schedule,
                          swappedFrom: undefined,
                        }
                      : { drug_master_id: undefined, drug_name: e.target.value, nextBatch: undefined, nextExpiry: undefined, stock: undefined, swappedFrom: undefined }
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
                <BrandChoice
                  drugs={drugs as any[]} drugId={r.drug_master_id} qty={r.qty} swappedFrom={r.swappedFrom}
                  onUse={(d: any) => {
                    const was = drugs.find((x) => x.id === r.drug_master_id);
                    setRow(idx, { ...rowFromDrug(d, r.qty), swappedFrom: r.swappedFrom ?? (was && isGenericNamed(was) ? was.name : undefined) });
                  }}
                  onTakeRest={(d: any, rest: number) => setRows((prev) => {
                    const n = [...prev];
                    n[idx] = { ...n[idx], qty: Math.max(0, n[idx].stock ?? 0) };
                    n.splice(idx + 1, 0, { ...rowFromDrug(d, rest), swappedFrom: n[idx].swappedFrom });
                    return withEntryLine(n);
                  })}
                />
              </td>
              <td className="py-1.5 px-1">
                <input type="number" className="input text-right" value={r.qty} onChange={(e) => setRow(idx, { qty: Number(e.target.value) })} />
              </td>
              <td className="py-1.5 px-1">
                <input type="number" className={cn('input text-right', wardLocked && 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed')} value={priceOf(r)} readOnly={wardLocked}
                  title={wardLocked ? "Medicines charged to an in-patient are priced at the batch's selling price" : undefined} onChange={(e) => setRow(idx, { rate: Number(e.target.value) })} />
              </td>
              <td className="py-1.5 px-1 text-right font-medium">{formatINR(r.qty * priceOf(r))}</td>
              <td>
                {!(isBlankLine(r) && idx === rows.length - 1) && (       // the empty entry line at the bottom has nothing to remove
                  <button className="text-red-500 hover:text-red-700 p-1" aria-label="Remove this line" onClick={() => setRows(withEntryLine(rows.filter((_, i) => i !== idx)))}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="drugs-list">
        {drugs.map((d) => <option key={d.id} value={d.name} />)}
      </datalist>

      {wardLocked && (
        <div className="mt-2 text-[11px] text-sky-700 dark:text-sky-300">
          Charged to the in-patient bill at each batch&rsquo;s selling price — the rate can&rsquo;t be changed here. Pick every medicine from the list so it can be priced from its stock.
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <SalePaymentChoice value={pay} onChange={setPay} options={payOpts} total={total} discount={discount} />
        <div className="card p-3 bg-gray-50 dark:bg-slate-900">
          <div className="flex justify-between text-xs"><span>Subtotal</span><span>{formatINR(subtotal)}</span></div>
          <DiscountRow d={disc} subtotal={subtotal} over={lim.over} />
          {lim.pct != null && (
            <div className={cn('text-[10px] text-right', lim.over ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-500 dark:text-slate-400')}>
              {lim.over ? `More than your limit (${lim.pct}% = ${formatINR(lim.maxAmount as number)}) — ask a manager.` : `Your limit: ${lim.pct}% (up to ${formatINR(lim.maxAmount as number)})`}
            </div>
          )}
          <div className="flex justify-between text-sm font-bold pt-2 border-t border-gray-300 dark:border-slate-700 mt-1">
            <span>Total</span><span className="text-blue-700 dark:text-blue-300">{formatINR(total)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-success" onClick={() => sell.mutate()} disabled={sell.isPending || !hasRealLine(rows) || !!payBlocked || !!disc.problem || lim.over}>
          {sell.isPending ? 'Dispensing…' : pay.how === 'ipd' ? 'Dispense (FEFO) & add to IPD bill' : pay.how === 'credit' ? 'Dispense (FEFO) on credit' : 'Dispense (FEFO) & Charge'}
        </button>
      </div>

      {/* Printed bill — offered right after dispensing. */}
      {receiptId !== null && (
        <PharmacySaleReceipt saleId={receiptId} onClose={() => { setReceiptId(null); onDone(); }} />
      )}
    </div>
  );
}

/* ===================================================================
   COUNTER SALE — walk-in / OTC dispense without a doctor's prescription.
   For chemist-counter operations or quick OTC sales. Optional patient
   lookup (so repeat customers can be tracked) but not required.
   =================================================================== */
function CounterSaleForm({ onDone, initialPatient = null }: {
  onDone: () => void;
  initialPatient?: { id: number; uhid: string; first_name: string; last_name: string; phone: string } | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();                                   // who made the sale is recorded on it
  const { data: drugs = [] } = useQuery({
    queryKey: ['pharmacy-drugs-active'],
    queryFn: () => window.electronAPI.pharmacy.listDrugs({ activeOnly: true }),
  });

  type Row = { drug_master_id?: number; drug_name: string; qty: number; rate: number; /** the batch's selling price the screen offered */ listRate?: number; nextBatch?: string; nextExpiry?: string; stock?: number; schedule?: DrugSchedule };
  const [rows, setRows] = useState<Row[]>(() => withEntryLine<Row>([]));
  const [pay, setPay] = useState<PayChoice>(initialPayChoice);       // paid now / on credit / charged to the in-patient bill
  const [receiptId, setReceiptId] = useState<number | null>(null);   // printed receipt after the sale
  const [saleRef, setSaleRef] = useState(newRef);                      // one id per sale attempt (see DispenseForm)
  const [guestName, setGuestName] = useState('');                       // walk-in only: an optional name for the receipt and the walk-in list

  // Optional patient picker
  const [patientQuery, setPatientQuery] = useState('');
  const [patient, setPatient] = useState<{ id: number; uhid: string; first_name: string; last_name: string; phone: string } | null>(initialPatient);
  const { data: patientResults = [] } = useQuery({
    queryKey: ['pharmacy-counter-patient-search', patientQuery],
    queryFn: () => window.electronAPI.patients.search(patientQuery),
    enabled: !patient && patientQuery.trim().length > 0,
  });

  // Medicines charged to an in-patient's bill are priced at the batch's selling price: the rate is shown, not editable (the main process
  // re-prices them anyway). A line that uses two batches is priced per batch on the bill.
  const wardLocked = pay.how === 'ipd';
  const priceOf = (r: Row) => (wardLocked ? (r.listRate ?? r.rate) : r.rate);
  const subtotal = useMemo(() => rows.reduce((s, r) => s + r.qty * priceOf(r), 0), [rows, wardLocked]);
  const disc = useSaleDiscount(subtotal);                      // typed as a percentage (first choice) or in rupees — whichever the person types counts
  const discount = disc.amount;
  const total = Math.max(0, subtotal - discount);
  const payOpts = usePayOptions(patient?.id);
  const payBlocked = payProblem(pay, payOpts, total, discount);
  const lim = useCounterDiscountLimit(subtotal, discount);     // the signed-in role's limit on a counter discount, if the clinic set one

  const setRow = (idx: number, patch: Partial<Row>) =>
    setRows((r) => { const n = [...r]; n[idx] = { ...n[idx], ...patch }; return withEntryLine(n); });

  const sell = useMutation({
    mutationFn: () => {
      const payload = {
        appointment_id: null,
        patient_id: patient?.id ?? null,
        customer_name: patient ? null : (guestName.trim() || null),
        items: rows.filter(isRealLine).map((r) => ({
          drug_master_id: r.drug_master_id,
          drug_name: r.drug_name,
          qty: r.qty,
          rate: priceOf(r),
        })),
        discount,
        discount_pct: disc.pct,
        ...payFields(pay, payOpts),
      };
      return window.electronAPI.pharmacy.sell({ ...payload, sold_by: user?.username, client_ref: refFor(saleRef, payload) });
    },
    onSuccess: (sale: any) => {
      setSaleRef(newRef());
      setGuestName('');
      qc.invalidateQueries({ queryKey: ['pharmacy-sales'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-drugs'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-drugs-active'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-alerts'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-clinic-stock'] });
      qc.invalidateQueries({ queryKey: ['pharmacy-batches'] });
      for (const k of ['billing-portal', 'bills', 'bill-admissions', 'finance', 'receivables', 'portal-walkins']) qc.invalidateQueries({ queryKey: [k] });
      toast(`Counter sale recorded — ${payDoneText(pay, payOpts, total)}`);
      // Offer the printed receipt instead of closing straight away; the user
      // prints (or skips) and the panel closes from the receipt's Close button.
      if (sale?.id) setReceiptId(Number(sale.id));
      else onDone();
    },
    onError: (e: any) => toast(e?.message || 'Counter sale failed', 'error'),
  });

  // Highlight if any selected drug needs a prescription (Schedule H/H1) — informational, not blocking.
  const hasScheduleH = rows.some((r) => r.schedule === 'H' || r.schedule === 'H1');

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-slate-700 mb-3">
        <div>
          <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
            <ShoppingCart className="w-4 h-4" /> Counter Sale
          </div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">No prescription required. FEFO batches are still allocated automatically.</div>
        </div>
      </div>

      {/* Optional patient picker */}
      <div className="mb-3">
        <label className="label">Customer (optional)</label>
        {patient ? (
          <div className="flex items-center justify-between p-2 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20">
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{patient.first_name} {patient.last_name}</div>
              <div className="text-[11px] text-gray-500 dark:text-slate-400">{patient.uhid} · {patient.phone}</div>
            </div>
            <button className="btn-ghost text-xs" onClick={() => { setPatient(null); setPatientQuery(''); }}>Change</button>
          </div>
        ) : (
          <div>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className="input pl-9"
                placeholder="Search by name / phone / UHID — or skip"
                value={patientQuery}
                onChange={(e) => setPatientQuery(e.target.value)}
              />
            </div>
            {patientQuery.trim().length > 0 && patientResults.length > 0 && (
              <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-800">
                {patientResults.slice(0, 8).map((p: any) => (
                  <li
                    key={p.id}
                    className="px-3 py-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800 text-sm"
                    onClick={() => { setPatient(p); setPatientQuery(''); }}
                  >
                    <div className="font-medium text-gray-900 dark:text-slate-100">{p.first_name} {p.last_name}</div>
                    <div className="text-[11px] text-gray-500 dark:text-slate-400">{p.uhid} · {p.phone}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {patient ? (
          <div className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-1.5">
            This sale will appear in {patient.first_name}'s Billing, together with their other bills.
          </div>
        ) : (
          <div className="mt-2">
            <input
              className="input"
              placeholder="Walk-in guest's name (optional)"
              maxLength={80}
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
            />
            <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">
              Pick a patient above to put this sale on their bill. A walk-in sale prints with the name typed here and is listed under
              Billing → Pharmacy walk-ins. Either way it is counted once in Accounts and Analytics.
            </div>
          </div>
        )}
      </div>

      {hasScheduleH && (
        <div className="mb-2 flex items-start gap-2 p-2 rounded-md text-[11px] text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <b>Schedule H/H1 drug in this sale</b> — by law, dispense only against a valid prescription. The dispensing register will record this entry.
          </div>
        </div>
      )}

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
                  list="counter-drugs-list"
                  className="input"
                  placeholder={isBlankLine(r) ? 'Type a drug name…' : 'Search drug…'}
                  value={r.drug_name}
                  onChange={(e) => {
                    const match = drugs.find((d) => d.name === e.target.value);
                    setRow(idx, match
                      ? {
                          drug_master_id: match.id,
                          drug_name: match.name,
                          rate: defaultRate(match), listRate: defaultRate(match),
                          nextBatch: match.batch || undefined,
                          nextExpiry: match.expiry || undefined,
                          stock: match.stock_qty ?? 0,
                          schedule: match.schedule,
                        }
                      : { drug_master_id: undefined, drug_name: e.target.value, schedule: undefined, nextBatch: undefined, nextExpiry: undefined, stock: undefined }
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
                  <div className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">⚠ Only {r.stock} in stock</div>
                )}
                <BrandChoice
                  drugs={drugs as any[]} drugId={r.drug_master_id} qty={r.qty}
                  onUse={(d: any) => setRow(idx, rowFromDrug(d, r.qty))}
                  onTakeRest={(d: any, rest: number) => setRows((prev) => {
                    const n = [...prev];
                    n[idx] = { ...n[idx], qty: Math.max(0, n[idx].stock ?? 0) };
                    n.splice(idx + 1, 0, rowFromDrug(d, rest));
                    return withEntryLine(n);
                  })}
                />
              </td>
              <td className="py-1.5 px-1"><input type="number" className="input text-right" value={r.qty} onChange={(e) => setRow(idx, { qty: Number(e.target.value) })} /></td>
              <td className="py-1.5 px-1"><input type="number" className={cn('input text-right', wardLocked && 'bg-gray-100 dark:bg-slate-800 cursor-not-allowed')} value={priceOf(r)} readOnly={wardLocked}
                  title={wardLocked ? "Medicines charged to an in-patient are priced at the batch's selling price" : undefined} onChange={(e) => setRow(idx, { rate: Number(e.target.value) })} /></td>
              <td className="py-1.5 px-1 text-right font-medium">{formatINR(r.qty * priceOf(r))}</td>
              <td>
                {!(isBlankLine(r) && idx === rows.length - 1) && (       // the empty entry line at the bottom has nothing to remove
                  <button className="text-red-500 hover:text-red-700 p-1" aria-label="Remove this line" onClick={() => setRows(withEntryLine(rows.filter((_, i) => i !== idx)))}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="counter-drugs-list">
        {drugs.map((d) => <option key={d.id} value={d.name} />)}
      </datalist>

      {wardLocked && (
        <div className="mt-2 text-[11px] text-sky-700 dark:text-sky-300">
          Charged to the in-patient bill at each batch&rsquo;s selling price — the rate can&rsquo;t be changed here. Pick every medicine from the list so it can be priced from its stock.
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <SalePaymentChoice value={pay} onChange={setPay} options={payOpts} total={total} discount={discount} />
        <div className="card p-3 bg-gray-50 dark:bg-slate-900">
          <div className="flex justify-between text-xs"><span>Subtotal</span><span>{formatINR(subtotal)}</span></div>
          <DiscountRow d={disc} subtotal={subtotal} over={lim.over} />
          {lim.pct != null && (
            <div className={cn('text-[10px] text-right', lim.over ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-500 dark:text-slate-400')}>
              {lim.over ? `More than your limit (${lim.pct}% = ${formatINR(lim.maxAmount as number)}) — ask a manager.` : `Your limit: ${lim.pct}% (up to ${formatINR(lim.maxAmount as number)})`}
            </div>
          )}
          <div className="flex justify-between text-sm font-bold pt-2 border-t border-gray-300 dark:border-slate-700 mt-1">
            <span>Total</span><span className="text-emerald-700 dark:text-emerald-300">{formatINR(total)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-secondary" onClick={onDone}>Cancel</button>
        <button className="btn-success" onClick={() => sell.mutate()} disabled={sell.isPending || !hasRealLine(rows) || !!payBlocked || !!disc.problem || lim.over}>
          {sell.isPending ? 'Recording…' : pay.how === 'ipd' ? 'Record Sale & add to IPD bill' : pay.how === 'credit' ? 'Record Sale on credit' : 'Record Sale & Charge'}
        </button>
      </div>

      {/* Printed receipt — shown right after the sale is recorded. */}
      {receiptId !== null && (
        <PharmacySaleReceipt saleId={receiptId} onClose={() => { setReceiptId(null); onDone(); }} />
      )}
    </div>
  );
}

/* ===================================================================
   DRUG LIST — just the drugs: name, form, strength, schedule, GST, MRP. No stock here: what the clinic
   actually holds is under "Drugs in my clinic", and stock comes in through Purchases.
   =================================================================== */

function DrugListTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<DrugMaster> | null>(null);
  const [brandOf, setBrandOf] = useState<string | null>(null);   // set while the dialog adds ANOTHER BRAND of this medicine
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [settingGst, setSettingGst] = useState(false);          // the "Set GST %" dialog

  const { data: drugs = [] } = useQuery({
    queryKey: ['pharmacy-drugs', q, false],
    queryFn: () => window.electronAPI.pharmacy.listDrugs({ q, activeOnly: false }),
  });
  // Every active drug, whatever is typed in the search — so a brand always shows the other brands of its medicine.
  const { data: allActive = [] } = useQuery({
    queryKey: ['pharmacy-drugs-active'],
    queryFn: () => window.electronAPI.pharmacy.listDrugs({ activeOnly: true }),
  });
  // Deleting a drug needs the administrator password (typed in the box below, checked by the app itself — never by this screen).
  const deleteDrugs = async (password: string): Promise<{ ok: boolean; error?: string }> => {
    const r = await window.electronAPI.pharmacy.bulkDeleteDrugs([...selectedIds], password);
    if (!r.ok) return { ok: false, error: r.error };
    for (const k of DRUG_QUERY_KEYS) qc.invalidateQueries({ queryKey: [k] });
    const parts: string[] = [];
    if (r.hardDeleted) parts.push(`${r.hardDeleted} permanently deleted`);
    if (r.softDeleted) parts.push(`${r.softDeleted} marked Inactive (had history)`);
    const failed = r.results.filter((x) => x.mode === 'failed').length;
    if (failed) parts.push(`${failed} failed`);
    toast(parts.join(' · ') || 'No drugs deleted');
    setSelectedIds(new Set());
    return { ok: true };
  };

  const allSelected = drugs.length > 0 && drugs.every((d) => selectedIds.has(d.id));
  const someSelected = selectedIds.size > 0 && !allSelected;
  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(drugs.map((d) => d.id)));
  };
  const toggleOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Pre-flight: count how many selected drugs have historical references vs none.
  // (For the confirmation modal copy — actual delete logic is server-side.)
  const selectedDrugs = drugs.filter((d) => selectedIds.has(d.id));

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="input pl-9" placeholder="Search by name / generic / barcode" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn-secondary" onClick={() => setSettingGst(true)} title="You decide the GST % of your medicines — change many at once">
          <Percent className="w-4 h-4" /> Set GST %
        </button>
        <button className="btn-primary" onClick={() => setEditing({ is_active: 1, low_stock_threshold: 10, default_mrp: 0, schedule: 'OTC' })}>
          <Plus className="w-4 h-4" /> Add Drug
        </button>
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400 mb-2">
        💡 This is the list of drugs your clinic knows — it shows no stock. What you actually hold is under <b>Drugs in my clinic</b>, and stock comes in through <b>Purchases</b> (the legal source).
        Tick the checkboxes to bulk-delete drugs (drugs with history get marked Inactive instead).
      </div>

      {/* Bulk action bar — only shows when at least one drug is selected */}
      {selectedIds.size > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800">
          <div className="text-sm text-blue-900 dark:text-blue-100">
            <b>{selectedIds.size}</b> drug{selectedIds.size === 1 ? '' : 's'} selected
          </div>
          <div className="flex items-center gap-2">
            <button
              className="text-xs text-gray-600 dark:text-slate-300 hover:underline"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </button>
            <button
              className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded-md font-semibold border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-800 text-blue-800 dark:text-blue-200 hover:bg-blue-50"
              onClick={() => setSettingGst(true)}
            >
              <Percent className="w-3.5 h-3.5" /> Set GST % for selected
            </button>
            <button
              className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded-md font-semibold bg-red-600 hover:bg-red-700 text-white"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Selected
            </button>
          </div>
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
            <th className="py-2 w-8">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected; }}
                onChange={toggleAll}
              />
            </th>
            <th className="py-2">Name</th>
            <th className="py-2">Form / Strength</th>
            <th className="py-2">Schedule</th>
            <th className="py-2 text-right">MRP</th>
            <th className="py-2 pl-6">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {drugs.map((d) => {
            const checked = selectedIds.has(d.id);
            return (
              <tr
                key={d.id}
                className={cn(
                  'border-b border-gray-100 dark:border-slate-800',
                  checked && 'bg-blue-50/60 dark:bg-blue-900/20'
                )}
              >
                <td className="py-2 w-8">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOne(d.id)}
                    aria-label={`Select ${d.name}`}
                  />
                </td>
                <td className="py-2">
                  <div className="font-medium text-gray-900 dark:text-slate-100">{d.name}{d.item_type === 'consumable' && <span className="badge bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200 ml-2 align-middle" title="A syringe, cannula, suture, tape, bed sheet… — no generic name, strength or schedule; not offered in prescriptions">Consumable</span>}</div>
                  <div className="text-[11px] text-gray-500 dark:text-slate-400">{d.item_type === 'consumable' ? 'Not a medicine' : d.generic_name || '—'}{d.manufacturer ? ` · ${d.manufacturer}` : ''}</div>
                  {(() => {
                    const same = siblingsOf(allActive as any[], d as any);
                    return same.length > 0 ? (
                      <div className="text-[10px] text-indigo-700 dark:text-indigo-300 mt-0.5" title="Same ingredient, strength and form — shown together in Drugs in my clinic and offered when dispensing">
                        Same medicine: {same.slice(0, 3).map((x: any) => x.name).join(' · ')}{same.length > 3 ? ` +${same.length - 3}` : ''}
                      </div>
                    ) : null;
                  })()}
                </td>
                <td className="py-2 text-gray-600 dark:text-slate-300">{d.form || '—'} {d.strength ? `· ${d.strength}` : ''}</td>
                <td className="py-2"><ScheduleBadge schedule={d.schedule} /></td>
                <td className="py-2 text-right">{formatINR(d.default_mrp)}</td>
                <td className="py-2 pl-6">
                  {d.is_active
                    ? <span className="badge bg-green-100 text-green-700">Active</span>
                    : <span className="badge bg-gray-200 text-gray-600">Inactive</span>}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  <button className="btn-ghost text-xs" onClick={() => { setBrandOf(null); setEditing(d); }}><Pencil className="w-3.5 h-3.5" /> Edit</button>
                  <button className="btn-ghost text-xs" title="Add another brand of this same medicine — its ingredient, strength, form, schedule and GST are filled in for you"
                    onClick={() => { setBrandOf(d.name); setEditing(anotherBrandOf(d)); }}>
                    <Plus className="w-3.5 h-3.5" /> Brand
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* === Bulk delete: the administrator password is typed again === */}
      {confirmDelete && (
        <AdminPasswordModal
          title={`Delete ${selectedIds.size} drug${selectedIds.size === 1 ? '' : 's'}?`}
          confirmLabel={`Yes, Delete ${selectedIds.size}`}
          onClose={() => setConfirmDelete(false)}
          onConfirm={deleteDrugs}
        >
          <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-gray-800 dark:text-slate-200">
              You're about to delete <b>{selectedIds.size}</b> drug{selectedIds.size === 1 ? '' : 's'} from the master.
              The app will check each one:
              <ul className="list-disc pl-5 mt-2 space-y-0.5 text-[12px]">
                <li><b>No history</b> (no batches, Rx, sales, dispenses, purchases) → permanently deleted.</li>
                <li><b>Has history</b> → marked <b>Inactive</b> instead. Past records stay; the drug disappears from active dispense + lists.</li>
              </ul>
            </div>
          </div>
          <div className="border border-gray-200 dark:border-slate-700 rounded max-h-48 overflow-y-auto">
            <ul className="text-xs divide-y divide-gray-100 dark:divide-slate-800">
              {selectedDrugs.map((d) => (
                <li key={d.id} className="px-3 py-1.5 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-gray-900 dark:text-slate-100">{d.name}</span>
                    <span className="text-[11px] text-gray-500 dark:text-slate-400 ml-2">
                      {d.form || ''} {d.strength ? `· ${d.strength}` : ''}
                    </span>
                  </div>
                  <ScheduleBadge schedule={d.schedule} />
                </li>
              ))}
            </ul>
          </div>
        </AdminPasswordModal>
      )}

      {editing && <DrugEditModal drug={editing} brandOf={brandOf ?? undefined} onClose={() => { setEditing(null); setBrandOf(null); }} />}
      {settingGst && <SetGstModal selectedIds={[...selectedIds]} onClose={() => setSettingGst(false)} onDone={() => setSelectedIds(new Set())} />}

    </section>
  );
}

/* ===================================================================
   PURCHASES — wholesaler invoices + line items → auto-create batches
   =================================================================== */
function PurchasesTab({ supplier, onClearSupplier }: { supplier: { id: number; name: string } | null; onClearSupplier: () => void }) {
  // Arriving with "View bills" from the Wholesalers tab shows that supplier's bills for ALL dates.
  const [from, setFrom] = useState(supplier ? '' : daysAgo(30));
  const [to, setTo] = useState(supplier ? '' : todayISO());
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState<null | 'guide' | 'waiting'>(null);   // Import bill (photo → ChatGPT → Excel)
  const [openId, setOpenId] = useState<number | null>(null);
  const [owedOnly, setOwedOnly] = useState(false);
  const { data: waitingImports = [] } = useQuery({ queryKey: [WAITING_KEY], queryFn: () => window.electronAPI.purchaseImport.waiting() });

  const { data: invoices = [] } = useQuery({
    queryKey: ['purchases', from, to, owedOnly, supplier?.id ?? null],
    queryFn: () => window.electronAPI.purchases.list({
      from: from || undefined, to: to || undefined, wholesaler_id: supplier?.id, status: owedOnly ? 'outstanding' : undefined,
    }),
  });

  const totalSpend = invoices.reduce((s, x) => s + Number(x.total || 0), 0);
  // Outstanding is only known for bills whose payments are on record.
  const owed = invoices.reduce((s, x) => s + (x.outstanding != null ? Math.max(0, Number(x.outstanding)) : 0), 0);
  const unknownPaid = invoices.filter((x) => x.outstanding == null).length;

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-xs text-gray-500">to</span>
          <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-300 ml-2">
            <input type="checkbox" checked={owedOnly} onChange={(e) => setOwedOnly(e.target.checked)} /> Only bills not fully paid
          </label>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm">
            <span className="text-gray-500 dark:text-slate-400">Spend:</span>{' '}
            <span className="font-bold text-blue-700 dark:text-blue-300">{formatINR(totalSpend)}</span>
          </div>
          <div className="text-sm" title="Billed by suppliers in this range and not yet paid">
            <span className="text-gray-500 dark:text-slate-400">To pay:</span>{' '}
            <span className={cn('font-bold', owed > 0 ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400')}>{formatINR(owed)}</span>
            {unknownPaid > 0 && <span className="text-[10px] text-amber-700 dark:text-amber-300 ml-1">+ {unknownPaid} bill{unknownPaid === 1 ? '' : 's'} with unknown payment</span>}
          </div>
          {waitingImports.length > 0 && (
            <button className="btn-secondary text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700" onClick={() => setImporting('waiting')}
              title="Lines you set aside while importing a bill — not in your stock yet">
              Waiting to finish ({waitingImports.length})
            </button>
          )}
          <button className="btn-secondary" onClick={() => setImporting('guide')} title="Read a supplier's bill with ChatGPT and check it here — saves typing every line">
            <FileSpreadsheet className="w-4 h-4" /> Import bill
          </button>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4" /> New Purchase Bill
          </button>
        </div>
      </div>

      {supplier && (
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 px-3 py-1 text-xs text-blue-900 dark:text-blue-100">
          Bills from <b>{supplier.name}</b>{!from && !to ? ' · all dates' : ''}
          <button type="button" className="hover:text-red-600" aria-label="Show every supplier again" title="Show every supplier again"
            onClick={() => { onClearSupplier(); setFrom(daysAgo(30)); setTo(todayISO()); }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {invoices.length === 0 ? (
        <EmptyState icon={Truck} title={owedOnly ? 'Nothing owed in this range' : 'No purchase invoices in range'} description="Click 'New Purchase Bill' to record a wholesaler invoice. Line items auto-create stock batches." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
              <th className="py-2">Invoice #</th>
              <th className="py-2">Wholesaler (License)</th>
              <th className="py-2">Inv. Date</th>
              <th className="py-2 text-right">Total</th>
              <th className="py-2 text-right">To pay</th>
              <th className="py-2">Payment</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b border-gray-100 dark:border-slate-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/40" onClick={() => setOpenId(inv.id)}>
                <td className="py-2 font-mono text-xs">{inv.invoice_number}</td>
                <td className="py-2">
                  {inv.wholesaler_name}
                  <div className="text-[10px] text-gray-500 dark:text-slate-400 font-mono">{inv.wholesaler_license_no}</div>
                </td>
                <td className="py-2 text-xs text-gray-500 dark:text-slate-400">{fmtDate(inv.invoice_date)}</td>
                <td className="py-2 text-right font-semibold">{formatINR(inv.total)}</td>
                <td className="py-2 text-right text-xs">
                  {inv.outstanding == null
                    ? <span className="text-amber-700 dark:text-amber-300" title="Marked part-paid before payments were tracked — open the bill to enter what was paid">unknown</span>
                    : inv.outstanding > 0.004 ? <span className="font-semibold text-red-700 dark:text-red-400">{formatINR(inv.outstanding)}</span> : <span className="text-gray-400">—</span>}
                </td>
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
      {importing && <ImportBillModal start={importing} onClose={() => setImporting(null)} onOpenBill={(id) => setOpenId(id)} />}
      {openId !== null && <PurchaseDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </section>
  );
}


/* ===================================================================
   SALES HISTORY (unchanged structurally)
   =================================================================== */
function SalesTab() {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  // Reprint: a customer who lost the slip, or a counter that ran out of paper
  // mid-print, must be able to get the same bill again days later.
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const [collect, setCollect] = useState<{ saleId: number; label: string; due: number } | null>(null);   // taking the rest of a credit sale
  const [erasing, setErasing] = useState<{ id: number; number: string; who: string; total: number } | null>(null);   // admin: delete a counter sale
  const qc = useQueryClient();
  const toast = useToast();
  const { adminUnlocked } = useAuth();
  const { data: sales = [] } = useQuery({
    queryKey: ['pharmacy-sales', from, to],
    queryFn: () => window.electronAPI.pharmacy.listSales({ from, to }),
  });
  // Medicines given on a ward are charged on the patient's IPD bill, so they are listed here (the stock went out) but
  // are not pharmacy revenue — counting them would report the same rupee twice.
  const isWard = (x: { payment_mode: string | null }) => x.payment_mode === 'IPD-bill';
  const totalRevenue = sales.filter((x) => !isWard(x)).reduce((s, x) => s + Number(x.total || 0), 0);
  const wardTotal = sales.filter(isWard).reduce((s, x) => s + Number(x.total || 0), 0);
  // Medicines given on credit: revenue counts the whole bill, but part of it may not have been paid yet.
  const owing = sales.filter((x) => !isWard(x)).reduce((s, x) => s + Math.max(0, Number(x.due || 0)), 0);
  return (
    <section className="card p-4">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-xs text-gray-500">to</span>
        <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="ml-auto text-sm">
          <span className="text-gray-500 dark:text-slate-400">Revenue:</span> <span className="font-bold text-emerald-700 dark:text-emerald-300">{formatINR(totalRevenue)}</span>
          {owing > 0.004 && (
            <span className="ml-3 text-[11px] text-amber-700 dark:text-amber-300" title="Medicines given on credit that have not been paid for yet">
              {formatINR(owing)} still owed on credit
            </span>
          )}
          {wardTotal > 0 && (
            <span className="ml-3 text-[11px] text-gray-500 dark:text-slate-400" title="Medicines given on a ward — already charged on the patient's IPD bill">
              + {formatINR(wardTotal)} given on wards (billed on IPD bills)
            </span>
          )}
        </div>
      </div>
      {sales.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="No sales in range" />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
              <th className="py-2">Sale No</th>
              <th className="py-2">Customer</th>
              <th className="py-2">Date</th>
              <th className="py-2 text-right">Total</th>
              <th className="py-2">Mode</th>
              <th className="py-2 text-right">Bill</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id} className="border-b border-gray-100 dark:border-slate-800">
                <td className="py-2 font-mono text-xs">{s.sale_number}</td>
                <td className="py-2">
                  {s.patient_name ? (
                    <>{s.patient_name}<div className="text-[11px] text-gray-500">{s.patient_uhid || ''} · also in their Billing</div></>
                  ) : isWard(s) ? (
                    <>—<div className="text-[11px] text-gray-500">given on a ward · on the IPD bill</div></>
                  ) : (
                    <>{s.customer_name || 'Walk-in'}<div className="text-[11px] text-gray-500">walk-in guest · Billing → Pharmacy walk-ins</div></>
                  )}
                </td>
                <td className="py-2 text-xs text-gray-500 dark:text-slate-400">{fmtDateTime(s.created_at)}</td>
                <td className="py-2 text-right font-semibold">{formatINR(s.total)}</td>
                <td className="py-2">
                  <span className="badge bg-gray-100 text-gray-700">{isWard(s) ? 'IPD bill' : (s.payment_mode || '—')}</span>
                  {Number(s.due) > 0.004 ? (
                    <div className="mt-0.5"><span className="badge bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">On credit · {formatINR(Number(s.due))} due</span></div>
                  ) : s.on_credit ? (
                    <div className="mt-0.5"><span className="badge bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">Credit · settled</span></div>
                  ) : null}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {Number(s.due) > 0.004 && (
                    <button className="btn-primary text-[11px] py-1 px-2 mr-1"
                      onClick={() => setCollect({ saleId: Number(s.id), label: `${s.patient_name || 'Pharmacy'} ${s.sale_number}`, due: Number(s.due) })}>
                      Collect
                    </button>
                  )}
                  <button
                    className="btn-secondary text-[11px] py-1 px-2 inline-flex items-center gap-1"
                    onClick={() => setReceiptId(Number(s.id))}
                    title={`Print the bill for ${s.sale_number} again`}
                  >
                    <Printer className="w-3 h-3" /> Print
                  </button>
                  {adminUnlocked && !isWard(s) && (
                    <button className="btn-ghost text-[11px] py-1 px-2 ml-1 text-red-600 hover:text-red-700"
                      title="Delete this sale (admin password) — the medicines go back on the shelf"
                      onClick={() => setErasing({ id: Number(s.id), number: String(s.sale_number), who: String(s.patient_name || 'walk-in'), total: Number(s.total) || 0 })}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {erasing && (
        <AdminPasswordModal
          title="Delete this pharmacy sale?" confirmLabel="Delete this sale" onClose={() => setErasing(null)}
          onConfirm={async (pw) => {
            const r = await window.electronAPI.admin.deleteSale(erasing.id, pw);
            if (r.ok) {
              toast(`Sale ${erasing.number} deleted`);
              for (const k of ['pharmacy-sales', 'billing-portal', 'bills', 'bills-pharmacy', 'finance', 'finance-summary', 'receivables', 'portal-walkins', 'pharmacy-clinic-stock', 'pharmacy-batches', 'pharmacy-drugs', 'pharmacy-alerts']) qc.invalidateQueries({ queryKey: [k] });
            }
            return r;
          }}
        >
          <div>Permanently delete sale <span className="font-bold">{erasing.number}</span> for <span className="font-bold">{erasing.who}</span> — {formatINR(erasing.total)}?</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">
            Erases the sale, its lines, its payments and its dispensing-register rows (for a Schedule H medicine that is a legal record). The medicines go back on the shelf.
            A copy of what was erased is kept in the audit log. Sales charged to an in-patient's bill cannot be deleted here.
          </div>
        </AdminPasswordModal>
      )}

      {receiptId !== null && (
        <PharmacySaleReceipt saleId={receiptId} onClose={() => setReceiptId(null)} />
      )}
      {collect && (
        <CollectPaymentModal target={{ saleId: collect.saleId }} label={collect.label} due={collect.due}
          onClose={() => setCollect(null)}
          onDone={() => {
            setCollect(null);
            for (const k of ['pharmacy-sales', 'billing-portal', 'bills', 'finance', 'receivables', 'pharmacy-sale-detail', 'portal-walkins']) qc.invalidateQueries({ queryKey: [k] });
          }} />
      )}
    </section>
  );
}
