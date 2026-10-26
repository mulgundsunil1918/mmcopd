import type { Candidate, MatchKind } from './match';
import type { ItemType } from './items';

/** What a medicine looked-up by ChatGPT says it is — advisory only, never saved without a person's say. */
export interface LineLookup {
  brand: string; generic: string; strength: string; form: string;
  source: string; confidence: 'High' | 'Medium' | 'Low' | '';
}

/** A medicine the bill names that is not on the Drug List: what the clinic will add if the person says so. */
export interface NewDrugSpec {
  name: string;
  generic_name: string;
  form: string;
  strength: string;
  schedule: 'OTC' | 'H' | 'H1' | 'G' | 'X';
  pack_size: number | null;
  hsn_code: string;
  /** A syringe, a cannula, a suture, a bed sheet… is a consumable: no generic name, strength or schedule, and it may print no batch or expiry. Absent = medicine. */
  item_type?: ItemType;
}

export interface DraftLine {
  /** 1…n, stable while the screen is open. */
  id: number;
  /** The spreadsheet row, so a message can say "Row 7". */
  row: number;
  line_no: string;
  /** Copied from the bill, never changed. */
  printed_name: string;
  lookup: LineLookup;
  pack: string;
  manufacturer: string;
  hsn: string;
  batch: string;
  /** ISO date (the last day of the month when only a month was given), or '' when it could not be read. */
  expiry: string;
  expiry_printed: string;
  /** Why the expiry could not be read, when it could not. */
  expiry_problem: string;
  qty: number | null;
  free_qty: number;
  mrp: number | null;
  rate: number | null;
  disc_pct: number;
  /** The bill has no discount column: the percentage was worked out from this line's printed amount (and the discounts add up to the bill's printed discount). */
  disc_derived?: boolean;
  /** The medicine chosen for this line is a consumable (a new one is judged from `new_drug.item_type` instead). A consumable may have no batch or expiry. */
  consumable?: boolean;
  gst_rate: number | null;
  selling_price: number | null;
  printed_amount: number | null;
  /** ChatGPT's own notes on the line. */
  flags: string;
  // ---- the person's choices ----
  drug_id: number | null;
  new_drug: NewDrugSpec | null;
  /** The person has accepted a match that was not certain. */
  confirmed: boolean;
  /** Left out of this import; kept in the waiting list to be finished later. */
  aside: boolean;
  /** How the name was matched (computed when the file is read). */
  match: { kind: MatchKind; candidates: Candidate[]; composition: 'agree' | 'differ' | 'unknown' };
  /** What "Add as a new medicine" starts from: the bill's name, the lookup's composition, the schedule left for the person to check. */
  suggested_new: NewDrugSpec;
}

export interface PrintedTotals {
  subtotal: number | null; discount: number | null; cgst: number | null; sgst: number | null; igst: number | null;
  round_off: number | null; other: number | null; net: number | null;
}

export interface DraftBill {
  supplier_name: string;
  supplier_gstin: string;
  supplier_license: string;
  /** An existing supplier this bill is from (matched by GSTIN or name, or picked); null = to be added. */
  wholesaler_id: number | null;
  invoice_number: string;
  /** ISO date. */
  invoice_date: string;
  invoice_date_printed: string;
  payment_terms: string;
  printed: PrintedTotals;
  pages_seen: string;
  notes: string;
  // ---- worked out from the bill, editable ----
  /** A discount on the WHOLE bill, ₹ (the line discounts are already in each line). */
  discount: number;
  /** `discount` was worked out from the bill (the printed discount less the lines' own) and follows the lines when they are corrected; typing in the box makes it the person's own. */
  discount_auto?: boolean;
  other_charges: number;
  round_off: 'auto' | number;
  interstate: boolean;
  paid_now: number;
  pay_mode: string;
  /** The person has looked at the difference between the bill's total and the lines and accepts it. */
  totals_ack: boolean;
  /** Another part of a bill already imported ("12 (part 2)"). */
  part_of: string;
  /** Suppliers in the Wholesalers list that look like the one on the bill (when none matched outright). */
  supplier_suggestions: { id: number; name: string; reason: string }[];
}

export interface Draft {
  bill: DraftBill;
  lines: DraftLine[];
}

export type Severity = 'error' | 'warn' | 'info';
export interface Problem {
  code: string;
  severity: Severity;
  /** The line this is about (DraftLine.id), or null for the bill as a whole. */
  line: number | null;
  field?: string;
  message: string;
}

/** One figure of the bill's footer against the same figure from the lines — says WHERE a difference is (the sub total? the discount? the GST?). */
export interface ReconPart { label: string; printed: number; lines: number; diff: number }

export interface Reconciliation {
  /** What the bill says is payable. */
  printed_net: number | null;
  /** What CureDesk makes the lines being imported come to (with the discount, charges and round-off shown). */
  computed_total: number;
  /** The printed amounts of the lines set aside. */
  aside_printed: number;
  /** printed_net − (computed_total + aside_printed): zero when everything adds up. */
  difference: number | null;
  ok: boolean;
  /** The footer's own figures against the lines', for each figure the bill printed (empty when none was printed). */
  parts?: ReconPart[];
}

// ---------------------------------------------------------------------------------------------------------------- between the screen and the app
/** Reading the uploaded Excel: a draft to review, or a plain list of what is wrong with the file. */
export type ParseResult =
  | { ok: true; draft: Draft; notices: string[]; duplicate: { id: number; date: string } | null }
  | { ok: false; problems: string[] };

export interface ImportCommit {
  draft: Draft;
  /** The typed word. Must be IMPORT. */
  confirm: string;
  /** One per attempt: a repeat returns the first save. */
  client_ref: string;
  /** The bill's picture or PDF, as base64 text (a multi-PC clinic sends every call to the host as JSON, which cannot carry raw bytes). */
  photo?: { name: string; base64: string } | null;
  /** The waiting draft this finishes (it is closed when the part is saved). */
  waiting_id?: number | null;
  /** True when the clinic cannot claim the GST back, so it becomes part of what the stock cost (the screen worked its figures out with this). */
  gst_in_cost?: boolean;
}

export type ImportResult =
  | { ok: true; duplicate: boolean; invoice_id: number; invoice_number: string; lines: number; batches: number; total: number; new_drugs: number; reactivated: number; new_supplier: boolean; aliases_saved: number; waiting_id: number | null; aside: number }
  | { ok: false; error: string; problems?: Problem[] };

export interface WaitingRow { id: number; supplier_name: string | null; invoice_number: string; invoice_date: string | null; line_count: number; imported_invoice_id: number | null; created_at: string; has_photo: boolean }

export type WaitingGet = { ok: true; draft: Draft; scan_path: string | null } | { ok: false; error: string };
