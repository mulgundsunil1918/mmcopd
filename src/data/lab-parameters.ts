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
  // ---- more of what a clinic laboratory runs: electrolytes and lipids as single tests, cardiac, diabetes, hormones, tumour markers, immunology, cultures, serology, fluids ----
  // (typical adult ranges; "~" = shown, never flagged; a normal WORD such as Negative flags anything else as Abnormal. Every lab edits them for its own analyser and kit.)
  { test: 'Reticulocyte Count', aliases: ['Retic Count', 'Retic'], category: 'haematology', sample: 'EDTA Blood', params: [['Reticulocytes', '%', '0.5-2.5']] },
  { test: 'Absolute Eosinophil Count (AEC)', aliases: ['AEC', 'Absolute Eosinophil Count'], category: 'haematology', sample: 'EDTA Blood', params: [['Absolute eosinophil count', '/µL', '40-440']] },
  { test: 'Peripheral Blood Smear', aliases: ['PBS', 'Peripheral Smear', 'Blood Smear'], category: 'haematology', sample: 'EDTA Blood', params: [['RBC morphology', '', '~Normocytic normochromic'], ['WBC morphology', '', '~Normal'], ['Platelets on smear', '', '~Adequate'], ['Parasites', '', 'Not seen'], ['Impression', '', '~—']] },
  { test: 'Malaria Parasite (Smear)', aliases: ['MP', 'MP Smear', 'Malaria Parasite', 'Malarial Parasite'], category: 'haematology', sample: 'EDTA Blood', params: [['Malaria parasite', '', 'Not seen']] },
  { test: 'Bleeding Time (BT)', aliases: ['BT', 'Bleeding Time'], category: 'haematology', sample: 'Fingertip', params: [['Bleeding time', 'min', '1-6']] },
  { test: 'Clotting Time (CT)', aliases: ['CT', 'Clotting Time'], category: 'haematology', sample: 'Whole Blood', params: [['Clotting time', 'min', '4-10']] },
  { test: 'Fibrinogen', aliases: ['Plasma Fibrinogen'], category: 'haematology', sample: 'Citrate Plasma', params: [['Fibrinogen', 'mg/dL', '200-400']] },
  { test: 'Direct Coombs Test (DCT)', aliases: ['DCT', 'Direct Coombs'], category: 'haematology', sample: 'EDTA Blood', params: [['Direct Coombs test', '', 'Negative']] },
  { test: 'Indirect Coombs Test (ICT)', aliases: ['ICT', 'Indirect Coombs'], category: 'haematology', sample: 'Serum', params: [['Indirect Coombs test', '', 'Negative']] },
  { test: 'G6PD (Quantitative)', aliases: ['G6PD', 'G6PD Assay'], category: 'haematology', sample: 'EDTA Blood', params: [['G6PD', 'U/g Hb', '7-20.5']] },
  { test: 'Sickling Test', aliases: ['Sickle Cell Test', 'Sickling'], category: 'haematology', sample: 'EDTA Blood', params: [['Sickling test', '', 'Negative']] },
  { test: 'Haemoglobin Electrophoresis (HPLC)', aliases: ['Hb Electrophoresis', 'HPLC', 'Hb HPLC'], category: 'haematology', sample: 'EDTA Blood', params: [['HbA', '%', '95-98'], ['HbA2', '%', '1.5-3.5'], ['HbF', '%', '<2'], ['Abnormal haemoglobin (HbS / HbD / HbC)', '', 'Absent']] },

  { test: 'Serum Sodium', aliases: ['Sodium', 'Na', 'S. Sodium', 'Serum Na'], category: 'biochemistry', sample: 'Serum', params: [['Sodium (Na)', 'mmol/L', '135-145']] },
  { test: 'Serum Potassium', aliases: ['Potassium', 'K', 'S. Potassium', 'Serum K'], category: 'biochemistry', sample: 'Serum', params: [['Potassium (K)', 'mmol/L', '3.5-5.1']] },
  { test: 'Serum Chloride', aliases: ['Chloride', 'Cl', 'S. Chloride'], category: 'biochemistry', sample: 'Serum', params: [['Chloride (Cl)', 'mmol/L', '98-107']] },
  { test: 'Serum Bicarbonate', aliases: ['Bicarbonate', 'HCO3', 'Serum HCO3'], category: 'biochemistry', sample: 'Serum', params: [['Bicarbonate (HCO3)', 'mmol/L', '22-29']] },
  { test: 'Ionised Calcium', aliases: ['Ionized Calcium', 'iCa'], category: 'biochemistry', sample: 'Heparin Whole Blood', params: [['Ionised calcium', 'mmol/L', '1.12-1.32']] },
  { test: 'Total Cholesterol', aliases: ['Cholesterol', 'S. Cholesterol', 'Serum Cholesterol'], category: 'biochemistry', sample: 'Serum', params: [['Total cholesterol', 'mg/dL', '<200|Desirable < 200']] },
  { test: 'Triglycerides', aliases: ['TG', 'Serum Triglycerides', 'S. Triglycerides'], category: 'biochemistry', sample: 'Serum', params: [['Triglycerides', 'mg/dL', '<150|Normal < 150']] },
  { test: 'HDL Cholesterol', aliases: ['HDL', 'HDL-C'], category: 'biochemistry', sample: 'Serum', params: [['HDL cholesterol', 'mg/dL', 'M>40;F>50']] },
  { test: 'LDL Cholesterol', aliases: ['LDL', 'LDL-C'], category: 'biochemistry', sample: 'Serum', params: [['LDL cholesterol', 'mg/dL', '<100|Optimal < 100']] },
  { test: 'Direct Bilirubin', aliases: ['Conjugated Bilirubin', 'D. Bilirubin'], category: 'biochemistry', sample: 'Serum', params: [['Direct bilirubin', 'mg/dL', '0.0-0.3']] },
  { test: 'Serum Protein, Albumin, Globulin (A/G Ratio)', aliases: ['Protein Profile', 'A/G Ratio', 'Total Protein Albumin Globulin'], category: 'biochemistry', sample: 'Serum', params: [['Total protein', 'g/dL', '6.0-8.3'], ['Albumin', 'g/dL', '3.5-5.2'], ['Globulin', 'g/dL', '2.0-3.5'], ['A/G ratio', '', '1.0-2.1']] },
  { test: 'Iron Studies', aliases: ['Iron Profile', 'Anaemia Profile', 'Iron, TIBC, Ferritin'], category: 'biochemistry', sample: 'Serum', params: [['Serum iron', 'µg/dL', 'M65-175;F50-170'], ['TIBC', 'µg/dL', '250-450'], ['Transferrin saturation', '%', '20-50'], ['Ferritin', 'ng/mL', 'M24-336;F11-307']] },
  { test: 'eGFR', aliases: ['Estimated GFR', 'GFR'], category: 'biochemistry', sample: 'Serum', params: [['eGFR', 'mL/min/1.73 m²', '>90']] },
  { test: 'Serum Lactate', aliases: ['Lactate', 'Lactic Acid'], category: 'biochemistry', sample: 'Fluoride Plasma', params: [['Lactate', 'mmol/L', '0.5-2.2']] },
  { test: 'Serum Ammonia', aliases: ['Ammonia', 'Blood Ammonia'], category: 'biochemistry', sample: 'EDTA Plasma (on ice)', params: [['Ammonia', 'µg/dL', '15-45']] },
  { test: 'Serum Osmolality', aliases: ['Osmolality'], category: 'biochemistry', sample: 'Serum', params: [['Osmolality', 'mOsm/kg', '275-295']] },
  { test: 'Arterial Blood Gas (ABG)', aliases: ['ABG', 'Blood Gas', 'Blood Gas Analysis'], category: 'biochemistry', sample: 'Arterial Blood (heparin)', params: [['pH', '', '7.35-7.45'], ['pCO2', 'mmHg', '35-45'], ['pO2', 'mmHg', '80-100'], ['HCO3', 'mmol/L', '22-26'], ['Base excess', 'mmol/L', '-2-2'], ['SaO2', '%', '95-100']] },

  { test: 'CPK (Total)', aliases: ['CPK', 'CK', 'Creatine Kinase', 'CK Total'], category: 'biochemistry', sample: 'Serum', params: [['CPK (total)', 'U/L', 'M39-308;F26-192']] },
  { test: 'CK-MB', aliases: ['CKMB', 'CPK-MB'], category: 'biochemistry', sample: 'Serum', params: [['CK-MB', 'U/L', '<25']] },
  { test: 'Troponin I', aliases: ['Trop I', 'TnI', 'Cardiac Troponin I'], category: 'biochemistry', sample: 'Serum', params: [['Troponin I', 'ng/mL', '<0.04']] },
  { test: 'Troponin T (Rapid)', aliases: ['Trop T', 'Troponin T'], category: 'biochemistry', sample: 'Whole Blood', params: [['Troponin T (qualitative)', '', 'Negative']] },
  { test: 'NT-proBNP', aliases: ['proBNP', 'BNP', 'NT pro BNP'], category: 'biochemistry', sample: 'Serum', params: [['NT-proBNP', 'pg/mL', '<125']] },
  { test: 'hs-CRP', aliases: ['High Sensitivity CRP', 'hsCRP'], category: 'biochemistry', sample: 'Serum', params: [['hs-CRP', 'mg/L', '<3']] },
  { test: 'Lipoprotein (a)', aliases: ['Lp(a)', 'Lipoprotein a'], category: 'biochemistry', sample: 'Serum', params: [['Lipoprotein (a)', 'mg/dL', '<30']] },
  { test: 'Homocysteine', aliases: ['Serum Homocysteine'], category: 'biochemistry', sample: 'Serum', params: [['Homocysteine', 'µmol/L', '5-15']] },

  { test: 'Oral Glucose Tolerance Test (OGTT 75 g)', aliases: ['OGTT', 'GTT', 'Glucose Tolerance Test', 'OGTT 75g'], category: 'biochemistry', sample: 'Fluoride Plasma', params: [['Fasting glucose', 'mg/dL', '70-100'], ['1 hour glucose', 'mg/dL', '<180'], ['2 hour glucose', 'mg/dL', '<140']] },
  { test: 'Glucose Challenge Test (GCT 50 g)', aliases: ['GCT', 'GCT 50g', '50 g Glucose Challenge'], category: 'biochemistry', sample: 'Fluoride Plasma', params: [['1 hour glucose (50 g load)', 'mg/dL', '<140']] },
  { test: 'Fasting Insulin', aliases: ['Insulin Fasting', 'Insulin', 'Serum Insulin'], category: 'biochemistry', sample: 'Serum', params: [['Insulin (fasting)', 'µIU/mL', '2.6-24.9']] },
  { test: 'C-Peptide', aliases: ['C Peptide'], category: 'biochemistry', sample: 'Serum', params: [['C-peptide', 'ng/mL', '0.8-3.5']] },
  { test: 'Fructosamine', aliases: ['Glycated Albumin'], category: 'biochemistry', sample: 'Serum', params: [['Fructosamine', 'µmol/L', '200-285']] },

  { test: 'Cortisol (Morning)', aliases: ['Cortisol', 'Serum Cortisol', 'Cortisol 8 AM'], category: 'biochemistry', sample: 'Serum', params: [['Cortisol (morning)', 'µg/dL', '6.2-19.4']] },
  { test: 'Free T3 (FT3)', aliases: ['FT3', 'Free T3'], category: 'biochemistry', sample: 'Serum', params: [['Free T3', 'pg/mL', '2.0-4.4']] },
  { test: 'Free T4 (FT4)', aliases: ['FT4', 'Free T4'], category: 'biochemistry', sample: 'Serum', params: [['Free T4', 'ng/dL', '0.8-1.8']] },
  { test: 'Thyroid Profile — Free (FT3 FT4 TSH)', aliases: ['Free Thyroid Profile', 'FT3 FT4 TSH', 'Thyroid Profile Free'], category: 'biochemistry', sample: 'Serum', params: [['Free T3', 'pg/mL', '2.0-4.4'], ['Free T4', 'ng/dL', '0.8-1.8'], ['TSH', 'µIU/mL', '0.4-4.0']] },
  { test: 'Anti-TPO Antibodies', aliases: ['Anti TPO', 'TPO Antibody', 'ATPO'], category: 'biochemistry', sample: 'Serum', params: [['Anti-TPO antibodies', 'IU/mL', '<35']] },
  { test: 'Prolactin', aliases: ['PRL', 'Serum Prolactin'], category: 'biochemistry', sample: 'Serum', params: [['Prolactin', 'ng/mL', 'M4.0-15.2;F4.8-23.3']] },
  { test: 'FSH', aliases: ['Follicle Stimulating Hormone'], category: 'biochemistry', sample: 'Serum', params: [['FSH', 'mIU/mL', 'M1.5-12.4;F3.5-12.5']] },
  { test: 'LH', aliases: ['Luteinizing Hormone', 'Luteinising Hormone'], category: 'biochemistry', sample: 'Serum', params: [['LH', 'mIU/mL', 'M1.7-8.6;F2.4-12.6']] },
  { test: 'Estradiol (E2)', aliases: ['E2', 'Oestradiol', 'Estradiol'], category: 'biochemistry', sample: 'Serum', params: [['Estradiol (E2)', 'pg/mL', 'M10-40;F30-400']] },
  { test: 'Progesterone', aliases: ['Serum Progesterone'], category: 'biochemistry', sample: 'Serum', params: [['Progesterone', 'ng/mL', 'M0.2-1.4;F0.2-1.5']] },
  { test: 'Testosterone (Total)', aliases: ['Testosterone', 'Total Testosterone'], category: 'biochemistry', sample: 'Serum', params: [['Testosterone (total)', 'ng/dL', 'M240-950;F8-60']] },
  { test: 'Beta hCG (Quantitative)', aliases: ['Beta HCG', 'B-hCG', 'hCG', 'Serum hCG'], category: 'biochemistry', sample: 'Serum', params: [['Beta hCG', 'mIU/mL', '<5']] },
  { test: 'Folate (Vitamin B9)', aliases: ['Folic Acid', 'Folate', 'Serum Folate'], category: 'biochemistry', sample: 'Serum', params: [['Folate', 'ng/mL', '3.1-17.5']] },
  { test: 'Zinc', aliases: ['Serum Zinc'], category: 'biochemistry', sample: 'Serum', params: [['Zinc', 'µg/dL', '60-120']] },

  { test: 'CA-125', aliases: ['CA 125'], category: 'biochemistry', sample: 'Serum', params: [['CA-125', 'U/mL', '<35']] },
  { test: 'CEA', aliases: ['Carcinoembryonic Antigen'], category: 'biochemistry', sample: 'Serum', params: [['CEA', 'ng/mL', '<5']] },
  { test: 'AFP (Alpha Fetoprotein)', aliases: ['AFP', 'Alpha Feto Protein'], category: 'biochemistry', sample: 'Serum', params: [['AFP', 'ng/mL', '<10']] },
  { test: 'CA 19-9', aliases: ['CA19-9', 'CA 19.9'], category: 'biochemistry', sample: 'Serum', params: [['CA 19-9', 'U/mL', '<37']] },
  { test: 'CA 15-3', aliases: ['CA15-3'], category: 'biochemistry', sample: 'Serum', params: [['CA 15-3', 'U/mL', '<30']] },

  { test: 'Total IgE', aliases: ['IgE', 'Serum IgE'], category: 'serology', sample: 'Serum', params: [['Total IgE', 'IU/mL', '<100']] },
  { test: 'ASO Titre', aliases: ['ASO', 'ASLO', 'Anti-Streptolysin O'], category: 'serology', sample: 'Serum', params: [['ASO titre', 'IU/mL', '<200']] },
  { test: 'Anti-CCP', aliases: ['Anti CCP', 'Anti-Cyclic Citrullinated Peptide'], category: 'serology', sample: 'Serum', params: [['Anti-CCP', 'U/mL', '<20']] },
  { test: 'ANA (Antinuclear Antibody)', aliases: ['ANA', 'ANA IF'], category: 'serology', sample: 'Serum', params: [['ANA', '', 'Negative']] },
  { test: 'Anti-dsDNA', aliases: ['Anti ds DNA', 'dsDNA'], category: 'serology', sample: 'Serum', params: [['Anti-dsDNA', '', 'Negative']] },
  { test: 'Complement C3', aliases: ['C3'], category: 'serology', sample: 'Serum', params: [['C3 complement', 'mg/dL', '90-180']] },
  { test: 'Complement C4', aliases: ['C4'], category: 'serology', sample: 'Serum', params: [['C4 complement', 'mg/dL', '10-40']] },

  { test: 'Dengue IgM & IgG', aliases: ['Dengue Serology', 'Dengue Antibody', 'Dengue IgM IgG'], category: 'serology', sample: 'Serum', params: [['Dengue IgM', '', 'Negative'], ['Dengue IgG', '', 'Negative']] },
  { test: 'Chikungunya IgM', aliases: ['Chikungunya'], category: 'serology', sample: 'Serum', params: [['Chikungunya IgM', '', 'Negative']] },
  { test: 'Leptospira IgM', aliases: ['Leptospira'], category: 'serology', sample: 'Serum', params: [['Leptospira IgM', '', 'Negative']] },
  { test: 'Scrub Typhus IgM', aliases: ['Scrub Typhus'], category: 'serology', sample: 'Serum', params: [['Scrub typhus IgM', '', 'Negative']] },
  { test: 'Brucella Antibody (Rose Bengal)', aliases: ['Brucella', 'Rose Bengal'], category: 'serology', sample: 'Serum', params: [['Brucella (Rose Bengal)', '', 'Negative']] },
  { test: 'HBeAg', aliases: ['Hepatitis B e Antigen'], category: 'serology', sample: 'Serum', params: [['HBeAg', '', 'Negative']] },
  { test: 'Anti-HBs (HBsAb)', aliases: ['HBsAb', 'Anti HBs', 'Hepatitis B Surface Antibody'], category: 'serology', sample: 'Serum', params: [['Anti-HBs', 'mIU/mL', '>10']] },
  { test: 'Anti-HBc Total', aliases: ['HBcAb', 'Anti HBc'], category: 'serology', sample: 'Serum', params: [['Anti-HBc total', '', 'Negative']] },
  { test: 'HAV IgM', aliases: ['Hepatitis A IgM'], category: 'serology', sample: 'Serum', params: [['HAV IgM', '', 'Negative']] },
  { test: 'HEV IgM', aliases: ['Hepatitis E IgM'], category: 'serology', sample: 'Serum', params: [['HEV IgM', '', 'Negative']] },
  { test: 'TPHA', aliases: ['Treponema pallidum Haemagglutination'], category: 'serology', sample: 'Serum', params: [['TPHA', '', 'Non-reactive']] },
  { test: 'H. pylori Antigen (Stool)', aliases: ['H pylori Stool Antigen', 'HPSA', 'H. pylori Stool Antigen'], category: 'serology', sample: 'Stool', params: [['H. pylori antigen', '', 'Negative']] },
  { test: 'H. pylori IgG', aliases: ['H pylori Antibody', 'H. pylori Antibody'], category: 'serology', sample: 'Serum', params: [['H. pylori IgG', '', 'Negative']] },
  { test: 'QuantiFERON-TB Gold', aliases: ['IGRA', 'Quantiferon', 'QuantiFERON'], category: 'serology', sample: 'Heparin Whole Blood', params: [['QuantiFERON-TB', '', 'Negative']] },
  { test: 'Influenza A/B Antigen (Rapid)', aliases: ['Influenza Antigen', 'Flu A B'], category: 'serology', sample: 'Nasal Swab', params: [['Influenza A antigen', '', 'Negative'], ['Influenza B antigen', '', 'Negative']] },
  { test: 'COVID-19 Rapid Antigen', aliases: ['COVID Antigen', 'Covid RAT'], category: 'serology', sample: 'Nasopharyngeal Swab', params: [['SARS-CoV-2 antigen', '', 'Negative']] },
  { test: 'COVID-19 RT-PCR', aliases: ['COVID RT PCR', 'SARS-CoV-2 PCR', 'Covid PCR'], category: 'microbiology', sample: 'Nasopharyngeal Swab', params: [['SARS-CoV-2 RNA', '', 'Not detected']] },
  { test: 'Mantoux Test (TST)', aliases: ['Mantoux', 'Tuberculin Skin Test', 'TST'], category: 'clinical_pathology', sample: 'Intradermal (read at 48-72 h)', params: [['Induration', 'mm', '<10']] },

  { test: 'Urine Culture & Sensitivity', aliases: ['Urine C&S', 'Urine Culture', 'Urine C/S'], category: 'microbiology', sample: 'Urine (mid-stream)', params: [['Culture result', '', 'No growth'], ['Colony count', 'CFU/mL', '~—'], ['Organism isolated', '', '~—'], ['Antibiotic sensitivity', '', '~—']] },
  { test: 'Blood Culture & Sensitivity', aliases: ['Blood C&S', 'Blood Culture', 'Blood C/S'], category: 'microbiology', sample: 'Blood (culture bottle)', params: [['Culture result', '', 'No growth'], ['Organism isolated', '', '~—'], ['Antibiotic sensitivity', '', '~—']] },
  { test: 'Pus / Wound Swab Culture & Sensitivity', aliases: ['Pus C&S', 'Wound Swab Culture', 'Swab Culture', 'Pus Culture'], category: 'microbiology', sample: 'Pus / Swab', params: [['Culture result', '', 'No growth'], ['Organism isolated', '', '~—'], ['Antibiotic sensitivity', '', '~—']] },
  { test: 'Throat Swab Culture & Sensitivity', aliases: ['Throat Swab Culture', 'Throat Culture'], category: 'microbiology', sample: 'Throat Swab', params: [['Culture result', '', 'Normal flora'], ['Organism isolated', '', '~—'], ['Antibiotic sensitivity', '', '~—']] },
  { test: 'Sputum Culture & Sensitivity', aliases: ['Sputum C&S', 'Sputum Culture'], category: 'microbiology', sample: 'Sputum', params: [['Culture result', '', 'Normal flora'], ['Organism isolated', '', '~—'], ['Antibiotic sensitivity', '', '~—']] },
  { test: 'Stool Culture & Sensitivity', aliases: ['Stool C&S', 'Stool Culture'], category: 'microbiology', sample: 'Stool', params: [['Culture result', '', 'No pathogen isolated'], ['Organism isolated', '', '~—'], ['Antibiotic sensitivity', '', '~—']] },
  { test: 'Sputum for AFB', aliases: ['AFB Sputum', 'Sputum AFB', 'ZN Stain', 'AFB Smear'], category: 'microbiology', sample: 'Sputum', params: [['AFB (ZN stain)', '', 'Negative']] },

  { test: 'Urine Microalbumin', aliases: ['Microalbumin', 'Urine Albumin', 'MAU'], category: 'biochemistry', sample: 'Urine', params: [['Urine microalbumin', 'mg/L', '<20']] },
  { test: 'Urine Albumin-Creatinine Ratio (ACR)', aliases: ['ACR', 'Urine ACR', 'Microalbumin Creatinine Ratio'], category: 'biochemistry', sample: 'Urine', params: [['Urine albumin', 'mg/L', '~—'], ['Urine creatinine', 'mg/dL', '~—'], ['Albumin / creatinine ratio', 'mg/g', '<30']] },
  { test: '24-Hour Urine Protein', aliases: ['24 hr Urine Protein', '24h Urine Protein', 'Urine Protein 24 hours'], category: 'biochemistry', sample: '24-hour Urine', params: [['Urine volume', 'mL/24 h', '~—'], ['Protein (24 h)', 'mg/24 h', '<150']] },
  { test: 'Creatinine Clearance', aliases: ['CrCl', 'Creatinine Clearance 24h'], category: 'biochemistry', sample: '24-hour Urine + Serum', params: [['Creatinine clearance', 'mL/min', 'M97-137;F88-128']] },
  { test: 'Urine Ketones', aliases: ['Ketone Bodies', 'Urine Ketone'], category: 'clinical_pathology', sample: 'Urine', params: [['Urine ketones', '', 'Negative']] },
  { test: 'Urine Sugar (Benedict’s)', aliases: ['Urine Glucose', 'Urine Sugar', 'Benedict Test'], category: 'clinical_pathology', sample: 'Urine', params: [['Urine sugar', '', 'Nil']] },
  { test: 'CSF Analysis', aliases: ['CSF Routine', 'Cerebrospinal Fluid Analysis', 'CSF Examination'], category: 'clinical_pathology', sample: 'CSF', params: [['CSF appearance', '', '~Clear, colourless'], ['CSF total cells', '/µL', '0-5'], ['CSF neutrophils', '%', '~—'], ['CSF lymphocytes', '%', '~—'], ['CSF protein', 'mg/dL', '15-45'], ['CSF glucose', 'mg/dL', '40-70'], ['CSF chloride', 'mmol/L', '118-132']] },
  { test: 'ADA (Adenosine Deaminase)', aliases: ['ADA', 'Pleural Fluid ADA', 'Ascitic Fluid ADA'], category: 'biochemistry', sample: 'Body Fluid', params: [['ADA', 'U/L', '<40']] },
];


/**
 * AGE GROUPS: children are not small adults. For the tests where it matters, a parameter has its own normal range for each of four child groups (the adult range is
 * the parameter's ordinary one above): [newborn — under 28 days, infant — to 1 year, child — to 12 years, adolescent — to 18 years]. The app picks the group from the
 * patient's date of birth on the day of the test. Written like any range — "13-17", "M13-16;F12-16" (boys / girls), "<75", or words — and '' means "same as the adult range".
 * Typical paediatric reference values (Nelson / Harriet Lane style): every lab edits them to match its own analyser and kit.
 */
export type ChildSpecs = [newborn: string, infant: string, child: string, adolescent: string];
const NOTE_LIPID = 'Not routinely measured before 2 years';
const NOTE_THY = 'Age-specific — see the kit’s insert';
export const AGE_RANGES: Record<string, ChildSpecs> = {
  'Haemoglobin (Hb)': ['13.4-19.8', '10.5-13.5', '11.5-14.5', 'M13-16;F12-16'],
  'Total RBC count': ['4.0-6.6', '3.1-5.3', '3.9-5.3', 'M4.5-5.3;F4.1-5.1'],
  'Packed cell volume (PCV)': ['41-65', '30-44', '34-43', 'M37-49;F36-46'],
  'MCV': ['88-126', '70-110', '75-93', '78-98'],
  'MCH': ['28-37', '23-35', '24-32', '25-33'],
  'MCHC': ['29-37', '30-36', '30-36', '31-36'],
  'RDW-CV': ['14.9-18.7', '12-16', '11.5-14.5', ''],
  'Total WBC count (TLC)': ['9000-30000', '6000-17500', '5000-15500', '4500-13000'],
  'Neutrophils': ['40-75', '15-45', '25-65', '40-70'],
  'Lymphocytes': ['20-40', '40-75', '25-60', ''],
  'Monocytes': ['3-12', '3-12', '3-12', ''],
  'Platelet count': ['150000-450000', '150000-450000', '150000-450000', '150000-450000'],
  'ESR (Westergren)': ['0-2', '0-10', '0-10', '0-15'],
  'Serum creatinine': ['0.3-1.0', '0.2-0.5', '0.3-0.7', 'M0.6-1.2;F0.5-1.0'],
  'Uric acid': ['2.0-5.5', '2.0-5.5', '2.0-5.5', ''],
  'SGOT (AST)': ['25-75', '15-60', '15-45', '10-40'],
  'SGPT (ALT)': ['10-45', '10-45', '10-35', ''],
  'Alkaline phosphatase (ALP)': ['150-470', '150-470', '140-420', '70-390'],
  'Total bilirubin': ['Interpret by the baby’s age in hours (bilirubin chart)', '', '', ''],
  'Fasting blood sugar': ['45-100', '60-100', '60-100', ''],
  'Calcium': ['7.6-10.4', '9.0-11.0', '8.8-10.8', '8.4-10.2'],
  'Phosphorus': ['4.8-8.2', '4.0-6.5', '3.7-6.5', '2.7-4.5'],
  'Potassium (K)': ['3.7-5.9', '4.1-5.3', '', ''],
  'TSH': ['1.0-39.0', '1.7-9.1', '0.7-5.7', '0.5-4.8'],
  'Total T3': [NOTE_THY, '105-245', '94-269', '83-213'],
  'Total T4': [NOTE_THY, '5.9-14.0', '6.4-15.0', '5.6-11.7'],
  'Total cholesterol': [NOTE_LIPID, NOTE_LIPID, '<170', '<170'],
  'Triglycerides': [NOTE_LIPID, NOTE_LIPID, '<75', '<90'],
  'HDL cholesterol': [NOTE_LIPID, NOTE_LIPID, '>45', '>45'],
  'LDL cholesterol': [NOTE_LIPID, NOTE_LIPID, '<110', '<110'],
  'Non-HDL cholesterol': [NOTE_LIPID, NOTE_LIPID, '<120', '<120'],
};
