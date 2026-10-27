/**
 * The map of the Settings page: which tab holds what, which tabs belong to a module the clinic may not have paid for, and which saved settings each tab owns.
 *
 * WHY IT IS A FILE OF ITS OWN (owner, 2026-10-27: "the whole settings section needs to be audited, I only get confused what is where"): pharmacy, lab,
 * radiology and in-patient settings used to be scattered over Billing & IPD, the Pharmacy page and the Lab page. Now each module has ONE tab, shown (unlocked)
 * only when the subscription includes it, and the keys each tab saves are listed here. tests/e2e/settings-map.test.ts fails the build when a saved setting
 * with a module's name on it (pharmacy_*, lab_*, radiology_*, ipd_* ...) is not claimed by that module's tab — so a setting added tomorrow cannot be
 * dropped on the wrong page without somebody deciding where it belongs.
 */
import type { Settings } from '../types';

export type SettingsTabId =
  | 'clinic' | 'doctors' | 'reception' | 'billing'
  | 'pharmacy' | 'lab' | 'ipd' | 'whatsapp' | 'peds'
  | 'system' | 'multisystem' | 'subscription';

export type SettingsGroupId = 'clinic' | 'modules' | 'computer';

/** The paid modules a tab can depend on (the ones the licence switches on and off). */
export type SettingsModule = 'pharmacy' | 'lab' | 'ipd' | 'whatsapp';

export interface SettingsTabDef {
  id: SettingsTabId;
  label: string;
  group: SettingsGroupId;
  /** Present = the tab is unlocked only while the subscription includes this module. */
  module?: SettingsModule;
  /** One sentence, shown at the top of the tab: what lives here. */
  blurb: string;
}

export const SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
  { id: 'clinic', label: 'The clinic' },
  { id: 'modules', label: 'Modules' },
  { id: 'computer', label: 'This computer & licence' },
];

export const SETTINGS_TABS: SettingsTabDef[] = [
  { id: 'clinic', label: 'Clinic', group: 'clinic', blurb: 'Your clinic’s name, address, logo and the header printed on every document.' },
  { id: 'doctors', label: 'Doctors & Templates', group: 'clinic', blurb: 'Your doctors (fees, signature, slip), where patients come from, and the text templates doctors use.' },
  { id: 'reception', label: 'Reception & Fees', group: 'clinic', blurb: 'The front desk: consultation and registration fees, the queue, the follow-up rule, service shortcuts and patient locations.' },
  { id: 'billing', label: 'Billing & GST', group: 'clinic', blurb: 'How the clinic bills: GST registration, invoice numbers, round-off, the price list (charge heads) and staff discount limits.' },
  { id: 'pharmacy', label: 'Pharmacy', group: 'modules', module: 'pharmacy', blurb: 'Everything about the pharmacy in one place: its GST and licence on bills, the discount limit at the counter, credit.' },
  { id: 'lab', label: 'Laboratory & Radiology', group: 'modules', module: 'lab', blurb: 'Everything about the lab and the scan desk: when a bill is raised, and the test and scan price lists.' },
  { id: 'ipd', label: 'In-Patient (IPD)', group: 'modules', module: 'ipd', blurb: 'Wards and beds, the daily charges, deposits, insurance (TPA), admission requests and the discharge summary.' },
  { id: 'whatsapp', label: 'WhatsApp', group: 'modules', module: 'whatsapp', blurb: 'What patients receive on WhatsApp: the wording of each message, the Google review link, the country code for phone numbers, and the Pro automation status.' },
  { id: 'peds', label: 'Pediatrics', group: 'modules', blurb: 'Growth charts, vaccines and calculators for paediatric patients.' },
  { id: 'system', label: 'System', group: 'computer', blurb: 'Sign-in and security, who can open what, this computer’s clock, start-up, backups and updates, reset.' },
  { id: 'multisystem', label: 'Multi-System', group: 'computer', blurb: 'Connecting several computers in the clinic — which one is the main computer.' },
  { id: 'subscription', label: 'Subscription & Modules', group: 'computer', blurb: 'Your plan and its expiry, renewing or adding a module, and which modules this computer shows.' },
];

export const tabDef = (id: SettingsTabId): SettingsTabDef => SETTINGS_TABS.find((t) => t.id === id) ?? SETTINGS_TABS[0];

/** Tab names an older version remembered in the browser's storage, and the tab they were merged into. */
export const OLD_TAB_IDS: Record<string, SettingsTabId> = { workflow: 'reception', patients: 'reception' };

export const SETTINGS_TAB_STORAGE_KEY = 'caredesk:settings-tab';
/** Make Settings open on this tab the next time it is shown (what a "go to Settings" button does just before it navigates there). */
export function rememberSettingsTab(tab: SettingsTabId) {
  try { localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, tab); } catch { /* storage can be unavailable; Settings then opens on the tab it remembered */ }
}

/** A tab id that may come from storage or an old link → a tab that exists. */
export function tabFromStored(v: string | null | undefined): SettingsTabId {
  if (!v) return 'clinic';
  if (SETTINGS_TABS.some((t) => t.id === v)) return v as SettingsTabId;
  return OLD_TAB_IDS[v] ?? 'clinic';
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The saved settings each tab edits with its own Save button (the other tabs edit and save their own things as they go).
// ---------------------------------------------------------------------------------------------------------------------------------
type K = keyof Settings;

/** Billing & GST — the clinic's own billing. (Registration type and GSTIN are shared by the pharmacy's bills; they live here once.) */
export const BILLING_KEYS: K[] = [
  'gst_enabled', 'gst_registration_type', 'clinic_gstin', 'clinic_legal_name', 'clinic_state_code', 'healthcare_gst_exempt',
  'invoice_prefix', 'bill_round_off', 'discount_caps_json', 'discount_require_reason',
];

/** Pharmacy — its own GST switch and the identity printed on its bills, the starting GST % of a new medicine, the counter discount limits, credit. */
export const PHARMACY_KEYS: K[] = [
  'pharmacy_gst_enabled', 'pharmacy_gstin', 'pharmacy_legal_name', 'pharmacy_drug_license_no', 'default_drug_gst_rate',
  'pharmacy_discount_caps_json', 'pharmacy_credit_enabled', 'pharmacy_ipd_charge_enabled',
];

/** Laboratory & Radiology — when a bill is raised for an order. (The test and scan price lists are managed on their own pages.) */
export const LAB_KEYS: K[] = ['lab_auto_bill', 'radiology_auto_bill'];

/** In-Patient — numbering, GST on ward bills, the daily charges, deposits, insurance, admission requests, the discharge summary switch. */
export const IPD_KEYS: K[] = [
  'ip_number_prefix', 'ipd_gst_enabled', 'ipd_auto_accrue_bed', 'ipd_auto_accrue_nursing', 'ipd_auto_accrue_doctor_visit', 'ipd_doctor_visit_mode',
  'ipd_transfer_charge_rule', 'ipd_accrual_time', 'ipd_advance_enabled', 'tpa_enabled', 'ipd_admission_requests_enabled', 'discharge_summary_enabled',
];

/** WhatsApp — the wording of the one-click messages, the country code for patients' numbers, the Google review link (was also typed into Clinic Info). */
export const WHATSAPP_KEYS: K[] = ['whatsapp_templates_json', 'whatsapp_country_code', 'google_review_url'];

/**
 * Saved settings with a WhatsApp / SMS name that NOTHING reads or edits any more (an older "send through an API" design; they stay in the database and in
 * every backup, untouched). Listed so the guard does not claim them for the WhatsApp tab: a new setting is never silently added to this list.
 */
export const LEGACY_UNUSED_KEYS = ['whatsapp_enabled', 'whatsapp_api_url', 'whatsapp_api_key', 'whatsapp_template'];

/**
 * Which tab must own a saved setting, judged by its name. Used by the guard test: a setting whose name says "pharmacy" that is not in the pharmacy
 * tab's list (or one that is in two lists) is a setting somebody dropped on the wrong page.
 */
export function owningTabOfKey(key: string): SettingsTabId | null {
  if (LEGACY_UNUSED_KEYS.includes(key)) return null;
  if (/^whatsapp_/.test(key) || key === 'google_review_url') return 'whatsapp';
  if (/^pharmacy_/.test(key) || key === 'default_drug_gst_rate') return 'pharmacy';
  if (/^(lab|radiology)_/.test(key)) return 'lab';
  if (/^(ipd_|tpa_|discharge_summary_)/.test(key) || key === 'ip_number_prefix') return 'ipd';
  return null;
}
