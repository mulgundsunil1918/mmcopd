/**
 * Default PARAMETERS and NORMAL VALUES for the common lab tests, so a clinic only has to type the results.
 *
 * These are the usual adult reference ranges printed by Indian labs (they differ a little between analysers, kits, age and labs — the clinic can edit any of
 * them under Lab → Test Catalogue → Normal values; "Reset to defaults" brings these back). Each line is  [name, unit, range, group?]  and the range is written as
 * in src/lib/labRanges.ts:  "13-17" · "M13-17;F12-15" · "<140" · ">40" · "Negative" · "<100|Optimal < 100".  A line starting with "~" is shown but never flagged.
 *
 * Adding the defaults only ever ADDS: a test that already has parameters of its own is left exactly as the clinic made it.
 */
export type ParamLine = [name: string, unit: string, range: string, group?: string];
export interface DefaultPanel { test: string; aliases?: string[]; category: string; sample?: string; params: ParamLine[] }

const DLC: ParamLine[] = [
  ['Neutrophils', '%', '40-75', 'Differential count'], ['Lymphocytes', '%', '20-45', 'Differential count'], ['Eosinophils', '%', '1-6', 'Differential count'],
  ['Monocytes', '%', '2-10', 'Differential count'], ['Basophils', '%', '0-1', 'Differential count'],
];

export const LAB_PANELS: DefaultPanel[] = [
  { test: 'Complete Blood Count (CBC)', aliases: ['CBC', 'Complete Blood Count', 'Hemogram', 'Haemogram', 'CBC (Complete Blood Count)'], category: 'haematology', sample: 'EDTA Blood', params: [
    ['Haemoglobin (Hb)', 'g/dL', 'M13-17;F12-15'], ['Total RBC count', 'million/µL', 'M4.5-5.5;F3.8-4.8'], ['Packed cell volume (PCV)', '%', 'M40-50;F36-46'],
    ['MCV', 'fL', '83-101'], ['MCH', 'pg', '27-32'], ['MCHC', 'g/dL', '31.5-34.5'], ['RDW-CV', '%', '11.6-14.0'],
    ['Total WBC count (TLC)', '/µL', '4000-11000'], ...DLC, ['Platelet count', '/µL', '150000-410000'],
  ] },
  { test: 'Differential Leucocyte Count (DLC)', aliases: ['DLC', 'Differential Count'], category: 'haematology', sample: 'EDTA Blood', params: DLC.map(([n, u, r]) => [n, u, r] as ParamLine) },
  { test: 'Lipid Profile', aliases: ['Lipid Panel', 'Lipid Profile (Fasting)'], category: 'biochemistry', sample: 'Serum (Fasting)', params: [
    ['Total cholesterol', 'mg/dL', '<200|Desirable < 200'], ['Triglycerides', 'mg/dL', '<150|Normal < 150'], ['HDL cholesterol', 'mg/dL', 'M>40;F>50'],
    ['LDL cholesterol', 'mg/dL', '<100|Optimal < 100'], ['VLDL cholesterol', 'mg/dL', '2-30'], ['Total cholesterol / HDL ratio', '', '<5'], ['Non-HDL cholesterol', 'mg/dL', '<130'],
  ] },
  { test: 'Liver Function Test (LFT)', aliases: ['LFT', 'Liver Function Tests', 'Liver Profile'], category: 'biochemistry', sample: 'Serum', params: [
    ['Total bilirubin', 'mg/dL', '0.2-1.2'], ['Direct bilirubin', 'mg/dL', '0.0-0.3'], ['Indirect bilirubin', 'mg/dL', '0.2-0.9'],
    ['SGOT (AST)', 'U/L', '5-40'], ['SGPT (ALT)', 'U/L', '5-40'], ['Alkaline phosphatase (ALP)', 'U/L', '44-147'], ['GGT', 'U/L', 'M10-71;F6-42'],
    ['Total protein', 'g/dL', '6.0-8.3'], ['Albumin', 'g/dL', '3.5-5.2'], ['Globulin', 'g/dL', '2.0-3.5'], ['A/G ratio', '', '1.0-2.1'],
  ] },
  { test: 'Kidney Function Test (KFT/RFT)', aliases: ['KFT', 'RFT', 'Renal Function Test', 'Kidney Function Test', 'Renal Profile'], category: 'biochemistry', sample: 'Serum', params: [
    ['Blood urea', 'mg/dL', '15-45'], ['Blood urea nitrogen (BUN)', 'mg/dL', '7-21'], ['Serum creatinine', 'mg/dL', 'M0.7-1.3;F0.6-1.1'], ['Uric acid', 'mg/dL', 'M3.5-7.2;F2.6-6.0'],
    ['Sodium (Na)', 'mmol/L', '135-145'], ['Potassium (K)', 'mmol/L', '3.5-5.1'], ['Chloride (Cl)', 'mmol/L', '98-107'], ['Calcium', 'mg/dL', '8.6-10.2'], ['Phosphorus', 'mg/dL', '2.5-4.5'],
  ] },
  { test: 'Serum Electrolytes (Na/K/Cl)', aliases: ['Electrolytes', 'Serum Electrolytes'], category: 'biochemistry', sample: 'Serum', params: [
    ['Sodium (Na)', 'mmol/L', '135-145'], ['Potassium (K)', 'mmol/L', '3.5-5.1'], ['Chloride (Cl)', 'mmol/L', '98-107'],
  ] },
  { test: 'Thyroid Profile (T3 T4 TSH)', aliases: ['Thyroid Profile', 'TFT', 'Thyroid Function Test'], category: 'biochemistry', sample: 'Serum', params: [
    ['Total T3', 'ng/dL', '80-200'], ['Total T4', 'µg/dL', '5.1-14.1'], ['TSH', 'µIU/mL', '0.4-4.0'],
  ] },
  { test: 'Urine Routine & Microscopy', aliases: ['Urine Routine', 'Urine R/E', 'Urine Routine Examination', 'Urine Analysis'], category: 'clinical_pathology', sample: 'Urine', params: [
    ['Colour', '', '~Pale yellow', 'Physical examination'], ['Appearance', '', '~Clear', 'Physical examination'], ['Specific gravity', '', '1.005-1.030', 'Physical examination'], ['pH', '', '4.5-8.0', 'Physical examination'],
    ['Protein (albumin)', '', 'Nil', 'Chemical examination'], ['Glucose (sugar)', '', 'Nil', 'Chemical examination'], ['Ketones', '', 'Nil', 'Chemical examination'], ['Blood', '', 'Nil', 'Chemical examination'],
    ['Bilirubin', '', 'Nil', 'Chemical examination'], ['Urobilinogen', '', 'Normal', 'Chemical examination'], ['Nitrite', '', 'Negative', 'Chemical examination'], ['Leucocyte esterase', '', 'Negative', 'Chemical examination'],
    ['Pus cells', '/HPF', '0-5', 'Microscopy'], ['Red blood cells', '/HPF', '0-2', 'Microscopy'], ['Epithelial cells', '/HPF', '0-5', 'Microscopy'], ['Casts', '', 'Nil', 'Microscopy'], ['Crystals', '', 'Nil', 'Microscopy'], ['Bacteria', '', 'Nil', 'Microscopy'],
  ] },
  { test: 'Stool Routine & Microscopy', aliases: ['Stool Routine', 'Stool R/E', 'Stool Examination'], category: 'clinical_pathology', sample: 'Stool', params: [
    ['Colour', '', '~Brown'], ['Consistency', '', '~Formed'], ['Mucus', '', 'Nil'], ['Blood', '', 'Nil'], ['Pus cells', '/HPF', '0-5'], ['Red blood cells', '/HPF', 'Nil'],
    ['Ova', '', 'Not seen'], ['Cysts', '', 'Not seen'], ['Parasites', '', 'Not seen'],
  ] },
  { test: 'Prothrombin Time / INR', aliases: ['PT/INR', 'PT INR', 'Prothrombin Time'], category: 'haematology', sample: 'Citrate Blood', params: [['Prothrombin time (PT)', 'sec', '11-13.5'], ['INR', '', '0.8-1.2']] },
  { test: 'Widal Test', aliases: ['Widal'], category: 'serology', sample: 'Serum', params: [
    ['S. typhi O', 'titre', '~< 1:80'], ['S. typhi H', 'titre', '~< 1:80'], ['S. paratyphi AH', 'titre', '~< 1:80'], ['S. paratyphi BH', 'titre', '~< 1:80'],
  ] },
  { test: 'Semen Analysis', aliases: ['Semen Examination', 'Seminal Fluid Analysis'], category: 'clinical_pathology', sample: 'Semen', params: [
    ['Volume', 'mL', '>1.5'], ['Liquefaction', '', '~Within 60 minutes'], ['pH', '', '>7.2'], ['Sperm concentration', 'million/mL', '>15'], ['Total sperm number', 'million/ejaculate', '>39'],
    ['Total motility', '%', '>40'], ['Progressive motility', '%', '>32'], ['Normal forms', '%', '>4'], ['Vitality', '%', '>58'], ['Pus cells', 'million/mL', '<1'],
  ] },
  { test: 'Blood Grouping & Rh Typing', aliases: ['Blood Group', 'ABO & Rh'], category: 'haematology', sample: 'EDTA Blood', params: [['ABO group', '', '~—'], ['Rh (D) type', '', '~—']] },

  // ---- one-line tests that still deserve a normal range (the result is flagged H / L automatically) ----
  { test: 'Haemoglobin (Hb)', aliases: ['Hb', 'Hemoglobin'], category: 'haematology', sample: 'EDTA Blood', params: [['Haemoglobin (Hb)', 'g/dL', 'M13-17;F12-15']] },
  { test: 'Total Leucocyte Count (TLC)', aliases: ['TLC', 'WBC Count', 'Total WBC Count'], category: 'haematology', sample: 'EDTA Blood', params: [['Total WBC count (TLC)', '/µL', '4000-11000']] },
  { test: 'Platelet Count', aliases: ['Platelets'], category: 'haematology', sample: 'EDTA Blood', params: [['Platelet count', '/µL', '150000-410000']] },
  { test: 'ESR', aliases: ['Erythrocyte Sedimentation Rate'], category: 'haematology', sample: 'EDTA Blood', params: [['ESR (Westergren)', 'mm/hr', 'M0-15;F0-20']] },
  { test: 'Packed Cell Volume (PCV/Hct)', aliases: ['PCV', 'Haematocrit', 'Hematocrit'], category: 'haematology', sample: 'EDTA Blood', params: [['Packed cell volume (PCV)', '%', 'M40-50;F36-46']] },
  { test: 'aPTT', aliases: ['APTT'], category: 'haematology', sample: 'Citrate Blood', params: [['aPTT', 'sec', '25-35']] },
  { test: 'D-Dimer', aliases: ['D Dimer'], category: 'haematology', sample: 'Citrate Blood', params: [['D-Dimer', 'µg/mL FEU', '<0.5']] },
  { test: 'Fasting Blood Sugar (FBS)', aliases: ['FBS', 'Fasting Blood Glucose', 'Blood Sugar Fasting'], category: 'biochemistry', sample: 'Fluoride Plasma', params: [['Fasting blood sugar', 'mg/dL', '70-100']] },
  { test: 'Post-Prandial Blood Sugar (PPBS)', aliases: ['PPBS', 'Post Prandial Blood Sugar', 'Blood Sugar PP'], category: 'biochemistry', sample: 'Fluoride Plasma', params: [['Post-prandial blood sugar', 'mg/dL', '<140']] },
  { test: 'Random Blood Sugar (RBS)', aliases: ['RBS', 'Random Blood Glucose'], category: 'biochemistry', sample: 'Fluoride Plasma', params: [['Random blood sugar', 'mg/dL', '<140']] },
  { test: 'HbA1c', aliases: ['Glycosylated Haemoglobin', 'Glycated Hemoglobin', 'HbA1C'], category: 'biochemistry', sample: 'EDTA Blood', params: [['HbA1c', '%', '4.0-5.6']] },
  { test: 'Blood Urea', aliases: ['Urea'], category: 'biochemistry', sample: 'Serum', params: [['Blood urea', 'mg/dL', '15-45']] },
  { test: 'Serum Creatinine', aliases: ['Creatinine'], category: 'biochemistry', sample: 'Serum', params: [['Serum creatinine', 'mg/dL', 'M0.7-1.3;F0.6-1.1']] },
  { test: 'Blood Urea Nitrogen (BUN)', aliases: ['BUN'], category: 'biochemistry', sample: 'Serum', params: [['Blood urea nitrogen (BUN)', 'mg/dL', '7-21']] },
  { test: 'Uric Acid', aliases: ['Serum Uric Acid'], category: 'biochemistry', sample: 'Serum', params: [['Uric acid', 'mg/dL', 'M3.5-7.2;F2.6-6.0']] },
  { test: 'Total Bilirubin', aliases: ['Serum Bilirubin'], category: 'biochemistry', sample: 'Serum', params: [['Total bilirubin', 'mg/dL', '0.2-1.2']] },
  { test: 'SGOT / AST', aliases: ['SGOT', 'AST'], category: 'biochemistry', sample: 'Serum', params: [['SGOT (AST)', 'U/L', '5-40']] },
  { test: 'SGPT / ALT', aliases: ['SGPT', 'ALT'], category: 'biochemistry', sample: 'Serum', params: [['SGPT (ALT)', 'U/L', '5-40']] },
  { test: 'Alkaline Phosphatase (ALP)', aliases: ['ALP'], category: 'biochemistry', sample: 'Serum', params: [['Alkaline phosphatase (ALP)', 'U/L', '44-147']] },
  { test: 'GGT', aliases: ['Gamma GT'], category: 'biochemistry', sample: 'Serum', params: [['GGT', 'U/L', 'M10-71;F6-42']] },
  { test: 'Total Protein', aliases: ['Serum Protein'], category: 'biochemistry', sample: 'Serum', params: [['Total protein', 'g/dL', '6.0-8.3']] },
  { test: 'Serum Albumin', aliases: ['Albumin'], category: 'biochemistry', sample: 'Serum', params: [['Albumin', 'g/dL', '3.5-5.2']] },
  { test: 'Serum Amylase', aliases: ['Amylase'], category: 'biochemistry', sample: 'Serum', params: [['Amylase', 'U/L', '30-110']] },
  { test: 'Serum Lipase', aliases: ['Lipase'], category: 'biochemistry', sample: 'Serum', params: [['Lipase', 'U/L', '0-160']] },
  { test: 'Serum Calcium', aliases: ['Calcium'], category: 'biochemistry', sample: 'Serum', params: [['Calcium', 'mg/dL', '8.6-10.2']] },
  { test: 'Serum Phosphorus', aliases: ['Phosphorus'], category: 'biochemistry', sample: 'Serum', params: [['Phosphorus', 'mg/dL', '2.5-4.5']] },
  { test: 'Serum Magnesium', aliases: ['Magnesium'], category: 'biochemistry', sample: 'Serum', params: [['Magnesium', 'mg/dL', '1.7-2.2']] },
  { test: 'LDH', aliases: ['Lactate Dehydrogenase'], category: 'biochemistry', sample: 'Serum', params: [['LDH', 'U/L', '140-280']] },
  { test: 'Serum Iron', aliases: ['Iron'], category: 'biochemistry', sample: 'Serum', params: [['Serum iron', 'µg/dL', 'M65-175;F50-170']] },
  { test: 'TIBC', aliases: ['Total Iron Binding Capacity'], category: 'biochemistry', sample: 'Serum', params: [['TIBC', 'µg/dL', '250-450']] },
  { test: 'Serum Ferritin', aliases: ['Ferritin'], category: 'biochemistry', sample: 'Serum', params: [['Ferritin', 'ng/mL', 'M24-336;F11-307']] },
  { test: 'TSH', aliases: ['Thyroid Stimulating Hormone'], category: 'biochemistry', sample: 'Serum', params: [['TSH', 'µIU/mL', '0.4-4.0']] },
  { test: 'Vitamin D (25-OH)', aliases: ['Vitamin D', '25 OH Vitamin D'], category: 'biochemistry', sample: 'Serum', params: [['Vitamin D (25-OH)', 'ng/mL', '30-100']] },
  { test: 'Vitamin B12', aliases: ['B12'], category: 'biochemistry', sample: 'Serum', params: [['Vitamin B12', 'pg/mL', '211-911']] },
  { test: 'C-Reactive Protein (CRP)', aliases: ['CRP'], category: 'biochemistry', sample: 'Serum', params: [['C-reactive protein (CRP)', 'mg/L', '<6']] },
  { test: 'Procalcitonin', aliases: ['PCT'], category: 'biochemistry', sample: 'Serum', params: [['Procalcitonin', 'ng/mL', '<0.5']] },
  { test: 'PSA (Prostate Specific Antigen)', aliases: ['PSA', 'Total PSA'], category: 'biochemistry', sample: 'Serum', params: [['PSA (total)', 'ng/mL', '<4']] },
  { test: 'Dengue NS1 Antigen', aliases: ['Dengue NS1'], category: 'serology', sample: 'Serum', params: [['Dengue NS1 antigen', '', 'Negative']] },
  { test: 'Malaria Antigen (Rapid)', aliases: ['Malaria Antigen', 'Malaria Rapid Test'], category: 'serology', sample: 'EDTA Blood', params: [['Malaria antigen', '', 'Negative']] },
  { test: 'Typhoid IgM/IgG (Typhidot)', aliases: ['Typhidot'], category: 'serology', sample: 'Serum', params: [['Typhoid IgM', '', 'Negative'], ['Typhoid IgG', '', 'Negative']] },
  { test: 'HIV I & II (Rapid/ELISA)', aliases: ['HIV', 'HIV Test'], category: 'serology', sample: 'Serum', params: [['HIV I & II antibodies', '', 'Non-reactive']] },
  { test: 'HBsAg', aliases: ['Hepatitis B Surface Antigen'], category: 'serology', sample: 'Serum', params: [['HBsAg', '', 'Non-reactive']] },
  { test: 'Anti-HCV', aliases: ['HCV'], category: 'serology', sample: 'Serum', params: [['Anti-HCV antibodies', '', 'Non-reactive']] },
  { test: 'VDRL / RPR', aliases: ['VDRL', 'RPR'], category: 'serology', sample: 'Serum', params: [['VDRL / RPR', '', 'Non-reactive']] },
  { test: 'RA Factor', aliases: ['Rheumatoid Factor', 'RF'], category: 'serology', sample: 'Serum', params: [['Rheumatoid factor', 'IU/mL', '<14']] },
  { test: 'Urine Pregnancy Test (UPT)', aliases: ['UPT', 'Urine Pregnancy Test'], category: 'clinical_pathology', sample: 'Urine', params: [['Urine pregnancy test', '', 'Negative']] },
  { test: 'Stool Occult Blood', aliases: ['Occult Blood'], category: 'clinical_pathology', sample: 'Stool', params: [['Occult blood', '', 'Negative']] },
];
