/**
 * Standard pharmacy catalogue for Indian OPD/clinic practice — ~130 of the most
 * commonly stocked / sold medicines, coded here so a fresh install starts with a
 * ready drug list (mirrors the lab catalogue). Every clinic can edit prices,
 * add/remove items, and manage stock from Pharmacy → Manage Drugs.
 *
 * MRPs are indicative (₹, per pack) and GST rates follow the usual Indian slabs
 * (5% for most life-saving, 12% for the majority of formulations). Loading the
 * catalogue only ADDS drugs whose name isn't already present, so it's safe to run
 * on an existing catalogue.
 */
export interface CatalogDrug {
  name: string;               // common brand as stocked
  generic_name: string;
  form: 'Tablet' | 'Capsule' | 'Syrup' | 'Suspension' | 'Injection' | 'Drops' | 'Ointment' | 'Cream' | 'Gel' | 'Inhaler' | 'Respules' | 'Sachet' | 'Solution' | 'Spray';
  strength: string;
  schedule: 'H' | 'H1' | 'G' | 'X' | 'OTC';
  gst_rate: number;           // 5 | 12 | 18
  default_mrp: number;        // ₹ per pack
  pack_size?: number;         // units per strip/bottle
}

export const PHARMACY_CATALOG: CatalogDrug[] = [
  // ── Analgesics / antipyretics / NSAIDs ────────────────────────────────
  { name: 'Dolo 650', generic_name: 'Paracetamol', form: 'Tablet', strength: '650 mg', schedule: 'OTC', gst_rate: 12, default_mrp: 31, pack_size: 15 },
  { name: 'Crocin Advance', generic_name: 'Paracetamol', form: 'Tablet', strength: '500 mg', schedule: 'OTC', gst_rate: 12, default_mrp: 22, pack_size: 15 },
  { name: 'Calpol 250 Syrup', generic_name: 'Paracetamol', form: 'Syrup', strength: '250 mg/5ml', schedule: 'OTC', gst_rate: 12, default_mrp: 45, pack_size: 60 },
  { name: 'Combiflam', generic_name: 'Ibuprofen + Paracetamol', form: 'Tablet', strength: '400+325 mg', schedule: 'OTC', gst_rate: 12, default_mrp: 44, pack_size: 20 },
  { name: 'Brufen 400', generic_name: 'Ibuprofen', form: 'Tablet', strength: '400 mg', schedule: 'H', gst_rate: 12, default_mrp: 38, pack_size: 15 },
  { name: 'Zerodol-SP', generic_name: 'Aceclofenac + Serratiopeptidase', form: 'Tablet', strength: '100+15 mg', schedule: 'H', gst_rate: 12, default_mrp: 108, pack_size: 10 },
  { name: 'Zerodol-P', generic_name: 'Aceclofenac + Paracetamol', form: 'Tablet', strength: '100+325 mg', schedule: 'H', gst_rate: 12, default_mrp: 100, pack_size: 10 },
  { name: 'Voveran 50', generic_name: 'Diclofenac', form: 'Tablet', strength: '50 mg', schedule: 'H', gst_rate: 12, default_mrp: 25, pack_size: 15 },
  { name: 'Volini Gel', generic_name: 'Diclofenac Diethylamine', form: 'Gel', strength: '1.16%', schedule: 'OTC', gst_rate: 12, default_mrp: 130, pack_size: 30 },
  { name: 'Nimulid', generic_name: 'Nimesulide', form: 'Tablet', strength: '100 mg', schedule: 'H', gst_rate: 12, default_mrp: 55, pack_size: 10 },
  { name: 'Meftal Spas', generic_name: 'Mefenamic Acid + Dicyclomine', form: 'Tablet', strength: '250+10 mg', schedule: 'H', gst_rate: 12, default_mrp: 60, pack_size: 10 },
  { name: 'Ultracet', generic_name: 'Tramadol + Paracetamol', form: 'Tablet', strength: '37.5+325 mg', schedule: 'H', gst_rate: 12, default_mrp: 120, pack_size: 10 },
  { name: 'Aspirin 75', generic_name: 'Aspirin', form: 'Tablet', strength: '75 mg', schedule: 'OTC', gst_rate: 12, default_mrp: 12, pack_size: 14 },

  // ── Antibiotics / antibacterials ──────────────────────────────────────
  { name: 'Augmentin 625', generic_name: 'Amoxicillin + Clavulanic Acid', form: 'Tablet', strength: '500+125 mg', schedule: 'H', gst_rate: 12, default_mrp: 205, pack_size: 10 },
  { name: 'Mox 500', generic_name: 'Amoxicillin', form: 'Capsule', strength: '500 mg', schedule: 'H', gst_rate: 12, default_mrp: 62, pack_size: 10 },
  { name: 'Azithral 500', generic_name: 'Azithromycin', form: 'Tablet', strength: '500 mg', schedule: 'H', gst_rate: 12, default_mrp: 118, pack_size: 5 },
  { name: 'Taxim-O 200', generic_name: 'Cefixime', form: 'Tablet', strength: '200 mg', schedule: 'H', gst_rate: 12, default_mrp: 135, pack_size: 10 },
  { name: 'Cefpodoxime 200', generic_name: 'Cefpodoxime Proxetil', form: 'Tablet', strength: '200 mg', schedule: 'H', gst_rate: 12, default_mrp: 165, pack_size: 10 },
  { name: 'Ciplox 500', generic_name: 'Ciprofloxacin', form: 'Tablet', strength: '500 mg', schedule: 'H', gst_rate: 12, default_mrp: 55, pack_size: 10 },
  { name: 'O2 200', generic_name: 'Ofloxacin + Ornidazole', form: 'Tablet', strength: '200+500 mg', schedule: 'H', gst_rate: 12, default_mrp: 95, pack_size: 10 },
  { name: 'Levoflox 500', generic_name: 'Levofloxacin', form: 'Tablet', strength: '500 mg', schedule: 'H', gst_rate: 12, default_mrp: 120, pack_size: 5 },
  { name: 'Flagyl 400', generic_name: 'Metronidazole', form: 'Tablet', strength: '400 mg', schedule: 'H', gst_rate: 12, default_mrp: 35, pack_size: 15 },
  { name: 'Doxy-1', generic_name: 'Doxycycline', form: 'Capsule', strength: '100 mg', schedule: 'H', gst_rate: 12, default_mrp: 40, pack_size: 10 },
  { name: 'Monocef 1g Injection', generic_name: 'Ceftriaxone', form: 'Injection', strength: '1 g', schedule: 'H', gst_rate: 12, default_mrp: 55, pack_size: 1 },
  { name: 'Cefixime + Azithromycin', generic_name: 'Cefixime + Azithromycin', form: 'Tablet', strength: '200+250 mg', schedule: 'H', gst_rate: 12, default_mrp: 175, pack_size: 10 },
  { name: 'Norflox-TZ', generic_name: 'Norfloxacin + Tinidazole', form: 'Tablet', strength: '400+600 mg', schedule: 'H', gst_rate: 12, default_mrp: 78, pack_size: 10 },

  // ── PPIs / antacids / GI ─────────────────────────────────────────────
  { name: 'Pan-D', generic_name: 'Pantoprazole + Domperidone', form: 'Capsule', strength: '40+30 mg', schedule: 'H', gst_rate: 12, default_mrp: 148, pack_size: 15 },
  { name: 'Pan 40', generic_name: 'Pantoprazole', form: 'Tablet', strength: '40 mg', schedule: 'H', gst_rate: 12, default_mrp: 130, pack_size: 15 },
  { name: 'Omez 20', generic_name: 'Omeprazole', form: 'Capsule', strength: '20 mg', schedule: 'H', gst_rate: 12, default_mrp: 68, pack_size: 15 },
  { name: 'Nexpro RD 40', generic_name: 'Esomeprazole + Domperidone', form: 'Capsule', strength: '40+30 mg', schedule: 'H', gst_rate: 12, default_mrp: 175, pack_size: 15 },
  { name: 'Razo 20', generic_name: 'Rabeprazole', form: 'Tablet', strength: '20 mg', schedule: 'H', gst_rate: 12, default_mrp: 110, pack_size: 15 },
  { name: 'Digene Gel', generic_name: 'Antacid (Magaldrate + Simethicone)', form: 'Suspension', strength: '200 ml', schedule: 'OTC', gst_rate: 12, default_mrp: 155, pack_size: 200 },
  { name: 'Gelusil MPS', generic_name: 'Aluminium + Magnesium Hydroxide + Simethicone', form: 'Suspension', strength: '170 ml', schedule: 'OTC', gst_rate: 12, default_mrp: 95, pack_size: 170 },
  { name: 'Cyclopam', generic_name: 'Dicyclomine + Paracetamol', form: 'Tablet', strength: '20+500 mg', schedule: 'H', gst_rate: 12, default_mrp: 48, pack_size: 10 },
  { name: 'Drotin-M', generic_name: 'Drotaverine + Mefenamic Acid', form: 'Tablet', strength: '80+250 mg', schedule: 'H', gst_rate: 12, default_mrp: 70, pack_size: 10 },
  { name: 'Sucral Syrup', generic_name: 'Sucralfate + Oxetacaine', form: 'Suspension', strength: '200 ml', schedule: 'H', gst_rate: 12, default_mrp: 165, pack_size: 200 },
  { name: 'Eldoper', generic_name: 'Loperamide', form: 'Tablet', strength: '2 mg', schedule: 'H', gst_rate: 12, default_mrp: 22, pack_size: 10 },
  { name: 'Econorm Sachet', generic_name: 'Saccharomyces boulardii', form: 'Sachet', strength: '250 mg', schedule: 'OTC', gst_rate: 12, default_mrp: 32, pack_size: 1 },

  // ── Antiemetics ──────────────────────────────────────────────────────
  { name: 'Emeset 4', generic_name: 'Ondansetron', form: 'Tablet', strength: '4 mg', schedule: 'H', gst_rate: 12, default_mrp: 42, pack_size: 10 },
  { name: 'Domstal', generic_name: 'Domperidone', form: 'Tablet', strength: '10 mg', schedule: 'H', gst_rate: 12, default_mrp: 38, pack_size: 10 },
  { name: 'Perinorm', generic_name: 'Metoclopramide', form: 'Tablet', strength: '10 mg', schedule: 'H', gst_rate: 12, default_mrp: 18, pack_size: 10 },

  // ── Antihistamines / anti-allergics ──────────────────────────────────
  { name: 'Cetirizine', generic_name: 'Cetirizine', form: 'Tablet', strength: '10 mg', schedule: 'OTC', gst_rate: 12, default_mrp: 20, pack_size: 10 },
  { name: 'Levocet', generic_name: 'Levocetirizine', form: 'Tablet', strength: '5 mg', schedule: 'OTC', gst_rate: 12, default_mrp: 45, pack_size: 10 },
  { name: 'Allegra 120', generic_name: 'Fexofenadine', form: 'Tablet', strength: '120 mg', schedule: 'H', gst_rate: 12, default_mrp: 175, pack_size: 10 },
  { name: 'Montek LC', generic_name: 'Montelukast + Levocetirizine', form: 'Tablet', strength: '10+5 mg', schedule: 'H', gst_rate: 12, default_mrp: 175, pack_size: 10 },
  { name: 'Avil 25', generic_name: 'Pheniramine', form: 'Tablet', strength: '25 mg', schedule: 'H', gst_rate: 12, default_mrp: 15, pack_size: 15 },
  { name: 'Sinarest', generic_name: 'Paracetamol + Phenylephrine + Chlorpheniramine', form: 'Tablet', strength: '500+10+2 mg', schedule: 'OTC', gst_rate: 12, default_mrp: 65, pack_size: 10 },

  // ── Respiratory / cough / asthma ─────────────────────────────────────
  { name: 'Ascoril LS Syrup', generic_name: 'Ambroxol + Levosalbutamol + Guaifenesin', form: 'Syrup', strength: '100 ml', schedule: 'H', gst_rate: 12, default_mrp: 125, pack_size: 100 },
  { name: 'Benadryl Cough Syrup', generic_name: 'Diphenhydramine + Ammonium Chloride', form: 'Syrup', strength: '100 ml', schedule: 'OTC', gst_rate: 12, default_mrp: 110, pack_size: 100 },
  { name: 'Grilinctus', generic_name: 'Dextromethorphan + Chlorpheniramine', form: 'Syrup', strength: '100 ml', schedule: 'H', gst_rate: 12, default_mrp: 105, pack_size: 100 },
  { name: 'Asthalin Inhaler', generic_name: 'Salbutamol', form: 'Inhaler', strength: '100 mcg', schedule: 'H', gst_rate: 5, default_mrp: 130, pack_size: 200 },
  { name: 'Foracort 200 Inhaler', generic_name: 'Formoterol + Budesonide', form: 'Inhaler', strength: '6+200 mcg', schedule: 'H', gst_rate: 5, default_mrp: 385, pack_size: 120 },
  { name: 'Duolin Respules', generic_name: 'Levosalbutamol + Ipratropium', form: 'Respules', strength: '2.5 ml', schedule: 'H', gst_rate: 5, default_mrp: 95, pack_size: 5 },
  { name: 'Budecort Respules', generic_name: 'Budesonide', form: 'Respules', strength: '0.5 mg', schedule: 'H', gst_rate: 5, default_mrp: 115, pack_size: 5 },
  { name: 'Montair 10', generic_name: 'Montelukast', form: 'Tablet', strength: '10 mg', schedule: 'H', gst_rate: 12, default_mrp: 155, pack_size: 10 },
  { name: 'Deriphyllin', generic_name: 'Etophylline + Theophylline', form: 'Tablet', strength: '77+23 mg', schedule: 'H', gst_rate: 12, default_mrp: 40, pack_size: 10 },

  // ── Antidiabetics ────────────────────────────────────────────────────
  { name: 'Glycomet 500', generic_name: 'Metformin', form: 'Tablet', strength: '500 mg', schedule: 'H', gst_rate: 12, default_mrp: 30, pack_size: 20 },
  { name: 'Glycomet GP1', generic_name: 'Metformin + Glimepiride', form: 'Tablet', strength: '500+1 mg', schedule: 'H', gst_rate: 12, default_mrp: 95, pack_size: 15 },
  { name: 'Amaryl 2', generic_name: 'Glimepiride', form: 'Tablet', strength: '2 mg', schedule: 'H', gst_rate: 12, default_mrp: 90, pack_size: 10 },
  { name: 'Janumet 50/500', generic_name: 'Sitagliptin + Metformin', form: 'Tablet', strength: '50+500 mg', schedule: 'H', gst_rate: 12, default_mrp: 215, pack_size: 15 },
  { name: 'Istamet 50/500', generic_name: 'Sitagliptin + Metformin', form: 'Tablet', strength: '50+500 mg', schedule: 'H', gst_rate: 12, default_mrp: 180, pack_size: 15 },
  { name: 'Human Mixtard Insulin', generic_name: 'Insulin (30/70)', form: 'Injection', strength: '40 IU/ml', schedule: 'H', gst_rate: 5, default_mrp: 150, pack_size: 10 },
  { name: 'Lantus Insulin', generic_name: 'Insulin Glargine', form: 'Injection', strength: '100 IU/ml', schedule: 'H', gst_rate: 5, default_mrp: 850, pack_size: 3 },

  // ── Antihypertensives / cardiac ──────────────────────────────────────
  { name: 'Amlong 5', generic_name: 'Amlodipine', form: 'Tablet', strength: '5 mg', schedule: 'H', gst_rate: 12, default_mrp: 42, pack_size: 15 },
  { name: 'Telma 40', generic_name: 'Telmisartan', form: 'Tablet', strength: '40 mg', schedule: 'H', gst_rate: 12, default_mrp: 105, pack_size: 15 },
  { name: 'Telma-H 40', generic_name: 'Telmisartan + Hydrochlorothiazide', form: 'Tablet', strength: '40+12.5 mg', schedule: 'H', gst_rate: 12, default_mrp: 120, pack_size: 15 },
  { name: 'Losar 50', generic_name: 'Losartan', form: 'Tablet', strength: '50 mg', schedule: 'H', gst_rate: 12, default_mrp: 60, pack_size: 15 },
  { name: 'Met XL 25', generic_name: 'Metoprolol', form: 'Tablet', strength: '25 mg', schedule: 'H', gst_rate: 12, default_mrp: 55, pack_size: 15 },
  { name: 'Cardace 5', generic_name: 'Ramipril', form: 'Tablet', strength: '5 mg', schedule: 'H', gst_rate: 12, default_mrp: 95, pack_size: 10 },
  { name: 'Atorva 10', generic_name: 'Atorvastatin', form: 'Tablet', strength: '10 mg', schedule: 'H', gst_rate: 12, default_mrp: 65, pack_size: 15 },
  { name: 'Rosuvas 10', generic_name: 'Rosuvastatin', form: 'Tablet', strength: '10 mg', schedule: 'H', gst_rate: 12, default_mrp: 110, pack_size: 10 },
  { name: 'Ecosprin-AV 75', generic_name: 'Aspirin + Atorvastatin', form: 'Capsule', strength: '75+10 mg', schedule: 'H', gst_rate: 12, default_mrp: 95, pack_size: 15 },
  { name: 'Clopilet 75', generic_name: 'Clopidogrel', form: 'Tablet', strength: '75 mg', schedule: 'H', gst_rate: 12, default_mrp: 78, pack_size: 10 },
  { name: 'Nitrocontin 2.6', generic_name: 'Nitroglycerin', form: 'Tablet', strength: '2.6 mg', schedule: 'H', gst_rate: 12, default_mrp: 45, pack_size: 15 },
  { name: 'Lasix 40', generic_name: 'Furosemide', form: 'Tablet', strength: '40 mg', schedule: 'H', gst_rate: 12, default_mrp: 12, pack_size: 15 },
  { name: 'Dytor 10', generic_name: 'Torsemide', form: 'Tablet', strength: '10 mg', schedule: 'H', gst_rate: 12, default_mrp: 70, pack_size: 15 },

  // ── Thyroid / hormones / steroids ────────────────────────────────────
  { name: 'Thyronorm 50', generic_name: 'Levothyroxine', form: 'Tablet', strength: '50 mcg', schedule: 'H', gst_rate: 5, default_mrp: 130, pack_size: 120 },
  { name: 'Eltroxin 100', generic_name: 'Levothyroxine', form: 'Tablet', strength: '100 mcg', schedule: 'H', gst_rate: 5, default_mrp: 165, pack_size: 120 },
  { name: 'Omnacortil 10', generic_name: 'Prednisolone', form: 'Tablet', strength: '10 mg', schedule: 'H', gst_rate: 12, default_mrp: 55, pack_size: 10 },
  { name: 'Wysolone 5', generic_name: 'Prednisolone', form: 'Tablet', strength: '5 mg', schedule: 'H', gst_rate: 12, default_mrp: 30, pack_size: 10 },
  { name: 'Defcort 6', generic_name: 'Deflazacort', form: 'Tablet', strength: '6 mg', schedule: 'H', gst_rate: 12, default_mrp: 95, pack_size: 10 },
  { name: 'Dexona Injection', generic_name: 'Dexamethasone', form: 'Injection', strength: '4 mg/ml', schedule: 'H', gst_rate: 12, default_mrp: 8, pack_size: 1 },

  // ── Vitamins / supplements / tonics ──────────────────────────────────
  { name: 'Zincovit', generic_name: 'Multivitamin + Multimineral', form: 'Tablet', strength: '—', schedule: 'OTC', gst_rate: 12, default_mrp: 108, pack_size: 15 },
  { name: 'Becosules', generic_name: 'Vitamin B-Complex + Vitamin C', form: 'Capsule', strength: '—', schedule: 'OTC', gst_rate: 12, default_mrp: 42, pack_size: 20 },
  { name: 'Shelcal 500', generic_name: 'Calcium + Vitamin D3', form: 'Tablet', strength: '500 mg + 250 IU', schedule: 'OTC', gst_rate: 12, default_mrp: 120, pack_size: 15 },
  { name: 'Uprise D3 60K', generic_name: 'Cholecalciferol (Vitamin D3)', form: 'Sachet', strength: '60000 IU', schedule: 'OTC', gst_rate: 12, default_mrp: 35, pack_size: 1 },
  { name: 'Livogen', generic_name: 'Ferrous Fumarate + Folic Acid', form: 'Tablet', strength: '152+1.5 mg', schedule: 'OTC', gst_rate: 12, default_mrp: 45, pack_size: 10 },
  { name: 'Autrin', generic_name: 'Iron + Folic Acid + B12', form: 'Capsule', strength: '—', schedule: 'OTC', gst_rate: 12, default_mrp: 55, pack_size: 15 },
  { name: 'Neurobion Forte', generic_name: 'Vitamin B1 B6 B12', form: 'Tablet', strength: '—', schedule: 'OTC', gst_rate: 12, default_mrp: 40, pack_size: 30 },
  { name: 'Limcee', generic_name: 'Vitamin C', form: 'Tablet', strength: '500 mg', schedule: 'OTC', gst_rate: 12, default_mrp: 28, pack_size: 15 },
  { name: 'Cypon Syrup', generic_name: 'Cyproheptadine + Tricholine', form: 'Syrup', strength: '200 ml', schedule: 'H', gst_rate: 12, default_mrp: 95, pack_size: 200 },
  { name: 'Electral Powder', generic_name: 'ORS', form: 'Sachet', strength: '21.8 g', schedule: 'OTC', gst_rate: 12, default_mrp: 22, pack_size: 1 },
  { name: 'Enerzal', generic_name: 'Energy + Electrolytes', form: 'Sachet', strength: '50 g', schedule: 'OTC', gst_rate: 12, default_mrp: 45, pack_size: 1 },

  // ── Topicals / dermatology / antiseptics ─────────────────────────────
  { name: 'Betadine Ointment', generic_name: 'Povidone Iodine', form: 'Ointment', strength: '5%', schedule: 'OTC', gst_rate: 12, default_mrp: 95, pack_size: 20 },
  { name: 'Soframycin Cream', generic_name: 'Framycetin', form: 'Cream', strength: '1%', schedule: 'H', gst_rate: 12, default_mrp: 42, pack_size: 30 },
  { name: 'T-Bact Ointment', generic_name: 'Mupirocin', form: 'Ointment', strength: '2%', schedule: 'H', gst_rate: 12, default_mrp: 155, pack_size: 5 },
  { name: 'Candid Cream', generic_name: 'Clotrimazole', form: 'Cream', strength: '1%', schedule: 'OTC', gst_rate: 12, default_mrp: 78, pack_size: 20 },
  { name: 'Candid-B Cream', generic_name: 'Clotrimazole + Beclomethasone', form: 'Cream', strength: '—', schedule: 'H', gst_rate: 12, default_mrp: 95, pack_size: 15 },
  { name: 'Quadriderm RF', generic_name: 'Betamethasone + Gentamicin + others', form: 'Cream', strength: '—', schedule: 'H', gst_rate: 12, default_mrp: 105, pack_size: 15 },
  { name: 'Silverex Ionic Gel', generic_name: 'Silver Sulphadiazine', form: 'Gel', strength: '—', schedule: 'H', gst_rate: 12, default_mrp: 110, pack_size: 25 },
  { name: 'Dettol Antiseptic', generic_name: 'Chloroxylenol', form: 'Solution', strength: '4.8%', schedule: 'OTC', gst_rate: 18, default_mrp: 95, pack_size: 125 },
  { name: 'Ketoconazole Shampoo', generic_name: 'Ketoconazole', form: 'Solution', strength: '2%', schedule: 'H', gst_rate: 12, default_mrp: 145, pack_size: 60 },

  // ── Eye / ENT drops ──────────────────────────────────────────────────
  { name: 'Ciplox Eye Drops', generic_name: 'Ciprofloxacin', form: 'Drops', strength: '0.3%', schedule: 'H', gst_rate: 12, default_mrp: 18, pack_size: 10 },
  { name: 'Moxicip Eye Drops', generic_name: 'Moxifloxacin', form: 'Drops', strength: '0.5%', schedule: 'H', gst_rate: 12, default_mrp: 65, pack_size: 5 },
  { name: 'Refresh Tears', generic_name: 'Carboxymethylcellulose', form: 'Drops', strength: '0.5%', schedule: 'OTC', gst_rate: 12, default_mrp: 130, pack_size: 10 },
  { name: 'Otrivin Nasal Spray', generic_name: 'Xylometazoline', form: 'Spray', strength: '0.1%', schedule: 'OTC', gst_rate: 12, default_mrp: 88, pack_size: 10 },
  { name: 'Candibiotic Ear Drops', generic_name: 'Chloramphenicol + Clotrimazole + others', form: 'Drops', strength: '—', schedule: 'H', gst_rate: 12, default_mrp: 90, pack_size: 5 },

  // ── Antifungal / antiviral / antiparasitic (oral) ────────────────────
  { name: 'Forcan 150', generic_name: 'Fluconazole', form: 'Tablet', strength: '150 mg', schedule: 'H', gst_rate: 12, default_mrp: 45, pack_size: 1 },
  { name: 'Zentel', generic_name: 'Albendazole', form: 'Tablet', strength: '400 mg', schedule: 'OTC', gst_rate: 12, default_mrp: 22, pack_size: 1 },
  { name: 'Ivermectin 12', generic_name: 'Ivermectin', form: 'Tablet', strength: '12 mg', schedule: 'H', gst_rate: 12, default_mrp: 35, pack_size: 4 },
  { name: 'Acivir 400', generic_name: 'Aciclovir', form: 'Tablet', strength: '400 mg', schedule: 'H', gst_rate: 12, default_mrp: 95, pack_size: 5 },

  // ── CNS / misc ───────────────────────────────────────────────────────
  { name: 'Pregabalin 75', generic_name: 'Pregabalin', form: 'Capsule', strength: '75 mg', schedule: 'H', gst_rate: 12, default_mrp: 85, pack_size: 10 },
  { name: 'Gabapentin 300', generic_name: 'Gabapentin', form: 'Capsule', strength: '300 mg', schedule: 'H', gst_rate: 12, default_mrp: 95, pack_size: 10 },
  { name: 'Amitone 10', generic_name: 'Amitriptyline', form: 'Tablet', strength: '10 mg', schedule: 'H', gst_rate: 12, default_mrp: 30, pack_size: 15 },
  { name: 'Nervijen Plus', generic_name: 'Methylcobalamin + ALA + others', form: 'Capsule', strength: '—', schedule: 'H', gst_rate: 12, default_mrp: 145, pack_size: 10 },
  { name: 'Rantac 150', generic_name: 'Ranitidine', form: 'Tablet', strength: '150 mg', schedule: 'H', gst_rate: 12, default_mrp: 30, pack_size: 20 },
  { name: 'Chymoral Forte', generic_name: 'Trypsin + Chymotrypsin', form: 'Tablet', strength: '—', schedule: 'H', gst_rate: 12, default_mrp: 130, pack_size: 10 },
  { name: 'Dolo Cold', generic_name: 'Paracetamol + Phenylephrine + CPM', form: 'Tablet', strength: '—', schedule: 'OTC', gst_rate: 12, default_mrp: 42, pack_size: 10 },
  { name: 'Vicks Action 500', generic_name: 'Paracetamol + Phenylephrine + Caffeine', form: 'Tablet', strength: '—', schedule: 'OTC', gst_rate: 12, default_mrp: 48, pack_size: 10 },

  // ── More antibiotics / anti-infectives ───────────────────────────────
  { name: 'Cefuroxime 500', generic_name: 'Cefuroxime Axetil', form: 'Tablet', strength: '500 mg', schedule: 'H', gst_rate: 12, default_mrp: 220, pack_size: 10 },
  { name: 'Clavam 625', generic_name: 'Amoxicillin + Clavulanic Acid', form: 'Tablet', strength: '500+125 mg', schedule: 'H', gst_rate: 12, default_mrp: 195, pack_size: 10 },
  { name: 'Zifi 200', generic_name: 'Cefixime', form: 'Tablet', strength: '200 mg', schedule: 'H', gst_rate: 12, default_mrp: 145, pack_size: 10 },
  { name: 'Zifi CV 200', generic_name: 'Cefixime + Clavulanic Acid', form: 'Tablet', strength: '200+125 mg', schedule: 'H', gst_rate: 12, default_mrp: 250, pack_size: 10 },
  { name: 'Cephalexin 500', generic_name: 'Cephalexin', form: 'Capsule', strength: '500 mg', schedule: 'H', gst_rate: 12, default_mrp: 90, pack_size: 10 },
  { name: 'Clindamycin 300', generic_name: 'Clindamycin', form: 'Capsule', strength: '300 mg', schedule: 'H', gst_rate: 12, default_mrp: 175, pack_size: 10 },
  { name: 'Linezolid 600', generic_name: 'Linezolid', form: 'Tablet', strength: '600 mg', schedule: 'H', gst_rate: 12, default_mrp: 480, pack_size: 10 },
  { name: 'Rifampicin 450', generic_name: 'Rifampicin', form: 'Capsule', strength: '450 mg', schedule: 'H', gst_rate: 5, default_mrp: 95, pack_size: 10 },
  { name: 'Amikacin 500 Injection', generic_name: 'Amikacin', form: 'Injection', strength: '500 mg', schedule: 'H', gst_rate: 12, default_mrp: 45, pack_size: 1 },
  { name: 'Gentamicin 80 Injection', generic_name: 'Gentamicin', form: 'Injection', strength: '80 mg', schedule: 'H', gst_rate: 12, default_mrp: 12, pack_size: 1 },
  { name: 'Piptaz 4.5g Injection', generic_name: 'Piperacillin + Tazobactam', form: 'Injection', strength: '4.5 g', schedule: 'H', gst_rate: 12, default_mrp: 380, pack_size: 1 },
  { name: 'Meropenem 1g Injection', generic_name: 'Meropenem', form: 'Injection', strength: '1 g', schedule: 'H', gst_rate: 12, default_mrp: 650, pack_size: 1 },
  { name: 'Metrogyl 100 Infusion', generic_name: 'Metronidazole', form: 'Injection', strength: '100 ml', schedule: 'H', gst_rate: 12, default_mrp: 22, pack_size: 1 },
  { name: 'Augmentin Duo Syrup', generic_name: 'Amoxicillin + Clavulanic Acid', form: 'Suspension', strength: '30 ml', schedule: 'H', gst_rate: 12, default_mrp: 135, pack_size: 30 },
  { name: 'Azithral Syrup 200', generic_name: 'Azithromycin', form: 'Suspension', strength: '200 mg/5ml', schedule: 'H', gst_rate: 12, default_mrp: 95, pack_size: 15 },
  { name: 'Cefpodoxime Syrup 50', generic_name: 'Cefpodoxime Proxetil', form: 'Suspension', strength: '50 mg/5ml', schedule: 'H', gst_rate: 12, default_mrp: 110, pack_size: 30 },

  // ── Paediatric syrups / drops ────────────────────────────────────────
  { name: 'Meftal-P Syrup', generic_name: 'Mefenamic Acid', form: 'Suspension', strength: '100 mg/5ml', schedule: 'H', gst_rate: 12, default_mrp: 78, pack_size: 60 },
  { name: 'Ibugesic Plus Syrup', generic_name: 'Ibuprofen + Paracetamol', form: 'Suspension', strength: '100+162.5 mg', schedule: 'H', gst_rate: 12, default_mrp: 65, pack_size: 60 },
  { name: 'Crocin Drops', generic_name: 'Paracetamol', form: 'Drops', strength: '100 mg/ml', schedule: 'OTC', gst_rate: 12, default_mrp: 42, pack_size: 15 },
  { name: 'Zincovit Syrup', generic_name: 'Multivitamin + Zinc', form: 'Syrup', strength: '200 ml', schedule: 'OTC', gst_rate: 12, default_mrp: 125, pack_size: 200 },
  { name: 'Ondem Syrup', generic_name: 'Ondansetron', form: 'Syrup', strength: '2 mg/5ml', schedule: 'H', gst_rate: 12, default_mrp: 62, pack_size: 30 },
  { name: 'Zinconia Syrup', generic_name: 'Zinc Sulphate', form: 'Syrup', strength: '20 mg/5ml', schedule: 'OTC', gst_rate: 12, default_mrp: 55, pack_size: 60 },
  { name: 'Colicaid Drops', generic_name: 'Simethicone + Dill Oil', form: 'Drops', strength: '15 ml', schedule: 'OTC', gst_rate: 12, default_mrp: 105, pack_size: 15 },
  { name: 'Sporlac Sachet', generic_name: 'Lactobacillus', form: 'Sachet', strength: '1 g', schedule: 'OTC', gst_rate: 12, default_mrp: 28, pack_size: 1 },
  { name: 'Albendazole Suspension', generic_name: 'Albendazole', form: 'Suspension', strength: '200 mg/5ml', schedule: 'OTC', gst_rate: 12, default_mrp: 32, pack_size: 10 },

  // ── IV fluids / injections (ward + emergency) ────────────────────────
  { name: 'Normal Saline 0.9% 500ml', generic_name: 'Sodium Chloride', form: 'Injection', strength: '500 ml', schedule: 'H', gst_rate: 12, default_mrp: 55, pack_size: 1 },
  { name: 'Ringer Lactate 500ml', generic_name: 'Compound Sodium Lactate', form: 'Injection', strength: '500 ml', schedule: 'H', gst_rate: 12, default_mrp: 58, pack_size: 1 },
  { name: 'Dextrose 5% 500ml', generic_name: 'Dextrose', form: 'Injection', strength: '500 ml', schedule: 'H', gst_rate: 12, default_mrp: 55, pack_size: 1 },
  { name: 'DNS 500ml', generic_name: 'Dextrose + Normal Saline', form: 'Injection', strength: '500 ml', schedule: 'H', gst_rate: 12, default_mrp: 58, pack_size: 1 },
  { name: 'Pantop 40 Injection', generic_name: 'Pantoprazole', form: 'Injection', strength: '40 mg', schedule: 'H', gst_rate: 12, default_mrp: 55, pack_size: 1 },
  { name: 'Emeset 2ml Injection', generic_name: 'Ondansetron', form: 'Injection', strength: '2 mg/ml', schedule: 'H', gst_rate: 12, default_mrp: 15, pack_size: 1 },
  { name: 'Tramadol 50 Injection', generic_name: 'Tramadol', form: 'Injection', strength: '50 mg', schedule: 'H', gst_rate: 12, default_mrp: 18, pack_size: 1 },
  { name: 'Diclofenac 75 Injection', generic_name: 'Diclofenac', form: 'Injection', strength: '75 mg', schedule: 'H', gst_rate: 12, default_mrp: 14, pack_size: 1 },
  { name: 'Avil 2ml Injection', generic_name: 'Pheniramine', form: 'Injection', strength: '22.75 mg/ml', schedule: 'H', gst_rate: 12, default_mrp: 10, pack_size: 1 },
  { name: 'Hydrocortisone 100 Injection', generic_name: 'Hydrocortisone', form: 'Injection', strength: '100 mg', schedule: 'H', gst_rate: 12, default_mrp: 35, pack_size: 1 },
  { name: 'Adrenaline 1mg Injection', generic_name: 'Adrenaline', form: 'Injection', strength: '1 mg/ml', schedule: 'H', gst_rate: 12, default_mrp: 18, pack_size: 1 },
  { name: 'Atropine 0.6 Injection', generic_name: 'Atropine Sulphate', form: 'Injection', strength: '0.6 mg/ml', schedule: 'H', gst_rate: 12, default_mrp: 12, pack_size: 1 },
  { name: 'Lignocaine 2% Injection', generic_name: 'Lignocaine', form: 'Injection', strength: '30 ml', schedule: 'H', gst_rate: 12, default_mrp: 45, pack_size: 1 },
  { name: 'Tetanus Toxoid Injection', generic_name: 'Tetanus Toxoid', form: 'Injection', strength: '0.5 ml', schedule: 'H', gst_rate: 5, default_mrp: 30, pack_size: 1 },
  { name: 'Vitamin K 1mg Injection', generic_name: 'Phytomenadione', form: 'Injection', strength: '1 mg', schedule: 'H', gst_rate: 12, default_mrp: 20, pack_size: 1 },
  { name: 'Furosemide 20 Injection', generic_name: 'Furosemide', form: 'Injection', strength: '20 mg', schedule: 'H', gst_rate: 12, default_mrp: 10, pack_size: 1 },
  { name: 'Neurobion Forte Injection', generic_name: 'Vitamin B-Complex', form: 'Injection', strength: '3 ml', schedule: 'H', gst_rate: 12, default_mrp: 42, pack_size: 1 },

  // ── Cardiac / diabetes extras ────────────────────────────────────────
  { name: 'Telma AM', generic_name: 'Telmisartan + Amlodipine', form: 'Tablet', strength: '40+5 mg', schedule: 'H', gst_rate: 12, default_mrp: 145, pack_size: 15 },
  { name: 'Olmesartan 20', generic_name: 'Olmesartan', form: 'Tablet', strength: '20 mg', schedule: 'H', gst_rate: 12, default_mrp: 120, pack_size: 15 },
  { name: 'Nebicard 5', generic_name: 'Nebivolol', form: 'Tablet', strength: '5 mg', schedule: 'H', gst_rate: 12, default_mrp: 115, pack_size: 14 },
  { name: 'Concor 5', generic_name: 'Bisoprolol', form: 'Tablet', strength: '5 mg', schedule: 'H', gst_rate: 12, default_mrp: 130, pack_size: 10 },
  { name: 'Prolomet XL 50', generic_name: 'Metoprolol Succinate', form: 'Tablet', strength: '50 mg', schedule: 'H', gst_rate: 12, default_mrp: 118, pack_size: 15 },
  { name: 'Cilacar 10', generic_name: 'Cilnidipine', form: 'Tablet', strength: '10 mg', schedule: 'H', gst_rate: 12, default_mrp: 135, pack_size: 15 },
  { name: 'Storvas 20', generic_name: 'Atorvastatin', form: 'Tablet', strength: '20 mg', schedule: 'H', gst_rate: 12, default_mrp: 105, pack_size: 15 },
  { name: 'Ecosprin 75', generic_name: 'Aspirin', form: 'Tablet', strength: '75 mg', schedule: 'OTC', gst_rate: 12, default_mrp: 11, pack_size: 14 },
  { name: 'Dapagliflozin 10', generic_name: 'Dapagliflozin', form: 'Tablet', strength: '10 mg', schedule: 'H', gst_rate: 12, default_mrp: 195, pack_size: 10 },
  { name: 'Vildagliptin 50', generic_name: 'Vildagliptin', form: 'Tablet', strength: '50 mg', schedule: 'H', gst_rate: 12, default_mrp: 165, pack_size: 15 },
  { name: 'Pioglitazone 15', generic_name: 'Pioglitazone', form: 'Tablet', strength: '15 mg', schedule: 'H', gst_rate: 12, default_mrp: 70, pack_size: 10 },
  { name: 'Voglibose 0.3', generic_name: 'Voglibose', form: 'Tablet', strength: '0.3 mg', schedule: 'H', gst_rate: 12, default_mrp: 85, pack_size: 10 },
  { name: 'Insulin Actrapid', generic_name: 'Human Insulin (Regular)', form: 'Injection', strength: '40 IU/ml', schedule: 'H', gst_rate: 5, default_mrp: 155, pack_size: 10 },

  // ── Gastro / hepatology extras ───────────────────────────────────────
  { name: 'Udiliv 300', generic_name: 'Ursodeoxycholic Acid', form: 'Tablet', strength: '300 mg', schedule: 'H', gst_rate: 12, default_mrp: 285, pack_size: 10 },
  { name: 'Duphalac Syrup', generic_name: 'Lactulose', form: 'Syrup', strength: '200 ml', schedule: 'H', gst_rate: 12, default_mrp: 215, pack_size: 200 },
  { name: 'Cremaffin Plus', generic_name: 'Milk of Magnesia + Liquid Paraffin', form: 'Suspension', strength: '225 ml', schedule: 'OTC', gst_rate: 12, default_mrp: 195, pack_size: 225 },
  { name: 'Isabgol Husk', generic_name: 'Psyllium Husk', form: 'Sachet', strength: '100 g', schedule: 'OTC', gst_rate: 12, default_mrp: 165, pack_size: 1 },
  { name: 'Mebeverine 135', generic_name: 'Mebeverine', form: 'Tablet', strength: '135 mg', schedule: 'H', gst_rate: 12, default_mrp: 120, pack_size: 10 },
  { name: 'Rifagut 400', generic_name: 'Rifaximin', form: 'Tablet', strength: '400 mg', schedule: 'H', gst_rate: 12, default_mrp: 380, pack_size: 10 },
  { name: 'Ranitidine Injection', generic_name: 'Ranitidine', form: 'Injection', strength: '50 mg/2ml', schedule: 'H', gst_rate: 12, default_mrp: 12, pack_size: 1 },

  // ── Gynaecology / urology ────────────────────────────────────────────
  { name: 'Folvite 5', generic_name: 'Folic Acid', form: 'Tablet', strength: '5 mg', schedule: 'OTC', gst_rate: 12, default_mrp: 32, pack_size: 30 },
  { name: 'Duphaston 10', generic_name: 'Dydrogesterone', form: 'Tablet', strength: '10 mg', schedule: 'H', gst_rate: 12, default_mrp: 545, pack_size: 10 },
  { name: 'Susten 200', generic_name: 'Progesterone', form: 'Capsule', strength: '200 mg', schedule: 'H', gst_rate: 12, default_mrp: 320, pack_size: 10 },
  { name: 'Tranexamic Acid 500', generic_name: 'Tranexamic Acid', form: 'Tablet', strength: '500 mg', schedule: 'H', gst_rate: 12, default_mrp: 115, pack_size: 10 },
  { name: 'Clotrimazole Pessary', generic_name: 'Clotrimazole', form: 'Tablet', strength: '100 mg', schedule: 'H', gst_rate: 12, default_mrp: 65, pack_size: 6 },
  { name: 'Urimax D', generic_name: 'Tamsulosin + Dutasteride', form: 'Tablet', strength: '0.4+0.5 mg', schedule: 'H', gst_rate: 12, default_mrp: 285, pack_size: 15 },
  { name: 'Nitrofurantoin 100', generic_name: 'Nitrofurantoin', form: 'Capsule', strength: '100 mg', schedule: 'H', gst_rate: 12, default_mrp: 105, pack_size: 10 },
  { name: 'Alkasol Syrup', generic_name: 'Disodium Hydrogen Citrate', form: 'Syrup', strength: '100 ml', schedule: 'H', gst_rate: 12, default_mrp: 130, pack_size: 100 },

  // ── Ortho / rheumatology ─────────────────────────────────────────────
  { name: 'Etoricoxib 90', generic_name: 'Etoricoxib', form: 'Tablet', strength: '90 mg', schedule: 'H', gst_rate: 12, default_mrp: 145, pack_size: 10 },
  { name: 'Hifenac-P', generic_name: 'Aceclofenac + Paracetamol', form: 'Tablet', strength: '100+325 mg', schedule: 'H', gst_rate: 12, default_mrp: 98, pack_size: 10 },
  { name: 'Methotrexate 7.5', generic_name: 'Methotrexate', form: 'Tablet', strength: '7.5 mg', schedule: 'H', gst_rate: 5, default_mrp: 95, pack_size: 4 },
  { name: 'Febuxostat 40', generic_name: 'Febuxostat', form: 'Tablet', strength: '40 mg', schedule: 'H', gst_rate: 12, default_mrp: 165, pack_size: 10 },
  { name: 'Zerodol MR', generic_name: 'Aceclofenac + Paracetamol + Chlorzoxazone', form: 'Tablet', strength: '—', schedule: 'H', gst_rate: 12, default_mrp: 135, pack_size: 10 },
  { name: 'Myoril 4', generic_name: 'Thiocolchicoside', form: 'Capsule', strength: '4 mg', schedule: 'H', gst_rate: 12, default_mrp: 155, pack_size: 10 },
  { name: 'Calcirol Sachet', generic_name: 'Cholecalciferol', form: 'Sachet', strength: '60000 IU', schedule: 'OTC', gst_rate: 12, default_mrp: 32, pack_size: 1 },

  // ── Neuro / psychiatry ───────────────────────────────────────────────
  { name: 'Levipil 500', generic_name: 'Levetiracetam', form: 'Tablet', strength: '500 mg', schedule: 'H', gst_rate: 12, default_mrp: 195, pack_size: 10 },
  { name: 'Eptoin 100', generic_name: 'Phenytoin', form: 'Tablet', strength: '100 mg', schedule: 'H', gst_rate: 12, default_mrp: 55, pack_size: 10 },
  { name: 'Encorate Chrono 500', generic_name: 'Sodium Valproate', form: 'Tablet', strength: '500 mg', schedule: 'H', gst_rate: 12, default_mrp: 185, pack_size: 15 },
  { name: 'Escitalopram 10', generic_name: 'Escitalopram', form: 'Tablet', strength: '10 mg', schedule: 'H', gst_rate: 12, default_mrp: 110, pack_size: 10 },
  { name: 'Sertraline 50', generic_name: 'Sertraline', form: 'Tablet', strength: '50 mg', schedule: 'H', gst_rate: 12, default_mrp: 125, pack_size: 10 },
  { name: 'Clonazepam 0.5', generic_name: 'Clonazepam', form: 'Tablet', strength: '0.5 mg', schedule: 'H1', gst_rate: 12, default_mrp: 42, pack_size: 10 },
  { name: 'Alprazolam 0.25', generic_name: 'Alprazolam', form: 'Tablet', strength: '0.25 mg', schedule: 'H1', gst_rate: 12, default_mrp: 30, pack_size: 15 },
  { name: 'Betahistine 16', generic_name: 'Betahistine', form: 'Tablet', strength: '16 mg', schedule: 'H', gst_rate: 12, default_mrp: 118, pack_size: 10 },
  { name: 'Stemetil 5', generic_name: 'Prochlorperazine', form: 'Tablet', strength: '5 mg', schedule: 'H', gst_rate: 12, default_mrp: 38, pack_size: 10 },

  // ── Dermatology extras ───────────────────────────────────────────────
  { name: 'Fusidic Acid Cream', generic_name: 'Fusidic Acid', form: 'Cream', strength: '2%', schedule: 'H', gst_rate: 12, default_mrp: 135, pack_size: 15 },
  { name: 'Momate Cream', generic_name: 'Mometasone', form: 'Cream', strength: '0.1%', schedule: 'H', gst_rate: 12, default_mrp: 165, pack_size: 15 },
  { name: 'Permethrin 5% Lotion', generic_name: 'Permethrin', form: 'Solution', strength: '5%', schedule: 'H', gst_rate: 12, default_mrp: 115, pack_size: 60 },
  { name: 'Calamine Lotion', generic_name: 'Calamine', form: 'Solution', strength: '100 ml', schedule: 'OTC', gst_rate: 12, default_mrp: 85, pack_size: 100 },
  { name: 'Terbinafine 250', generic_name: 'Terbinafine', form: 'Tablet', strength: '250 mg', schedule: 'H', gst_rate: 12, default_mrp: 145, pack_size: 7 },
  { name: 'Itraconazole 100', generic_name: 'Itraconazole', form: 'Capsule', strength: '100 mg', schedule: 'H', gst_rate: 12, default_mrp: 195, pack_size: 10 },
  { name: 'Luliconazole Cream', generic_name: 'Luliconazole', form: 'Cream', strength: '1%', schedule: 'H', gst_rate: 12, default_mrp: 175, pack_size: 20 },
  { name: 'Zinc Oxide Ointment', generic_name: 'Zinc Oxide', form: 'Ointment', strength: '20%', schedule: 'OTC', gst_rate: 12, default_mrp: 60, pack_size: 20 },

  // ── Consumables / dressings (commonly billed at the counter) ─────────
  { name: 'Cotton Roll 500g', generic_name: 'Absorbent Cotton', form: 'Solution', strength: '500 g', schedule: 'OTC', gst_rate: 12, default_mrp: 185, pack_size: 1 },
  { name: 'Gauze Bandage 4"', generic_name: 'Roller Bandage', form: 'Solution', strength: '4 inch', schedule: 'OTC', gst_rate: 12, default_mrp: 35, pack_size: 1 },
  { name: 'Micropore Tape 1"', generic_name: 'Surgical Tape', form: 'Solution', strength: '1 inch', schedule: 'OTC', gst_rate: 12, default_mrp: 55, pack_size: 1 },
  { name: 'Disposable Syringe 5ml', generic_name: 'Syringe with Needle', form: 'Solution', strength: '5 ml', schedule: 'OTC', gst_rate: 12, default_mrp: 8, pack_size: 1 },
  { name: 'IV Cannula 20G', generic_name: 'IV Cannula', form: 'Solution', strength: '20 G', schedule: 'OTC', gst_rate: 12, default_mrp: 32, pack_size: 1 },
  { name: 'Surgical Gloves (pair)', generic_name: 'Latex Gloves', form: 'Solution', strength: 'Medium', schedule: 'OTC', gst_rate: 12, default_mrp: 18, pack_size: 1 },
  { name: 'Face Mask 3-ply', generic_name: 'Surgical Mask', form: 'Solution', strength: '3-ply', schedule: 'OTC', gst_rate: 12, default_mrp: 5, pack_size: 1 },
  { name: 'Hand Sanitizer 500ml', generic_name: 'Isopropyl Alcohol 70%', form: 'Solution', strength: '500 ml', schedule: 'OTC', gst_rate: 18, default_mrp: 175, pack_size: 500 },
  { name: 'Glucometer Strips (25)', generic_name: 'Blood Glucose Test Strips', form: 'Solution', strength: '25 strips', schedule: 'OTC', gst_rate: 12, default_mrp: 425, pack_size: 25 },
  { name: 'Urine Container', generic_name: 'Sterile Sample Container', form: 'Solution', strength: '60 ml', schedule: 'OTC', gst_rate: 12, default_mrp: 10, pack_size: 1 },
];
