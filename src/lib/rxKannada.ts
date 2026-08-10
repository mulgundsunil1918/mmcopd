/**
 * Kannada helper for printed prescriptions. Doctors type frequency / duration /
 * timing in English shorthand (1-0-1, BD, "15 days", "after food"); this renders
 * the Kannada equivalent to print underneath — so the patient (or their family)
 * understands the schedule even if they don't read English.
 *
 * Deliberately forgiving: anything it can't confidently translate is skipped, so
 * the Kannada line never shows a wrong or garbled instruction.
 */

const TIME_3 = ['ಬೆಳಿಗ್ಗೆ', 'ಮಧ್ಯಾಹ್ನ', 'ರಾತ್ರಿ'];               // morning, afternoon, night
const TIME_4 = ['ಬೆಳಿಗ್ಗೆ', 'ಮಧ್ಯಾಹ್ನ', 'ಸಂಜೆ', 'ರಾತ್ರಿ'];        // morning, afternoon, evening, night

// Word/abbreviation → Kannada, checked after the numeric pattern.
const FREQ_WORDS: [RegExp, string][] = [
  [/\bmorning\b/i, 'ಬೆಳಿಗ್ಗೆ'],
  [/\b(afternoon|noon)\b/i, 'ಮಧ್ಯಾಹ್ನ'],
  [/\bevening\b/i, 'ಸಂಜೆ'],
  [/\b(night|nite)\b/i, 'ರಾತ್ರಿ'],
  [/\b(once daily|once a day|\bOD\b|\bQD\b)\b/i, 'ದಿನಕ್ಕೆ ಒಮ್ಮೆ'],
  [/\b(twice daily|twice a day|\bBD\b|\bBID\b)\b/i, 'ದಿನಕ್ಕೆ ಎರಡು ಬಾರಿ'],
  [/\b(thrice daily|three times|\bTDS\b|\bTID\b)\b/i, 'ದಿನಕ್ಕೆ ಮೂರು ಬಾರಿ'],
  [/\b(four times|\bQID\b|\bQDS\b)\b/i, 'ದಿನಕ್ಕೆ ನಾಲ್ಕು ಬಾರಿ'],
  [/\b(at bedtime|bed ?time|\bHS\b|\bQHS\b)\b/i, 'ಮಲಗುವ ಮುನ್ನ'],
  [/\b(SOS|when required|if needed|PRN)\b/i, 'ಅಗತ್ಯವಿದ್ದಾಗ'],
  [/\b(stat|immediately)\b/i, 'ತಕ್ಷಣ'],
  [/\b(weekly|once a week)\b/i, 'ವಾರಕ್ಕೊಮ್ಮೆ'],
  [/\b(alternate day|every other day|\bEOD\b)\b/i, 'ದಿನ ಬಿಟ್ಟು ದಿನ'],
];

/** "1-0-1" / "1-1-1" / "0-0-1" / "1-0-0-1" → time-of-day words for each dose. */
function fromDosePattern(freq: string): string | null {
  const m = freq.trim().match(/^(\d+(?:\.\d+)?)([\-\/·](\d+(?:\.\d+)?)){1,3}$/);
  if (!m) return null;
  const parts = freq.trim().split(/[\-\/·]/).map((x) => Number(x));
  if (parts.some((n) => Number.isNaN(n))) return null;
  const slots = parts.length === 4 ? TIME_4 : parts.length === 3 ? TIME_3 : null;
  if (!slots) return null;
  const on = parts.map((n, i) => (n > 0 ? slots[i] : null)).filter(Boolean) as string[];
  return on.length ? on.join('-') : null;
}

export function freqKannada(freq?: string | null): string {
  if (!freq) return '';
  const pat = fromDosePattern(freq);
  if (pat) return pat;
  const hits: string[] = [];
  for (const [re, kn] of FREQ_WORDS) if (re.test(freq)) hits.push(kn);
  return hits.join(' · ');
}

export function durationKannada(dur?: string | null): string {
  if (!dur) return '';
  const m = dur.match(/(\d+)\s*(days?|d|weeks?|wks?|w|months?|mon|m|years?|yrs?|y)\b/i);
  if (!m) return '';
  const n = m[1];
  const u = m[2].toLowerCase();
  if (u.startsWith('w')) return `${n} ವಾರ`;
  if (u.startsWith('mon') || u === 'm' || u.startsWith('month')) return `${n} ತಿಂಗಳು`;
  if (u.startsWith('y')) return `${n} ವರ್ಷ`;
  return `${n} ದಿನ`; // days
}

const INSTR_WORDS: [RegExp, string][] = [
  [/\b(before food|before meals?|empty ?stomach|a\.?c\.?)\b/i, 'ಊಟಕ್ಕೆ ಮೊದಲು'],
  [/\b(after food|after meals?|p\.?c\.?)\b/i, 'ಊಟದ ನಂತರ'],
  [/\b(with food|with meals?)\b/i, 'ಊಟದ ಜೊತೆ'],
  [/\bwith (milk|water)\b/i, 'ಹಾಲು/ನೀರಿನೊಂದಿಗೆ'],
  [/\blukewarm water\b/i, 'ಬಿಸಿ ನೀರಿನೊಂದಿಗೆ'],
];

export function instructionsKannada(instr?: string | null): string {
  if (!instr) return '';
  const hits: string[] = [];
  for (const [re, kn] of INSTR_WORDS) if (re.test(instr)) hits.push(kn);
  return hits.join(' · ');
}

/** One combined Kannada line for a prescription row, or '' if nothing translated. */
export function rxKannadaLine(r: { frequency?: string | null; duration?: string | null; instructions?: string | null }): string {
  const parts = [freqKannada(r.frequency), durationKannada(r.duration), instructionsKannada(r.instructions)].filter(Boolean);
  return parts.join(' · ');
}
