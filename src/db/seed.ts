import type Database from 'better-sqlite3';

const DEFAULT_SETTINGS: Record<string, string> = {
  // Empty by design — every install asks the admin to fill these in via
  // Settings → Clinic. Showcase / demo build seeds its own values separately.
  clinic_name: '',
  clinic_address: '',
  clinic_phone: '',
  clinic_email: '',
  clinic_tagline: '',
  clinic_registration_no: '',
  slot_duration: '30',
  consultation_fee: '250',
  special_price: '150',
  queue_flow_enabled: 'false',
  show_user_badge: 'true',
  show_billing_module: 'true',
  show_patient_origin: 'true',
  app_mode: 'reception_pharmacy_doctor',
  default_state: '',
  default_district: '',
  known_villages: '',
  backup_folder: '',
  backup_reminder_time: '21:00',
  usb_reminder_weekday: '1',
  usb_reminder_time: '09:30',
  auto_launch: 'true',
  minimize_to_tray: 'true',
  start_minimized: 'false',
  keep_all_backups: 'true',
  auto_backup_enabled: 'true',
  auto_backup_frequency: 'daily',
  auto_backup_time: '13:00',
  update_check_enabled: 'true',
  update_check_time: '10:30',
  admin_password: '1234',
  sms_enabled: 'false',
  whatsapp_enabled: 'false',
  sms_provider: '',
  sms_account_sid: '',
  sms_auth_token: '',
  sms_from_number: '',
  whatsapp_api_url: '',
  whatsapp_api_key: '',
  whatsapp_country_code: '91',
  appointments_default_sort: 'oldest_first',
  followup_enabled: 'true',
  followup_window_days: '7',
  followup_free_visits: '2',
  followup_grace_days: '2',
  registration_fee_enabled: 'true',
  registration_fee_amount: '100',
  registration_fee_default_timing: 'ask',
  misc_services: 'Procedure,Vaccination,Nebulization,Wound Dressing,Injection,Suture / Stitches,IV Fluids,Other',
  // Network mode (multi-station / client-server). Default 'local' = single PC,
  // private SQLite. 'server' = this PC hosts; 'client' = this PC connects to
  // another PC running 'server'. URL + port + secret are honored only by the
  // active mode. The mode is also mirrored to localStorage at runtime so the
  // renderer can route IPC vs HTTP at boot.
  network_mode: 'local',
  network_listen_port: '4321',
  network_server_url: '',
  network_secret: '',
  // Friendly name for THIS PC, shown to other stations + on the sidebar pill.
  // Receptionist can rename later in Settings. Examples: "Reception Desk",
  // "Cabin 1 — Dr. Patil", "Pharmacy Counter".
  station_name: '',
  // Default click-to-WhatsApp template. Placeholders are case-insensitive.
  whatsapp_template:
    'Namaste {{patient_name}} 🙏\n\n' +
    'Your appointment at *{{clinic_name}}* is confirmed.\n\n' +
    '👨‍⚕️ *Doctor:* {{doctor_name}}\n' +
    '🚪 *Room:* {{room}}\n' +
    '📅 *Date:* {{date}}    🕒 *Time:* {{time}}\n' +
    '🎟️ *Token:* #{{token}}\n\n' +
    '🆔 *Patient ID (UHID):* {{uhid}}\n' +
    '📋 *Visit ID:* {{visit_id}}\n\n' +
    '📍 {{clinic_address}}\n' +
    '☎️ {{clinic_phone}}\n\n' +
    'Please arrive 10 minutes early. For any change, simply reply to this message or call us.\n\n' +
    'Thank you,\n*{{clinic_name}}*',
};

export function seedIfEmpty(db: Database.Database) {
  // No demo doctors / no demo drugs / no demo patients are ever seeded into a
  // production install. Settings get safe defaults (empty clinic info, sensible
  // workflow flags) but nothing identifies a specific clinic.

  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
  );
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) upsert.run(k, v);

  // Seed common drugs (kept — these are generic OTC + commonly stocked items
  // any clinic in India can edit / remove from Pharmacy → Drug Master).
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

  // Seed clinical quick-fill templates (stored as JSON in settings)
  const ctplRow = db.prepare("SELECT value FROM settings WHERE key='clinical_quick_templates'").get() as { value: string } | undefined;
  if (!ctplRow) {
    const CLINICAL_TEMPLATES = [
      {
        id: 'dm2', name: 'Type 2 Diabetes', category: 'Endocrinology',
        fields: {
          history: 'Known case of Type 2 Diabetes Mellitus. Presenting for routine follow-up.\nCompliance with medications — good/poor. No hypoglycaemic episodes reported.',
          examination: 'Vitals stable. No pallor, icterus, cyanosis, clubbing, lymphadenopathy, oedema. CVS — S1 S2 normal. RS — NVBS. P/A — soft, non-tender.',
          impression: 'Diabetes Mellitus Type 2 (E11) — controlled/uncontrolled',
          advice: 'Diabetic diet — avoid sugar, sweets, white rice, maida. Brisk walking 30 min daily.\nFasting & post-prandial blood sugar monthly. HbA1c every 3 months.\nFoot inspection daily. Ophthalmology review annually.',
        },
        follow_up_days: 30,
      },
      {
        id: 'htn', name: 'Hypertension', category: 'Cardiology',
        fields: {
          history: 'Known hypertensive, on medications. Presenting for follow-up. No headache, giddiness, chest pain, or breathlessness at rest.',
          examination: 'BP: /  mmHg (bilateral arms). Pulse — regular. No pedal oedema. CVS — S1 S2 heard, no murmurs. Fundus — not done today.',
          impression: 'Essential Hypertension (I10) — controlled/uncontrolled',
          advice: 'Low-sodium diet. Restrict pickles, processed foods. Avoid stress. Regular BP monitoring at home.\nComplete medication compliance — do not skip doses.',
        },
        follow_up_days: 30,
      },
      {
        id: 'urti', name: 'Acute URTI', category: 'General Medicine',
        fields: {
          history: 'C/O fever since ___ days, sore throat, runny nose, body ache. No cough, no breathing difficulty. Appetite reduced.',
          examination: 'Throat — congested, tonsils mildly enlarged. Bilateral nasal congestion. Chest clear. P/A — soft. Temperature — °F.',
          impression: 'Acute Viral Upper Respiratory Tract Infection (J06.9)',
          advice: 'Rest. Warm fluids. Steam inhalation twice daily. Saline nasal drops PRN.\nReturn immediately if fever > 5 days, difficulty breathing, or rash appears.',
        },
        follow_up_days: 5,
      },
      {
        id: 'age', name: 'Acute Gastroenteritis', category: 'General Medicine',
        fields: {
          history: 'C/O loose stools ___ times since ___ hours, nausea, vomiting ___ times. No blood in stools. Mild abdominal cramps. Appetite poor.',
          examination: 'Dehydration — mild/moderate. P/A — soft, mild diffuse tenderness, no guarding/rigidity. BS — present.',
          impression: 'Acute Gastroenteritis (K52.9)',
          advice: 'ORS after every loose stool. Small frequent meals — rice, curd, banana, khichdi. Avoid spicy/oily food.\nReturn if unable to tolerate orally, persistent vomiting, or blood in stools.',
        },
        follow_up_days: 3,
      },
      {
        id: 'ped_fever', name: 'Paediatric Fever', category: 'Paediatrics',
        fields: {
          history: 'Child with fever since ___ days. Max recorded — °F. No rash, no fits. Feeding — adequate/reduced. Activity — playful/dull.',
          examination: 'Temperature — °F. Alert & active. No rash. Throat — clear/congested. Chest — clear. P/A — soft. No signs of meningism.',
          impression: 'Fever, likely viral aetiology (R50.9)',
          advice: 'Paracetamol 15 mg/kg/dose 4-6 hourly if temp > 38°C. Sponging with lukewarm water.\nAdequate fluids. Light diet. Return if fits, rash, persistent vomiting, or no improvement in 72h.',
        },
        follow_up_days: 3,
      },
      {
        id: 'hypothyroid', name: 'Hypothyroidism', category: 'Endocrinology',
        fields: {
          history: 'Known case of hypothyroidism on T4 replacement. C/O fatigue, weight gain, cold intolerance.',
          examination: 'No goitre. No pedal oedema. Pulse — bradycardia/normal. Reflexes — delayed/normal.',
          impression: 'Hypothyroidism (E03.9) — on replacement therapy',
          advice: 'Take levothyroxine on empty stomach 30 min before food. Avoid calcium/iron supplements within 4h of dose.\nTSH every 6 months when stable.',
        },
        follow_up_days: 90,
      },
      {
        id: 'asthma', name: 'Bronchial Asthma', category: 'Pulmonology',
        fields: {
          history: 'Known asthmatic. C/O wheeze, breathlessness since ___. Trigger — dust/cold/exercise/infection. Last attack — ___. Using reliever inhaler ___ times/day.',
          examination: 'RR — /min. SpO2 — %. Air entry — bilateral, wheeze present/absent. No use of accessory muscles.',
          impression: 'Bronchial Asthma (J45) — mild/moderate/severe exacerbation / well-controlled',
          advice: 'Avoid triggers — dust, smoke, cold air. Use spacer with MDI. Peak flow monitoring.\nController inhaler must be used daily even when asymptomatic.',
        },
        follow_up_days: 14,
      },
      {
        id: 'osteo', name: 'Osteoarthritis Knee', category: 'Orthopaedics',
        fields: {
          history: 'C/O bilateral/unilateral knee pain since ___ months. Pain on walking, climbing stairs. Morning stiffness < 30 min. No swelling/locking/giving way.',
          examination: 'Joint line tenderness present. Crepitus +++. Range of motion — restricted. McMurray/Lachman — negative. No effusion.',
          impression: 'Osteoarthritis, Knee (M17)',
          advice: 'Quadriceps strengthening exercises. Weight reduction. Avoid squatting, sitting on floor.\nHot fomentation. Knee brace if needed.',
        },
        follow_up_days: 30,
      },
      {
        id: 'lbp', name: 'Low Back Pain', category: 'Orthopaedics',
        fields: {
          history: 'C/O low back pain since ___ days/weeks. Radiates to ___. Aggravated by bending/lifting. No bladder/bowel involvement.',
          examination: 'Lumbar spine — tenderness at L___. SLR — negative/positive at ___°. Muscle spasm present/absent. Neurological — intact.',
          impression: 'Mechanical Low Back Pain (M54.5)',
          advice: 'Bed rest 48h, then gradual mobilisation. Hot pack twice daily. Core strengthening exercises.\nAvoid lifting heavy weights, forward bending.',
        },
        follow_up_days: 7,
      },
      {
        id: 'anxiety', name: 'Anxiety Disorder', category: 'Psychiatry',
        fields: {
          history: 'C/O excessive worry, restlessness, palpitations, sleep disturbance since ___ months. No suicidal ideation. No substance use.',
          examination: 'Alert, oriented. No psychomotor agitation. Affect appropriate. Insight — present.',
          impression: 'Generalised Anxiety Disorder (F41.1)',
          advice: 'Breathing exercises, mindfulness, progressive muscle relaxation. Sleep hygiene.\nLimit caffeine and screen time. Follow up as scheduled.',
        },
        follow_up_days: 14,
      },
    ];
    db.prepare("INSERT INTO settings(key,value) VALUES('clinical_quick_templates', ?)").run(JSON.stringify(CLINICAL_TEMPLATES));
  }
}
