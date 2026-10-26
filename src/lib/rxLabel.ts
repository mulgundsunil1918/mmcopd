/**
 * A prescription line names the drug the doctor chose — a brand ("Dolo 650") — and the CHEMICAL name goes in brackets beside it
 * ("Dolo 650 (Paracetamol 650 mg)"), so a patient, a pharmacist at another counter or a colleague reads what is actually in it.
 *
 * The chemical name is a snapshot taken when the prescription is saved (prescription_items.generic_name), so a later edit of the Drug
 * List never rewrites an old prescription. A drug that is already named by its chemical ("Paracetamol 650 mg Tablet"), or one typed in
 * by hand that is not on the Drug List, has no brackets: there is nothing to add.
 */
import { isGenericNamed } from './medicineGroups';

export interface RxDrugLike { name: string; generic_name?: string | null; strength?: string | null; form?: string | null }

/** The text that goes in the brackets for this drug: its ingredient(s) and strength ("Paracetamol 650 mg"), or '' when there is none worth showing. */
export function genericLabelOf(d: RxDrugLike | null | undefined): string {
  if (!d) return '';
  const gen = String(d.generic_name ?? '').trim();
  if (!gen) return '';
  if (isGenericNamed({ name: d.name, generic_name: d.generic_name, strength: d.strength, form: d.form })) return '';     // already named by its chemical
  const strength = String(d.strength ?? '').trim();
  const label = strength && strength !== '—' ? `${gen} ${strength}` : gen;
  return label.toLowerCase() === String(d.name ?? '').trim().toLowerCase() ? '' : label;
}

/** "Dolo 650 (Paracetamol 650 mg)" — or just the name when there is no chemical name to add. */
export const rxLabel = (r: { drug_name: string; generic_name?: string | null }): string =>
  r.generic_name && String(r.generic_name).trim() ? `${r.drug_name} (${String(r.generic_name).trim()})` : r.drug_name;
