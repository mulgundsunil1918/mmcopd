import type Database from 'better-sqlite3';
import { getAllSettings } from '../db/settings';
import type { AppointmentWithJoins, NotificationType, Patient, Doctor } from '../types';

export interface NotifyConfig {
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  provider: string | null;
}

export class NotificationService {
  constructor(private db: Database.Database) {}

  private config(): NotifyConfig {
    const s = getAllSettings(this.db);
    return {
      smsEnabled: s.sms_enabled,
      whatsappEnabled: s.whatsapp_enabled,
      provider: s.sms_provider || null,
    };
  }

  private logToDb(patient_id: number | null, type: NotificationType, message: string, status: 'pending' | 'sent' | 'failed' = 'pending') {
    this.db
      .prepare(
        'INSERT INTO notification_log (patient_id, type, message, status, sent_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(patient_id, type, message, status, status === 'sent' ? new Date().toISOString() : null);
  }

  sendAppointmentConfirmation(
    patient: Pick<Patient, 'id' | 'first_name' | 'last_name' | 'phone'>,
    appointment: Pick<AppointmentWithJoins, 'appointment_date' | 'appointment_time' | 'token_number'>,
    doctor: Pick<Doctor, 'name'>,
    clinicName = 'CureDesk HMS'
  ) {
    const name = `${patient.first_name} ${patient.last_name}`.trim();
    const message = `Dear ${name}, your appointment with ${doctor.name} at ${clinicName} is confirmed for ${appointment.appointment_date} at ${appointment.appointment_time}. Token: #${appointment.token_number}`;
    const cfg = this.config();
    if (cfg.smsEnabled || cfg.whatsappEnabled) {
      // Provider not wired yet — would call Twilio / WhatsApp API here.
      this.logToDb(patient.id, cfg.whatsappEnabled ? 'patient_whatsapp' : 'patient_sms', message, 'pending');
    } else {
      this.logToDb(patient.id, 'patient_sms', message, 'pending');
    }
  }

  sendDoctorAlert(
    doctor: Pick<Doctor, 'id' | 'name'>,
    appointment: Pick<AppointmentWithJoins, 'appointment_time' | 'token_number'>,
    patient: Pick<Patient, 'first_name' | 'last_name'>
  ) {
    const pname = `${patient.first_name} ${patient.last_name}`.trim();
    const message = `New patient ${pname} (Token #${appointment.token_number}) scheduled with you at ${appointment.appointment_time} today.`;
    this.logToDb(null, 'doctor_sms', message, 'pending');
  }
}
