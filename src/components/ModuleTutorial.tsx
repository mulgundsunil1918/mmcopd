import { useState } from 'react';
import { HelpCircle, X, CheckCircle2, ArrowRight, Settings as Cog, Play } from 'lucide-react';
import { Modal } from './Modal';
import type { AppMode } from '../types';

/**
 * Per-setup tutorials. A clinic picking a mode ("OPD only", "OPD + Pharmacy",
 * "Full hospital with IPD", …) can read exactly what that setup includes, how
 * to configure it, and the daily workflow — in plain language, no jargon.
 *
 * Rendered from a "Learn about this setup" link under each App Mode card, and
 * reusable anywhere a module needs a (?) explainer.
 */
export interface TutorialSection { heading: string; points: string[] }
export interface Tutorial {
  title: string;
  forWho: string;
  setup: string[];      // one-time setup steps
  workflow: string[];   // daily flow
  configure: string[];  // where to customise
}

export const MODULE_TUTORIALS: Record<AppMode, Tutorial> = {
  reception: {
    title: 'Reception only',
    forWho: 'A front desk that registers patients, books appointments and bills — no doctor screen or pharmacy in the software.',
    setup: [
      'Fill Settings → Clinic with your clinic name, address, phone and logo — these print on every slip and bill.',
      'Add your doctors under Settings → Doctors & Templates so appointments can be booked under them.',
      'Set the consultation fee and registration fee under Settings → Fees & Workflow.',
    ],
    workflow: [
      'Register a walk-in patient (a UHID is generated automatically).',
      'Book an appointment under a doctor; a token number is assigned.',
      'Raise a bill from the global “New Bill” button — consultation, or anything custom.',
      'Track the day’s collection under Accounts.',
    ],
    configure: [
      'Fees & Workflow → consultation and registration fees, free follow-up policy.',
      'Billing & IPD → GST, invoice number format, discount limits per role.',
    ],
  },
  reception_pharmacy: {
    title: 'Reception + Pharmacy',
    forWho: 'A chemist counter, or a clinic where the pharmacy runs without a doctor screen in the software.',
    setup: [
      'Everything in Reception setup, plus:',
      'Build your drug master under Pharmacy → add medicines with HSN code and GST rate.',
      'Record opening stock as a purchase so batches and expiry are tracked (FEFO).',
    ],
    workflow: [
      'Dispense medicines at the counter; stock reduces from the earliest-expiry batch automatically.',
      'Schedule H / H1 sales are written to the compliance register.',
      'Raise a pharmacy bill for the patient.',
    ],
    configure: [
      'Each drug’s GST rate drives the tax on pharmacy bills (when GST is enabled).',
      'Billing & IPD → enable GST and enter your GSTIN to print tax invoices.',
    ],
  },
  reception_doctor: {
    title: 'Reception + Doctor',
    forWho: 'A doctor’s clinic with a front desk, where prescriptions are taken to an outside chemist.',
    setup: [
      'Everything in Reception setup, plus:',
      'Assign each doctor an OPD slip template under Settings → Doctors & Templates (General, OBG, Pediatrics, …).',
      'Set vitals and the sections you want on the consultation screen.',
    ],
    workflow: [
      'Reception books the patient; the doctor sees them in their dashboard by token.',
      'The doctor records vitals, history and prescription, then prints the OPD slip.',
      'Reception bills the consultation.',
    ],
    configure: [
      'Doctors & Templates → per-specialty slip layouts.',
      'Fees & Workflow → free follow-up window so repeat visits are handled automatically.',
    ],
  },
  reception_pharmacy_doctor: {
    title: 'Reception + Doctor + Pharmacy',
    forWho: 'The most common single-clinic setup — front desk, doctor, and an in-house pharmacy that fills from the doctor’s prescription.',
    setup: [
      'Everything in the Doctor and Pharmacy setups above.',
      'The prescription flows to the pharmacy so dispensing auto-fills from the doctor’s Rx.',
    ],
    workflow: [
      'Reception → doctor consultation → prescription → pharmacy dispenses → one visit, billed per section.',
      'Schedule H compliance is maintained automatically.',
    ],
    configure: [
      'Billing & IPD → charge heads (consultation, procedures) with colours.',
      'Fees & Workflow and Doctors & Templates as above.',
    ],
  },
  reception_pharmacy_doctor_lab: {
    title: 'Polyclinic (+ Laboratory)',
    forWho: 'A polyclinic that also runs its own laboratory.',
    setup: [
      'Everything above, plus:',
      'Build the lab test catalogue under Laboratory.',
      'Set who accepts orders and enters results (the Lab Tech role).',
    ],
    workflow: [
      'The doctor orders investigations from the consultation screen.',
      'The lab collects the sample, enters results, and the report prints on your letterhead.',
      'Lab charges post to the patient’s bill.',
    ],
    configure: [
      'Laboratory → test catalogue and reference ranges.',
      'Users & Access → add a Lab Tech login.',
    ],
  },
  full: {
    title: 'Full hospital (+ IPD)',
    forWho: 'A hospital with in-patient admissions — wards, beds, ward care and discharge.',
    setup: [
      'Everything above, plus:',
      'Settings → Billing & IPD → Wards & Beds: add each ward with its daily rate, then its beds (a range like G-01..G-10 adds ten at once).',
      'Add nurse and ward-in-charge logins under Users & Access.',
      'Set which charges auto-post each day (bed, nursing, doctor visit) under Billing & IPD.',
    ],
    workflow: [
      'A doctor requests an admission from OPD, or reception admits directly from the ward map.',
      'Reception picks a free bed; the running bill opens automatically.',
      'Nurses record vitals, medicines given, intake/output and notes; charges accrue daily.',
      'On discharge, pick the outcome (discharged / LAMA / DAMA / death / referred), the bill is finalised, and the discharge summary prints.',
    ],
    configure: [
      'Billing & IPD → wards, bed rates, accrual rules, transfer charge rule.',
      'Billing & IPD → Pediatrics add-on if you see children.',
      'Discharge summary templates (department / doctor-wise) so summaries are one click.',
    ],
  },
};

export function ModuleTutorialButton({ mode, className }: { mode: AppMode; className?: string }) {
  const [open, setOpen] = useState(false);
  const t = MODULE_TUTORIALS[mode];
  if (!t) return null;
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-300 hover:underline ${className || ''}`}
      >
        <HelpCircle className="w-3.5 h-3.5" /> Learn about this setup
      </button>
      {open && <TutorialModal tutorial={t} onClose={() => setOpen(false)} />}
    </>
  );
}

function TutorialModal({ tutorial: t, onClose }: { tutorial: Tutorial; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={t.title} size="lg">
      <div className="space-y-4 text-[13px]">
        <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3">
          <div className="text-[10px] uppercase tracking-wide font-bold text-blue-700 dark:text-blue-300 mb-1">Who it’s for</div>
          <div className="text-gray-800 dark:text-slate-200">{t.forWho}</div>
        </div>

        <Section icon={Cog} title="One-time setup" tone="emerald" items={t.setup} />
        <Section icon={Play} title="Daily workflow" tone="violet" items={t.workflow} />
        <Section icon={ArrowRight} title="Where to customise" tone="amber" items={t.configure} />
      </div>
    </Modal>
  );
}

const TONE: Record<string, string> = {
  emerald: 'text-emerald-600', violet: 'text-violet-600', amber: 'text-amber-600',
};

function Section({ icon: Icon, title, items, tone }: { icon: any; title: string; items: string[]; tone: string }) {
  return (
    <div>
      <div className={`flex items-center gap-1.5 text-[12px] font-bold mb-1.5 ${TONE[tone]}`}>
        <Icon className="w-4 h-4" /> {title}
      </div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-gray-700 dark:text-slate-300">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-300 dark:text-slate-600" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
