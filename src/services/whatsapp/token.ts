/**
 * Obfuscation for the stored WhatsApp access token.
 *
 * Deliberately NOT encryption — it only keeps the token out of plaintext in the
 * SQLite file. The database itself is protected by OS file permissions.
 *
 * This lives in its own module because it has to be used from two places that
 * cannot import each other: the IPC layer that stores the token, and the queue
 * worker that spends it. The worker previously had no access to `reveal`, so it
 * sent the RAW obfuscated blob to Meta as the bearer token — every queued and
 * scheduled message failed authentication, silently. Messages typed by hand went
 * through the IPC path and worked, which is why the gap went unnoticed.
 */
const KEY = 'CureDesk-WA-v1';

export function obscure(token: string): string {
  return Buffer.from(
    token.split('').map((c, i) => c.charCodeAt(0) ^ KEY.charCodeAt(i % KEY.length)).join(',')
  ).toString('base64');
}

export function reveal(enc: string): string {
  return Buffer.from(enc, 'base64')
    .toString()
    .split(',')
    .map((n, i) => String.fromCharCode(parseInt(n) ^ KEY.charCodeAt(i % KEY.length)))
    .join('');
}
