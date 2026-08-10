// Vendor keypair generator — RUN ONCE. Keep the private key OFFLINE and safe.
// The public key is embedded in the app; the private key signs licenses.
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
writeFileSync('license-keys/private.pem', priv, { mode: 0o600 });
writeFileSync('license-keys/public.pem', pub);
console.log('=== PUBLIC KEY (embed in app) ===');
console.log(pub);
console.log('Private key saved to license-keys/private.pem (KEEP SECRET, git-ignored).');
