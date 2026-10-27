// Imported FIRST by the test "main computer" (net-host.ts): it must not announce itself on the real network. The main computer's server sends a UDP broadcast every few
// seconds so other computers can find it; in a test that would show a ghost clinic to any real CureDesk on the same network. A stand-in socket swallows it.
import dgram from 'node:dgram';

const fake: any = { bind: (cb?: () => void) => { if (cb) cb(); return fake; }, setBroadcast: () => undefined, send: () => undefined, close: () => undefined, on: () => fake, once: () => fake, unref: () => fake, address: () => ({ port: 0, address: '0.0.0.0' }) };
(dgram as any).createSocket = () => fake;
