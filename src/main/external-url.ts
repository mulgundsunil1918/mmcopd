/**
 * Which addresses the app may hand to the operating system to open (`app:openExternal`). The window never opens a link itself: every click goes through here, so
 * a page, a patient's name or a pasted text can never make the app launch something it should not.
 *
 * Kept as one pure function so a test can hold the list to its rules. Besides the clinic's own sites, WhatsApp, phone, e-mail and maps, two kinds are allowed
 * for the "connect your computers" guide:
 *   - an Amazon.in SEARCH (so people choose a cable or a switch for themselves) — only a search address, never a product page or another site;
 *   - the few pages of Windows Settings the guide has buttons for (network, power, date & time, Windows Security) — exactly these, nothing else.
 */
import { WIN_PAGE_URI } from '../lib/connectGuide';

const PREFIXES = [
  'https://wa.me/',
  'https://api.whatsapp.com/',
  'tel:',
  'mailto:',
  'https://www.google.com/maps',
  'https://maps.google.com/',
  'https://curedesk.co.in/',
  'https://www.curedesk.co.in/',
  'https://mulgundsunil1918.github.io/mmcopd/',
  'https://bridgr.co.in/',
  'https://chatgpt.com/',
];

const AMAZON_SEARCH = 'https://www.amazon.in/s?k=';
const WINDOWS_PAGES: readonly string[] = Object.values(WIN_PAGE_URI);

export function isAllowedExternalUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  if (PREFIXES.some((p) => lower.startsWith(p))) return true;
  // The two newer kinds are held to a stricter rule: no spaces, line breaks or other control characters anywhere in the address.
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return false;
  if (lower.startsWith(AMAZON_SEARCH)) return true;
  return WINDOWS_PAGES.includes(lower);
}
