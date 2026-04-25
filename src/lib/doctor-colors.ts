import type { Doctor } from '../types';

/**
 * Curated palette — distinct colors that are still legible as small dots/pills.
 * Each entry includes a label so receptionists/admins can think in named colors.
 */
export const DOCTOR_COLOR_OPTIONS: { label: string; hex: string }[] = [
  { label: 'Emerald', hex: '#10b981' },
  { label: 'Sky',     hex: '#0ea5e9' },
  { label: 'Violet',  hex: '#8b5cf6' },
  { label: 'Rose',    hex: '#f43f5e' },
  { label: 'Amber',   hex: '#f59e0b' },
  { label: 'Cyan',    hex: '#06b6d4' },
  { label: 'Indigo',  hex: '#6366f1' },
  { label: 'Teal',    hex: '#14b8a6' },
  { label: 'Pink',    hex: '#ec4899' },
  { label: 'Lime',    hex: '#84cc16' },
  { label: 'Orange',  hex: '#f97316' },
  { label: 'Slate',   hex: '#64748b' },
];

/** Same colors, used as fallback when a doctor has no explicit color set. */
const FALLBACK = DOCTOR_COLOR_OPTIONS.map((c) => c.hex);

/** Deterministic — same doctor id always falls back to the same palette slot. */
function fallbackHex(doctorId: number): string {
  if (!Number.isFinite(doctorId) || doctorId < 0) return FALLBACK[0];
  return FALLBACK[doctorId % FALLBACK.length];
}

/** Returns the hex color for a doctor — explicit setting wins, else deterministic fallback. */
export function colorForDoctor(d: Pick<Doctor, 'id' | 'color'> | undefined | null): string {
  if (!d) return FALLBACK[0];
  const c = d.color?.trim();
  if (c && /^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return fallbackHex(d.id);
}

/** Convenience CSS bundle for a doctor — lets you spread it onto a single element. */
export function doctorAccent(d: Pick<Doctor, 'id' | 'color'> | undefined | null) {
  const hex = colorForDoctor(d);
  return {
    hex,
    dot: { backgroundColor: hex } as React.CSSProperties,
    soft: { backgroundColor: hex + '22', color: hex, borderColor: hex + '55' } as React.CSSProperties,
    border: { borderColor: hex } as React.CSSProperties,
    leftBar: { borderLeftColor: hex, borderLeftWidth: 4, borderLeftStyle: 'solid' } as React.CSSProperties,
  };
}
