export type Gender = 'M' | 'F' | 'Other';

export type AppointmentStatus = 'Waiting' | 'In Progress' | 'Done' | 'Cancelled' | 'Send to Billing';

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
}

export interface Appointment {
  id: number;
  patient_id: number;
  doctor_id: number;
  appointment_date: string;
  appointment_time: string;
  token_number: number;
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

export interface Settings {
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string;
  slot_duration: number;
  consultation_fee: number;
  special_price: number;
  sms_enabled: boolean;
  whatsapp_enabled: boolean;
  sms_provider: string | null;
  sms_account_sid: string | null;
  sms_auth_token: string | null;
  sms_from_number: string | null;
  whatsapp_api_url: string | null;
  whatsapp_api_key: string | null;
}
