/**
 * Vendor Ed25519 PUBLIC key — used only to VERIFY license signatures.
 *
 * The matching PRIVATE key never ships with the app; it lives on the vendor's
 * machine (license-keys/, git-ignored) and signs each customer's license. Because
 * verification is asymmetric, a customer holding this public key still cannot
 * forge, extend, or unlock a license — only the private key can sign one.
 */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAFYVrzKRxLBRgx5amHLPvRdpHviXpriXqm/l8avOvf7k=
-----END PUBLIC KEY-----`;
