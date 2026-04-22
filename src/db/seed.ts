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
  app_mode: 'reception_doctor',
  default_state: 'Karnataka',
  default_district: 'Gadag',
  known_villages: 'Mulgund, Gadag, Lakshmeshwar, Shirahatti, Naregal, Rona, Ron, Hulkoti, Koppal, Hubli, Dharwad',
  backup_folder: '',
  admin_password: '1918',
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

  // Seed common drugs
  const drugCount = db.prepare('SELECT COUNT(*) as c FROM drug_inventory').get() as { c: number };
  if (drugCount.c === 0) {
    const ins = db.prepare(
      'INSERT INTO drug_inventory (name, generic_name, form, strength, mrp, stock_qty, low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const drugs: [string, string, string, string, number, number, number][] = [
      ['Paracetamol 500mg', 'Paracetamol', 'Tablet', '500mg', 2, 100, 20],
      ['Cetirizine 10mg', 'Cetirizine', 'Tablet', '10mg', 1.5, 100, 20],
      ['Amoxicillin 500mg', 'Amoxicillin', 'Capsule', '500mg', 4, 50, 10],
      ['Azithromycin 500mg', 'Azithromycin', 'Tablet', '500mg', 15, 30, 10],
      ['Pantoprazole 40mg', 'Pantoprazole', 'Tablet', '40mg', 3, 50, 15],
      ['Ondansetron 4mg', 'Ondansetron', 'Tablet', '4mg', 5, 40, 10],
      ['Metformin 500mg', 'Metformin', 'Tablet', '500mg', 2, 60, 15],
      ['Amlodipine 5mg', 'Amlodipine', 'Tablet', '5mg', 2.5, 60, 15],
      ['Atorvastatin 10mg', 'Atorvastatin', 'Tablet', '10mg', 4, 40, 10],
      ['Ibuprofen 400mg', 'Ibuprofen', 'Tablet', '400mg', 2, 80, 20],
      ['ORS Sachet', 'Oral Rehydration Salts', 'Sachet', '—', 15, 50, 10],
      ['Cough Syrup 100ml', 'Dextromethorphan', 'Syrup', '100ml', 60, 25, 5],
      ['Crocin Syrup 60ml', 'Paracetamol', 'Syrup', '60ml', 45, 25, 5],
      ['Dettol Antiseptic 100ml', 'Chloroxylenol', 'Solution', '100ml', 55, 15, 5],
      ['Bandage Roll', '—', 'Dressing', '—', 25, 30, 10],
    ];
    for (const d of drugs) ins.run(...d);
  }

  // Seed common lab tests
  const labCount = db.prepare('SELECT COUNT(*) as c FROM lab_tests').get() as { c: number };
  if (labCount.c === 0) {
    const ins = db.prepare('INSERT INTO lab_tests (name, price, sample_type, ref_range, unit) VALUES (?, ?, ?, ?, ?)');
    const tests: [string, number, string, string, string][] = [
      ['Complete Blood Count (CBC)', 300, 'Blood (EDTA)', 'Hb 12-16 g/dL; WBC 4-11 ×10³/µL', ''],
      ['Fasting Blood Sugar (FBS)', 80, 'Blood (Fluoride)', '70-100', 'mg/dL'],
      ['Post-prandial Blood Sugar (PPBS)', 80, 'Blood (Fluoride)', '<140', 'mg/dL'],
      ['HbA1c', 400, 'Blood (EDTA)', '4-5.6', '%'],
      ['Lipid Profile', 500, 'Blood (SST)', 'Total Cholesterol <200 mg/dL', ''],
      ['Liver Function Test (LFT)', 450, 'Blood (SST)', '—', ''],
      ['Kidney Function Test (KFT)', 450, 'Blood (SST)', 'Creatinine 0.6-1.2 mg/dL', ''],
      ['Thyroid Profile (T3 T4 TSH)', 400, 'Blood (SST)', 'TSH 0.4-4.0', 'µIU/mL'],
      ['Urine Routine', 100, 'Urine', 'Normal', ''],
      ['ECG', 200, '—', 'Normal sinus rhythm', ''],
      ['X-Ray Chest PA', 250, '—', 'Normal lung fields', ''],
      ['Dengue NS1', 350, 'Blood (SST)', 'Negative', ''],
      ['Malaria Parasite (MP)', 150, 'Blood', 'Not detected', ''],
      ['Widal Test', 150, 'Blood (SST)', '<1:80', ''],
      ['COVID-19 Rapid Antigen', 300, 'Nasal swab', 'Negative', ''],
    ];
    for (const t of tests) ins.run(...t);
  }
}
