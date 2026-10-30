// Boots the app's real IPC handlers on a temporary database and lets a test call them by channel name,
// exactly as the renderer would through the preload. See electron-stub.ts for why this is safe.
import './electron-stub';
import { userData, stubState } from './electron-stub';
import electron from './electron-stub';
import { installIpcRegistry, ipcHandlers, setReadOnlyMode } from '../../src/main/ipc-registry';
import { getDb, closeDb } from '../../src/db/db';
import { registerIpc } from '../../src/main/ipc';
import { registerIpdBillingIpc } from '../../src/main/ipd-billing-ipc';
import { registerRadiologyIpc } from '../../src/main/radiology-ipc';
import { registerPedsIpc } from '../../src/main/peds-ipc';
import { registerPharmacyFinanceIpc } from '../../src/main/pharmacy-finance-ipc';
import { registerBillingPortalIpc } from '../../src/main/billing-portal-ipc';
import { registerAccountsIpc } from '../../src/main/accounts-ipc';
import { registerLabParamsIpc } from '../../src/main/lab-params-ipc';
import { registerSetupIpc } from '../../src/main/setup-ipc';
import { registerBillCancelIpc } from '../../src/main/bill-cancel';
import { ensureDefaultAdmin } from '../../src/main/auth';

export { userData, stubState, setReadOnlyMode, getDb, closeDb, electron };

let booted = false;
export function boot() {
  if (booted) return;
  booted = true;
  getDb();                    // real startup path: pre-migration snapshot + migrations on userData/caredesk.sqlite
  installIpcRegistry();       // same wrapper the app installs (records handlers + the read-only licence guard)
  registerIpc();
  registerIpdBillingIpc();
  registerRadiologyIpc();
  registerPedsIpc();
  registerPharmacyFinanceIpc();
  registerBillingPortalIpc();
  registerAccountsIpc();
  registerLabParamsIpc();
  registerSetupIpc();
  registerBillCancelIpc();
  try { ensureDefaultAdmin(getDb()); } catch { /* auth is optional for most flows */ }
}

/** Invoke a channel like the renderer does. Throws what the handler throws. */
export async function call<T = any>(channel: string, ...args: any[]): Promise<T> {
  const h = ipcHandlers.get(channel);
  if (!h) throw new Error(`no IPC handler registered for "${channel}"`);
  return await h({ sender: {} }, ...args);
}
/** Like call(), but never throws: { ok:true, value } or { ok:false, error }. */
export async function attempt<T = any>(channel: string, ...args: any[]): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try { return { ok: true, value: await call<T>(channel, ...args) }; }
  catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}
export const channels = () => [...ipcHandlers.keys()].sort();
