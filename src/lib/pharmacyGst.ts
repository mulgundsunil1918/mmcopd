/**
 * Is GST charged on PHARMACY sales (and claimed back on purchases) right now? — ONE rule for the main process and every screen.
 *
 * The pharmacy has its OWN GST switch (the button on the Pharmacy page, and the box in Settings → Billing), separate from the clinic's
 * "This clinic is GST-registered" switch: a clinic can issue GST bills for medicines while its consultations and wards are not on GST, and the
 * other way round. Until the clinic touches the pharmacy switch (`pharmacy_gst_enabled` is null) it simply follows the clinic switch, so a clinic
 * that updates sees no change. A composition dealer may never collect GST, whichever switch is on.
 */
export interface PharmacyGstSettings {
  pharmacy_gst_enabled?: boolean | null;
  gst_enabled?: boolean | null;
  gst_registration_type?: string | null;
}

export function pharmacyGstOn(s: PharmacyGstSettings | null | undefined): boolean {
  if (!s) return false;
  const own = s.pharmacy_gst_enabled;
  const on = own === null || own === undefined ? s.gst_enabled === true : own === true;
  return on && s.gst_registration_type !== 'composition';
}
