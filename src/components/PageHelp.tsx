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
        <p>The list remembers how you sorted it (recent visit, registration date or name) and how far back it looks &mdash; on this computer &mdash; until you change it.</p>
      </>
    ),
  },
  appointments: {
    title: 'Appointments',
    body: (
      <>
        <p>Today&rsquo;s queue, doctor by doctor. Each row is one patient waiting, with their token number.</p>
        <p>Print a slip for the patient, or move them along as they are seen. What the doctor records in the consultation flows on to Pharmacy, Lab and Billing automatically.</p>
        <p>Each row has two print buttons: <b>Consultation</b> prints the OPD consultation paper, and <b>Bill</b> prints that visit&rsquo;s bill. If the visit has no bill yet the button shows a <b>+</b> &mdash; click it to raise the bill right there (consultation fee, discount, how it is paid), and it opens for printing. Booking a visit raises its bill in the same step, so a visit is never left without one.</p>
      </>
    ),
  },
  pharmacy: {
    title: 'Pharmacy',
    body: (
      <>
        <p>Dispensing and stock. <b>Dispense</b> handles both a doctor&rsquo;s prescription and a walk-in counter sale; batches are picked oldest-expiry-first for you.</p>
        <p>Each tab does one job. <b>Drug List</b> is the catalogue &mdash; just the drugs (name, form, strength, schedule, GST, MRP), with no stock. <b>Drugs in my clinic</b> is what you actually hold: units in stock, next expiry, cost and price, with filters for low stock, out of stock, expiring within 90 days and expired; click a drug to see its batches. Brands of one medicine &mdash; the same ingredient, strength and form, like Dolo 650, Crocin 650 and &ldquo;Paracetamol 650 mg Tablet&rdquo; &mdash; sit together under one heading with the medicine&rsquo;s total; each brand keeps its own batches and price, and a prescription written for the generic can be filled from any brand on the shelf. <b>Purchases</b> records what you bought, <b>Sales</b> lists every sale (each prints a bill and can be reprinted), <b>Wholesalers</b> holds your suppliers and what you owe each one &mdash; <b>Pay supplier</b> settles their unpaid bills oldest-first in one payment &mdash; and <b>Reports</b> opens the Schedule H, stock and purchase registers. A new install starts with the drug list and an <b>empty shelf</b>; the administrator and the pharmacy in-charge can tick drugs in <b>Drugs in my clinic</b> to delete them, or use <b>Start fresh</b> to clear every drug, all stock and all batches (a full copy of the data is saved first).</p>
        <p>On a counter sale, pick the patient to put it on their bill, or leave it blank (optionally typing a guest name) for a walk-in. If your clinic has turned them on in <b>Settings &rarr; Pharmacy</b>, a registered patient can take medicines <b>on credit</b> (pay part now, the rest later &mdash; collect it from <b>Sales</b> or the patient&rsquo;s billing page), and an admitted patient&rsquo;s medicines can be <b>charged to their in-patient bill</b>. Stock you typed in by hand has a cost nobody can vouch for &mdash; <b>Drugs in my clinic &rarr; Cost not recorded</b> clears it so profit is never based on a guess.</p>
        <p>On a <b>purchase bill</b> enter the supplier&rsquo;s rate, any free units, discount and freight &mdash; the screen shows what each unit <i>really</i> cost you and the margin it leaves. If a medicine is not in the drug list yet, choose <b>Add this drug to the Drug List</b> at the top of that line&rsquo;s list &mdash; it is saved and picked into the line straight away. Click a bill to record what you paid the supplier; the amount still owed is always bill total minus payments.</p>
        <p><b>Import bill</b> (in <b>Purchases</b>) saves typing a long bill: in three steps you copy a set of instructions, give ChatGPT the bill (a photo or PDF &mdash; ask your dealer for a digital copy, it reads far more accurately) and upload the Excel it makes. CureDesk then shows <i>every line against the name printed on the bill</i>: boxes that still need filling (batch, expiry, MRP, GST&hellip;) are <b>red</b>, doubtful medicine matches ask you to confirm, and the bill&rsquo;s total is checked against the lines. A line you cannot settle can be <b>set aside</b> &mdash; the rest is imported now and that line waits under <b>Waiting to finish</b>. Nothing reaches your stock until you type <b>IMPORT</b>.</p>
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
        <p><b>Find a patient</b> at the top and the page becomes that patient&rsquo;s billing portal: everything already billed and paid (consultations, lab, radiology, in-patient, and medicines bought at the pharmacy counter), what is still to collect, and what can be billed now &mdash; a visit with no bill, a lab or scan order with no bill, a prescription not yet dispensed.</p>
        <p>A pharmacy sale made <i>under a patient&rsquo;s name</i> shows with that patient&rsquo;s bills &mdash; if it was taken on credit, the unpaid part is listed to collect like any other bill. A sale to a guest with no patient record is listed separately under <b>Pharmacy walk-ins</b>. Either way it is counted once in Accounts and Analytics.</p>
        <p><b>Raised a bill by mistake?</b> A manager or administrator can <b>Cancel</b> it from <b>Billing History</b> (not an in-patient bill). It stops counting as income and as money owed, and anything already received is recorded as a refund — never erased — with the reason and who did it.</p>
        <p>A <b>Quick Bill &rarr; Pharmacy (hand-typed)</b> bill is different from a pharmacy sale: you type it, no medicine leaves stock, and it is reported on its own in Analytics instead of in the Pharmacy stock figures.</p>
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
    title: 'Accounts',
    body: (
      <>
        <p>All the clinic&rsquo;s <b>money</b> in one place. <b>Money in</b> is what was collected (by day, month, doctor, payment mode) and what is still to collect. <b>Money out</b> is every payment: you raise a <b>voucher</b> for anything the clinic pays for &mdash; a hand wash for &#8377;45, rent, a salary, a doctor&rsquo;s pay &mdash; and supplier payments and patient refunds are listed there automatically.</p>
        <p>A voucher is numbered (CM-0001, SAL-0001 &hellip;), can be printed, and cannot be edited once saved: cancel it with a reason and raise it again. <b>Staff and salaries</b> pays salaries, gives advances and (if you keep attendance) suggests the salary from the days worked. The <b>Day book</b> shows cash in hand day by day; <b>Profit and loss</b> shows what is left after medicines, expenses, salaries and doctors&rsquo; pay.</p>
        <p>Who may raise or cancel vouchers, the staff list, expense heads and the cash you start counting from are set in <b>Settings &rarr; Accounts &amp; Analytics</b>.</p>
      </>
    ),
  },
  analytics: {
    title: 'Analytics',
    body: (
      <>
        <p>The <b>people, visits and time</b> side of the clinic &mdash; patient numbers, busiest hours, where patients come from, which doctors see the most. Money is in <b>Accounts</b>; each page here keeps one small figure and a link to it.</p>
        <p><b>Doctors</b> shows, for today, yesterday, any days you pick, how many visits each doctor had: <i>new patient</i> (new to that doctor), <i>free follow-up</i> and <i>paid repeat visit</i>. People allowed to raise vouchers also see what each doctor <i>earned</i> (worked out from what was collected, by the rule in Settings &rarr; Doctors &amp; Templates &rarr; Pay and Cuts), what was paid and what is still to pay &mdash; and can pay them with a voucher. <b>Referrals</b> does the same for outside referring doctors.</p>
        <p>Figures come from real recorded activity, so they are only as good as what staff enter. A quiet-looking module usually means it isn&rsquo;t being used, not that it isn&rsquo;t earning. <b>Pharmacy</b> splits sales between registered patients and walk-in guests, shows medicines given on credit, and keeps bills typed by hand in a section of their own; its profit, stock value and supplier accounts are in <b>Accounts &rarr; Profit and loss</b>.</p>
        <p>Days and months are counted on the clock of this computer, so a bill made at 1 a.m. belongs to that day.</p>
      </>
    ),
  },
  communication: {
    title: 'Communication',
    body: (
      <>
        <p>Reaching patients on WhatsApp. <b>Module 1</b> uses your own number — pick a patient, the message is pre-written, you press send. What each message says, and the Google review link, are set in <b>Settings &rarr; WhatsApp</b>.</p>
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
