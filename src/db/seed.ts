import type Database from 'better-sqlite3';

const DEFAULT_SETTINGS: Record<string, string> = {
  clinic_name: 'Mulgund Multispeciality Clinic',
  clinic_address: 'Mulgund, Karnataka',
  clinic_phone: '',
  clinic_email: '',
  clinic_tagline: 'Compassionate Care, Every Day',
  clinic_registration_no: '',
  slot_duration: '30',
  consultation_fee: '250',
  special_price: '150',
  queue_flow_enabled: 'false',
  sms_enabled: 'false',
  whatsapp_enabled: 'false',
  sms_provider: '',
  sms_account_sid: '',
  sms_auth_token: '',
  sms_from_number: '',
  whatsapp_api_url: '',
  whatsapp_api_key: '',
};

export function seedIfEmpty(db: Database.Database) {
  const doctorCount = db.prepare('SELECT COUNT(*) as c FROM doctors').get() as { c: number };
  if (doctorCount.c === 0) {
    const insert = db.prepare(
      'INSERT INTO doctors (name, specialty, phone, email, room_number, is_active, default_fee) VALUES (?, ?, ?, ?, ?, 1, ?)'
    );
    insert.run('Dr. Sunil Mulgund', 'General Physician', '9900000001', 'sunil@mmc.clinic', '101', 500);
    insert.run('Dr. Priya Patil', 'Pediatrician', '9900000002', 'priya@mmc.clinic', '102', 600);
    insert.run('Dr. Rahul Desai', 'Orthopedic', '9900000003', 'rahul@mmc.clinic', '103', 700);
  }

  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
  );
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) upsert.run(k, v);
}
