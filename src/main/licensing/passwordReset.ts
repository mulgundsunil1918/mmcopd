/**
 * Support-issued password RESET codes (the "forgot admin password" recovery).
 *
 * A reset code is an Ed25519-signed payload — exactly the same envelope shape as
 * a licence — but with `t: 'pwreset'` instead of licence fields. It is minted by
 * the vendor's keygen tool (which holds the private key), bound to ONE machine's
 * fingerprint, and expires quickly. The app verifies it here with the embedded
 * public key, so:
 *   - only the vendor can produce a working code (private key never ships),
 *   - a code for one clinic's PC can't unlock another's (machine-bound),
 *   - an old code can't be reused forever (short expiry).
 *
 * This is deliberately separate from verifyToken(): a licence token has
 * `expires_at` + `modules` and no `t`, so the two can never be mistaken for each
 * other. On success the caller resets BOTH the admin user's login password and
 * the admin-gate password to a value the clinic chooses on the spot.
 */
import { LICENSE_PUBLIC_KEY_PEM } from './publicKey';
import { machineFingerprint } from './license';
import { readSignedCodeStrict, signatureIsGenuine } from './envelope';

export interface ResetPayload {
  t: 'pwreset';
  hardware_id: string;
  exp: number;   // epoch ms — hard expiry
  n?: string;    // random nonce so two codes for the same PC differ
}

export type ResetCheck =
  | { ok: true; payload: ResetPayload }
  | { ok: false; error: string };

/** Verify a support reset code against THIS machine. Never throws. (`publicKeyPem` is only ever passed by tests.) */
export function verifyResetCode(code: string, publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM): ResetCheck {
  const raw = String(code || '').trim();
  if (!raw) return { ok: false, error: 'Enter the reset code you got from support.' };
  // Exactly the code support issued — nothing added, nothing missing (see envelope.ts).
  const signed = readSignedCodeStrict(raw);
  if (!signed) return { ok: false, error: 'This reset code is not exactly the one support gave you — it has extra, missing or changed characters. Copy all of it again and paste it as it is.' };
  if (!signatureIsGenuine(signed.payloadText, signed.signature, publicKeyPem)) return { ok: false, error: 'This reset code failed the security check (wrong or edited code).' };

  let payload: ResetPayload;
  try { payload = JSON.parse(signed.payloadText) as ResetPayload; }
  catch { return { ok: false, error: 'This reset code is not valid.' }; }

  if (payload.t !== 'pwreset') {
    return { ok: false, error: 'That looks like a licence key, not a password-reset code. Ask support for a reset code.' };
  }
  const thisMachine = machineFingerprint();
  if (payload.hardware_id && payload.hardware_id !== thisMachine) {
    return { ok: false, error: 'This reset code was made for a different computer. Read out THIS computer’s Machine ID to support and ask for a fresh code.' };
  }
  if (!payload.exp || Date.now() > Number(payload.exp)) {
    return { ok: false, error: 'This reset code has expired. Ask support for a new one (they only stay valid a short while for safety).' };
  }
  return { ok: true, payload };
}
