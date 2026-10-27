/**
 * Who is making THIS call — when the call comes from another computer.
 *
 * Until now the main process kept ONE signed-in person (`currentSession` in ipc.ts). That was right for one computer, but on a network every computer's
 * calls arrive at the main computer, and a sign-in on any of them overwrote that one person: the nurse's bills were recorded under whoever signed in last,
 * a cabin user could act with the permissions of the administrator signed in at the main desk, and an administrator at a cabin could be refused because
 * someone else had signed in later. With "everyone signs in with their own login" (more than one computer) that is not acceptable.
 *
 * Now every call a computer sends to the main one carries who is signed in on THAT computer (`session`), and the main computer runs the call "as" that
 * person: `actor()` (the audit trail, "sold by") and `requireRole()` read it from here. A call made on the main computer's own screen has no caller record, so
 * it uses the main computer's own session exactly as before. A computer that does not send `session` at all (an older version of CureDesk) is also left on the
 * old behaviour, so a clinic updated one computer at a time keeps working.
 *
 * The identity is stated by the sending computer, not proven: every computer on the network already holds the clinic's shared secret and can call anything, so
 * this is for accountability and for keeping honest users inside their role — the same trust the network has always had.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SessionUser } from './auth';

interface Caller { session: SessionUser | null }
const store = new AsyncLocalStorage<Caller>();

const ROLES = ['admin', 'manager', 'receptionist', 'doctor', 'nurse', 'ward_incharge', 'lab_tech', 'radiology_tech', 'pharmacist'];

/** Run `fn` as the person signed in on another computer (null = nobody is signed in there). */
export function runForRemoteCaller<T>(session: SessionUser | null, fn: () => T): T {
  return store.run({ session }, fn);
}

/** The caller record of the current call, or undefined when it was made on this computer's own screen. */
export function remoteCaller(): Caller | undefined {
  return store.getStore();
}
export const isRemoteCall = (): boolean => store.getStore() !== undefined;

/**
 * What came over the network as "who is signed in", made safe: only a plain account (a positive id, a user name, one of the known roles) is believed;
 * anything else is "nobody". `undefined` is passed through untouched — it means the sender did not say (an older version).
 */
export function sanitizeWireSession(v: unknown): SessionUser | null | undefined {
  if (v === undefined) return undefined;
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = Number(o.id);
  const username = typeof o.username === 'string' ? o.username.trim().slice(0, 64) : '';
  const role = typeof o.role === 'string' ? o.role : '';
  if (!Number.isInteger(id) || id <= 0 || !username || !ROLES.includes(role)) return null;
  const doctor = o.doctor_id == null ? null : Number(o.doctor_id);
  return {
    id, username, role: role as SessionUser['role'],
    display_name: typeof o.display_name === 'string' ? o.display_name.slice(0, 120) : null,
    doctor_id: doctor !== null && Number.isInteger(doctor) && doctor > 0 ? doctor : null,
  };
}
