/**
 * "How is this paid?" for a pharmacy sale — shared by the prescription dispense form and the counter sale form.
 *
 * With both Settings switches off (the default) it is the same Cash / Card / UPI buttons as always. When a clinic turns
 * on medicines on credit and/or charging an admitted patient's bill, the extra choices appear — but only where they can
 * work: credit needs a registered patient (so it is clear who owes), the in-patient charge needs a patient who is
 * admitted right now. A choice that cannot be used is shown greyed with the reason, never silently missing.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BedDouble, Clock } from 'lucide-react';
import { cn, formatINR } from '../../lib/utils';

export interface PayChoice {
  how: 'now' | 'credit' | 'ipd';
  /** Cash / Card / UPI — how the money is taken now (for credit: the part paid now). */
  mode: string;
  /** Credit only: what is paid now, as typed ('' = nothing). */
  paidNow: string;
}

export const initialPayChoice: PayChoice = { how: 'now', mode: 'Cash', paidNow: '' };

export interface PayOptions {
  creditOn: boolean;
  ipdOn: boolean;
  /** Credit can be used right now (switched on and a registered patient is picked). */
  creditOk: boolean;
  /** What this patient already owes from earlier bills and credit sales (0 when nothing, or when credit is off). */
  alreadyOwes: number;
  /** The patient's current stay, when charging the in-patient bill is switched on and they are admitted. */
  admission: { admission_id: number; admission_number: string; ward: string | null; bed_number: string | null; discharge_status: string } | null;
}

/** What the counter may offer for this patient. */
export function usePayOptions(patientId: number | null | undefined): PayOptions {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const creditOn = !!settings?.pharmacy_credit_enabled;
  const ipdOn = !!settings?.pharmacy_ipd_charge_enabled;
  const { data: admission = null } = useQuery({
    queryKey: ['pharmacy-patient-admission', patientId],
    queryFn: () => window.electronAPI.pharmacy.patientAdmission(patientId!),
    enabled: ipdOn && !!patientId,
  });
  // Same query (and cache) as the patient's billing portal: the figure here can never differ from the one there.
  const { data: portal } = useQuery({
    queryKey: ['billing-portal', patientId],
    queryFn: () => window.electronAPI.billing.patientPortal(patientId!),
    enabled: creditOn && !!patientId,
    staleTime: 15_000,
  });
  return {
    creditOn, ipdOn, creditOk: creditOn && !!patientId,
    alreadyOwes: creditOn && patientId ? Math.max(0, Number(portal?.summary?.outstanding) || 0) : 0,
    admission: ipdOn && patientId ? admission : null,
  };
}

/** The part of the sale payload this choice decides. */
export function payFields(c: PayChoice, o: PayOptions): { payment_mode?: string; credit?: boolean; paid_now?: number; ipd_admission_id?: number } {
  if (c.how === 'ipd' && o.admission) return { ipd_admission_id: o.admission.admission_id };
  if (c.how === 'credit') return { payment_mode: c.mode, credit: true, paid_now: Number(c.paidNow) || 0 };
  return { payment_mode: c.mode };
}

/** Why this sale cannot be recorded as chosen — or null when it can. Shown under the buttons and used to disable "Record". */
export function payProblem(c: PayChoice, o: PayOptions, total: number, discount: number): string | null {
  if (c.how === 'credit') {
    if (!o.creditOk) return 'Pick a registered patient to sell on credit.';
    const now = Number(c.paidNow) || 0;
    if (now < 0) return 'The amount paid now cannot be negative.';
    if (now > total + 0.001) return `The amount paid now is more than the bill (${formatINR(total)}).`;
  }
  if (c.how === 'ipd') {
    if (!o.admission) return 'This patient is not admitted — take the payment now instead.';
    if (o.admission.discharge_status === 'requested') return 'A discharge is being prepared for this patient — take the payment now instead.';
    if (discount > 0) return 'Remove the discount: a discount on an in-patient bill is given on the bill itself.';
  }
  return null;
}

/** One line for the toast after the sale. */
export function payDoneText(c: PayChoice, o: PayOptions, total: number): string {
  if (c.how === 'ipd' && o.admission) return `charged to ${o.admission.admission_number}'s bill — ${formatINR(total)}`;
  if (c.how === 'credit') {
    const left = Math.max(0, total - (Number(c.paidNow) || 0));
    return left > 0.004 ? `${formatINR(total)}, ${formatINR(left)} still to pay` : formatINR(total);
  }
  return formatINR(total);
}

const MODES = ['Cash', 'Card', 'UPI'];

export function SalePaymentChoice({ value, onChange, options, total, discount, accent = 'emerald' }: {
  value: PayChoice;
  onChange: (v: PayChoice) => void;
  options: PayOptions;
  total: number;
  discount: number;
  accent?: 'emerald' | 'blue';
}) {
  const { creditOn, ipdOn, creditOk, admission, alreadyOwes } = options;
  // A choice that stops being usable (another patient picked, patient removed) falls back to paying now.
  useEffect(() => {
    if ((value.how === 'credit' && !creditOk) || (value.how === 'ipd' && !admission)) onChange({ ...value, how: 'now' });
  }, [value, creditOk, admission, onChange]);

  const on = accent === 'blue' ? 'bg-blue-600 text-white border-blue-600' : 'bg-emerald-600 text-white border-emerald-600';
  const off = 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200';
  const problem = payProblem(value, options, total, discount);
  const modeButtons = (
    <div className="flex gap-2">
      {MODES.map((m) => (
        <button key={m} type="button" onClick={() => onChange({ ...value, mode: m })}
          className={cn('px-3 py-1.5 text-xs rounded-md border', value.mode === m ? on : off)}>{m}</button>
      ))}
    </div>
  );

  // Nothing extra is switched on: exactly the old control.
  if (!creditOn && !ipdOn) {
    return (<div><div className="label">Payment Mode</div>{modeButtons}</div>);
  }

  const how = (h: PayChoice['how'], label: string, usable: boolean, why: string, icon?: React.ReactNode) => (
    <button key={h} type="button" disabled={!usable} title={usable ? undefined : why}
      onClick={() => onChange({ ...value, how: h })}
      className={cn('px-3 py-1.5 text-xs rounded-md border inline-flex items-center gap-1.5',
        value.how === h ? on : off, !usable && 'opacity-50 cursor-not-allowed')}>
      {icon}{label}
    </button>
  );
  const owed = Math.max(0, total - (Number(value.paidNow) || 0));

  return (
    <div className="space-y-2">
      <div className="label">How is it paid?</div>
      <div className="flex gap-2 flex-wrap">
        {how('now', 'Paid now', true, '')}
        {creditOn && how('credit', 'On credit', creditOk, 'Pick a registered patient first — a sale on credit must say who owes the money.', <Clock className="w-3 h-3" />)}
        {ipdOn && how('ipd', 'Charge to IPD bill', !!admission, 'This patient is not admitted right now.', <BedDouble className="w-3 h-3" />)}
      </div>

      {value.how === 'now' && modeButtons}

      {value.how === 'credit' && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-900/20 p-2.5 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[11px] text-gray-700 dark:text-slate-300">Paid now (₹)</label>
            <input type="number" min={0} step="0.01" className="input w-28 text-right py-1" placeholder="0"
              value={value.paidNow} onChange={(e) => onChange({ ...value, paidNow: e.target.value })} />
            {(Number(value.paidNow) || 0) > 0 && modeButtons}
          </div>
          {alreadyOwes > 0.004 && (
            <div className="text-[11px] font-semibold text-red-700 dark:text-red-300">
              Note: this patient already owes {formatINR(alreadyOwes)} from earlier bills.
            </div>
          )}
          <div className="text-[11px] text-amber-900 dark:text-amber-200">
            {owed > 0.004
              ? <><b>{formatINR(owed)}</b> will stay owing against this patient until it is paid — you will see it in Billing, Accounts and Analytics → Receivables.</>
              : 'The whole bill is paid now, so this is an ordinary sale.'}
          </div>
        </div>
      )}

      {value.how === 'ipd' && admission && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-900/20 p-2.5 text-[11px] text-blue-900 dark:text-blue-200">
          Goes onto the running bill of <b>{admission.admission_number}</b>
          {admission.ward ? ` · ${admission.ward}` : ''}{admission.bed_number ? ` · bed ${admission.bed_number}` : ''}. No money is taken now — it is
          collected with the rest of the in-patient bill. Priced like any other sale: the selling price of the batch it comes from (its MRP when none was set).
        </div>
      )}

      {problem && <div className="text-[11px] text-red-600 dark:text-red-400">{problem}</div>}
    </div>
  );
}
