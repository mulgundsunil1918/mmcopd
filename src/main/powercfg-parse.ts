/**
 * Pure parser for `powercfg /query ... STANDBYIDLE` output — no electron, no
 * child_process — so it can be bundled and unit-tested in plain node. host-power
 * (which does pull in electron for the runtime sleep blocker) re-exports this.
 *
 * Getting it wrong in either direction is bad: a false alarm trains staff to
 * ignore warnings, a missed one leaves the clinic exposed. So unreadable output
 * returns known:false ("unknown"), never a reassuring zero.
 */
export function parseStandbyTimeout(out: string): { known: boolean; seconds: number } {
  // Prefer the AC line; powercfg prints AC then DC.
  const m = out.match(/Current AC Power Setting Index:\s*(0x[0-9a-fA-F]+|\d+)/);
  if (!m) return { known: false, seconds: 0 };
  const raw = m[1];
  const seconds = raw.startsWith('0x') ? parseInt(raw, 16) : parseInt(raw, 10);
  if (!Number.isFinite(seconds)) return { known: false, seconds: 0 };
  return { known: true, seconds };
}
