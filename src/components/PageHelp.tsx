/**
 * The "?" beside a module's title.
 *
 * Settings already explains every switch it owns, but the modules themselves —
 * the screens staff actually spend the day in — had no explanation at all. A
 * receptionist opening Accounts for the first time, or a new hire looking at
 * IPD, had to ask someone. This answers the two questions that actually get
 * asked: what is this screen for, and what am I supposed to do on it.
 *
 * Written for the person at the desk, not for whoever built it: no field names,
 * no jargon, and it says where things go afterwards, because "where did that
 * bill end up" is the question that follows almost every action.
 */
import { HelpTip } from './HelpTip';

type PageKey =
  | 'reception' | 'appointments' | 'pharmacy' | 'lab' | 'radiology' | 'ipd'
  | 'billing' | 'services' | 'accounts' | 'analytics' | 'communication';

const HELP: Record<PageKey, { title: string; body: React.ReactNode }> = {
  reception: {
    title: 'Reception',
    body: (
      <>
        <p>The front desk. Register a patient who has never been here before, or find an existing one and send them to a doctor&rsquo;s queue.</p>
        <p>Every patient gets a permanent UHID here. Search by name, phone or UHID before registering — creating a second record for the same person splits their history in two.</p>
      </>
    ),
  },
  appointments: {
    title: 'Appointments',
    body: (
      <>
        <p>Today&rsquo;s queue, doctor by doctor. Each row is one patient waiting, with their token number.</p>
        <p>Print a slip for the patient, or move them along as they are seen. What the doctor records in the consultation flows on to Pharmacy, Lab and Billing automatically.</p>
      </>
    ),
  },
  pharmacy: {
    title: 'Pharmacy',
    body: (
      <>
        <p>Dispensing and stock. <b>Dispense</b> handles both a doctor&rsquo;s prescription and a walk-in counter sale; batches are picked oldest-expiry-first for you.</p>
        <p><b>Drug Master</b> is your catalogue, <b>Stock &amp; Batches</b> is what you physically hold, and <b>Purchases</b> records what you bought. Every sale prints a bill and can be reprinted later from <b>Sales</b>.</p>
        <p>On a <b>purchase bill</b> enter the supplier&rsquo;s rate, any free units, discount and freight &mdash; the screen shows what each unit <i>really</i> cost you and the margin it leaves. Click a bill to record what you paid the supplier; the amount still owed is always bill total minus payments.</p>
        <p>Profit, margin and stock value are in <b>Analytics &rarr; Pharmacy</b>.</p>
      </>
    ),
  },
  lab: {
    title: 'Laboratory',
    body: (
      <>
        <p>Investigations, from request to report. Orders raised by a doctor appear here on their own — nothing needs to be sent across.</p>
        <p>Collect the sample, enter results, print the report. A bill is raised automatically from your test prices, so a test priced ₹0 is done but never charged for.</p>
      </>
    ),
  },
  radiology: {
    title: 'Radiology',
    body: (
      <>
        <p>X-Ray, ultrasound, CT and MRI, from request to written report. Scans a doctor orders in a consultation appear here by themselves; walk-ins are raised with <b>New Radiology Request</b>.</p>
        <p>A bill is raised automatically from your scan prices — take payment right here, print the bill, and print the report on your letterhead once the findings and impression are written. Set your prices under <b>Catalogue &amp; Prices</b>; a scan left at ₹0 is done but never charged for.</p>
      </>
    ),
  },
  ipd: {
    title: 'IPD (In-Patient)',
    body: (
      <>
        <p>Admitted patients, ward by ward. Open a patient for vitals, medicines, nursing notes, doctor notes and intake/output.</p>
        <p>Bed and nursing charges accrue every day on their own. Discharge is two steps: the doctor saves the summary, then billing staff approve it — the bed frees up only after that.</p>
      </>
    ),
  },
  billing: {
    title: 'Billing',
    body: (
      <>
        <p>Money owed and money taken. Raise a bill, settle one, or print a copy for a patient.</p>
        <p>Bills raised elsewhere — pharmacy, lab, services, IPD — all land here, so this is the one place that shows what a patient actually owes.</p>
      </>
    ),
  },
  services: {
    title: 'Services',
    body: (
      <>
        <p>Anything you charge for that isn&rsquo;t a consultation, a medicine or a lab test: injections, dressings, vaccination, minor procedures.</p>
        <p>Pick the patient, pick what was done, record the charge. It becomes a normal bill you can print now or reprint later from the list below.</p>
      </>
    ),
  },
  accounts: {
    title: 'Accounts & Finance',
    body: (
      <>
        <p>What the clinic earned and what it spent. Collections come in from every module automatically; expenses are what you enter here.</p>
        <p>Use it to see a day&rsquo;s or a month&rsquo;s cash position without adding up bills by hand.</p>
      </>
    ),
  },
  analytics: {
    title: 'Analytics',
    body: (
      <>
        <p>The patterns behind the day-to-day — patient numbers, revenue by department, busiest hours, which doctors see the most.</p>
        <p>Figures come from real recorded activity, so they are only as good as what staff enter. A quiet-looking module usually means it isn&rsquo;t being used, not that it isn&rsquo;t earning.</p>
        <p><b>Pharmacy</b> shows <i>profit already made</i> (revenue minus what those units cost, after discounts), <i>stock on the shelf</i> at cost, MRP and your selling price, and what you owe each supplier. <b>Margin</b> is profit &divide; revenue; <b>markup</b> is profit &divide; cost &mdash; ₹50 cost sold at ₹100 is a 50% margin and a 100% markup.</p>
        <p>Days and months are counted on the clock of this computer, so a bill made at 1 a.m. belongs to that day.</p>
      </>
    ),
  },
  communication: {
    title: 'Communication',
    body: (
      <>
        <p>Reaching patients on WhatsApp. <b>Module 1</b> uses your own number — pick a patient, the message is pre-written, you press send.</p>
        <p><b>Module 2</b> is automation (reminders and campaigns that send themselves), which runs through AiSensy on the official WhatsApp Business API.</p>
      </>
    ),
  },
};

export function PageHelp({ page }: { page: PageKey }) {
  const h = HELP[page];
  if (!h) return null;
  return <HelpTip title={h.title}>{h.body}</HelpTip>;
}
