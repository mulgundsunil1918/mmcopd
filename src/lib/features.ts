/**
 * THE feature catalogue — every page, tab, card, tile, chart and optional form field a clinic may want to hide.
 *
 * Owner (2026-10-29): "set or enable or disable everything in the settings". One list drives both the Settings → "What to show" switches and the
 * on-screen gating (`<Feature id="…">`, `useFeature`, and `moduleSwitchedOff` for whole pages). Everything is ON by default, so an update changes
 * nothing; a switch only HIDES — the data underneath is never touched. tests/e2e/features.test.ts fails the build when a catalogue entry is used
 * nowhere, a screen uses an id that is not listed, or an id is listed twice.
 */
import type { SettingsTabId } from './settingsMap';

export interface FeatureDef {
  id: string;
  label: string;
  /** The Settings tab whose "What to show" card carries this switch. */
  tab: SettingsTabId;
  /** Heading inside that card. */
  group: string;
  /** Plain words: where the owner sees it. */
  where: string;
}

const F = (id: string, label: string, tab: SettingsTabId, group: string, where: string): FeatureDef => ({ id, label, tab, group, where });

export const FEATURES: FeatureDef[] = [
  // ── Whole pages (sidebar + address) ──
  F('page:/patient-log', 'Patient Log page', 'reception', 'Pages', 'Sidebar → Patient Log'),
  F('page:/miscellaneous', 'Services page', 'reception', 'Pages', 'Sidebar → Services'),
  F('page:/notifications', 'Notifications page', 'reception', 'Pages', 'Sidebar → Notifications'),
  F('page:/print-jobs', 'Print Jobs page', 'reception', 'Pages', 'Sidebar → Print Jobs'),
  F('page:/accounts', 'Accounts page', 'accounts', 'Pages', 'Sidebar → Accounts'),
  F('page:/analytics', 'Analytics page', 'accounts', 'Pages', 'Sidebar → Analytics'),

  // ── Optional fields inside forms (hidden = not asked; nothing already saved is touched) ──
  F('reception.field.email', 'Email', 'reception', 'Registration form', 'Reception → New patient → Email'),
  F('reception.field.blood_group', 'Blood group', 'reception', 'Registration form', 'Reception → New patient → Blood group'),
  F('reception.field.address', 'Address', 'reception', 'Registration form', 'Reception → New patient → Address'),
  F('reception.field.profession', 'Profession', 'reception', 'Registration form', 'Reception → New patient → Profession'),
  F('reception.field.place', 'Village / town / place', 'reception', 'Registration form', 'Reception → New patient → Place'),
  F('reception.field.district', 'District', 'reception', 'Registration form', 'Reception → New patient → District'),
  F('reception.field.state', 'State', 'reception', 'Registration form', 'Reception → New patient → State'),
  F('consultation.vital.temp', 'Temperature', 'reception', 'Consultation vitals', 'Doctor → Consultation → Vitals'),
  F('consultation.vital.pulse', 'Pulse', 'reception', 'Consultation vitals', 'Doctor → Consultation → Vitals'),
  F('consultation.vital.rr', 'Respiratory rate', 'reception', 'Consultation vitals', 'Doctor → Consultation → Vitals'),
  F('consultation.vital.spo2', 'SpO₂', 'reception', 'Consultation vitals', 'Doctor → Consultation → Vitals'),
  F('consultation.vital.bp', 'Blood pressure', 'reception', 'Consultation vitals', 'Doctor → Consultation → Vitals'),
  F('consultation.vital.weight', 'Weight', 'reception', 'Consultation vitals', 'Doctor → Consultation → Vitals'),
  F('consultation.vital.height', 'Height', 'reception', 'Consultation vitals', 'Doctor → Consultation → Vitals'),
  F('consultation.vital.followup', 'Follow-up date', 'reception', 'Consultation vitals', 'Doctor → Consultation → Vitals'),
  F('consultation.field.notes', 'Notes', 'reception', 'Consultation form', 'Doctor → Consultation → Notes'),
  F('booking.field.referral', 'Referral', 'reception', 'Booking form', 'Appointments → Book → Referral'),
  F('booking.field.group', 'Patient group', 'reception', 'Booking form', 'Appointments → Book → Patient group'),
  F('services.field.performed_by', 'Performed by', 'reception', 'Services form', 'Services → New service → Performed by'),
  F('lab.field.referring_doctor', 'Referring doctor', 'lab', 'Lab order form', 'Laboratory → New order → Referring doctor'),
  F('lab.field.notes', 'Notes', 'lab', 'Lab order form', 'Laboratory → New order → Notes'),
  F('radiology.field.consulting_doctor', 'Consulting doctor', 'lab', 'Radiology request form', 'Radiology → New request → Consulting doctor'),
  F('radiology.field.referral', 'Referral', 'lab', 'Radiology request form', 'Radiology → New request → Referral'),
  F('ipd.field.suggested_ward', 'Suggested ward', 'ipd', 'Admission request form', 'IPD → Request admission → Suggested ward'),
  F('ipd.field.notes', 'Notes for reception', 'ipd', 'Admission request form', 'IPD → Request admission → Notes'),

  // ── Accounts ──
  F('accounts.tab.overview', 'Overview tab', 'accounts', 'Accounts tabs', 'Accounts → Overview'),
  F('accounts.tab.in', 'Money in tab', 'accounts', 'Accounts tabs', 'Accounts → Money in'),
  F('accounts.tab.out', 'Money out tab (vouchers)', 'accounts', 'Accounts tabs', 'Accounts → Money out'),
  F('accounts.tab.staff', 'Staff and salaries tab', 'accounts', 'Accounts tabs', 'Accounts → Staff and salaries'),
  F('accounts.tab.daybook', 'Day book tab', 'accounts', 'Accounts tabs', 'Accounts → Day book'),
  F('accounts.tab.pnl', 'Profit and loss tab', 'accounts', 'Accounts tabs', 'Accounts → Profit and loss'),
  F('accounts.in.kpis', 'Today / week / month / all-time tiles', 'accounts', 'Accounts → Money in', 'Money in → the four tiles on top'),
  F('accounts.in.range', 'Range summary', 'accounts', 'Accounts → Money in', 'Money in → range summary'),
  F('accounts.in.bymode', 'Collected today, by payment mode', 'accounts', 'Accounts → Money in', 'Money in → by payment mode'),
  F('accounts.in.daywise', 'Day-wise table', 'accounts', 'Accounts → Money in', 'Money in → day-wise'),
  F('accounts.in.monthly', 'Monthly chart', 'accounts', 'Accounts → Money in', 'Money in → monthly'),
  F('accounts.in.weekday', 'Busiest weekday (money)', 'accounts', 'Accounts → Money in', 'Money in → by weekday'),
  F('accounts.in.hours', 'Peak hours (money)', 'accounts', 'Accounts → Money in', 'Money in → by hour'),
  F('accounts.in.doctors', 'Money by doctor', 'accounts', 'Accounts → Money in', 'Money in → by doctor'),
  F('accounts.in.alltime', 'By payment mode, all time', 'accounts', 'Accounts → Money in', 'Money in → all-time by payment mode'),
  F('accounts.in.places', 'Money by place', 'accounts', 'Accounts → Money in', 'Money in → by place'),
  F('accounts.in.toppatients', 'Top patients', 'accounts', 'Accounts → Money in', 'Money in → top patients'),
  F('accounts.in.receivables', 'Dues, unbilled work and discounts', 'accounts', 'Accounts → Money in', 'Money in → bottom sections'),
  F('accounts.pnl.profit', 'Real profit (revenue less costs)', 'accounts', 'Accounts → Profit and loss', 'Profit and loss → profit'),
  F('accounts.pnl.modules', 'Revenue by module', 'accounts', 'Accounts → Profit and loss', 'Profit and loss → revenue by module'),
  F('accounts.pnl.pharmacy', 'Pharmacy profit and stock value', 'accounts', 'Accounts → Profit and loss', 'Profit and loss → pharmacy'),

  // ── Analytics ──
  F('analytics.tab.overview', 'Overview tab', 'accounts', 'Analytics tabs', 'Analytics → Overview'),
  F('analytics.tab.doctors', 'Doctors tab', 'accounts', 'Analytics tabs', 'Analytics → Doctors'),
  F('analytics.tab.ipd', 'IPD tab', 'accounts', 'Analytics tabs', 'Analytics → IPD'),
  F('analytics.tab.demographics', 'Demographics tab', 'accounts', 'Analytics tabs', 'Analytics → Demographics'),
  F('analytics.tab.origin', 'Patient Origin tab', 'accounts', 'Analytics tabs', 'Analytics → Patient Origin'),
  F('analytics.tab.referrals', 'Referrals tab', 'accounts', 'Analytics tabs', 'Analytics → Referrals'),
  F('analytics.tab.pharmacy', 'Pharmacy tab', 'accounts', 'Analytics tabs', 'Analytics → Pharmacy'),
  F('analytics.tab.services', 'Services tab', 'accounts', 'Analytics tabs', 'Analytics → Services'),
  F('analytics.tab.operations', 'Reports tab', 'accounts', 'Analytics tabs', 'Analytics → Reports'),
  F('analytics.doctors.table', 'Day-by-day table', 'accounts', 'Analytics → Doctors', 'Doctors → day by day'),
  F('analytics.doctors.cards', 'One card per doctor', 'accounts', 'Analytics → Doctors', 'Doctors → doctor cards'),
  F('analytics.doctors.money', 'Money columns (billed, collected, earned, paid)', 'accounts', 'Analytics → Doctors', 'Doctors → money'),
  F('analytics.busy', 'Busiest weekdays and hours', 'accounts', 'Analytics → Overview', 'Overview → busy times'),
];

export const FEATURE_IDS = new Set(FEATURES.map((f) => f.id));
export const featuresOfTab = (tab: SettingsTabId) => FEATURES.filter((f) => f.tab === tab);

/** `feature_switches_json` keeps ONLY what was switched off: `{ "accounts.tab.daybook": false }`. Anything not listed is on. */
export function parseSwitches(json: string | null | undefined): Record<string, boolean> {
  try {
    const o = json ? JSON.parse(json) : {};
    const out: Record<string, boolean> = {};
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (v === false) out[k] = false;
    return out;
  } catch { return {}; }
}
export function featureOn(settings: { feature_switches_json?: string } | null | undefined, id: string): boolean {
  if (!settings?.feature_switches_json) return true;
  return parseSwitches(settings.feature_switches_json)[id] !== false;
}
/** The JSON to save after turning one switch on or off. */
export function withSwitch(json: string | null | undefined, id: string, on: boolean): string {
  const cur = parseSwitches(json);
  if (on) delete cur[id]; else cur[id] = false;
  return JSON.stringify(cur);
}
/** Is this whole page switched off by its catalogue entry? (moduleSwitchedOff calls this, so the sidebar and the address guard agree.) */
export const pageFeatureOff = (path: string, settings: { feature_switches_json?: string } | null | undefined) =>
  FEATURE_IDS.has(`page:${path}`) && !featureOn(settings, `page:${path}`);
