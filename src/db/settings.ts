import type Database from 'better-sqlite3';
import type { Settings } from '../types';

export function getAllSettings(db: Database.Database): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    clinic_name: map.clinic_name || 'Mulgund Multispeciality Clinic',
    clinic_address: map.clinic_address || '',
    clinic_phone: map.clinic_phone || '',
    clinic_email: map.clinic_email || '',
    clinic_tagline: map.clinic_tagline || '',
    clinic_registration_no: map.clinic_registration_no || '',
    slot_duration: parseInt(map.slot_duration || '30', 10),
    consultation_fee: parseInt(map.consultation_fee || '250', 10),
    special_price: parseInt(map.special_price || '150', 10),
    sms_enabled: map.sms_enabled === 'true',
    whatsapp_enabled: map.whatsapp_enabled === 'true',
    sms_provider: map.sms_provider || null,
    sms_account_sid: map.sms_account_sid || null,
    sms_auth_token: map.sms_auth_token || null,
    sms_from_number: map.sms_from_number || null,
    whatsapp_api_url: map.whatsapp_api_url || null,
    whatsapp_api_key: map.whatsapp_api_key || null,
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
