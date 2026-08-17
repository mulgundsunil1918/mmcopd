/**
 * Prove the heartbeat evicts a client that dropped WITHOUT a close frame — the
 * "1 computer still connected when it clearly isn't" bug — while never evicting
 * a client that is still there.
 *
 * The hard case is simulated by pausing a real client's underlying socket: it
 * stops answering pings but the connection stays open and sends no close, which
 * is exactly what a powered-off / WiFi-dropped cabin looks like to the host.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { trackLiveness, heartbeatSweep } from '../.vite-test/ws-heartbeat.mjs';

const PORT = 47555;
let pass = true;
const check = (name, ok, detail) => {
  if (!ok) pass = false;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Host side: the connected map + the exact liveness wiring network-server uses.
const clients = new Map();
const server = new WebSocketServer({ port: PORT });
server.on('connection', (ws, req) => {
  clients.set(ws, { name: 'cabin', ip: '127.0.0.1', since: Date.now() });
  trackLiveness(ws);
  ws.on('close', () => clients.delete(ws));
});
await new Promise((r) => server.on('listening', r));

const connect = () => new Promise((resolve) => {
  const c = new WebSocket(`ws://127.0.0.1:${PORT}`);
  c.on('open', () => resolve(c));
});

const A = await connect(); // stays responsive
const B = await connect(); // will vanish
await wait(100);
check('both clients registered', clients.size === 2, `${clients.size}`);

// B vanishes: pause its socket so it can't answer pings, but sends no close.
B._socket.pause();

// Sweep 1: marks both not-alive, pings both. A auto-pongs; B (paused) cannot.
heartbeatSweep(server, clients);
await wait(300); // let A's pong return
check('nobody evicted on the first missed beat', clients.size === 2,
  `${clients.size} — a single slow beat must not drop a live client`);

// Sweep 2: A ponged (isAlive true) → kept. B never ponged (isAlive false) → gone.
const evicted = heartbeatSweep(server, clients);
await wait(100);
check('the vanished client is evicted', clients.size === 1, `${clients.size} left`);
check('exactly one eviction', evicted === 1, `${evicted}`);
check('the SURVIVING client is the responsive one (A)',
  [...clients.values()].length === 1 && A.readyState === WebSocket.OPEN);

// And a fully live pair should survive many sweeps untouched.
B.terminate();
await wait(100);
const C = await connect();
await wait(100);
for (let i = 0; i < 4; i++) { heartbeatSweep(server, clients); await wait(250); }
// The map is keyed by SERVER-side sockets, so assert on the count and on the
// client sockets still being OPEN rather than map.has() of the client objects.
check('a responsive client survives repeated sweeps',
  clients.size === 2 && A.readyState === WebSocket.OPEN && C.readyState === WebSocket.OPEN,
  `${clients.size} still connected`);

A.terminate(); C.terminate();
await new Promise((r) => server.close(r));
console.log(pass ? '\nALL PASS' : '\nFAILURES ABOVE');
process.exit(pass ? 0 : 1);
