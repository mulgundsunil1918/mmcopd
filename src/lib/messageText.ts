/**
 * Text that leaves the app as a WhatsApp message must be plain letters, digits and punctuation — NO emoji.
 *
 * Why: on some PCs / browsers an emoji in the pre-filled message arrives as "�" (the replacement character) or breaks other text, and
 * it has come back more than once however the templates were repaired. Rather than chase it per machine, emoji are removed from every
 * message at the single point where the link is built (buildWhatsAppUrl), from the built-in templates, and from any saved copy — so
 * the problem cannot return, whatever a clinic types into a template or an old backup restores.
 *
 * Careful with other scripts: Kannada, Hindi and other Indian-language text (including its zero-width joiners) is left exactly as it is —
 * a joiner is only removed when it is part of an emoji sequence (a "family" or "doctor" emoji is several emoji glued together by joiners).
 */

const PICTO = String.raw`(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})`;
/** One emoji, with everything glued to it: variation selectors, skin tones, keycap mark, tag characters, and further emoji joined by ZWJ. */
const EMOJI_CLUSTER = new RegExp(`${PICTO}(?:[\\uFE00-\\uFE0F\\u{1F3FB}-\\u{1F3FF}\\u20E3\\u{E0020}-\\u{E007F}]|\\u200D${PICTO})*`, 'gu');
/** What can be left over on its own: flag letters, skin tones, variation selectors, keycap / tag marks, and the replacement character. */
const LEFTOVER = /[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}︀-️⃣�]/gu;
/** With the u flag this matches only an UNPAIRED surrogate (half of an emoji whose other half was lost). */
const LONE_SURROGATE = /[\uD800-\uDFFF]/gu;

/** True if the text carries an emoji, a replacement character or a broken half of one. */
export function hasEmojiOrBrokenText(text: string): boolean {
  const s = String(text ?? '');
  return new RegExp(EMOJI_CLUSTER.source, 'u').test(s) || new RegExp(LEFTOVER.source, 'u').test(s) || new RegExp(LONE_SURROGATE.source, 'u').test(s);
}

/** The text with every emoji (and broken character) taken out and the gaps they leave tidied; wording, *bold* marks and line breaks stay. */
export function cleanForWhatsApp(text: string): string {
  return String(text ?? '')
    .replace(EMOJI_CLUSTER, '')
    .replace(LEFTOVER, '')
    .replace(LONE_SURROGATE, '')
    .replace(/[ \t]+/g, ' ')            // runs of spaces left where an emoji was
    .replace(/ *\n */g, '\n')           // no space at the edge of a line
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
