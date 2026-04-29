import type Database from 'better-sqlite3';
import type { Settings } from '../types';

export function getAllSettings(db: Database.Database): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    clinic_name: map.clinic_name || 'CureDesk HMS',
    clinic_address: map.clinic_address || '',
    clinic_phone: map.clinic_phone || '',
    clinic_email: map.clinic_email || '',
    clinic_tagline: map.clinic_tagline || '',
    clinic_registration_no: map.clinic_registration_no || '',
    clinic_logo: map.clinic_logo || '',
    slot_duration: parseInt(map.slot_duration || '30', 10),
    consultation_fee: parseInt(map.consultation_fee || '250', 10),
    special_price: parseInt(map.special_price || '150', 10),
    queue_flow_enabled: map.queue_flow_enabled === 'true',
    // Default true to preserve existing behavior; users on a single-account
    // setup can hide this from Settings to declutter the sidebar.
    show_user_badge: map.show_user_badge !== 'false',
    // Billing module is for the queue-flow workflow (Send to Billing → invoice).
    // For clinics that take payment upfront at registration it's mostly empty.
    // Default true for backward compat; toggle off in Settings to hide.
    show_billing_module: map.show_billing_module !== 'false',
    // Patient Origin page is also covered by the consolidated Analytics tab.
    // Single-clinic users may want to hide the standalone entry.
    show_patient_origin: map.show_patient_origin !== 'false',
    app_mode: (map.app_mode as any) || 'reception_pharmacy_doctor',
    default_state: map.default_state || '',
    default_district: map.default_district || '',
    known_villages: map.known_villages || '',
    backup_folder: map.backup_folder || '',
    backup_reminder_time: map.backup_reminder_time || '21:00',
    usb_reminder_weekday: parseInt(map.usb_reminder_weekday || '1', 10),
    usb_reminder_time: map.usb_reminder_time || '09:30',
    auto_launch: map.auto_launch === 'true',
    minimize_to_tray: map.minimize_to_tray !== 'false',
    start_minimized: map.start_minimized === 'true',
    keep_all_backups: map.keep_all_backups !== 'false',
    auto_backup_enabled: map.auto_backup_enabled !== 'false',
    auto_backup_frequency: (map.auto_backup_frequency as any) || 'daily',
    auto_backup_time: map.auto_backup_time || '13:00',
    update_check_enabled: map.update_check_enabled !== 'false',
    update_check_time: map.update_check_time || '10:30',
    admin_password: map.admin_password || '1918',
    sms_enabled: map.sms_enabled === 'true',
    whatsapp_enabled: map.whatsapp_enabled === 'true',
    sms_provider: map.sms_provider || null,
    sms_account_sid: map.sms_account_sid || null,
    sms_auth_token: map.sms_auth_token || null,
    sms_from_number: map.sms_from_number || null,
    whatsapp_api_url: map.whatsapp_api_url || null,
    whatsapp_api_key: map.whatsapp_api_key || null,
    whatsapp_template:
      map.whatsapp_template ||
      'Namaste {{patient_name}} 🙏\n\nYour appointment at *{{clinic_name}}* is confirmed.\n\n' +
        '👨‍⚕️ *Doctor:* {{doctor_name}}\n🚪 *Room:* {{room}}\n📅 *Date:* {{date}}    🕒 *Time:* {{time}}\n🎟️ *Token:* #{{token}}\n\n' +
        '🆔 *Patient ID (UHID):* {{uhid}}\n📋 *Visit ID:* {{visit_id}}\n\n' +
        '📍 {{clinic_address}}\n☎️ {{clinic_phone}}\n\n' +
        'Please arrive 10 minutes early. For any change, simply reply to this message or call us.\n\nThank you,\n*{{clinic_name}}*',
    whatsapp_country_code: map.whatsapp_country_code || '91',
    appointments_default_sort: (map.appointments_default_sort as any) || 'oldest_first',
    followup_enabled: map.followup_enabled !== 'false',
    followup_window_days: parseInt(map.followup_window_days || '7', 10),
    followup_free_visits: parseInt(map.followup_free_visits || '2', 10),
    followup_grace_days: parseInt(map.followup_grace_days || '2', 10),
    registration_fee_enabled: map.registration_fee_enabled !== 'false',
    registration_fee_amount: parseInt(map.registration_fee_amount || '100', 10),
    registration_fee_default_timing: (map.registration_fee_default_timing as any) || 'ask',
    misc_services: map.misc_services || 'Procedure,Vaccination,Nebulization,Wound Dressing,Injection,Suture / Stitches,IV Fluids,Other',
  };
}

export function saveSettings(db: Database.Database, patch: Partial<Settings>) {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      upsert.run(k, typeof v === 'boolean' ? String(v) : v === null ? '' : String(v));
    }
  });
  tx();
}
