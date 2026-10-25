/**
 * Strict reading of a vendor-issued code (a licence key or a password-reset code).
 *
 * A code is base64( JSON { p: <payload text>, s: <base64 Ed25519 signature of p> } ). Node's own base64 reader is very forgiving:
 * it skips characters that are not base64 and stops at the "=" padding, so a code with ANYTHING added after it, or with symbols or
 * spaces dropped into the middle, still decoded to the same signed content and was accepted. A code must be EXACTLY what the keygen
 * produced — nothing added, nothing missing — so it is read here only when it is canonical base64: no stray characters, correct
 * padding, and re-encoding what it decodes to gives back the very same text. Any character added, removed or changed makes it fail,
 * before the signature is even looked at. The decoded envelope must also be exactly what the keygen writes, JSON.stringify({ p, s }), so
 * there is only ONE text per licence. Only whitespace around the whole code is tolerated (the newline a copy often brings).
 */
import crypto from 'node:crypto';

const CANONICAL_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decode canonical base64, or null when the text is anything else. */
export function decodeBase64Strict(text: string): Buffer | null {
  if (typeof text !== 'string' || text.length === 0 || text.length % 4 !== 0 || !CANONICAL_BASE64.test(text)) return null;
  const bytes = Buffer.from(text, 'base64');
  return bytes.toString('base64') === text ? bytes : null;
}

export interface SignedCode { payloadText: string; signature: Buffer }

/** Read the { p, s } envelope of a code exactly as issued; null when the text is not precisely such a code. (The signature is NOT checked here.) */
export function readSignedCodeStrict(raw: string): SignedCode | null {
  const outer = decodeBase64Strict(String(raw ?? '').trim());
  if (!outer) return null;
  let env: any;
  try { env = JSON.parse(outer.toString('utf8')); } catch { return null; }
  if (!env || typeof env.p !== 'string' || typeof env.s !== 'string') return null;
  // The keygen writes the envelope as exactly JSON.stringify({ p, s }). Insisting on that, byte for byte, closes the last loophole:
  // a DIFFERENT base64 text that still decodes to the same signed content followed by blank space (a few last-character edits do).
  if (!Buffer.from(JSON.stringify({ p: env.p, s: env.s }), 'utf8').equals(outer)) return null;
  const signature = decodeBase64Strict(env.s);
  if (!signature || signature.length !== 64) return null;        // an Ed25519 signature is exactly 64 bytes
  return { payloadText: env.p, signature };
}

/** Is `signature` a genuine signature of `payloadText` by the key behind `publicKeyPem`? */
export function signatureIsGenuine(payloadText: string, signature: Buffer, publicKeyPem: string): boolean {
  try { return crypto.verify(null, Buffer.from(payloadText, 'utf8'), publicKeyPem, signature); } catch { return false; }
}
