/**
 * "Load default vitals" in the consultation: the typical NORMAL readings for the patient's group, to start from while typing.
 *
 * Only temperature, pulse, breathing rate, SpO₂ and blood pressure are ever filled. Weight and height are NEVER filled — they are
 * measured per patient and drive drug doses, so a "typical" value there would be dangerous. The values are mid-range textbook figures
 * (age bands as in the paediatric / adult normal-vital-sign tables), meant to be replaced by what was actually measured.
 */
import type { Vitals } from '../types';

export type VitalsGroup = 'Newborn' | 'Infant' | 'Toddler' | 'Preschool child' | 'School-age child' | 'Adolescent' | 'Adult' | 'Older adult' | 'Pregnancy (ANC)';

export const DEFAULT_VITALS: Record<VitalsGroup, { age: string; vitals: Required<Pick<Vitals, 'temp' | 'pulse' | 'rr' | 'spo2' | 'bp'>> }> = {
  'Newborn':          { age: 'under 1 month', vitals: { temp: '98.6', pulse: '140', rr: '45', spo2: '98', bp: '70/45' } },
  'Infant':           { age: '1–12 months',   vitals: { temp: '98.6', pulse: '120', rr: '40', spo2: '98', bp: '90/55' } },
  'Toddler':          { age: '1–3 years',     vitals: { temp: '98.6', pulse: '110', rr: '28', spo2: '98', bp: '95/58' } },
  'Preschool child':  { age: '3–6 years',     vitals: { temp: '98.6', pulse: '100', rr: '24', spo2: '98', bp: '100/60' } },
  'School-age child': { age: '6–12 years',    vitals: { temp: '98.6', pulse: '90',  rr: '20', spo2: '98', bp: '110/70' } },
  'Adolescent':       { age: '12–18 years',   vitals: { temp: '98.6', pulse: '80',  rr: '16', spo2: '98', bp: '115/75' } },
  'Adult':            { age: '18–65 years',   vitals: { temp: '98.6', pulse: '76',  rr: '16', spo2: '98', bp: '120/80' } },
  'Older adult':      { age: '65 years and over', vitals: { temp: '98.2', pulse: '72', rr: '16', spo2: '96', bp: '130/80' } },
  'Pregnancy (ANC)':  { age: 'antenatal visit', vitals: { temp: '98.6', pulse: '84', rr: '16', spo2: '98', bp: '110/70' } },
};

/**
 * Which group a patient belongs to. The visit's "Patient Group" (set at booking) wins when it names a clinical group —
 * ANC → pregnancy, Geriatric → older adult, Paediatric → by age but never above adolescent; otherwise it is simply the age.
 */
export function vitalsGroupFor(ageInDaysOrNull: number | null, patientGroup?: string | null): VitalsGroup {
  const g = (patientGroup || '').trim().toLowerCase();
  if (g === 'anc' || g.startsWith('antenatal') || g.startsWith('pregnan')) return 'Pregnancy (ANC)';
  if (g.startsWith('geriatric')) return 'Older adult';
  const days = ageInDaysOrNull;
  const years = days == null ? null : days / 365.25;
  let byAge: VitalsGroup;
  if (days == null) byAge = g.startsWith('paediatric') || g.startsWith('pediatric') ? 'School-age child' : 'Adult';
  else if (days < 28) byAge = 'Newborn';
  else if (days < 365) byAge = 'Infant';
  else if ((years as number) < 3) byAge = 'Toddler';
  else if ((years as number) < 6) byAge = 'Preschool child';
  else if ((years as number) < 12) byAge = 'School-age child';
  else if ((years as number) < 18) byAge = 'Adolescent';
  else if ((years as number) < 65) byAge = 'Adult';
  else byAge = 'Older adult';
  if ((g.startsWith('paediatric') || g.startsWith('pediatric')) && (byAge === 'Adult' || byAge === 'Older adult')) return 'Adolescent';
  return byAge;
}

export const DEFAULTED_KEYS = ['temp', 'pulse', 'rr', 'spo2', 'bp'] as const;
export type DefaultedKey = typeof DEFAULTED_KEYS[number];

/** The vitals with the group's defaults added into every EMPTY field among the five — anything already typed is kept exactly. */
export function withDefaultVitals(current: Vitals, group: VitalsGroup): { vitals: Vitals; filled: DefaultedKey[] } {
  const next: Vitals = { ...current };
  const filled: DefaultedKey[] = [];
  for (const k of DEFAULTED_KEYS) {
    if (!String(next[k] ?? '').trim()) { next[k] = DEFAULT_VITALS[group].vitals[k]; filled.push(k); }
  }
  return { vitals: next, filled };
}
