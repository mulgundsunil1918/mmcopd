import { useState } from 'react';
import { CheckCircle2, FileText, Printer, Receipt, Stethoscope, User } from 'lucide-react';
import { Modal } from './Modal';
import { OpdSlipFor } from './OpdSlipFor';
import { BillPrint } from './billing/BillPrint';
import { fmt12h, fmtDate, fmtDateTime, formatINR } from '../lib/utils';
import type { AppointmentWithJoins } from '../types';

/**
 * Shown the moment an appointment is booked and paid.
 *
 * It used to jump straight into the OPD slip preview, so the consultation BILL — raised
 * in the same step — was never offered at the counter and the receptionist had to go
 * hunting for it in Billing. Now both papers are one tap away:
 *   • Print Consultation Paper — the OPD slip the doctor writes on
 *   • Print Consultation Bill  — the receipt for what the patient just paid
 *   • Print Both               — the paper, then the bill, one after the other
 */
export function BookingDoneDialog({
  appt, bill, onClose,
}: {
  appt: AppointmentWithJoins;
  /** The bill raised at booking (null if billing was skipped). */
  bill: { id: number; bill_number?: string; total?: number; payment_mode?: string } | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<null | 'paper' | 'bill'>(null);
  const [both, setBoth] = useState(false);
  const hasBill = !!bill?.id;

  // Each print screen replaces the dialog while it is open, and returns here when closed.
  if (step === 'paper') {
    return (
      <OpdSlipFor
        appointment={appt}
        onClose={() => {
          if (both && hasBill) setStep('bill');
          else { setStep(null); setBoth(false); }
        }}
      />
    );
  }
  if (step === 'bill' && hasBill) {
    return <BillPrint billId={Number(bill!.id)} onClose={() => { setStep(null); setBoth(false); }} />;
  }

  const when = `${fmtDate(appt.appointment_date)} · ${fmt12h(appt.appointment_time)}`;
  const tile = 'w-full text-left rounded-xl border-2 p-3.5 flex items-center gap-3 transition focus:outline-none focus:ring-2 focus:ring-blue-400';

  return (
    <Modal open onClose={onClose} title="Appointment booked" size="md">
      <div className="space-y-4">
        {/* What was booked */}
        <div className="flex items-start gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3.5">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300 leading-none">Token #{appt.token_number}</span>
              <span className="text-xs text-emerald-800/80 dark:text-emerald-200/80">{when}</span>
            </div>
            <div className="mt-1.5 text-sm text-gray-900 dark:text-slate-100 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-gray-500" />
              <b className="truncate">{appt.patient_name}</b>
              <span className="text-gray-500 dark:text-slate-400 text-xs">{appt.patient_uhid}</span>
            </div>
            <div className="text-[13px] text-gray-700 dark:text-slate-300 flex items-center gap-1.5">
              <Stethoscope className="w-3.5 h-3.5 text-gray-500" />
              {appt.doctor_name}{appt.doctor_room ? ` · Room ${appt.doctor_room}` : ''}
            </div>
            {appt.referred_by && (
              <div className="text-[12px] text-gray-600 dark:text-slate-400 mt-0.5">Referral <b>{appt.referred_by}</b></div>
            )}
            {appt.patient_created_at && (
              <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">Patient registered {fmtDateTime(appt.patient_created_at)}</div>
            )}
            {hasBill && (
              <div className="text-[12px] text-gray-700 dark:text-slate-300 mt-1">
                Paid <b>{formatINR(Number(bill!.total || 0))}</b>{bill!.payment_mode ? ` · ${bill!.payment_mode}` : ''}{bill!.bill_number ? ` · ${bill!.bill_number}` : ''}
              </div>
            )}
          </div>
        </div>

        {/* What to print */}
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Print now</div>

          <button type="button" autoFocus onClick={() => { setBoth(false); setStep('paper'); }}
            className={`${tile} border-blue-300 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20`}>
            <FileText className="w-6 h-6 text-blue-600 flex-shrink-0" />
            <span>
              <span className="block text-sm font-semibold text-gray-900 dark:text-slate-100">Print Consultation Paper</span>
              <span className="block text-[11px] text-gray-500 dark:text-slate-400">The OPD slip for the doctor — vitals, history, Rx.</span>
            </span>
          </button>

          <button type="button" disabled={!hasBill} onClick={() => { setBoth(false); setStep('bill'); }}
            className={`${tile} ${hasBill ? 'border-amber-300 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-900/20' : 'border-gray-200 dark:border-slate-700 opacity-50 cursor-not-allowed'}`}>
            <Receipt className="w-6 h-6 text-amber-600 flex-shrink-0" />
            <span>
              <span className="block text-sm font-semibold text-gray-900 dark:text-slate-100">Print Consultation Bill</span>
              <span className="block text-[11px] text-gray-500 dark:text-slate-400">{hasBill ? 'The receipt for what the patient just paid.' : 'No bill was raised for this booking.'}</span>
            </span>
          </button>

          <button type="button" disabled={!hasBill} onClick={() => { setBoth(true); setStep('paper'); }}
            className={`${tile} ${hasBill ? 'border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/20' : 'border-gray-200 dark:border-slate-700 opacity-50 cursor-not-allowed'}`}>
            <Printer className="w-6 h-6 text-emerald-600 flex-shrink-0" />
            <span>
              <span className="block text-sm font-semibold text-gray-900 dark:text-slate-100">Print Both</span>
              <span className="block text-[11px] text-gray-500 dark:text-slate-400">The paper first, then the bill — press Close after the first one to continue.</span>
            </span>
          </button>
        </div>

        <div className="flex justify-end pt-1">
          <button className="btn-secondary" onClick={onClose}>Done — print later</button>
        </div>
      </div>
    </Modal>
  );
}
