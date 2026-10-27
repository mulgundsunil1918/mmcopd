/**
 * "Is this the admin password?" on an EXTRA computer.
 *
 * The clinic has ONE admin password and the main computer holds it. An extra computer therefore asks the main computer first; this decides what to do with the
 * answer, in plain functions with the asking passed in, so every case can be tested without a network:
 *
 *   main computer says YES                      → yes, and this computer keeps a copy (so it can still open Settings if the main computer is off later);
 *   main computer says NO, clinic has ONE password → no. That is final: a stale password from before the change no longer opens Settings;
 *   main computer says NO, clinic NOT yet unified  → this computer's OWN old Settings password still opens it. Before the administrator has set the one password
 *                                                  every computer has its own, and the update must not lock anybody out of Settings;
 *   main computer cannot be reached              → this computer's own copy decides (it is what lets someone reach Settings to repair the connection);
 *   main computer is an older version            → it has no "…Ex" question; the plain yes/no question is used and the clinic counts as not unified yet.
 */
export interface HostAnswer { ok: boolean; unified: boolean }

export interface AdminVerifyDeps {
  /** Ask the main computer (the question that also tells whether the clinic has ONE password). Rejects when it cannot be asked. */
  askHostEx: (password: string) => Promise<HostAnswer>;
  /** The plain yes/no question, for a main computer too old to know the one above. */
  askHostOld: (password: string) => Promise<boolean>;
  /** This computer's own check: its copy of the clinic password, or its own old Settings password. */
  askLocal: (password: string) => Promise<boolean>;
  /** Keep the clinic password on this computer after the main computer confirmed it. */
  remember: (password: string, unified: boolean) => void;
}

/** The main computer has no such question (it is an older CureDesk). */
export const isUnknownChannelError = (err: unknown): boolean => /unknown ipc channel/i.test(String((err as any)?.message ?? err ?? ''));

export async function verifyAdminViaHost(d: AdminVerifyDeps, password: string): Promise<boolean> {
  let answer: HostAnswer;
  try {
    answer = await d.askHostEx(password);
  } catch (err) {
    if (!isUnknownChannelError(err)) return d.askLocal(password);              // unreachable (or it errored): this computer's own copy decides
    try { answer = { ok: await d.askHostOld(password), unified: false }; }    // an older main computer: the plain question
    catch { return d.askLocal(password); }
  }
  if (answer.ok) {
    try { d.remember(password, answer.unified); } catch { /* the copy is a convenience; the answer stands */ }
    return true;
  }
  if (answer.unified) return false;
  return d.askLocal(password);
}
