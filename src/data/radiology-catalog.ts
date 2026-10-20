/**
 * Standard radiology & imaging catalogue — loaded into the Radiology department the
 * first time it is opened (the clinic then sets its own prices; the list ships unpriced
 * on purpose, rates are each clinic's own).
 *
 * Radiology used to be a category inside the Laboratory catalogue. It is now its own
 * department with its own orders, bills and reports (see main/radiology.ts).
 */

export const RADIOLOGY_MODALITIES = [
  'xray', 'contrast', 'usg', 'doppler', 'ct', 'mri', 'mammography', 'dexa', 'cardiac', 'other',
] as const;
export type RadiologyModality = typeof RADIOLOGY_MODALITIES[number];

export const MODALITY_LABEL: Record<RadiologyModality, string> = {
  xray: 'X-Ray',
  contrast: 'Contrast studies',
  usg: 'Ultrasound (USG)',
  doppler: 'Doppler',
  ct: 'CT',
  mri: 'MRI',
  mammography: 'Mammography',
  dexa: 'DEXA',
  cardiac: 'ECG / Echo / TMT',
  other: 'Other',
};

/** Best-effort modality from a test's name, so imported / typed tests group sensibly. */
export function modalityOf(name: string): RadiologyModality {
  const n = (name || '').toLowerCase();
  if (/doppler/.test(n)) return 'doppler';
  if (/^x-?ray\b/.test(n)) return 'xray';
  if (/barium|pyelogram|\bivp\b|enema|hsg|sialogram/.test(n)) return 'contrast';
  if (/\busg\b|sonograph|\btvs\b|ultrasound/.test(n)) return 'usg';
  if (/^(hr)?ct\b|\bct\b/.test(n)) return 'ct';
  if (/^mri\b|\bmri\b|mrcp/.test(n)) return 'mri';
  if (/mammo/.test(n)) return 'mammography';
  if (/dexa|densitometry|\bbmd\b/.test(n)) return 'dexa';
  if (/\becg\b|echocardio|\becho\b|treadmill|\btmt\b/.test(n)) return 'cardiac';
  return 'other';
}

export interface RadiologyCatalogEntry { name: string; modality: RadiologyModality }

const NAMES: string[] = [
  'X-Ray Chest PA View',
  'X-Ray Chest AP/Lateral',
  'X-Ray PNS (Water’s View)',
  'X-Ray Skull AP/Lateral',
  'X-Ray Cervical Spine',
  'X-Ray Dorsal Spine',
  'X-Ray Lumbosacral Spine',
  'X-Ray Pelvis with Both Hips',
  'X-Ray Abdomen Erect (KUB)',
  'X-Ray Shoulder Joint',
  'X-Ray Elbow Joint',
  'X-Ray Wrist Joint',
  'X-Ray Hand',
  'X-Ray Knee Joint',
  'X-Ray Ankle Joint',
  'X-Ray Foot',
  'X-Ray Mastoid',
  'Barium Swallow',
  'Barium Meal Follow Through',
  'Barium Enema',
  'Intravenous Pyelogram (IVP)',
  'USG Whole Abdomen',
  'USG Abdomen & Pelvis',
  'USG KUB',
  'USG Pelvis',
  'USG Obstetric (Dating/Early)',
  'USG Anomaly Scan (Level II)',
  'USG Obstetric Growth Scan',
  'Transvaginal Sonography (TVS)',
  'USG Breast',
  'USG Thyroid / Neck',
  'USG Scrotum',
  'Colour Doppler Lower Limb',
  'Colour Doppler Carotid',
  'USG-Guided FNAC',
  'CT Brain (Plain)',
  'CT Brain (Contrast)',
  'CT Chest',
  'HRCT Chest',
  'CT Abdomen & Pelvis',
  'CT KUB (Plain)',
  'CT PNS',
  'CT Angiography',
  'MRI Brain',
  'MRI Cervical Spine',
  'MRI Lumbar Spine',
  'MRI Knee Joint',
  'MRI Whole Abdomen',
  'MRCP',
  'Mammography (Both Breasts)',
  'DEXA Bone Densitometry',
  'ECG',
  '2D Echocardiography',
  'Treadmill Test (TMT)',
  'Pulmonary Function Test (PFT)',
];

export const RADIOLOGY_CATALOG: RadiologyCatalogEntry[] = NAMES.map((name) => ({ name, modality: modalityOf(name) }));

/** Prices carried over when a clinic had already priced one of these in the old lab catalogue. */
export const RADIOLOGY_KNOWN_PRICES: Record<string, number> = {
  'x-ray chest pa view': 250,
};
