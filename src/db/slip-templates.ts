/**
 * Default OPD-slip body templates seeded on first install. Each template is a
 * named, ordered list of sections. The "well-known" keys (history, examination,
 * impression, advice) map to the existing consultations.* columns; everything
 * else lives in consultations.extra_fields_json.
 *
 * Users edit / add / remove templates through Settings → OPD Slip Templates.
 * The doctor's template_id picks which one renders on their consultation panel
 * and printed slip. Header / vitals / signature / follow-up box are unchanged.
 */

export type SlipSectionType = 'textarea' | 'singleline' | 'date' | 'number' | 'dropdown';

export interface SlipTemplateSection {
  /** Stable key used to read/write the value. Reserved keys: history, examination, impression, advice. */
  key: string;
  title: string;
  type: SlipSectionType;
  /** Vertical print height in mm (textarea/singleline). Ignored for date/number/dropdown. */
  height_mm?: number;
  placeholder?: string;
  /** Comma-separated options for dropdown type. */
  options?: string[];
  /** False = input-only, not rendered on the printed slip. Default true. */
  printed?: boolean;
}

export interface SlipLayout {
  pages: 1 | 2;
  logoSize: 'none' | 'small' | 'medium' | 'large';
  headerStyle: 'full' | 'compact';
  fontSize: number;
  showVitals: boolean;
  showRxTable: boolean;
  showSignature: boolean;
  showQrCodes: boolean;
  showFollowupBox: boolean;
  /** Section keys the user has pinned to page 1 (overrides auto-split when set). */
  page1Keys: string[];
  /** Section keys the user has pinned to page 2. */
  page2Keys: string[];
}

export const DEFAULT_LAYOUT: SlipLayout = {
  pages: 2,
  logoSize: 'large',
  headerStyle: 'full',
  fontSize: 13,
  showVitals: true,
  showRxTable: true,
  showSignature: true,
  showQrCodes: true,
  showFollowupBox: true,
  page1Keys: [],
  page2Keys: [],
};

export interface SlipTemplate {
  id: number;
  name: string;
  /** Free-text hint shown in the picker (e.g. "OBG / Gynaecology"). */
  specialty_hint?: string;
  sections: SlipTemplateSection[];
  layout?: SlipLayout;
}

const generalSections: SlipTemplateSection[] = [
  { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 55, printed: true },
  { key: 'examination', title: 'Examination', type: 'textarea', height_mm: 60, printed: true },
  { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 22, printed: true },
  { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 60, printed: true },
];

const obgSections: SlipTemplateSection[] = [
  { key: 'lmp', title: 'LMP (Last Menstrual Period)', type: 'date', printed: true },
  { key: 'edd', title: 'EDD (Expected Date of Delivery)', type: 'date', printed: true },
  { key: 'parity', title: 'G / P / A / L', type: 'singleline', height_mm: 8, placeholder: 'e.g. G2 P1 A0 L1', printed: true },
  { key: 'gestational_age', title: 'Gestational Age', type: 'singleline', height_mm: 8, placeholder: 'e.g. 28 wks 3 days', printed: true },
  { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 40, printed: true },
  { key: 'examination', title: 'P/A & P/V Examination', type: 'textarea', height_mm: 40, printed: true },
  { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 22, printed: true },
  { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 50, printed: true },
];

const pediatricsSections: SlipTemplateSection[] = [
  { key: 'feeding', title: 'Feeding History', type: 'textarea', height_mm: 18, printed: true },
  { key: 'milestones', title: 'Developmental Milestones', type: 'textarea', height_mm: 18, printed: true },
  { key: 'immunization', title: 'Immunization Status', type: 'singleline', height_mm: 8, placeholder: 'e.g. Up to date / Partial / Pending DPT-3', printed: true },
  { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 40, printed: true },
  { key: 'examination', title: 'Examination', type: 'textarea', height_mm: 40, printed: true },
  { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 22, printed: true },
  { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 50, printed: true },
];

const cardiologySections: SlipTemplateSection[] = [
  { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 35, printed: true },
  { key: 'exertional', title: 'Exertional Capacity / NYHA Class', type: 'singleline', height_mm: 8, placeholder: 'e.g. NYHA II — breathless on climbing 1 flight', printed: true },
  { key: 'heart_sounds', title: 'Heart Sounds / Murmurs', type: 'textarea', height_mm: 22, placeholder: 'S1 S2 normal · No added sounds · No murmur', printed: true },
  { key: 'ecg_findings', title: 'ECG / Echo Findings', type: 'textarea', height_mm: 22, printed: true },
  { key: 'examination', title: 'Other Examination', type: 'textarea', height_mm: 22, printed: true },
  { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 22, printed: true },
  { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 45, printed: true },
];

const orthoSections: SlipTemplateSection[] = [
  { key: 'site', title: 'Site / Side', type: 'singleline', height_mm: 8, placeholder: 'e.g. Right knee · Left shoulder', printed: true },
  { key: 'mechanism', title: 'Mechanism of Injury', type: 'textarea', height_mm: 18, placeholder: 'How did the injury happen?', printed: true },
  { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 30, printed: true },
  { key: 'rom', title: 'Range of Motion (ROM)', type: 'textarea', height_mm: 18, placeholder: 'Flexion / Extension / Abduction / Rotation', printed: true },
  { key: 'deformities', title: 'Deformities / Tenderness', type: 'textarea', height_mm: 18, printed: true },
  { key: 'examination', title: 'Other Examination', type: 'textarea', height_mm: 22, printed: true },
  { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 22, printed: true },
  { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 40, printed: true },
];

const entSections: SlipTemplateSection[] = [
  { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 35, placeholder: 'Onset, duration, side, associated symptoms', printed: true },
  { key: 'otoscopy_right', title: 'Otoscopy — Right Ear', type: 'textarea', height_mm: 18, placeholder: 'EAC · TM appearance · Cone of light · Discharge', printed: true },
  { key: 'otoscopy_left', title: 'Otoscopy — Left Ear', type: 'textarea', height_mm: 18, placeholder: 'EAC · TM appearance · Cone of light · Discharge', printed: true },
  { key: 'hearing', title: 'Hearing Assessment', type: 'singleline', height_mm: 8, placeholder: 'e.g. Whisper test passed · Audiometry pending', printed: true },
  { key: 'tuning_fork', title: 'Tuning Fork Tests', type: 'textarea', height_mm: 14, placeholder: 'Rinne · Weber · ABC', printed: true },
  { key: 'nasal', title: 'Nasal Examination', type: 'textarea', height_mm: 18, placeholder: 'Septum · Turbinates · Discharge · Polyps', printed: true },
  { key: 'throat', title: 'Throat / Pharynx Examination', type: 'textarea', height_mm: 18, placeholder: 'Tonsils · Posterior pharyngeal wall · Uvula', printed: true },
  { key: 'examination', title: 'Other Examination', type: 'textarea', height_mm: 18, printed: true },
  { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 22, printed: true },
  { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 40, printed: true },
];

const generalMedicineSections: SlipTemplateSection[] = [
  { key: 'history', title: 'Chief Complaints', type: 'textarea', height_mm: 35, placeholder: 'Presenting complaints with onset, duration, progression', printed: true },
  { key: 'past_history', title: 'Past History', type: 'textarea', height_mm: 18, placeholder: 'DM · HTN · TB · IHD · Surgeries · Allergies', printed: true },
  { key: 'personal_history', title: 'Personal History', type: 'textarea', height_mm: 18, placeholder: 'Diet · Sleep · Bowel · Bladder · Addictions (smoking / alcohol / tobacco)', printed: true },
  { key: 'family_history', title: 'Family History', type: 'textarea', height_mm: 14, placeholder: 'Heritable / chronic illnesses in immediate family', printed: true },
  { key: 'general_exam', title: 'General Examination', type: 'textarea', height_mm: 22, placeholder: 'Pallor · Icterus · Cyanosis · Clubbing · Lymphadenopathy · Edema', printed: true },
  { key: 'examination', title: 'Systemic Examination (CVS · RS · P/A · CNS)', type: 'textarea', height_mm: 35, printed: true },
  { key: 'impression', title: 'Provisional Diagnosis', type: 'textarea', height_mm: 22, printed: true },
  { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 50, printed: true },
];

const dermaSections: SlipTemplateSection[] = [
  { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 30, placeholder: 'Onset, duration, site, spread, associated symptoms, aggravating / relieving factors', printed: true },
  { key: 'lesion_description', title: 'Lesion Description', type: 'textarea', height_mm: 22, placeholder: 'Type · Size · Shape · Border · Colour · Surface · Consistency', printed: true },
  { key: 'distribution', title: 'Distribution / Site', type: 'singleline', height_mm: 8, placeholder: 'e.g. Bilateral extensor surface of forearms', printed: true },
  { key: 'examination', title: 'General & Systemic Examination', type: 'textarea', height_mm: 22, printed: true },
  { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 22, printed: true },
  { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 50, printed: true },
];

const ophthoSections: SlipTemplateSection[] = [
  { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 30, placeholder: 'Visual disturbance, pain, redness, discharge — onset and duration', printed: true },
  { key: 'vision_re', title: 'Vision — Right Eye (RE)', type: 'singleline', height_mm: 8, placeholder: 'e.g. 6/6 unaided · 6/12 with PH', printed: true },
  { key: 'vision_le', title: 'Vision — Left Eye (LE)', type: 'singleline', height_mm: 8, placeholder: 'e.g. 6/6 unaided · 6/18 with PH', printed: true },
  { key: 'iop', title: 'IOP (Intraocular Pressure)', type: 'singleline', height_mm: 8, placeholder: 'RE: __mmHg  LE: __mmHg', printed: true },
  { key: 'slit_lamp', title: 'Slit-lamp Examination', type: 'textarea', height_mm: 22, placeholder: 'Cornea · Anterior chamber · Lens · Vitreous', printed: true },
  { key: 'fundus', title: 'Fundus Examination', type: 'textarea', height_mm: 22, placeholder: 'Disc · Vessels · Macula · Periphery', printed: true },
  { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 18, printed: true },
  { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 45, printed: true },
];

const neuroSections: SlipTemplateSection[] = [
  { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 35, placeholder: 'Headache, weakness, numbness, seizures, speech, memory — onset & progression', printed: true },
  { key: 'cranial_nerves', title: 'Cranial Nerve Examination', type: 'textarea', height_mm: 22, placeholder: 'CN II–XII assessment', printed: true },
  { key: 'motor', title: 'Motor System', type: 'textarea', height_mm: 18, placeholder: 'Tone · Power (MRC grade) · Reflexes · Coordination', printed: true },
  { key: 'sensory', title: 'Sensory System', type: 'textarea', height_mm: 18, placeholder: 'Pain · Touch · Vibration · Proprioception', printed: true },
  { key: 'examination', title: 'Other Examination', type: 'textarea', height_mm: 18, printed: true },
  { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 22, printed: true },
  { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 45, printed: true },
];

const psychiatrySections: SlipTemplateSection[] = [
  { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 30, placeholder: 'Presenting problem, onset, duration, precipitating factors', printed: true },
  { key: 'mse_appearance', title: 'Mental Status — Appearance & Behaviour', type: 'textarea', height_mm: 18, placeholder: 'Grooming · Eye contact · Psychomotor activity', printed: true },
  { key: 'mse_speech_mood', title: 'Mental Status — Speech & Mood', type: 'textarea', height_mm: 18, placeholder: 'Rate · Volume · Mood (subjective) · Affect', printed: true },
  { key: 'mse_thought', title: 'Mental Status — Thought & Perception', type: 'textarea', height_mm: 18, placeholder: 'Form · Content · Hallucinations · Delusions', printed: true },
  { key: 'sleep_appetite', title: 'Sleep / Appetite', type: 'singleline', height_mm: 8, placeholder: 'Sleep: __hrs · Appetite: Good/Poor', printed: true },
  { key: 'impression', title: 'Impression / Diagnosis (ICD-10)', type: 'textarea', height_mm: 22, printed: true },
  { key: 'advice', title: 'Plan / Prescription', type: 'textarea', height_mm: 45, printed: true },
];

const dentalSections: SlipTemplateSection[] = [
  { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 25, placeholder: 'Pain, sensitivity, swelling — onset, character, severity', printed: true },
  { key: 'tooth_no', title: 'Tooth / Site', type: 'singleline', height_mm: 8, placeholder: 'e.g. 36 (lower left 1st molar)', printed: true },
  { key: 'clinical_findings', title: 'Clinical Findings', type: 'textarea', height_mm: 22, placeholder: 'Caries · Mobility · Percussion · Gingival status', printed: true },
  { key: 'xray_findings', title: 'X-ray / Radiograph Findings', type: 'textarea', height_mm: 18, placeholder: 'Periapical / OPG / CBCT findings', printed: true },
  { key: 'procedure', title: 'Procedure Done / Planned', type: 'textarea', height_mm: 22, placeholder: 'Scaling · Extraction · RCT · Crown · Filling', printed: true },
  { key: 'impression', title: 'Diagnosis', type: 'textarea', height_mm: 18, printed: true },
  { key: 'advice', title: 'Advice & Post-procedure Instructions', type: 'textarea', height_mm: 40, printed: true },
];

const gastroSections: SlipTemplateSection[] = [
  { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 35, placeholder: 'Pain, nausea, vomiting, diarrhoea, constipation, bleeding — onset & progression', printed: true },
  { key: 'abdominal_exam', title: 'Abdominal Examination', type: 'textarea', height_mm: 25, placeholder: 'Inspection · Palpation (tender quadrant, guarding, rigidity) · Percussion · Auscultation', printed: true },
  { key: 'endoscopy', title: 'Endoscopy / Colonoscopy Findings', type: 'textarea', height_mm: 18, placeholder: 'Findings and biopsy notes', printed: true },
  { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 22, printed: true },
  { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 50, printed: true },
];

const pulmoSections: SlipTemplateSection[] = [
  { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 30, placeholder: 'Cough, breathlessness, wheeze, haemoptysis — onset, triggers, severity', printed: true },
  { key: 'spo2_trend', title: 'SpO₂ / Peak Flow / 6MWT', type: 'singleline', height_mm: 8, placeholder: 'SpO₂ at rest: __% · Exertion: __% · PEFR: __L/min', printed: true },
  { key: 'spirometry', title: 'Spirometry / PFT', type: 'textarea', height_mm: 18, placeholder: 'FEV1: __ · FVC: __ · FEV1/FVC: __ · Pattern: Obstructive/Restrictive/Mixed', printed: true },
  { key: 'examination', title: 'Examination', type: 'textarea', height_mm: 25, placeholder: 'Air entry · Wheeze · Crepitations · Added sounds', printed: true },
  { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 22, printed: true },
  { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 45, printed: true },
];

const urologySections: SlipTemplateSection[] = [
  { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 30, placeholder: 'Dysuria, frequency, haematuria, stone symptoms, retention — onset & duration', printed: true },
  { key: 'urine_exam', title: 'Urine Examination / Culture', type: 'singleline', height_mm: 8, placeholder: 'Report summary or pending', printed: true },
  { key: 'usg_findings', title: 'USG / KUB Findings', type: 'textarea', height_mm: 22, placeholder: 'Kidney · Ureter · Bladder — size, calculi, hydronephrosis', printed: true },
  { key: 'psa', title: 'PSA (if applicable)', type: 'singleline', height_mm: 8, placeholder: 'Total PSA: __ ng/mL  Date: __', printed: true },
  { key: 'examination', title: 'Examination', type: 'textarea', height_mm: 22, printed: true },
  { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 22, printed: true },
  { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 45, printed: true },
];

const surgerySections: SlipTemplateSection[] = [
  { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 30, printed: true },
  { key: 'examination', title: 'Examination / Local Finding', type: 'textarea', height_mm: 25, placeholder: 'Local: site, size, swelling, tenderness · Systemic: CVS, RS, P/A', printed: true },
  { key: 'investigation', title: 'Investigations', type: 'textarea', height_mm: 18, placeholder: 'Blood workup · USG / CT / X-ray findings', printed: true },
  { key: 'procedure_plan', title: 'Procedure / Operation Planned', type: 'singleline', height_mm: 8, placeholder: 'e.g. Laparoscopic cholecystectomy · Hernia repair', printed: true },
  { key: 'post_op_notes', title: 'Post-operative Notes', type: 'textarea', height_mm: 22, placeholder: 'Wound status · Drains · Diet · Activity restrictions', printed: true },
  { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 18, printed: true },
  { key: 'advice', title: 'Advice / Discharge Instructions', type: 'textarea', height_mm: 40, printed: true },
];

export const DEFAULT_SLIP_TEMPLATES: SlipTemplate[] = [
  { id: 1,  name: 'General',          specialty_hint: 'Default short layout', sections: generalSections },
  { id: 2,  name: 'General Medicine', specialty_hint: 'Full medicine workup — past / personal / family / systemic exam', sections: generalMedicineSections },
  { id: 3,  name: 'OBG',              specialty_hint: 'Obstetrics & Gynaecology', sections: obgSections },
  { id: 4,  name: 'Pediatrics',       specialty_hint: 'Children — feeding, milestones, immunization', sections: pediatricsSections },
  { id: 5,  name: 'Cardiology',       specialty_hint: 'Heart-focused workflow with NYHA, sounds, ECG', sections: cardiologySections },
  { id: 6,  name: 'Orthopedic',       specialty_hint: 'Site, ROM, deformities', sections: orthoSections },
  { id: 7,  name: 'ENT',              specialty_hint: 'Ear · Nose · Throat — otoscopy, tuning fork, nasal, throat', sections: entSections },
  { id: 8,  name: 'Dermatology',      specialty_hint: 'Skin — lesion description, distribution', sections: dermaSections },
  { id: 9,  name: 'Ophthalmology',    specialty_hint: 'Eye — vision, IOP, slit-lamp, fundus', sections: ophthoSections },
  { id: 10, name: 'Neurology',        specialty_hint: 'Cranial nerves, motor, sensory', sections: neuroSections },
  { id: 11, name: 'Psychiatry',       specialty_hint: 'MSE — appearance, mood, thought, perception', sections: psychiatrySections },
  { id: 12, name: 'Dentistry',        specialty_hint: 'Tooth #, procedure, radiograph — Vitals & Rx off by default', sections: dentalSections, layout: { ...DEFAULT_LAYOUT, showVitals: false, showRxTable: false } },
  { id: 13, name: 'Gastroenterology', specialty_hint: 'Abdomen, endoscopy, colonoscopy', sections: gastroSections },
  { id: 14, name: 'Pulmonology',      specialty_hint: 'SpO₂, PFT, spirometry', sections: pulmoSections },
  { id: 15, name: 'Urology',          specialty_hint: 'KUB, USG, PSA', sections: urologySections },
  { id: 16, name: 'General Surgery',  specialty_hint: 'Pre-op / post-op — procedure, wound status', sections: surgerySections },
];
