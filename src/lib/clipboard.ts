/**
 * Robust "copy to clipboard" that works in every context this app runs in.
 *
 * The packaged app loads the renderer over `file://`, which is **not** a secure
 * context, so `navigator.clipboard` is `undefined` there — the reason the
 * Machine ID "Copy" button silently did nothing. We try, in order:
 *   1. Electron's native clipboard via the `app:copyText` IPC bridge (works
 *      over file://),
 *   2. the async Clipboard API (secure contexts — the https web demo),
 *   3. a hidden-textarea `execCommand('copy')` fallback.
 *
 * Returns true if any path succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  const s = String(text ?? '');

  // 1. Electron native clipboard (main process) — the reliable path in the app.
  try {
    const native = (window as any).electronAPI?.app?.copyText;
    if (typeof native === 'function') {
      const r = await native(s);
      if (r && r.ok !== false) return true;
    }
  } catch { /* fall through */ }

  // 2. Async Clipboard API — available in secure contexts (https / localhost).
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch { /* fall through */ }

  // 3. Legacy execCommand fallback via an off-screen textarea.
  try {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { /* give up */ }

  return false;
}
