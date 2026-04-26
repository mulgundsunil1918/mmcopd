export type Gender = 'M' | 'F' | 'Other';

export type AppointmentStatus = 'Waiting' | 'In Progress' | 'Done' | 'Cancelled' | 'Send to Billing' | 'Ready for Print';

export type PaymentMode = 'Cash' | 'Card' | 'UPI';

export type NotificationStatus = 'pending' | 'sent' | 'failed';

export type NotificationType = 'patient_sms' | 'patient_whatsapp' | 'doctor_sms';

export interface Patient {
  id: number;
  uhid: string;
  first_name: string;
  last_name: string;
  dob: string;
  gender: Gender;
  phone: string;
  email: string | null;
  address: string | null;
  blood_group: string | null;
  place: string | null;
  district: string | null;
  state: string | null;
  profession: string | null;
  created_at: string;
}

export interface PatientInput {
  first_name: string;
  last_name: string;
  dob: string;
  gender: Gender;
  phone: string;
  email?: string | null;
  address?: string | null;
  blood_group?: string | null;
  place?: string | null;
  district?: string | null;
  state?: string | null;
  profession?: string | null;
}

export interface Doctor {
  id: number;
  name: string;
  specialty: string;
  phone: string | null;
  email: string | null;
  room_number: string | null;
  is_active: number;
  default_fee: number;
  signature?: string | null;
  qualifications?: string | null;
  registration_no?: string | null;
  color?: string | null;
}

export interface Appointment {
  id: number;
  patient_id: number;
  doctor_id: number;
  appointment_date: string;
  appointment_time: string;
  token_number: number;
  consultation_token: string | null;
  status: AppointmentStatus;
  notes: string | null;
  created_at: string;
}

export interface AppointmentWithJoins extends Appointment {
  patient_name: string;
  patient_uhid: string;
  patient_dob: string;
  patient_gender: Gender;
  patient_phone: string;
  patient_blood_group: string | null;
  patient_created_at: string;
  doctor_name: string;
  doctor_specialty: string;
  doctor_room: string | null;
}

export interface BillItem {
  description: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface Bill {
  id: number;
  bill_number: string;
  appointment_id: number | null;
  patient_id: number;
  items_json: string;
  subtotal: number;
  discount: number;
  discount_type: 'flat' | 'percent';
  total: number;
  payment_mode: PaymentMode;
  paid_at: string | null;
  created_at: string;
}

export interface BillWithJoins extends Bill {
  patient_name: string;
  patient_uhid: string;
  doctor_name: string | null;
}

export interface NotificationLog {
  id: number;
  patient_id: number | null;
  type: NotificationType;
  message: string;
  status: NotificationStatus;
  sent_at: string | null;
  created_at: string;
  patient_name?: string;
}

export interface Vitals {
  bp?: string;
  pulse?: string;
  temp?: string;
  spo2?: string;
  rr?: string;
  weight?: string;
  height?: string;
}

export interface Consultation {
  id?: number;
  appointment_id: number;
  patient_id: number;
  doctor_id: number;
  history?: string | null;
  vitals?: Vitals | null;
  examination?: string | null;
  impression?: string | null;
  advice?: string | null;
  follow_up_date?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * 6-mode app ladder. Pharmacy is its own toggleable layer because under
 * Drugs & Cosmetics rules, in-house pharmacy needs a separate license —
 * many clinics operate without one and refer patients to outside chemists.
 */
export type AppMode =
  | 'reception'                       // Reception only
  | 'reception_pharmacy'              // + Pharmacy (chemist counter without doctor)
  | 'reception_doctor'                // + Doctor (no pharmacy)
  | 'reception_pharmacy_doctor'       // + Doctor + Pharmacy (most common — DEFAULT)
  | 'reception_pharmacy_doctor_lab'   // + Lab (polyclinic)
  | 'full';                           // + IPD (full hospital)

export interface PrescriptionItem {
  id?: number;
  appointment_id: number;
  drug_name: string;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
  order_idx?: number;
}

export interface LabTest {
  id: number;
  name: string;
  price: number;
  sample_type: string | null;
  ref_range: string | null;
  unit: string | null;
  is_active: number;
}

export type LabOrderStatus = 'ordered' | 'sample_collected' | 'reported' | 'cancelled';

export interface LabOrder {
  id: number;
  order_number: string;
  appointment_id: number | null;
  patient_id: number;
  doctor_id: number | null;
  status: LabOrderStatus;
  ordered_at: string;
  collected_at: string | null;
  reported_at: string | null;
  notes: string | null;
}

export interface LabOrderItem {
  id?: number;
  lab_order_id: number;
  lab_test_id: number | null;
  test_name: string;
  result: string | null;
  unit: string | null;
  ref_range: string | null;
  is_abnormal: number;
}

/** Legacy single-batch drug shape. Kept for the old IPC shim during v0.2.x. */
export interface Drug {
  id: number;
  name: string;
  generic_name: string | null;
  form: string | null;
  strength: string | null;
  mrp: number;
  purchase_price: number | null;
  batch: string | null;
  expiry: string | null;
  stock_qty: number;
  low_stock_threshold: number;
  is_active: number;
}

export type DrugSchedule = 'H' | 'H1' | 'G' | 'X' | 'OTC';

/** Master SKU. Stock lives in DrugStockBatch; sum across batches for total qty. */
export interface DrugMaster {
  id: number;
  name: string;
  generic_name: string | null;
  manufacturer: string | null;
  form: string | null;
  strength: string | null;
  pack_size: number | null;
  schedule: DrugSchedule;
  hsn_code: string | null;
  gst_rate: number;
  default_mrp: number;
  low_stock_threshold: number;
  barcode: string | null;
  is_active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Aggregated from drug_stock_batches by listDrugs (not stored in row). */
  stock_qty?: number;
  /** Earliest expiry across active batches (not stored in row). */
  next_expiry?: string | null;
}

export interface DrugStockBatch {
  id: number;
  drug_master_id: number;
  purchase_item_id: number | null;
  batch_no: string;
  expiry: string;
  qty_received: number;
  qty_remaining: number;
  purchase_price: number | null;
  mrp: number;
  manufacturer_license_no: string | null;
  received_at: string;
  is_active: number;
  /** Joined for display only. */
  drug_name?: string;
  schedule?: DrugSchedule;
}

export interface Wholesaler {
  id: number;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  drug_license_no: string;
  gstin: string | null;
  is_active: number;
  notes: string | null;
  created_at: string;
}

export type PurchasePaymentStatus = 'paid' | 'unpaid' | 'partial';

export interface PurchaseInvoice {
  id: number;
  invoice_number: string;
  wholesaler_id: number;
  invoice_date: string;
  received_date: string;
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  discount: number;
  total: number;
  payment_mode: string | null;
  payment_status: PurchasePaymentStatus;
  scan_path: string | null;
  ocr_job_id: number | null;
  notes: string | null;
  created_at: string;
  /** Joined for display only. */
  wholesaler_name?: string;
}

export interface PurchaseInvoiceItem {
  id: number;
  invoice_id: number;
  drug_master_id: number;
  batch_no: string;
  expiry: string;
  qty_received: number;
  pack_qty: number | null;
  free_qty: number;
  purchase_price: number;
  mrp: number;
  gst_rate: number;
  manufacturer_license_no: string | null;
  line_total: number;
  /** Joined for display only. */
  drug_name?: string;
}

export interface PurchaseInvoiceInput {
  invoice_number: string;
  wholesaler_id: number;
  invoice_date: string;
  received_date?: string;
  subtotal?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  discount?: number;
  total?: number;
  payment_mode?: string | null;
  payment_status?: PurchasePaymentStatus;
  notes?: string | null;
  items: Array<Omit<PurchaseInvoiceItem, 'id' | 'invoice_id' | 'drug_name'>>;
}

export interface DispensingRow {
  id: number;
  sale_item_id: number;
  sale_id: number;
  patient_id: number | null;
  doctor_id: number | null;
  drug_master_id: number;
  batch_id: number;
  batch_no: string;
  expiry: string;
  schedule: DrugSchedule;
  qty: number;
  rate: number;
  rx_reference: string | null;
  dispensed_at: string;
  dispensed_by: string | null;
  /** Joined for display only. */
  patient_name?: string | null;
  drug_name?: string | null;
  doctor_name?: string | null;
}

export interface PharmacySaleItem {
  drug_id?: number | null;
  drug_name: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface PharmacySale {
  id: number;
  sale_number: string;
  patient_id: number | null;
  appointment_id: number | null;
  subtotal: number;
  discount: number;
  total: number;
  payment_mode: string | null;
  sold_by: string | null;
  created_at: string;
}

export type AdmissionStatus = 'admitted' | 'discharged' | 'cancelled';

export interface IpAdmission {
  id: number;
  admission_number: string;
  patient_id: number;
  admission_doctor_id: number | null;
  admitted_at: string;
  discharged_at: string | null;
  bed_number: string | null;
  ward: string | null;
  admission_notes: string | null;
  discharge_summary: string | null;
  status: AdmissionStatus;
}

export interface Settings {
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string;
  clinic_email: string;
  clinic_tagline: string;
  clinic_registration_no: string;
  clinic_logo: string;
  slot_duration: number;
  consultation_fee: number;
  special_price: number;
  queue_flow_enabled: boolean;
  app_mode: AppMode;
  default_state: string;
  default_district: string;
  known_villages: string;
  backup_folder: string;
  backup_reminder_time: string;
  usb_reminder_weekday: number;
  usb_reminder_time: string;
  auto_launch: boolean;
  minimize_to_tray: boolean;
  start_minimized: boolean;
  keep_all_backups: boolean;
  auto_backup_enabled: boolean;
  auto_backup_frequency: 'hourly' | 'every_3_hours' | 'every_6_hours' | 'twice_daily' | 'daily';
  auto_backup_time: string;
  update_check_enabled: boolean;
  update_check_time: string;
  admin_password: string;
  sms_enabled: boolean;
  whatsapp_enabled: boolean;
  sms_provider: string | null;
  sms_account_sid: string | null;
  sms_auth_token: string | null;
  sms_from_number: string | null;
  whatsapp_api_url: string | null;
  whatsapp_api_key: string | null;
  whatsapp_template: string;
  whatsapp_country_code: string;
  appointments_default_sort: 'oldest_first' | 'newest_first';
}
