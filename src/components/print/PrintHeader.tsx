import { HeartPulse } from 'lucide-react';
import type { Settings } from '../../types';

/**
 * THE printed letterhead — one component for every document the clinic hands out
 * (bills, lab / radiology bills & reports, pharmacy receipts, discharge summary,
 * growth chart, the OPD slip). Before this, each print screen carried its own
 * hand-copied header with a fixed 18 mm logo, so there was no way to make the logo
 * bigger and every clinic's paper looked the same regardless of its logo.
 *
 * Two styles, chosen in Settings → Clinic → Letterhead (with a live preview):
 *   - 'logo_text' : the logo beside the clinic name / tagline / address (size adjustable).
 *   - 'banner'    : the uploaded logo IS the whole header, full width. For clinics whose
 *                   logo is a wide letterhead image that already carries the name, so the
 *                   clinic name and tagline are NOT printed again.
 */

export type LogoSize = 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
export const LOGO_SIZES: LogoSize[] = ['sm', 'md', 'lg', 'xl', 'xxl'];
/** Printed logo box, in millimetres. */
export const LOGO_MM: Record<LogoSize, number> = { sm: 16, md: 22, lg: 28, xl: 36, xxl: 46 };
export const LOGO_SIZE_LABEL: Record<LogoSize, string> = {
  sm: 'Small', md: 'Medium', lg: 'Large', xl: 'Extra large', xxl: 'Huge',
};

export interface Letterhead {
  style: 'logo_text' | 'banner';
  logoSize: LogoSize;
  showName: boolean;
  showTagline: boolean;
  /** Address, phone and registration number line. */
  showContact: boolean;
  /** Tallest the banner may print, in mm (it is always full width). */
  bannerMaxMm: number;
}

export const DEFAULT_LETTERHEAD: Letterhead = {
  style: 'logo_text', logoSize: 'lg', showName: true, showTagline: true, showContact: true, bannerMaxMm: 40,
};

/** Normalise whatever the settings hold (missing keys on older data, bad values) into a letterhead. */
export function resolveLetterhead(s: Partial<Settings> | null | undefined): Letterhead {
  const x: any = s || {};
  const size = LOGO_SIZES.includes(x.lh_logo_size) ? (x.lh_logo_size as LogoSize) : DEFAULT_LETTERHEAD.logoSize;
  const max = Number(x.lh_banner_max_mm);
  return {
    style: x.lh_style === 'banner' ? 'banner' : 'logo_text',
    logoSize: size,
    showName: x.lh_show_name !== false,
    showTagline: x.lh_show_tagline !== false,
    showContact: x.lh_show_contact !== false,
    bannerMaxMm: Number.isFinite(max) && max >= 15 ? Math.min(80, max) : DEFAULT_LETTERHEAD.bannerMaxMm,
  };
}

/** A banner can only be used when an image has actually been uploaded. */
export function isBannerActive(s: Partial<Settings> | null | undefined): boolean {
  return resolveLetterhead(s).style === 'banner' && !!(s as any)?.clinic_logo;
}

/** "123 MG Road, City" — the contact lines under the name (or under the banner). */
export function contactLines(s: Partial<Settings>): { address: string; phoneReg: string } {
  const bits: string[] = [];
  if (s.clinic_phone) bits.push(`☎ ${s.clinic_phone}`);
  if (s.clinic_registration_no) bits.push(`Reg. ${s.clinic_registration_no}`);
  return { address: s.clinic_address || '', phoneReg: bits.join(' · ') };
}

export function PrintHeader({
  settings,
  accent = '#1e3a8a',
  legal,
  right,
  nameSize = 22,
  compact = false,
}: {
  settings: Partial<Settings>;
  /** The rule under the header (and the clinic name colour, where the sheet keeps colour). */
  accent?: string;
  /** Legal identifiers a document must carry (GSTIN, drug licence…). Printed on EVERY style —
   *  hiding the contact line must never hide a tax identifier. */
  legal?: React.ReactNode;
  /** Optional block at the far right (e.g. a document number). */
  right?: React.ReactNode;
  nameSize?: number;
  /** For a half-page bill: a smaller logo and name so the header does not eat the sheet. */
  compact?: boolean;
}) {
  const lh = resolveLetterhead(settings);
  const logo = settings.clinic_logo || '';
  const { address, phoneReg } = contactLines(settings);
  const name = settings.clinic_name || 'CureDesk HMS';

  // ---- Wide logo as the entire header ------------------------------------------------
  if (lh.style === 'banner' && logo) {
    return (
      <div className="pb-2" style={{ borderBottom: `2px solid ${accent}` }}>
        <img
          src={logo}
          alt={name}
          style={{ display: 'block', width: '100%', maxHeight: `${lh.bannerMaxMm}mm`, objectFit: 'contain' }}
        />
        {(lh.showContact && (address || phoneReg)) && (
          <div className="text-center text-[11px] text-slate-600 mt-1.5">
            {address}{address && phoneReg ? ' · ' : ''}{phoneReg}
          </div>
        )}
        {legal && <div className="text-center text-[11px] text-slate-600">{legal}</div>}
        {right && <div className="mt-1">{right}</div>}
      </div>
    );
  }

  // ---- Logo beside the clinic details ------------------------------------------------
  const mm = compact ? Math.min(LOGO_MM[lh.logoSize], 20) : LOGO_MM[lh.logoSize];
  const nameFont = compact ? Math.min(nameSize, 18) : nameSize;
  return (
    // Centred on one line: the logo keeps its OWN shape (a wide logo used to be squeezed into a square box and sat lower than
    // the clinic name), and the clinic details sit level with the middle of it.
    <div className={compact ? 'flex items-center gap-3 pb-2' : 'flex items-center gap-4 pb-3'} style={{ borderBottom: `2px solid ${accent}` }}>
      {logo ? (
        <img
          src={logo}
          alt="Logo"
          style={{ maxHeight: `${mm}mm`, maxWidth: `${Math.round(mm * 1.7)}mm`, width: 'auto', height: 'auto', objectFit: 'contain', flexShrink: 0, display: 'block' }}
        />
      ) : (
        <div
          className="rounded-lg flex items-center justify-center text-white flex-shrink-0"
          style={{ width: `${mm}mm`, height: `${mm}mm`, background: 'linear-gradient(135deg,#1d4ed8,#4f46e5)' }}
        >
          <HeartPulse style={{ width: '45%', height: '45%' }} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        {lh.showName && (
          <div className="font-extrabold uppercase" style={{ color: accent, fontSize: nameFont, lineHeight: 1.1 }}>{name}</div>
        )}
        {lh.showTagline && settings.clinic_tagline && (
          <div className="italic" style={{ color: accent, fontSize: 12 }}>{settings.clinic_tagline}</div>
        )}
        {lh.showContact && address && <div className="text-[11px] text-slate-600 mt-1">{address}</div>}
        {lh.showContact && phoneReg && <div className="text-[11px] text-slate-600">{phoneReg}</div>}
        {legal && <div className="text-[11px] text-slate-600">{legal}</div>}
      </div>
      {right}
    </div>
  );
}
