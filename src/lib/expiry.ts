/**
 * "No expiry". A syringe, a cannula or a bed sheet may print no expiry date, but a stock batch must have one (the column is NOT NULL and the shelf is sorted by it).
 * Such a batch is stored with ONE far-off stand-in date, and every screen shows it as "No expiry" — it can never be "expired" or "expiring soon".
 */
export const NO_EXPIRY = '2099-12-31';
export const isNoExpiry = (iso: string | Date | null | undefined): boolean => {
  if (!iso) return false;
  let t: string;
  try { t = iso instanceof Date ? iso.toISOString() : String(iso); } catch { return false; }       // an invalid Date is not "no expiry"
  return /^\d{4}/.test(t) && t.slice(0, 4) >= '2099';
};
/** An expiry for display: "No expiry" for the stand-in date, else the date as given by `fmt`. */
export const expiryLabel = (iso: string | null | undefined, fmt: (iso: string) => string = (s) => s): string => (!iso ? '' : isNoExpiry(iso) ? 'No expiry' : fmt(iso));
