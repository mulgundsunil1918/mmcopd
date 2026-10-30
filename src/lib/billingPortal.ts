/**
 * Billing portal shapes — what the Billing screen, Accounts and Analytics receive from main/billing-portal.ts.
 *
 * Types only (no database, no Electron) so the preload bridge and the screens can import them without pulling in
 * the main process. The rules that fill them live in main/billing-portal.ts.
 */

/** 'pharmacy' = medicines sold from stock (a counter sale / dispensing); 'pharmacy_manual' = a hand-typed pharmacy bill that
 *  never touched stock, cost or profit. They are kept apart everywhere. */
export type PortalKind = 'consultation' | 'lab' | 'radiology' | 'service' | 'pharmacy' | 'pharmacy_manual' | 'ipd';
export type PortalStatus = 'paid' | 'part_paid' | 'unpaid' | 'cancelled';

export interface PortalLine {
  /** Unique within the list ("bill:12", "sale:7"). */
  key: string;
  source: 'bill' | 'pharmacy_sale';
  kind: PortalKind;
  number: string;
  /** UTC timestamp as stored; the screen shows it in the PC's time zone. */
  date: string;
  title: string;
  detail: string;
  doctor_name: string | null;
  total: number;
  /** Payments received against this bill. */
  paid: number;
  /** In-patient advance deposits counted towards this bill. */
  advance: number;
  due: number;
  status: PortalStatus;
  payment_mode: string | null;
  bill_id: number | null;
  sale_id: number | null;
  admission_id: number | null;
  /** In-patient only: still admitted, so the bill is still growing. */
  running: boolean;
  /** Pharmacy sale made under this patient's name at the counter. */
  counter_sale: boolean;
}

export type PortalTodoKind = 'bill_due' | 'ipd_running' | 'consultation_unbilled' | 'lab_unbilled' | 'radiology_unbilled' | 'rx_pending';

export interface PortalTodo {
  key: string;
  kind: PortalTodoKind;
  title: string;
  detail: string;
  /** Local date (visits / prescriptions) or UTC timestamp (orders / bills) — see `date_is_local`. */
  date: string;
  date_is_local: boolean;
  /** What billing this would charge, when it is known (doctor's fee, or the sum of the tests' prices). */
  amount: number | null;
  /** For a due bill / running admission: what is still owed. */
  due: number | null;
  appointment_id: number | null;
  order_id: number | null;
  bill_id: number | null;
  /** A pharmacy sale made on credit that still owes money (collect it with `pharmacy.payCredit`). */
  sale_id: number | null;
  admission_id: number | null;
}

export interface PatientPortal {
  patient: {
    id: number; uhid: string; name: string; phone: string | null; dob: string | null; gender: string | null; address: string | null;
  };
  summary: {
    billed: number;
    received: number;
    outstanding: number;
    /** Advance deposits not yet used by a bill or refunded — money held for the patient. */
    credit_held: number;
    bills: number;
    pharmacy_sales: number;
    to_bill_count: number;
  };
  todo: PortalTodo[];
  history: PortalLine[];
}

export type OrderBillResult =
  | { ok: true; bill_id: number; bill_number: string; total: number }
  | { ok: false; error: string; needs_confirm?: boolean };

export interface OutstandingBill {
  /** 'bill' = a row in bills; 'pharmacy_sale' = a pharmacy sale made on credit. */
  source: 'bill' | 'pharmacy_sale';
  /** 0 for a pharmacy sale. */
  bill_id: number;
  sale_id: number | null;
  /** The bill number, or the pharmacy sale number. */
  bill_number: string;
  patient_id: number | null;
  /** The patient's name, or the name typed for a walk-in bill. */
  name: string;
  uhid: string | null;
  kind: PortalKind;
  /** UTC timestamp as stored. */
  created_at: string;
  total: number;
  paid: number;
  advance: number;
  due: number;
  /** Whole days since the bill was raised (the clinic's calendar). */
  age_days: number;
}

export interface Receivables {
  total_due: number;
  bills_due: number;
  patients_due: number;
  by_kind: { kind: PortalKind; label: string; bills: number; due: number }[];
  by_patient: { patient_id: number | null; name: string; uhid: string | null; bills: number; due: number; oldest_days: number }[];
  /** How long the money has been outstanding, by the bill's date. */
  aging: { label: string; bills: number; due: number }[];
}

export interface Collections {
  /** Received in the period, by how it was paid. */
  by_mode: { payment_mode: string; count: number; total: number }[];
  total: number;
  /** Where the total came from, so the figure can be checked against each screen. */
  by_source: {
    /** Payments entered against a bill afterwards (instalments, in-patient payments). */
    bill_payments: number;
    /** Bills paid in full the moment they were raised (OPD, lab, radiology, services). */
    paid_at_billing: number;
    /** Pharmacy sales — what was taken at the counter when the sale was made. */
    pharmacy_counter: number;
    /** Payments taken later against pharmacy sales made on credit. */
    pharmacy_credit_payments: number;
    /** In-patient deposits received (less any refunded) — money in before there is a bill to pay. */
    ipd_deposits: number;
  };
}

export interface DailyCollectionRow {
  day: string;
  /** Bills raised that day (cancelled ones left out). */
  bills: number;
  /** Total of those bills — billed, whether or not it has all been paid yet. */
  revenue: number;
  /** Of the bills' total, what was marked as paid in cash / card / UPI when it was raised. */
  cash: number;
  card: number;
  upi: number;
  /** Pharmacy counter sales that day (sold under a patient or to a guest). */
  pharmacy_sales: number;
  pharmacy: number;
  /** Money actually received that day, by every route — what the till should hold. */
  received: number;
}

export interface UnbilledItem {
  kind: 'lab' | 'radiology' | 'visit';
  patient_id: number;
  name: string;
  uhid: string | null;
  title: string;
  /** UTC timestamp (orders) or local date (visits) — see `date_is_local`. */
  date: string;
  date_is_local: boolean;
  amount: number;
}

/** Work that was done (or booked) but has no bill — money that could be charged and is not yet. */
export interface UnbilledWork {
  days: number;
  lab: { orders: number; value: number };
  radiology: { orders: number; value: number };
  visits: { count: number; value: number };
  total_value: number;
  /** The biggest and oldest first, so the desk can start from the top. */
  items: UnbilledItem[];
}

export interface DiscountRow {
  kind: 'bill' | 'pharmacy';
  number: string;
  /** UTC timestamp as stored. */
  date: string;
  patient: string;
  uhid: string | null;
  amount: number;
  reason: string | null;
  by: string | null;
}

/** Discounts given in a period, on bills and on pharmacy sales — so every concession can be accounted for. */
export interface DiscountsGiven {
  bills: { count: number; value: number };
  pharmacy: { count: number; value: number };
  total_value: number;
  /** Discount as a share of what was charged before any discount (bills + counter pharmacy); null with nothing billed. */
  pct_of_gross: number | null;
  largest: DiscountRow[];
}

/**
 * Hand-typed pharmacy bills (Quick Bill → Pharmacy) over a period. Nothing moved out of stock for these, so they have no
 * cost and no profit; they are reported here and nowhere in the stock-based Pharmacy analytics.
 */
export interface ManualPharmacy {
  from: string;
  to: string;
  bills: number;
  billed: number;
  discount: number;
  /** Received on the bills of this period. */
  collected: number;
  /** Still unpaid on the bills of this period. */
  still_owed: number;
  /** Unpaid on ALL hand-typed pharmacy bills, whenever they were raised (the Receivables figure for this kind). */
  owed_now: number;
  by_mode: { mode: string; count: number; total: number }[];
  by_day: { day: string; bills: number; total: number }[];
  by_customer: { kind: 'patient' | 'walk-in'; count: number; total: number }[];
  largest: { bill_number: string; created_at: string; name: string; total: number; due: number; payment_mode: string | null }[];
}

/** First-run setup guide — where a freshly installed clinic stands (see main/setup.ts). */
export type SetupStepKey = 'computers' | 'clinic' | 'doctors' | 'fees' | 'staff' | 'pharmacy' | 'inpatient';
export interface SetupStatus {
  show: boolean;
  status: 'pending' | 'skipped' | 'done';
  clinic_named: boolean;
  clinic_name: string;
  existing_clinic: boolean;
  steps: Record<SetupStepKey, 'todo' | 'done' | 'skipped'>;
  reminder: boolean;
}

