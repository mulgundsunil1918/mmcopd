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

export interface SlipTemplate {
  id: number;
  name: string;
  /** Free-text hint shown in the picker (e.g. "OBG / Gynaecology"). */
  specialty_hint?: string;
  sections: SlipTemplateSection[];
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

export const DEFAULT_SLIP_TEMPLATES: SlipTemplate[] = [
  { id: 1, name: 'General', specialty_hint: 'General medicine / default', sections: generalSections },
  { id: 2, name: 'OBG', specialty_hint: 'Obstetrics & Gynaecology', sections: obgSections },
  { id: 3, name: 'Pediatrics', specialty_hint: 'Children — feeding, milestones, immunization', sections: pediatricsSections },
  { id: 4, name: 'Cardiology', specialty_hint: 'Heart-focused workflow with NYHA, sounds, ECG', sections: cardiologySections },
  { id: 5, name: 'Orthopedic', specialty_hint: 'Site, ROM, deformities', sections: orthoSections },
];
