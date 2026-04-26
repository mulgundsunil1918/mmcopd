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
function isoAt(date: string, time: string) {
  return `${date}T${time}:00`;
}

// ---------- Settings ----------
export const DEMO_SETTINGS: Settings = {
  clinic_name: 'Mulgund Multispeciality Clinic',
  clinic_address: '1st Floor, Arihant Plaza, Rotary Circle, Gadag - 582 101',
  clinic_phone: '9019263206',
  clinic_email: 'mulgundsunil@gmail.com',
  clinic_tagline: 'Trusted Care',
  clinic_registration_no: '13567',
  clinic_logo: '',
  slot_duration: 30,
  consultation_fee: 250,
  special_price: 150,
  queue_flow_enabled: false,
  show_user_badge: true,
  show_billing_module: false,
  show_patient_origin: false,
  app_mode: 'reception_pharmacy_doctor',
  default_state: 'Karnataka',
  default_district: 'Gadag',
  known_villages: 'Mulgund, Gadag, Lakshmeshwar, Naregal, Shirahatti',
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
  admin_password: '1918',
  sms_enabled: false,
  whatsapp_enabled: false,
  sms_provider: null,
  sms_account_sid: null,
  sms_auth_token: null,
  sms_from_number: null,
  whatsapp_api_url: null,
  whatsapp_api_key: null,
  whatsapp_template:
    'Namaste {{patient_name}} 🙏\n\nYour appointment at *{{clinic_name}}* is confirmed.\n\n' +
    '👨‍⚕️ *Doctor:* {{doctor_name}}\n🚪 *Room:* {{room}}\n📅 *Date:* {{date}}    🕒 *Time:* {{time}}\n🎟️ *Token:* #{{token}}\n\n' +
    '🆔 *Patient ID (UHID):* {{uhid}}\n📋 *Visit ID:* {{visit_id}}\n\n' +
    '📍 {{clinic_address}}\n☎️ {{clinic_phone}}\n\nThank you,\n*{{clinic_name}}*',
  whatsapp_country_code: '91',
  appointments_default_sort: 'oldest_first',
};

// ---------- Doctors ----------
export const DEMO_DOCTORS: Doctor[] = [
  { id: 1, name: 'Dr. Sunil Mulgund', specialty: 'General Physician', phone: '9900000001', email: 'sunil@mmc.clinic', room_number: '101', is_active: 1, default_fee: 500, qualifications: 'MBBS, MD (Medicine)', registration_no: 'KMC-12345', signature: null, color: '#10b981', available_from: '09:00', available_to: '21:00' },
  { id: 2, name: 'Dr. Priya Patil', specialty: 'Pediatrician', phone: '9900000002', email: 'priya@mmc.clinic', room_number: '102', is_active: 1, default_fee: 600, qualifications: 'MBBS, DCH', registration_no: 'KMC-23456', signature: null, color: '#0ea5e9', available_from: '10:00', available_to: '18:00' },
  { id: 3, name: 'Dr. Rahul Desai', specialty: 'Orthopedic', phone: '9900000003', email: 'rahul@mmc.clinic', room_number: '103', is_active: 1, default_fee: 700, qualifications: 'MBBS, MS (Ortho)', registration_no: 'KMC-34567', signature: null, color: '#f59e0b', available_from: '17:00', available_to: '20:00' },
  { id: 4, name: 'Dr. Sunita Mulgund', specialty: 'ENT', phone: '9900000004', email: 'sunita@mmc.clinic', room_number: '1', is_active: 1, default_fee: 600, qualifications: 'MBBS, MS (ENT)', registration_no: 'KMC-45678', signature: null, color: '#8b5cf6', available_from: '11:00', available_to: '17:00' },
  { id: 5, name: 'Dr. Veeresh', specialty: 'OBG', phone: '9900000005', email: 'veeresh@mmc.clinic', room_number: '3', is_active: 1, default_fee: 500, qualifications: 'MBBS, MD (OBG)', registration_no: 'KMC-56789', signature: null, color: '#ec4899', available_from: '09:00', available_to: '13:00' },
];

// ---------- Patients ----------
const FIRST_NAMES_M = ['Suresh', 'Mahesh', 'Rajesh', 'Anil', 'Mohan', 'Vikram', 'Kiran', 'Arjun', 'Shivaraj', 'Basavaraj', 'Mallikarjun', 'Veerappa', 'Ravi', 'Manjunath', 'Prakash', 'Hanumanth', 'Channappa', 'Santosh', 'Ashok', 'Naveen'];
const FIRST_NAMES_F = ['Sushma', 'Lakshmi', 'Saraswati', 'Renuka', 'Mahadevi', 'Bhagya', 'Shanta', 'Geeta', 'Padma', 'Kavita', 'Rekha', 'Pushpa', 'Indira', 'Yamuna', 'Sangeeta', 'Anitha', 'Vidya', 'Sunita', 'Nanda', 'Roopa'];
const LAST_NAMES = ['Patil', 'Hiremath', 'Desai', 'Kulkarni', 'Goudar', 'Hubballi', 'Kamatar', 'Joshi', 'Madiwalar', 'Kerur', 'Naregal', 'Lakshmeshwar', 'Mulgund', 'Annigeri', 'Hosur', 'Doddagoudar', 'Pujari', 'Ronad', 'Math', 'Doddamath'];
const PLACES = ['Mulgund', 'Gadag', 'Lakshmeshwar', 'Naregal', 'Shirahatti', 'Annigeri', 'Hulkoti', 'Ron', 'Hosalli', 'Holealur', 'Betageri', 'Doni', 'Kalkeri', 'Yelvigi', 'Soratur'];
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
      created_at: a.created_at,
      patient_name: a.patient_name,
      doctor_name: a.doctor_name,
    } as any;
  });

// ---------- Drug master + batches ----------
const DRUG_SEED: { name: string; generic: string; mfg: string; form: string; strength: string; schedule: DrugSchedule; mrp: number }[] = [
  { name: 'Paracetamol 500mg', generic: 'Paracetamol', mfg: 'GSK', form: 'Tab', strength: '500mg', schedule: 'OTC', mrp: 2 },
  { name: 'Cetirizine 10mg', generic: 'Cetirizine', mfg: 'Cipla', form: 'Tab', strength: '10mg', schedule: 'OTC', mrp: 1.5 },
  { name: 'Amoxicillin 500mg', generic: 'Amoxicillin', mfg: 'Cipla', form: 'Cap', strength: '500mg', schedule: 'H', mrp: 4 },
  { name: 'Azithromycin 500mg', generic: 'Azithromycin', mfg: 'Cipla', form: 'Tab', strength: '500mg', schedule: 'H', mrp: 15 },
  { name: 'Pantoprazole 40mg', generic: 'Pantoprazole', mfg: 'Sun', form: 'Tab', strength: '40mg', schedule: 'OTC', mrp: 3 },
  { name: 'Ondansetron 4mg', generic: 'Ondansetron', mfg: 'Sun', form: 'Tab', strength: '4mg', schedule: 'H', mrp: 5 },
  { name: 'Metformin 500mg', generic: 'Metformin', mfg: 'Lupin', form: 'Tab', strength: '500mg', schedule: 'H', mrp: 2 },
  { name: 'Amlodipine 5mg', generic: 'Amlodipine', mfg: 'Lupin', form: 'Tab', strength: '5mg', schedule: 'H', mrp: 2.5 },
  { name: 'Atorvastatin 10mg', generic: 'Atorvastatin', mfg: 'Sun', form: 'Tab', strength: '10mg', schedule: 'H', mrp: 4 },
  { name: 'Ibuprofen 400mg', generic: 'Ibuprofen', mfg: 'GSK', form: 'Tab', strength: '400mg', schedule: 'OTC', mrp: 2 },
  { name: 'ORS Sachet', generic: 'Oral Rehydration Salts', mfg: 'Cipla', form: 'Sachet', strength: '—', schedule: 'OTC', mrp: 15 },
  { name: 'Crocin Syrup 60ml', generic: 'Paracetamol', mfg: 'GSK', form: 'Syrup', strength: '60ml', schedule: 'OTC', mrp: 45 },
  { name: 'Cough Syrup 100ml', generic: 'Dextromethorphan', mfg: 'Cipla', form: 'Syrup', strength: '100ml', schedule: 'H', mrp: 60 },
  { name: 'Levocetirizine 5mg', generic: 'Levocetirizine', mfg: 'Sun', form: 'Tab', strength: '5mg', schedule: 'OTC', mrp: 2 },
  { name: 'Telmisartan 40mg', generic: 'Telmisartan', mfg: 'Lupin', form: 'Tab', strength: '40mg', schedule: 'H', mrp: 5 },
];

export const DEMO_DRUG_MASTER: DrugMaster[] = DRUG_SEED.map((d, i) => ({
  id: i + 1,
  name: d.name,
  generic_name: d.generic,
  manufacturer: d.mfg,
  form: d.form,
  strength: d.strength,
  pack_size: 10,
  schedule: d.schedule,
  hsn_code: '30049099',
  gst_rate: 12,
  default_mrp: d.mrp,
  low_stock_threshold: 10,
  barcode: null,
  is_active: 1,
  notes: null,
  created_at: daysAgo(180),
  updated_at: daysAgo(30),
}));

export const DEMO_BATCHES: DrugStockBatch[] = DEMO_DRUG_MASTER.flatMap((m, i) => {
  // Two batches per drug with different expiries.
  return [0, 1].map((bi) => ({
    id: i * 10 + bi + 1,
    drug_master_id: m.id,
    purchase_item_id: null,
    batch_no: `BX${pad(i, 2)}${bi}`,
    expiry: daysAgo(-90 - bi * 180), // first batch in ~3 months, second in ~9 months
    qty_received: 100,
    qty_remaining: 100 - Math.floor(rand() * 50),
    purchase_price: m.default_mrp * 0.7,
    mrp: m.default_mrp,
    manufacturer_license_no: 'KA-MFG-12345',
    received_at: daysAgo(60),
    is_active: 1,
    drug_name: m.name,
    schedule: m.schedule,
  }));
});

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
  const drug = pick(DEMO_DRUG_MASTER);
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
export const DEMO_RX_ITEMS: PrescriptionItem[] = DEMO_CONSULTATIONS.flatMap((c, i) => {
  const drugs = [pick(DEMO_DRUG_MASTER), pick(DEMO_DRUG_MASTER)];
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
