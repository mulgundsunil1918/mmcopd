/**
 * Static demo dataset for the GitHub Pages showcase build.
 *
 * NEVER imported by the Electron app — only by the demo entry point.
 * 50 patients, 5 doctors, ~100 appointments, ~30 consultations,
 * ~50 prescription items, ~30 bills, ~50 pharmacy sales, drug master,
 * batches, dispensing register, wholesalers, purchase invoices.
 *
 * Names + places are intentionally generic / Karnataka-flavored to feel
 * authentic without naming real people.
 */

import type {
  AppointmentWithJoins, Bill, Consultation, Doctor, DrugMaster, DrugStockBatch,
  PharmacySale, PurchaseInvoice, Settings, Wholesaler, Vitals, PrescriptionItem,
  DispensingRow, DrugSchedule,
} from '../types';
import { PHARMACY_CATALOG, type CatalogDrug } from '../data/pharmacy-catalog';

// ---------- Helpers (deterministic so the demo looks the same every load) ----------
let SEED = 42;
function rand() { SEED = (SEED * 9301 + 49297) % 233280; return SEED / 233280; }
function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)]; }
function range(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }
function pad(n: number, w = 2) { return String(n).padStart(w, '0'); }

const TODAY = new Date('2026-04-26');
function daysAgo(n: number) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
/** A date n days from the REAL today. The rest of the demo is pinned to a fixed day; shelf expiry has to move with the clock. */
function fromToday(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isoAt(date: string, time: string) {
  return `${date}T${time}:00`;
}

// ---------- Settings ----------
export const DEMO_SETTINGS: Settings = {
  clinic_name: 'City Care Multispeciality Clinic',
  clinic_address: '123 MG Road, Sample City - 000000',
  clinic_phone: '9000000000',
  clinic_email: 'clinic@example.com',
  clinic_tagline: 'Trusted Care',
  clinic_registration_no: 'REG-0000',
  clinic_logo: '',
  lh_style: 'logo_text', lh_logo_size: 'lg', lh_show_name: true, lh_show_tagline: true, lh_show_contact: true, lh_banner_max_mm: 40,
  slot_duration: 30,
  consultation_fee: 250,
  special_price: 150,
  queue_flow_enabled: false,
  show_user_badge: true,
  show_billing_module: true,
  show_patient_origin: true,
  app_mode: 'full',
  default_state: 'Karnataka',
  default_district: 'Gadag',
  known_villages: 'Shantipur, Gadag, Lakshmeshwar, Naregal, Shirahatti',
  backup_folder: '',
  backup_reminder_time: '21:00',
  usb_reminder_weekday: 1,
  usb_reminder_time: '09:30',
  auto_launch: true,
  minimize_to_tray: true,
  start_minimized: false,
  keep_all_backups: true,
  auto_backup_enabled: true,
  auto_backup_frequency: 'daily',
  auto_backup_time: '13:00',
  update_check_enabled: true,
  update_check_time: '10:30',
  admin_password: '1234',
  sms_enabled: false,
  whatsapp_enabled: false,
  sms_provider: null,
  sms_account_sid: null,
  sms_auth_token: null,
  sms_from_number: null,
  whatsapp_api_url: null,
  whatsapp_api_key: null,
  whatsapp_template:
    'Namaste {{patient_name}},\n\nYour appointment at *{{clinic_name}}* is confirmed.\n\n' +
    '*Doctor:* {{doctor_name}}\n*Room:* {{room}}\n*Date:* {{date}}   *Time:* {{time}}\n*Token:* #{{token}}\n\n' +
    '*Patient ID (UHID):* {{uhid}}\n*Visit ID:* {{visit_id}}\n\n' +
    '{{clinic_address}}\nPhone: {{clinic_phone}}\n\nThank you,\n*{{clinic_name}}*',
  whatsapp_country_code: '91',
  aisensy_signup_url: '',
  aisensy_connected_on: '',
  appointments_default_sort: 'oldest_first',
  records_list_window: 'quarter',
  followup_enabled: true,
  followup_window_days: 7,
  followup_free_visits: 2,
  followup_grace_days: 2,
  registration_fee_enabled: true,
  registration_fee_amount: 100,
  registration_fee_default_timing: 'ask',
  misc_services: 'Procedure,Vaccination,Nebulization,Wound Dressing,Injection,Suture / Stitches,IV Fluids,Other',
  network_mode: 'local',
  network_listen_port: 4321,
  network_server_url: '',
  network_secret: '',
  network_bind_ip: '',
  station_name: '',
  gst_enabled: false,
  pharmacy_gst_enabled: null,
  default_drug_gst_rate: null,
  gst_registration_type: 'unregistered',
  clinic_gstin: '',
  clinic_legal_name: '',
  clinic_state_code: '',
  healthcare_gst_exempt: true,
  invoice_prefix: 'INV',
  ip_number_prefix: 'IP',
  bill_round_off: true,
  ipd_auto_accrue_bed: true,
  ipd_auto_accrue_nursing: true,
  ipd_auto_accrue_doctor_visit: true,
  ipd_doctor_visit_mode: 'per_consultant',
  ipd_transfer_charge_rule: 'higher',
  ipd_accrual_time: '00:05',
  ipd_advance_enabled: true,
  discount_caps_json: '{"admin":100}',
  discount_require_reason: true,
  pharmacy_discount_caps_json: '',
  tpa_enabled: true,
  peds_enabled: true,
  peds_growth_enabled: true,
  peds_vaccines_enabled: true,
  peds_calculators_enabled: true,
  peds_vaccine_schedule: 'iap',
  peds_growth_default: 'auto',
  print_patient_language: 'kn',
  ipd_admission_requests_enabled: true,
  discharge_summary_enabled: true,
  lab_auto_bill: true, radiology_auto_bill: true,
  pharmacy_credit_enabled: true, pharmacy_ipd_charge_enabled: true, ipd_gst_enabled: true,
  role_access_json: '',
  sidebar_layout: '',
  station_role: 'everything',
  require_login: false,
  session_timeout_minutes: 0,
  qr1_img: '',
  qr1_label: 'Scan to Pay / Review',
  qr2_img: '',
  qr2_label: 'Scan to Pay / Review',
  anthropic_api_key: '',
  google_review_url: '',
};

// ---------- Doctors ----------
export const DEMO_DOCTORS: Doctor[] = [
  { id: 1, name: 'Dr. A. Sharma', specialty: 'General Physician', phone: '9000000001', email: 'doctor1@example.com', room_number: '101', is_active: 1, default_fee: 500, qualifications: 'MBBS, MD (Medicine)', registration_no: 'KMC-12345', signature: null, color: '#10b981', available_from: '09:00', available_to: '21:00' },
  { id: 2, name: 'Dr. P. Rao', specialty: 'Pediatrician', phone: '9000000002', email: 'doctor2@example.com', room_number: '102', is_active: 1, default_fee: 600, qualifications: 'MBBS, DCH', registration_no: 'KMC-23456', signature: null, color: '#0ea5e9', available_from: '10:00', available_to: '18:00' },
  { id: 3, name: 'Dr. M. Iyer', specialty: 'Orthopedic', phone: '9000000003', email: 'doctor3@example.com', room_number: '103', is_active: 1, default_fee: 700, qualifications: 'MBBS, MS (Ortho)', registration_no: 'KMC-34567', signature: null, color: '#f59e0b', available_from: '17:00', available_to: '20:00' },
  { id: 4, name: 'Dr. R. Menon', specialty: 'ENT', phone: '9000000004', email: 'doctor4@example.com', room_number: '1', is_active: 1, default_fee: 600, qualifications: 'MBBS, MS (ENT)', registration_no: 'KMC-45678', signature: null, color: '#8b5cf6', available_from: '11:00', available_to: '17:00' },
  { id: 5, name: 'Dr. K. Nair', specialty: 'OBG', phone: '9000000005', email: 'doctor5@example.com', room_number: '3', is_active: 1, default_fee: 500, qualifications: 'MBBS, MD (OBG)', registration_no: 'KMC-56789', signature: null, color: '#ec4899', available_from: '09:00', available_to: '13:00' },
];

// ---------- Patients ----------
const FIRST_NAMES_M = ['Suresh', 'Mahesh', 'Rajesh', 'Anil', 'Mohan', 'Vikram', 'Kiran', 'Arjun', 'Shivaraj', 'Basavaraj', 'Mallikarjun', 'Veerappa', 'Ravi', 'Manjunath', 'Prakash', 'Hanumanth', 'Channappa', 'Santosh', 'Ashok', 'Naveen'];
const FIRST_NAMES_F = ['Sushma', 'Lakshmi', 'Saraswati', 'Renuka', 'Mahadevi', 'Bhagya', 'Shanta', 'Geeta', 'Padma', 'Kavita', 'Rekha', 'Pushpa', 'Indira', 'Yamuna', 'Sangeeta', 'Anitha', 'Vidya', 'Sunita', 'Nanda', 'Roopa'];
const LAST_NAMES = ['Patil', 'Hiremath', 'Desai', 'Kulkarni', 'Goudar', 'Hubballi', 'Kamatar', 'Joshi', 'Madiwalar', 'Kerur', 'Naregal', 'Lakshmeshwar', 'Shetty', 'Annigeri', 'Hosur', 'Doddagoudar', 'Pujari', 'Ronad', 'Math', 'Doddamath'];
const PLACES = ['Shantipur', 'Gadag', 'Lakshmeshwar', 'Naregal', 'Shirahatti', 'Annigeri', 'Hulkoti', 'Ron', 'Hosalli', 'Holealur', 'Betageri', 'Doni', 'Kalkeri', 'Yelvigi', 'Soratur'];
const PROFESSIONS = ['Farmer', 'Housewife', 'Teacher', 'Driver', 'Shopkeeper', 'Student', 'Retired', 'Tailor', 'Carpenter', 'Mason', 'Govt. employee', 'Daily wage', 'Mechanic', 'Electrician', 'Vendor'];
const BLOOD_GROUPS = ['O+', 'A+', 'B+', 'AB+', 'O-', 'A-', 'B-', null, null, null]; // many unknown

interface DemoPatient {
  id: number; uhid: string; first_name: string; last_name: string; dob: string;
  gender: 'M' | 'F' | 'Other'; phone: string; email: string | null; address: string | null;
  blood_group: string | null; place: string | null; district: string | null; state: string | null;
  profession: string | null; created_at: string;
}

export const DEMO_PATIENTS: DemoPatient[] = range(50).map((i) => {
  const idx = i + 1;
  const isMale = rand() > 0.5;
  const fn = isMale ? pick(FIRST_NAMES_M) : pick(FIRST_NAMES_F);
  const ln = pick(LAST_NAMES);
  const ageYears = Math.floor(rand() * 75) + 1;
  const dob = new Date(TODAY); dob.setFullYear(dob.getFullYear() - ageYears); dob.setMonth(Math.floor(rand() * 12)); dob.setDate(Math.floor(rand() * 28) + 1);
  const createdDaysAgo = Math.floor(rand() * 365);
  return {
    id: idx,
    uhid: `MMC-${pad(idx, 4)}`,
    first_name: fn,
    last_name: ln,
    dob: dob.toISOString().slice(0, 10),
    gender: isMale ? 'M' : 'F',
    phone: `9${pad(Math.floor(rand() * 999999999), 9)}`,
    email: null,
    address: null,
    blood_group: pick(BLOOD_GROUPS),
    place: pick(PLACES),
    district: 'Gadag',
    state: 'Karnataka',
    profession: pick(PROFESSIONS),
    created_at: daysAgo(createdDaysAgo) + 'T10:00:00Z',
  };
});

// ---------- Appointments ----------
const STATUSES: Array<'Done' | 'Waiting' | 'In Progress' | 'Cancelled'> = ['Done', 'Done', 'Done', 'Done', 'Done', 'Waiting', 'In Progress', 'Cancelled'];
const TIMES = ['09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00'];

// What the front desk typed in the Referral box. Deterministic by index, never rand(): the rest of the demo data must come out exactly as before.
// (Some are spelt differently on purpose — "google", "Dr Ramesh Kumar" — because Analytics → Referrals counts them as one source.)
const DEMO_REFERRALS = ['Google', 'Self', 'Family', 'Dr. Ramesh Kumar', 'Google', 'Self', 'Dr. Meena Shetty', 'google', 'Old patient', 'Family', '', 'Self',
  'Dr Ramesh Kumar', 'Google', 'Instagram', 'Self', 'Neighbour', 'Google', '', 'Family', 'Dr. Meena Shetty', 'Self', 'Google', 'Instagram'];
export const DEMO_APPOINTMENTS: AppointmentWithJoins[] = range(100).map((i) => {
  const id = i + 1;
  const patient = DEMO_PATIENTS[Math.floor(rand() * DEMO_PATIENTS.length)];
  const doctor = DEMO_DOCTORS[Math.floor(rand() * DEMO_DOCTORS.length)];
  const dateOffset = Math.floor(rand() * 60); // last 60 days
  const date = daysAgo(dateOffset);
  const time = pick(TIMES);
  const isToday = dateOffset === 0;
  const status = isToday ? pick(['Waiting', 'In Progress', 'Done', 'Done']) : 'Done';
  return {
    id,
    patient_id: patient.id,
    doctor_id: doctor.id,
    appointment_date: date,
    appointment_time: time,
    token_number: (i % 25) + 1,
    consultation_token: null,
    status,
    notes: pick(['Fever, cough', 'Routine checkup', 'Joint pain', 'Headache', 'Stomach pain', null, null]),
    created_at: isoAt(date, time) + 'Z',
    patient_name: `${patient.first_name} ${patient.last_name}`,
    patient_uhid: patient.uhid,
    patient_dob: patient.dob,
    patient_gender: patient.gender,
    patient_phone: patient.phone,
    patient_blood_group: patient.blood_group,
    patient_created_at: patient.created_at,
    doctor_name: doctor.name,
    doctor_specialty: doctor.specialty,
    doctor_room: doctor.room_number,
    referred_by: DEMO_REFERRALS[(i * 7 + 3) % DEMO_REFERRALS.length] || null,
  } as AppointmentWithJoins;
});

// ---------- Bills (one per appointment, mostly paid) ----------
const PAY_MODES = ['Cash', 'Cash', 'Cash', 'UPI', 'UPI', 'Card'];
export const DEMO_BILLS: (Bill & { patient_name?: string; doctor_name?: string })[] = DEMO_APPOINTMENTS
  .filter((a) => a.status !== 'Cancelled')
  .map((a) => {
    const doc = DEMO_DOCTORS.find((d) => d.id === a.doctor_id)!;
    const fee = doc.default_fee + Math.floor(rand() * 200);
    return {
      id: a.id,
      bill_number: `BL-${pad(a.id, 4)}`,
      appointment_id: a.id,
      patient_id: a.patient_id,
      subtotal: fee,
      discount: 0,
      discount_type: 'flat',
      total: fee,
      payment_mode: pick(PAY_MODES),
      // The real database stores line items as JSON; screens that print a bill
      // (Invoice, reprint) JSON.parse this, so the sample bills must carry it too.
      items_json: JSON.stringify([{ description: 'OPD Consultation', qty: 1, rate: fee, amount: fee }]),
      created_at: a.created_at,
      patient_name: a.patient_name,
      doctor_name: a.doctor_name,
    } as any;
  });

// ---------- Drug master + batches ----------
// The 15 drugs this demo clinic holds on its shelf. Each is a row of the standard catalogue (src/data/pharmacy-catalog.ts), so the Drug List shows
// real compositions and no duplicates; the manufacturer and the per-unit price are the demo's own. The REST of the catalogue follows with no stock,
// exactly like a new install (a drug list to pick from, nothing on the shelf).
const STOCKED: { name: string; mfg: string; mrp: number }[] = [
  { name: 'Crocin Advance', mfg: 'GSK', mrp: 2 },
  { name: 'Cetirizine', mfg: 'Cipla', mrp: 1.5 },
  { name: 'Mox 500', mfg: 'Sun', mrp: 4 },
  { name: 'Azithral 500', mfg: 'Alembic', mrp: 15 },
  { name: 'Pan 40', mfg: 'Alkem', mrp: 3 },
  { name: 'Emeset 4', mfg: 'Cipla', mrp: 5 },
  { name: 'Glycomet 500', mfg: 'USV', mrp: 2 },
  { name: 'Amlong 5', mfg: 'Micro Labs', mrp: 2.5 },
  { name: 'Atorva 10', mfg: 'Zydus', mrp: 4 },
  { name: 'Brufen 400', mfg: 'Abbott', mrp: 2 },
  { name: 'Electral Powder', mfg: 'FDC', mrp: 15 },
  { name: 'Calpol 250 Syrup', mfg: 'GSK', mrp: 45 },
  { name: 'Ascoril LS Syrup', mfg: 'Glenmark', mrp: 60 },
  { name: 'Levocet', mfg: 'Hetero', mrp: 2 },
  { name: 'Telma 40', mfg: 'Glenmark', mrp: 5 },
];

const masterRow = (c: CatalogDrug, id: number, mfg: string | null, mrp: number): DrugMaster => ({
  id,
  name: c.name,
  generic_name: c.generic_name,
  manufacturer: mfg,
  form: c.form,
  strength: c.strength,
  pack_size: c.pack_size ?? null,
  schedule: c.schedule,
  hsn_code: '30049099',
  gst_rate: c.gst_rate,
  default_mrp: mrp,
  low_stock_threshold: 10,
  barcode: null,
  is_active: 1,
  notes: null,
  created_at: daysAgo(180),
  updated_at: daysAgo(30),
});
const stockedNames = new Set(STOCKED.map((d) => d.name));
// The catalogue's MRP is per PACK; this demo prices a unit (a tablet). The two extra brands stocked below are written per unit as well.
const PER_UNIT_MRP: Record<string, number> = { 'Dolo 500': 2.2, 'Dolo 650': 3.1 };
export const DEMO_DRUG_MASTER: DrugMaster[] = [
  ...STOCKED.map((d, i) => masterRow(PHARMACY_CATALOG.find((c) => c.name === d.name)!, i + 1, d.mfg, d.mrp)),
  ...PHARMACY_CATALOG.filter((c) => !stockedNames.has(c.name)).map((c, i) => masterRow(c, STOCKED.length + i + 1, null, PER_UNIT_MRP[c.name] ?? c.default_mrp)),
];
/** The drugs that have stock behind them (the first rows): what the demo's batches, sales, prescriptions and dispensing draw from. */
const STOCKED_MASTER = DEMO_DRUG_MASTER.slice(0, STOCKED.length);

// A deliberate spread — some expiring, one already expired, a couple low, two out — so every filter on
// "Drugs in my clinic" has something in it. (Days to the first batch's expiry, and units left in each batch.)
const SHELF: Record<number, { exp0: number; q0?: number; q1?: number }> = {
  1: { exp0: 40 }, 2: { exp0: -25, q0: 12 }, 3: { exp0: 160, q0: 4, q1: 0 }, 4: { exp0: 120, q0: 0, q1: 0 },
  5: { exp0: 75 }, 6: { exp0: 60, q0: 6, q1: 0 }, 8: { exp0: 200, q0: 0, q1: 0 }, 9: { exp0: -10, q0: 8 },
};

const GENERATED_BATCHES: DrugStockBatch[] = STOCKED_MASTER.flatMap((m, i) => {
  // Two batches per drug with different expiries.
  return [0, 1].map((bi) => {
    const left = 100 - Math.floor(rand() * 50);           // one rand() per batch, as before — the rest of the demo data is unchanged
    const shelf = SHELF[i];
    return {
      id: i * 10 + bi + 1,
      drug_master_id: m.id,
      purchase_item_id: i % 4 === 0 ? null : i * 2 + bi + 1,   // every fourth drug was typed in by hand (cost not recorded)
      batch_no: `BX${pad(i, 2)}${bi}`,
      expiry: fromToday(bi === 0 ? (shelf?.exp0 ?? 150 + (i % 4) * 30) : 300 + (i % 5) * 20),
      qty_received: 100,
      qty_remaining: (bi === 0 ? shelf?.q0 : shelf?.q1) ?? left,
      purchase_price: m.default_mrp * 0.7,
      mrp: m.default_mrp,
      manufacturer_license_no: 'KA-MFG-12345',
      received_at: daysAgo(60),
      is_active: 1,
      drug_name: m.name,
      schedule: m.schedule,
    };
  });
});

// Brands of ONE medicine sit together (same ingredient, strength and form): Crocin Advance has Dolo 500 beside it, and "Paracetamol 650 mg
// Tablet" — which the doctor prescribes by its generic name — is on the shelf as Dolo 650. Added after the generated batches, so nothing above moves.
const brandBatch = (name: string, id: number, batchNo: string, expDays: number, qty: number, unitCost: number): DrugStockBatch => {
  const m = DEMO_DRUG_MASTER.find((d) => d.name === name)!;
  return {
    id, drug_master_id: m.id, purchase_item_id: id, batch_no: batchNo, expiry: fromToday(expDays), qty_received: 100, qty_remaining: qty,
    purchase_price: unitCost, mrp: m.default_mrp, manufacturer_license_no: 'KA-MFG-12345', received_at: daysAgo(40), is_active: 1, drug_name: m.name, schedule: m.schedule,
  } as DrugStockBatch;
};
export const DEMO_BATCHES: DrugStockBatch[] = [
  ...GENERATED_BATCHES,
  brandBatch('Dolo 500', 901, 'DL5001', 95, 70, 1.6),
  brandBatch('Dolo 650', 902, 'DL6501', 210, 60, 2.2),
  brandBatch('Dolo 650', 903, 'DL6502', 330, 45, 2.2),
];

// ---------- Wholesalers ----------
export const DEMO_WHOLESALERS: Wholesaler[] = [
  { id: 1, name: 'Cipla Distributor', contact_person: 'Mr. Patel', phone: '9876543210', email: null, address: 'Hubli', drug_license_no: 'KA-HBL-20B/2024-001', gstin: '29AABCC1234D1Z5', is_active: 1, notes: null, created_at: daysAgo(200) },
  { id: 2, name: 'Sun Pharma Hubli', contact_person: 'Mr. Joshi', phone: '9876500000', email: null, address: 'Hubli', drug_license_no: 'KA-HBL-20B/2024-007', gstin: '29SUNPH7890Q1Z2', is_active: 1, notes: null, created_at: daysAgo(180) },
  { id: 3, name: 'GSK Karnataka', contact_person: null, phone: null, email: null, address: 'Bengaluru', drug_license_no: 'KA-BNG-20B/2024-101', gstin: null, is_active: 1, notes: null, created_at: daysAgo(150) },
];

// ---------- Purchase invoices ----------
export const DEMO_PURCHASES: PurchaseInvoice[] = range(8).map((i) => ({
  id: i + 1,
  invoice_number: `INV-${pad(i + 1, 5)}`,
  wholesaler_id: pick([1, 2, 3]),
  invoice_date: daysAgo(60 - i * 7),
  received_date: daysAgo(58 - i * 7),
  subtotal: 5000 + Math.floor(rand() * 10000),
  cgst: 600,
  sgst: 600,
  igst: 0,
  discount: 0,
  total: 6200 + Math.floor(rand() * 10000),
  payment_mode: pick(['Cash', 'Bank', 'Cheque']),
  payment_status: pick(['paid', 'paid', 'unpaid']) as any,
  scan_path: null,
  ocr_job_id: null,
  notes: null,
  created_at: daysAgo(60 - i * 7) + 'T10:00:00Z',
}));

// ---------- Pharmacy sales ----------
export const DEMO_PHARMACY_SALES: PharmacySale[] = range(50).map((i) => {
  const a = DEMO_APPOINTMENTS[i % DEMO_APPOINTMENTS.length];
  const total = 80 + Math.floor(rand() * 500);
  return {
    id: i + 1,
    sale_number: `PHX-${pad(i + 1, 5)}`,
    patient_id: i % 3 === 0 ? null : a.patient_id, // some walk-ins
    appointment_id: i % 3 === 0 ? null : a.id,
    subtotal: total,
    discount: 0,
    total,
    payment_mode: pick(PAY_MODES),
    sold_by: 'Counter',
    created_at: a.created_at,
  };
});

// ---------- Dispensing register ----------
export const DEMO_DISPENSING: DispensingRow[] = range(80).map((i) => {
  const sale = DEMO_PHARMACY_SALES[i % DEMO_PHARMACY_SALES.length];
  const drug = pick(STOCKED_MASTER);
  const batch = DEMO_BATCHES.find((b) => b.drug_master_id === drug.id)!;
  return {
    id: i + 1,
    sale_item_id: i + 1,
    sale_id: sale.id,
    patient_id: sale.patient_id,
    doctor_id: pick([1, 2, 3, 4, 5]),
    drug_master_id: drug.id,
    batch_id: batch.id,
    batch_no: batch.batch_no,
    expiry: batch.expiry,
    schedule: drug.schedule,
    qty: Math.floor(rand() * 10) + 1,
    rate: drug.default_mrp,
    rx_reference: `Rx ${sale.created_at.slice(0, 10)}`,
    dispensed_at: sale.created_at,
    dispensed_by: 'Counter',
    drug_name: drug.name,
    doctor_name: DEMO_DOCTORS.find((d) => d.id === pick([1, 2, 3, 4, 5]))?.name || null,
  };
});

// ---------- Consultations ----------
export const DEMO_CONSULTATIONS: Consultation[] = DEMO_APPOINTMENTS
  .filter((a) => a.status === 'Done')
  .slice(0, 30)
  .map((a, i) => ({
    id: i + 1,
    appointment_id: a.id,
    patient_id: a.patient_id,
    doctor_id: a.doctor_id,
    history: pick([
      'Fever since 3 days, cough, body ache',
      'Knee pain since 1 week',
      'Headache, nausea',
      'Recurrent stomach pain',
      'Dry skin, itching',
    ]),
    examination: 'Vitals stable. No acute distress. Throat congested.',
    impression: pick(['Acute viral URI', 'Osteoarthritis', 'Migraine', 'GERD', 'Allergic dermatitis']),
    advice: 'Hydration, rest, follow-up if symptoms persist > 48h.',
    follow_up_date: daysAgo(-7),
    vitals: { bp: '120/80', pulse: '78', temp: '98.6', spo2: '99', rr: '16', weight: '65', height: '170' } as Vitals,
    created_at: a.created_at,
    updated_at: a.created_at,
  } as Consultation));

// ---------- Prescription items ----------
const GENERATED_RX_ITEMS: PrescriptionItem[] = DEMO_CONSULTATIONS.flatMap((c, i) => {
  const drugs = [pick(STOCKED_MASTER), pick(STOCKED_MASTER)];
  return drugs.map((d, j) => ({
    id: i * 10 + j + 1,
    appointment_id: c.appointment_id,
    drug_master_id: d.id,
    drug_name: d.name,
    dosage: '1 tab',
    frequency: pick(['1-0-1', '1-1-1', '0-0-1']),
    duration: pick(['3 days', '5 days', '1 week']),
    instructions: pick(['After food', 'Before food', null]),
  } as PrescriptionItem));
});
// One prescription is written by the GENERIC name (the doctor does not pick a brand); the pharmacy fills it from the brand on the shelf.
const GENERIC_RX = DEMO_DRUG_MASTER.find((d) => d.name === 'Paracetamol 650 mg Tablet')!;
export const DEMO_RX_ITEMS: PrescriptionItem[] = [
  ...GENERATED_RX_ITEMS,
  { id: 9001, appointment_id: DEMO_CONSULTATIONS[0].appointment_id, drug_master_id: GENERIC_RX.id, drug_name: GENERIC_RX.name, dosage: '1 tab', frequency: '1-0-1', duration: '3 days', instructions: 'After food' } as PrescriptionItem,
];
