import { format, parseISO } from 'date-fns';
import { fmt12h } from './utils';
import type { AppointmentWithJoins, Settings } from '../types';

export const DEFAULT_WHATSAPP_TEMPLATE =
  'Namaste {{patient_name}},\n\n' +
  'Your appointment at *{{clinic_name}}* is confirmed.\n\n' +
  '👨‍⚕️ Doctor: {{doctor_name}}\n' +
  '📅 Date: {{date}}\n' +
  '🕒 Time: {{time}}\n' +
  '🎟️ Token: #{{token}}\n' +
  '🆔 Visit ID: {{visit_id}}\n\n' +
  'Please arrive 10 minutes early. For changes, reply to this message or call {{clinic_phone}}.\n\n' +
  'Thank you,\n{{clinic_name}}';

/** Available placeholders for the WhatsApp template. */
export const WHATSAPP_PLACEHOLDERS: { token: string; sample: string; help: string }[] = [
  { token: '{{patient_name}}', sample: 'Suresh Patil', help: "Patient's full name" },
  { token: '{{doctor_name}}', sample: 'Dr. Sunil Mulgund', help: 'Consulting doctor' },
  { token: '{{date}}', sample: '25 Apr 2026', help: 'Appointment date' },
  { token: '{{time}}', sample: '10:30 AM', help: 'Appointment time (12-hr)' },
  { token: '{{token}}', sample: '7', help: 'Token / queue number' },
  { token: '{{visit_id}}', sample: 'MMC0007/V42', help: 'UHID / Visit ID combo' },
  { token: '{{uhid}}', sample: 'MMC0007', help: "Patient's UHID" },
  { token: '{{clinic_name}}', sample: 'Mulgund Multispeciality Clinic', help: 'Clinic name' },
  { token: '{{clinic_phone}}', sample: '+91 99000 00000', help: 'Clinic phone' },
  { token: '{{clinic_address}}', sample: 'Mulgund, Karnataka', help: 'Clinic address' },
];

export interface WhatsAppContext {
  patient_name: string;
  doctor_name: string;
  date: string;
  time: string;
  token: string;
  visit_id: string;
  uhid: string;
  clinic_name: string;
  clinic_phone: string;
  clinic_address: string;
}

/** Replace {{placeholder}} tokens — case-insensitive, missing values become empty string. */
export function renderTemplate(template: string, ctx: Partial<WhatsAppContext>): string {
  return template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_m, key: string) => {
    const v = (ctx as any)[key.toLowerCase()];
    return v == null ? '' : String(v);
  });
}

/** Build context from an appointment + settings. */
export function buildContext(appointment: AppointmentWithJoins, settings: Settings): WhatsAppContext {
  const dateStr = (() => {
    try {
      return format(parseISO(appointment.appointment_date), 'dd MMM yyyy');
    } catch {
      return appointment.appointment_date;
    }
  })();
  return {
    patient_name: appointment.patient_name || '',
    doctor_name: appointment.doctor_name || '',
    date: dateStr,
    time: fmt12h(appointment.appointment_time),
    token: String(appointment.token_number ?? ''),
    visit_id: `${appointment.patient_uhid}/V${appointment.id}`,
    uhid: appointment.patient_uhid || '',
    clinic_name: settings.clinic_name || '',
    clinic_phone: settings.clinic_phone || '',
    clinic_address: settings.clinic_address || '',
  };
}

/** Strip non-digits from phone, prepend country code if not present. */
export function normalizeIndianPhone(raw: string, countryCode = '91'): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  // If already starts with country code (e.g. 91), keep as is.
  if (digits.startsWith(countryCode) && digits.length >= countryCode.length + 10) return digits;
  // 10-digit Indian mobile — prepend country code.
  if (digits.length === 10) return countryCode + digits;
  // Fallback — return digits as-is, let WhatsApp handle invalid numbers.
  return digits.length >= 10 ? digits : null;
}

/** Build a https://wa.me/<phone>?text=<encoded> URL ready for shell.openExternal. */
export function buildWhatsAppUrl(phone: string, message: string, countryCode = '91'): string | null {
  const norm = normalizeIndianPhone(phone, countryCode);
  if (!norm) return null;
  return `https://wa.me/${norm}?text=${encodeURIComponent(message)}`;
}
