/**
 * Help & Tutorials — the in-app manual.
 *
 * A clinic should never have to phone support to learn its own software, and a
 * printed manual goes stale the day it's printed. Every module is explained here
 * in the order a real clinic day happens, in plain language, with the exact menu
 * path for each action.
 *
 * Searchable, because nobody reads a manual front-to-back — they arrive with one
 * question ("how do I discharge a patient?") and need the answer in one screen.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen, Search, ChevronDown, Users, Calendar, Stethoscope, Pill, FlaskConical,
  BedDouble, Receipt, Syringe, Activity, HardDrive, Wifi, ShieldCheck, MessageSquare, Baby,
} from 'lucide-react';
import { cn } from '../lib/utils';

type Topic = {
  id: string;
  icon: any;
  title: string;
  tag: string;
  /** Everything searchable, flattened — keeps search honest without parsing JSX. */
  keywords: string;
  body: React.ReactNode;
};

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <li className="flex gap-2.5">
    <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center mt-0.5">{n}</span>
    <span className="flex-1">{children}</span>
  </li>
);
const Path = ({ children }: { children: React.ReactNode }) => (
  <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-800 text-[11px] font-mono">{children}</code>
);
const Tip = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 p-2.5 text-[12px] text-blue-900 dark:text-blue-100">{children}</div>
);
const Warn = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-2.5 text-[12px] text-amber-900 dark:text-amber-100">{children}</div>
);

const TOPICS: Topic[] = [
  {
    id: 'start', icon: BookOpen, title: 'First-time setup — start here', tag: 'Getting started',
    keywords: 'first setup start begin new install clinic name logo backup admin password getting started',
    body: (
      <>
        <p>Do these five things once, in this order, and the rest of the app behaves properly.</p>
        <ol className="space-y-2 mt-2">
          <Step n={1}><b>Fill in your clinic details</b> — <Path>Settings → Clinic → Clinic Identity</Path>. Name, address, phone, logo. This becomes the letterhead on every slip and bill.</Step>
          <Step n={2}><b>Add your doctors</b> — <Path>Settings → Doctors</Path>. Name, specialty, room number, consultation fee.</Step>
          <Step n={3}><b>Set the admin password</b> — the app asks on first run. This PIN guards Settings, Users and anything destructive.</Step>
          <Step n={4}><b>Choose a backup folder</b> — the app asks on first run. Pick a Google Drive or OneDrive folder so a copy lives outside this computer.</Step>
          <Step n={5}><b>Set your fees</b> — <Path>Settings → Fees &amp; Workflow</Path>. Consultation fee, registration fee, free follow-up policy.</Step>
        </ol>
        <div className="mt-2"><Tip>Every settings section has a <b>?</b> beside its heading. Click it for a plain-language explanation of what that section does.</Tip></div>
      </>
    ),
  },
  {
    id: 'reception', icon: Users, title: 'Reception — registering patients', tag: 'Daily use',
    keywords: 'reception register patient new patient uhid search walk-in front desk registration fee',
    body: (
      <>
        <ol className="space-y-2">
          <Step n={1}>Click <b>New Patient</b> (or press <Path>Ctrl+N</Path> from anywhere).</Step>
          <Step n={2}>Fill name, age/date of birth, gender, phone. Village and district pre-fill from your defaults.</Step>
          <Step n={3}>Save. The patient gets a permanent <b>UHID</b> — their file number for life.</Step>
          <Step n={4}>For a returning patient, just search their name, phone or UHID and pick them from the list.</Step>
        </ol>
        <div className="mt-2"><Tip>The list shows recent patients by default to stay fast. <b>Searching always reaches every record</b>, however old.</Tip></div>
      </>
    ),
  },
  {
    id: 'appointments', icon: Calendar, title: 'Appointments & the queue', tag: 'Daily use',
    keywords: 'appointment booking token queue doctor slot waiting book visit',
    body: (
      <>
        <ol className="space-y-2">
          <Step n={1}>From Reception, pick the patient → <b>Book Appointment</b> (or <Path>Ctrl+B</Path>).</Step>
          <Step n={2}>Choose the doctor and time. A <b>token number</b> is assigned automatically.</Step>
          <Step n={3}>The patient appears in that doctor's queue instantly — on their cabin PC too, if you run multiple computers.</Step>
          <Step n={4}>Print the OPD slip for the patient to carry in.</Step>
        </ol>
        <div className="mt-2"><Tip>Status colours tell you the queue at a glance: waiting, in consultation, done. The doctor updates it as they work — reception never has to ask.</Tip></div>
      </>
    ),
  },
  {
    id: 'consult', icon: Stethoscope, title: 'Doctor — consultation & prescription', tag: 'Daily use',
    keywords: 'doctor consultation prescription rx diagnosis history examination advice follow-up template',
    body: (
      <>
        <ol className="space-y-2">
          <Step n={1}>Open <b>Doctors</b> → your name → your queue for today.</Step>
          <Step n={2}>Click the patient to open the consultation panel.</Step>
          <Step n={3}>Fill history, examination, impression, advice — or insert a saved <b>quick-fill template</b> with one click.</Step>
          <Step n={4}>Add medicines to the prescription. Set a follow-up date if needed.</Step>
          <Step n={5}><b>Save</b>, then <b>Send to Reception</b> so the front desk can print it.</Step>
        </ol>
        <div className="mt-2"><Tip>Create your own templates at <Path>Settings → Doctors &amp; Templates</Path> so you never retype the same paragraph twice.</Tip></div>
      </>
    ),
  },
  {
    id: 'pharmacy', icon: Pill, title: 'Pharmacy — dispensing & stock', tag: 'Modules',
    keywords: 'pharmacy dispense counter sale drug stock batch expiry fefo schedule h receipt medicine inventory',
    body: (
      <>
        <p className="mb-2">CureDesk ships with <b>~220 common medicines</b> already loaded. Edit prices, add your own, or remove what you don't stock at <Path>Pharmacy → Drug Master</Path>.</p>
        <ol className="space-y-2">
          <Step n={1}><b>Against a prescription:</b> Pharmacy → Dispense → pick the waiting patient. Their medicines are already listed.</Step>
          <Step n={2}><b>Walk-in customer:</b> Pharmacy → Dispense → <b>Counter Sale</b>. Type the medicine; the price fills in automatically.</Step>
          <Step n={3}>Set quantity, apply a discount if any, choose payment mode.</Step>
          <Step n={4}><b>Record Sale &amp; Charge</b> → the printable receipt opens with batch numbers and expiry on every line.</Step>
        </ol>
        <div className="mt-2 space-y-2">
          <Tip>Stock is deducted automatically using <b>FEFO</b> — first-expiring batch goes out first, so nothing expires on your shelf unnoticed.</Tip>
          <Warn>Schedule H / H1 medicines are flagged on screen and on the receipt. Add stock via <b>Purchases</b> so batch and expiry are recorded for the register.</Warn>
        </div>
      </>
    ),
  },
  {
    id: 'lab', icon: FlaskConical, title: 'Laboratory — orders & results', tag: 'Modules',
    keywords: 'lab laboratory test order sample result report catalog price investigation',
    body: (
      <>
        <ol className="space-y-2">
          <Step n={1}>Load the standard catalogue once — <Path>Laboratory → Test Catalog → Load standard catalog</Path> (~160 common Indian tests).</Step>
          <Step n={2}><b>Set your prices</b> inline in that list. Untick <b>Active</b> for tests you don't offer, or tick several and <b>Delete selected</b> to remove them entirely.</Step>
          <Step n={3}>Raise an order from the Lab page or straight from a consultation.</Step>
          <Step n={4}>Mark the sample collected → enter results → print the report on your letterhead.</Step>
        </ol>
        <div className="mt-2"><Tip>A test that has never been ordered is deleted outright; one with past orders is deactivated instead, so old reports keep their names.</Tip></div>
      </>
    ),
  },
  {
    id: 'ipd', icon: BedDouble, title: 'IPD — admission to discharge', tag: 'Modules',
    keywords: 'ipd admission ward bed discharge summary nursing vitals medication approve final bill inpatient',
    body: (
      <>
        <p className="mb-2">Set up your wards and beds first at <Path>Settings → Billing &amp; IPD</Path> — including the per-day bed and nursing rates.</p>
        <ol className="space-y-2">
          <Step n={1}><b>Admit:</b> IPD → ward map → click a free bed → choose the patient and doctor.</Step>
          <Step n={2}><b>During the stay:</b> open the admission for vitals, medications, doctor notes, nursing notes and intake/output. Bed and nursing charges are added to the bill <b>automatically, once per day</b>.</Step>
          <Step n={3}><b>Discharge (doctor):</b> click Discharge → write the summary and outcome → <b>Save &amp; send for final billing</b>. The patient stays admitted and the bed stays occupied at this point.</Step>
          <Step n={4}><b>Final bill (reception/owner):</b> review the bill, add anything missed, apply a discount, collect payment.</Step>
          <Step n={5}><b>Approve &amp; discharge</b> — the bed is freed and the bill is locked as FINAL.</Step>
        </ol>
        <div className="mt-2"><Warn>If money is still due, approving asks for a written reason. That reason is saved and recorded in the audit log, so an unpaid discharge is always traceable.</Warn></div>
      </>
    ),
  },
  {
    id: 'billing', icon: Receipt, title: 'Billing & printing bills', tag: 'Daily use',
    keywords: 'billing bill invoice print gst tax discount payment receipt quick bill reprint',
    body: (
      <>
        <p className="mb-2">Every bill in CureDesk can be printed on your letterhead, and every one can be reprinted later.</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><b>OPD bill</b> — Billing → Billing Queue → pick the patient → generate → Print.</li>
          <li><b>Quick Bill</b> — the <b>New Bill</b> button in the top bar, for anyone, any amount. Save &amp; Print in one step.</li>
          <li><b>IPD bill</b> — Billing → <b>IPD / Admissions</b> tab shows every admission with its balance. Click to open the same bill the IPD screen uses.</li>
          <li><b>Pharmacy receipt</b> — printed right after a sale.</li>
          <li><b>Reprint anything</b> — Billing → Billing History → Reprint.</li>
        </ul>
        <div className="mt-2"><Tip>GST is off by default. If you're registered, switch it on at <Path>Settings → Billing &amp; IPD</Path> and bills become proper tax invoices with CGST/SGST.</Tip></div>
      </>
    ),
  },
  {
    id: 'services', icon: Syringe, title: 'Services — injections, dressings, vaccination', tag: 'Daily use',
    keywords: 'services injection dressing nebulization vaccination procedure charge misc',
    body: (
      <>
        <ol className="space-y-2">
          <Step n={1}>Open <b>Services</b> → pick the patient.</Step>
          <Step n={2}>Choose the service, enter the amount and payment mode.</Step>
          <Step n={3}><b>Record Charge</b> → the printable bill opens.</Step>
        </ol>
        <div className="mt-2"><Tip>Edit the list of services you offer at <Path>Settings → Fees &amp; Workflow → Services</Path>.</Tip></div>
      </>
    ),
  },
  {
    id: 'comms', icon: MessageSquare, title: 'Communication — WhatsApp to patients', tag: 'Modules',
    keywords: 'whatsapp communication message reminder patient send basic pro aisensy automation',
    body: (
      <>
        <p className="mb-2">Two ways to reach patients, depending on your plan:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><b>Module 1 — WhatsApp Business (Basic):</b> uses your existing number. Pick today's patient, the message is pre-typed, you press Send. No setup, no approval, free.</li>
          <li><b>Module 2 — Automation (Pro):</b> reminders and campaigns that send themselves, run through our partner <b>AiSensy</b> on the official WhatsApp Business API. CureDesk hands over your contacts and ready-made templates.</li>
        </ul>
        <p className="mt-3 mb-1.5 font-semibold">Setting up Pro automation (one time):</p>
        <ol className="space-y-2">
          <Step n={1}>Open <Path>Communication → Automation</Path> and press <b>Open AiSensy to sign up</b>. Create the account with your clinic’s own WhatsApp number.</Step>
          <Step n={2}>Finish AiSensy’s onboarding to get that number verified on the official WhatsApp Business API. This takes a day or two and is done entirely on their side.</Step>
          <Step n={3}>Back in CureDesk, press <b>Download contacts CSV</b> and upload that file using AiSensy’s bulk contact import.</Step>
          <Step n={4}>Copy the three ready-made templates into AiSensy’s template creator and submit them for approval. They already use AiSensy’s numbered variables.</Step>
          <Step n={5}>Switch on the reminders you want in AiSensy, then press <b>I’ve finished — mark AiSensy as live</b> so the setup steps stop showing.</Step>
        </ol>
        <div className="mt-2 space-y-2">
          <Tip>Your clinic pays AiSensy directly — their monthly plan plus WhatsApp’s per-conversation charge from Meta. CureDesk is not part of that billing.</Tip>
          <Warn>Patient data stays on this computer. The only thing that ever leaves is the contacts file you choose to upload.</Warn>
        </div>
      </>
    ),
  },
  {
    id: 'peds', icon: Baby, title: 'Pediatrics — growth charts & vaccines', tag: 'Modules',
    keywords: 'pediatrics paediatrics growth chart weight height vaccine immunisation iap who child',
    body: (
      <>
        <p className="mb-2">Switch it on at <Path>Settings → Pediatrics</Path>. Once on, children's consultations gain a growth and vaccination panel automatically.</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Record weight, height and head circumference — plotted live on <b>WHO or IAP</b> curves.</li>
          <li>Track the vaccination schedule and print what's due next.</li>
          <li>Print the full growth sheet for parents.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'analytics', icon: Activity, title: 'Analytics — understanding your clinic', tag: 'Business',
    keywords: 'analytics reports revenue charts graphs demographics finance module profit trends',
    body: (
      <>
        <p className="mb-2">Open <b>Analytics</b> for the picture of your practice, in colour charts:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><b>Overview</b> — today and this month at a glance.</li>
          <li><b>Finance</b> — revenue by day, month, weekday, peak hours, payment mode, doctor.</li>
          <li><b>Modules P&amp;L</b> — what OPD, Pharmacy, Lab and IPD each earn.</li>
          <li><b>Demographics</b> — age, gender, blood group, where patients come from.</li>
        </ul>
        <div className="mt-2"><Tip>Testing on a fresh install? <Path>Settings → System → Load sample data</Path> fills the app with fictional patients so you can see every chart working.</Tip></div>
      </>
    ),
  },
  {
    id: 'backup', icon: HardDrive, title: 'Backups — protecting your records', tag: 'Safety',
    keywords: 'backup restore google drive usb safety data loss recover automatic verified',
    body: (
      <>
        <p className="mb-2">Your patient records live on <b>this computer</b>. Backups are what stand between you and a dead hard disk.</p>
        <ol className="space-y-2">
          <Step n={1}>Use the orange <b>Backup</b> button in the sidebar — it's the only one, on purpose.</Step>
          <Step n={2}>Choose <b>Google Drive folder</b> (recommended — the copy leaves this PC) or <b>USB drive</b>.</Step>
          <Step n={3}>A receipt confirms what was saved and that it passed its integrity check.</Step>
        </ol>
        <div className="mt-2 space-y-2">
          <Tip>Backups also run <b>automatically</b> every day at the time you set. If the PC was off, it catches up the next time you switch it on.</Tip>
          <Warn>Each backup holds a full database copy, all uploaded documents, and an Excel file readable even without CureDesk. To restore: <Path>Settings → System → Restore</Path>.</Warn>
        </div>
      </>
    ),
  },
  {
    id: 'multi', icon: Wifi, title: 'Multiple computers (reception + cabin + pharmacy)', tag: 'Multi-station',
    keywords: 'multi station network host client server lan multiple computers cabin connect join code',
    body: (
      <>
        <p className="mb-2">Run CureDesk on several PCs sharing one live patient list.</p>
        <ol className="space-y-2">
          <Step n={1}>Pick one PC as the <b>main computer</b> (host) — it holds the data, the licence and the backups.</Step>
          <Step n={2}>On it: <Path>Settings → Multi-System → Network Mode</Path> → set as Host. Note the <b>join code</b>.</Step>
          <Step n={3}>On each other PC: install CureDesk → in the wizard choose <b>"This is an extra computer"</b> → enter the join code.</Step>
          <Step n={4}>Give each PC its job — <Path>Settings → System → This computer</Path> (Reception desk / Pharmacy counter / Lab bench…). Its menu shrinks to match.</Step>
        </ol>
        <div className="mt-2 space-y-2">
          <Tip><b>One subscription covers the whole clinic.</b> Stations never ask for a licence key — they inherit the host's.</Tip>
          <Warn>Keep the main computer switched on during clinic hours and set it to never sleep. If it's unreachable, stations show "Can't reach the main computer" and wait, reconnecting automatically.</Warn>
        </div>
        <p className="mt-2 text-[12px]">Full step-by-step, including troubleshooting: <Path>Settings → Multi-System → Multi-Station Setup Guide</Path>.</p>
      </>
    ),
  },
  {
    id: 'staff', icon: ShieldCheck, title: 'Staff accounts, roles & passwords', tag: 'Safety',
    keywords: 'staff user account role login password sign in permission admin pin receptionist pharmacist nurse',
    body: (
      <>
        <p className="mb-2">There are two separate things, and mixing them up is the commonest confusion:</p>
        <ul className="list-disc pl-5 space-y-1.5 mb-2">
          <li><b>Admin password (PIN)</b> — guards Settings, Users and destructive actions. Every clinic has one.</li>
          <li><b>Staff accounts</b> — individual usernames, only used if you switch sign-in on.</li>
        </ul>
        <ol className="space-y-2">
          <Step n={1}>Create people at <Path>Users &amp; Access → Add User</Path> and give each a role.</Step>
          <Step n={2}><b>Turn on sign-in</b> — <Path>Settings → System → Security &amp; Login</Path>. <b>Until you do this, roles have no effect</b> and everyone shares one session.</Step>
          <Step n={3}>Each person then signs in with their own username; they see only what their role allows, and their name is recorded against what they do.</Step>
        </ol>
        <div className="mt-2 space-y-2">
          <Tip>In a multi-PC clinic, staff accounts come from the <b>main computer</b> — create each person once and they can sign in at any station.</Tip>
          <Warn>Forgot the admin password? On the login or unlock screen click <b>"Forgot the password?"</b>, read your Machine ID to us, and we'll issue a one-time reset code for that computer.</Warn>
        </div>
      </>
    ),
  },
];

export function Help() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>('start');
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return TOPICS;
    return TOPICS.filter((t) =>
      t.title.toLowerCase().includes(needle) || t.keywords.includes(needle) || t.tag.toLowerCase().includes(needle));
  }, [q]);

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-blue-600" /> Help &amp; Tutorials
        </h1>
        <p className="text-xs text-gray-500 dark:text-slate-400">
          How to use every part of CureDesk{settings?.clinic_name ? ` at ${settings.clinic_name}` : ''} — in the order a clinic day happens.
        </p>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="input pl-9" placeholder="Search help — e.g. discharge, backup, pharmacy, login…"
          value={q} onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {shown.length === 0 && (
        <div className="card p-8 text-center text-sm text-gray-500 dark:text-slate-400">
          Nothing matches “{q}”. Try a simpler word — <i>bill</i>, <i>stock</i>, <i>discharge</i>.
        </div>
      )}

      <div className="space-y-2">
        {shown.map((t) => {
          const isOpen = open === t.id;
          const Icon = t.icon;
          return (
            <div key={t.id} className="card overflow-hidden">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : t.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-800/50 transition"
              >
                <Icon className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold text-gray-900 dark:text-slate-100">{t.title}</span>
                  <span className="block text-[10px] uppercase tracking-wider text-gray-400">{t.tag}</span>
                </span>
                <ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform shrink-0', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <div className="px-4 pb-4 pt-1 text-[12.5px] text-gray-700 dark:text-slate-300 leading-relaxed border-t border-gray-100 dark:border-slate-800">
                  {t.body}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card p-4 text-[12px] text-gray-600 dark:text-slate-300">
        <b>Still stuck?</b> Every settings section also has a <b>?</b> beside its heading with a short explanation.
        For anything else, contact us — our number is on your Subscription screen.
      </div>
    </div>
  );
}
