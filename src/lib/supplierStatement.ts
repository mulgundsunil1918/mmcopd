import { fromPaise, toPaise } from './pharmacyMath';

/**
 * A supplier's account, as a passbook: every bill (CREDIT — what the clinic owes) and every payment (DEBIT — what it paid), in date order,
 * with a running balance, plus the bills still pending (oldest first) and the latest bills. One function builds it for the real app
 * (main/pharmacy-finance.ts reads the rows) and for the website demo, so what a clinic sees is what was tested.
 *
 * Rules (they match supplierSummary, so the two screens never disagree):
 *   · money is added up in paise, never as floating-point rupees;
 *   · owed = bills − payments, only on bills whose payments are recorded;
 *   · a bill marked "part-paid" before payments were tracked (amount_paid NULL, no payment rows) has an UNKNOWN balance: it is listed on its
 *     own and is NOT in the running balance or the totals — it cannot be guessed;
 *   · a bill the clinic split into parts is named "<invoice> (part 2)": the parts are shown under the invoice they belong to.
 */
export interface StatementInvoice {
  id: number;
  invoice_number: string;
  invoice_date: string;           // YYYY-MM-DD
  total: number;
  amount_paid: number | null;     // NULL = a legacy "partly paid" bill whose paid amount was never recorded
  line_count?: number;
  notes?: string | null;
}
export interface StatementPayment {
  id: number;
  invoice_id: number;
  amount: number;
  payment_mode: string | null;
  paid_on: string;                // YYYY-MM-DD
  reference?: string | null;
  notes?: string | null;
}
export type BillState = 'unpaid' | 'part' | 'paid' | 'unknown';
export interface StatementBill {
  invoice_id: number;
  invoice_number: string;
  invoice_date: string;
  total: number;
  paid: number;
  outstanding: number;
  days_old: number;
  state: BillState;
  lines: number;
  /** The invoice this one is a later part of ("12" for "12 (part 2)"), else null. */
  part_of: string | null;
}
export interface StatementRow {
  date: string;
  kind: 'bill' | 'payment';
  invoice_id: number;
  /** Invoice number the row belongs to. */
  ref: string;
  particulars: string;
  /** A bill: what the clinic owes. */
  credit: number;
  /** A payment: what the clinic paid. */
  debit: number;
  /** Credit − debit, running. */
  balance: number;
}
export interface SupplierStatement {
  as_of: string;
  from: string | null;
  to: string | null;
  totals: {
    bills: number;
    billed: number;
    paid: number;
    owed: number;
    open_bills: number;
    oldest_pending_days: number | null;
    last_bill_date: string | null;
    last_payment_date: string | null;
  };
  /** Balance owed at the start of the period shown (0 when no start date was chosen). */
  brought_forward: number;
  /** What the rows shown add up to. */
  period: { credit: number; debit: number; closing: number };
  /** Bills still owing, OLDEST first. */
  pending: StatementBill[];
  /** The newest bills first, whatever their state. */
  latest: StatementBill[];
  rows: StatementRow[];
  /** Bills whose paid amount was never recorded: shown apart, not in any total above. */
  unknown: StatementBill[];
}

/** Who the account is with — what the statement's heading prints. */
export interface StatementSupplier {
  id: number;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  drug_license_no: string;
  gstin: string | null;
  is_active: number;
}
/** What the app's `wholesalers.statement()` returns (and the demo's mock of it). */
export type SupplierStatementResult = SupplierStatement & { supplier: StatementSupplier };

const PART = /^(.*?)\s*\(part\s*(\d+)\)\s*$/i;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const dayNumber = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000); };
const rupees = (p: number) => fromPaise(p);

export function buildSupplierStatement(
  invoices: StatementInvoice[],
  payments: StatementPayment[],
  opts: { today: string; from?: string | null; to?: string | null; latest?: number },
): SupplierStatement {
  const today = opts.today.slice(0, 10);
  const from = opts.from ? opts.from.slice(0, 10) : null;
  const to = opts.to ? opts.to.slice(0, 10) : null;
  const byInvoice = new Map<number, StatementPayment[]>();
  for (const p of payments) (byInvoice.get(p.invoice_id) ?? byInvoice.set(p.invoice_id, []).get(p.invoice_id)!).push(p);

  const bills: (StatementBill & { totalP: number; paidP: number; owedP: number })[] = invoices.map((i) => {
    const mine = byInvoice.get(i.id) ?? [];
    const unknown = i.amount_paid === null && mine.length === 0;
    const totalP = toPaise(i.total);
    const paidP = unknown ? 0 : sum(mine.map((p) => toPaise(p.amount)));
    const owedP = unknown ? 0 : Math.max(0, totalP - paidP);
    const m = PART.exec(i.invoice_number);
    return {
      invoice_id: i.id, invoice_number: i.invoice_number, invoice_date: i.invoice_date.slice(0, 10),
      total: rupees(totalP), paid: rupees(paidP), outstanding: rupees(owedP),
      days_old: Math.max(0, dayNumber(today) - dayNumber(i.invoice_date)),
      state: unknown ? 'unknown' : owedP <= 0 ? 'paid' : paidP > 0 ? 'part' : 'unpaid',
      lines: i.line_count ?? 0,
      part_of: m ? m[1].trim() : null,
      totalP, paidP, owedP,
    };
  });
  const strip = ({ totalP: _t, paidP: _p, owedP: _o, ...b }: StatementBill & { totalP: number; paidP: number; owedP: number }): StatementBill => b;
  const known = bills.filter((b) => b.state !== 'unknown');
  const billOrder = (a: StatementBill, b: StatementBill) => a.invoice_date.localeCompare(b.invoice_date) || a.invoice_id - b.invoice_id;

  // ---- the passbook: bills (credit) and payments (debit) in date order; on one day the bill comes first ----
  type Ev = { date: string; order: number; id: number; row: Omit<StatementRow, 'balance'>; p: number };
  const events: Ev[] = [];
  for (const b of known) {
    events.push({
      date: b.invoice_date, order: 0, id: b.invoice_id, p: b.totalP,
      row: { date: b.invoice_date, kind: 'bill', invoice_id: b.invoice_id, ref: b.invoice_number,
        particulars: `Bill ${b.invoice_number}${b.lines ? ` · ${b.lines} item${b.lines === 1 ? '' : 's'}` : ''}${b.part_of ? ` · later part of ${b.part_of}` : ''}`,
        credit: b.total, debit: 0 },
    });
  }
  const numberOf = new Map(known.map((b) => [b.invoice_id, b.invoice_number]));
  for (const p of payments) {
    const ref = numberOf.get(p.invoice_id);
    if (ref === undefined) continue;                                      // a payment on a bill with an unknown balance cannot occur; ignore defensively
    const how = [p.payment_mode, p.reference].filter(Boolean).join(' · ');
    events.push({
      date: p.paid_on.slice(0, 10), order: 1, id: p.id, p: -toPaise(p.amount),
      row: { date: p.paid_on.slice(0, 10), kind: 'payment', invoice_id: p.invoice_id, ref,
        particulars: `Payment against ${ref}${how ? ` (${how})` : ''}${p.notes ? ` — ${p.notes}` : ''}`, credit: 0, debit: rupees(toPaise(p.amount)) },
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.id - b.id);

  let run = 0;
  let broughtForwardP = 0;
  const rows: StatementRow[] = [];
  let creditP = 0, debitP = 0;
  for (const e of events) {
    run += e.p;
    if (from && e.date < from) { broughtForwardP = run; continue; }
    if (to && e.date > to) continue;
    if (e.p > 0) creditP += e.p; else debitP += -e.p;
    rows.push({ ...e.row, balance: rupees(run) });
  }
  const closingP = broughtForwardP + creditP - debitP;

  // ---- tiles ----
  const billedP = sum(known.map((b) => b.totalP));
  const paidP = sum(known.map((b) => b.paidP));
  const pending = known.filter((b) => b.outstanding > 0).map(strip).sort(billOrder);
  const lastPay = payments.filter((p) => numberOf.has(p.invoice_id)).map((p) => p.paid_on.slice(0, 10)).sort().pop() ?? null;
  const lastBill = known.map((b) => b.invoice_date).sort().pop() ?? null;
  return {
    as_of: today, from, to,
    totals: {
      bills: invoices.length, billed: rupees(billedP), paid: rupees(paidP), owed: rupees(sum(known.map((b) => b.owedP))),
      open_bills: pending.length, oldest_pending_days: pending.length ? pending[0].days_old : null,
      last_bill_date: lastBill, last_payment_date: lastPay,
    },
    brought_forward: rupees(broughtForwardP),
    period: { credit: rupees(creditP), debit: rupees(debitP), closing: rupees(closingP) },
    pending,
    latest: bills.map(strip).sort((a, b) => billOrder(b, a)).slice(0, Math.max(1, opts.latest ?? 10)),
    rows,
    unknown: bills.filter((b) => b.state === 'unknown').map(strip).sort(billOrder),
  };
}
