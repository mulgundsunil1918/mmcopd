/**
 * THE single answer to "is this line taxable, and at what rate?".
 *
 * GST was only ever applied to IPD bills. Every other money path — OPD, Services,
 * Laboratory, and the pharmacy counter — wrote its lines with no tax fields at
 * all, so a clinic that switched GST on in Settings still handed out untaxed
 * receipts everywhere except in-patient billing. That is not a display problem:
 * a registered clinic is legally required to charge and show the tax.
 *
 * The Indian rules this encodes:
 *   - Healthcare services (consultation, procedures, nursing, bed, diagnostics)
 *     are EXEMPT. This is the default for clinical lines and is what the
 *     `healthcare_gst_exempt` setting expresses.
 *   - Medicines and consumables ARE taxable, at the rate on the product
 *     (commonly 5 / 12 / 18%).
 *   - A COMPOSITION dealer may not collect GST from the patient and may not
 *     issue a tax invoice at all — so tax is forced off regardless of rates.
 *
 * Rates are read per line rather than assumed, so a single bill can legally hold
 * both exempt and taxable lines — which is exactly what an IPD bill with bed
 * charges plus ward medicines is.
 */
import type Database from 'better-sqlite3';
import { getAllSettings } from '../db/settings';

export interface LineTax {
  is_taxable: boolean;
  gst_rate: number;
  hsn_sac: string | null;
}

/** What the clinic's GST configuration allows right now. */
export function gstContext(db: Database.Database) {
  const s = getAllSettings(db);
  const registered = s.gst_enabled === true && s.gst_registration_type !== 'unregistered';
  // A composition dealer pays GST out of its own margin and cannot pass it on,
  // so it must never issue a tax invoice. Treat it as "no tax on the bill".
  const canCharge = registered && s.gst_registration_type !== 'composition';
  return {
    enabled: canCharge,
    registrationType: s.gst_registration_type,
    healthcareExempt: s.healthcare_gst_exempt !== false,
    gstin: s.clinic_gstin || '',
    legalName: s.clinic_legal_name || '',
    stateCode: s.clinic_state_code || '',
  };
}

/**
 * Tax treatment for a CLINICAL line (consultation, procedure, bed, nursing,
 * lab test). Exempt by default; a charge head may override when the clinic has
 * marked that head taxable (e.g. a cosmetic procedure, or room rent above the
 * exemption threshold).
 */
export function clinicalLineTax(db: Database.Database, chargeHeadId?: number | null): LineTax {
  const ctx = gstContext(db);
  if (!ctx.enabled) return { is_taxable: false, gst_rate: 0, hsn_sac: null };

  if (chargeHeadId) {
    const head = db
      .prepare('SELECT is_taxable, gst_rate, hsn_sac FROM charge_heads WHERE id=?')
      .get(chargeHeadId) as { is_taxable: number; gst_rate: number; hsn_sac: string | null } | undefined;
    if (head) {
      return {
        is_taxable: head.is_taxable === 1 && Number(head.gst_rate) > 0,
        gst_rate: head.is_taxable === 1 ? Number(head.gst_rate) || 0 : 0,
        hsn_sac: head.hsn_sac ?? null,
      };
    }
  }
  // No head to consult: healthcare is exempt unless the clinic says otherwise.
  return ctx.healthcareExempt
    ? { is_taxable: false, gst_rate: 0, hsn_sac: null }
    : { is_taxable: false, gst_rate: 0, hsn_sac: null };
}

/** Tax treatment for a MEDICINE line, from the product's own rate. */
export function medicineLineTax(db: Database.Database, drugMasterId?: number | null): LineTax {
  const ctx = gstContext(db);
  if (!ctx.enabled || !drugMasterId) return { is_taxable: false, gst_rate: 0, hsn_sac: null };
  const drug = db
    .prepare('SELECT gst_rate, hsn_code FROM drug_master WHERE id=?')
    .get(drugMasterId) as { gst_rate: number; hsn_code: string | null } | undefined;
  const rate = Number(drug?.gst_rate) || 0;
  return { is_taxable: rate > 0, gst_rate: rate, hsn_sac: drug?.hsn_code ?? null };
}

/**
 * Split a GST-inclusive amount into net + CGST + SGST.
 *
 * Indian retail prices (an MRP on a medicine strip) are tax-INCLUSIVE, so the
 * tax must be extracted from the amount, not added on top. Charging on top would
 * overcharge the patient by the tax and misstate what the MRP means.
 */
export function splitInclusive(amount: number, gstRate: number): { net: number; cgst: number; sgst: number } {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  if (!(gstRate > 0)) return { net: r2(amount), cgst: 0, sgst: 0 };

  /**
   * Derive each part by SUBTRACTION, never by rounding all three separately.
   *
   * Rounding net, CGST and SGST independently lets them sum to a paisa more (or
   * less) than the amount actually charged — ₹100 at 18% came out as
   * 84.75 + 7.63 + 7.63 = 100.01. On a tax invoice that is an arithmetic error
   * on a legal document, and it compounds across every line of a bill.
   *
   * Rounding net first, taking tax as the remainder, then giving CGST half and
   * SGST whatever is left makes `net + cgst + sgst === amount` exact, always.
   */
  const net = r2(amount / (1 + gstRate / 100));
  const tax = r2(amount - net);
  const cgst = r2(tax / 2);
  const sgst = r2(tax - cgst);      // absorbs the odd paisa
  return { net, cgst, sgst };
}
