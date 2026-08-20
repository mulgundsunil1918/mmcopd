import { useEffect, useState } from 'react';

/**
 * The live demo mounts the real desktop HMS layout (multi-panel reception,
 * doctor cabin, billing…) which is built for a wide workstation screen and is
 * not mobile-optimised. On a phone it collapses into an unusable mess, so we
 * gate small screens with a "open on desktop" screen. It's not a hard wall —
 * a curious visitor can still tap through — and it disappears the moment the
 * viewport is wide enough (e.g. they rotate a tablet or resize the window).
 *
 * Only used by the public demo (demo-entry) — the marketing landing page is
 * separately mobile-friendly and never sees this.
 */
const MOBILE_MAX = 820; // below this the desktop layout is too cramped to use

function isNarrow(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window.innerWidth;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  // Phones (even in landscape) get gated; a genuinely wide desktop passes.
  return w < MOBILE_MAX || (coarse && w < 1000);
}

export function MobileGate() {
  const [narrow, setNarrow] = useState(isNarrow);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onResize = () => setNarrow(isNarrow());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  if (!narrow || dismissed) return null;

  const href = typeof window !== 'undefined' ? window.location.href : '';

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center p-6 text-center overflow-auto"
      style={{ background: 'linear-gradient(160deg,#0f172a 0%,#1e3a8a 100%)' }}
    >
      <div className="max-w-sm my-auto">
        <div className="text-5xl mb-4" aria-hidden>📱&nbsp;→&nbsp;🖥️</div>
        <h1 className="text-2xl font-extrabold text-white mb-3" style={{ textWrap: 'balance' as any }}>
          Exploring on your phone?
        </h1>
        <p className="text-[13.5px] text-blue-100/90 leading-relaxed mb-5">
          <b className="text-white">CureDesk HMS</b> is a full hospital system built for desktop workstations —
          reception, the doctor’s cabin, the billing counter. This live demo uses a wide, multi-panel layout, so
          for the best experience we recommend opening it on a computer.
        </p>
        <div className="rounded-xl bg-white/10 border border-white/15 p-3.5 text-[12.5px] text-blue-100/90 mb-4 text-left leading-relaxed">
          <div className="font-bold text-white mb-2">👍 For the best experience</div>
          <div className="mb-2.5">
            <span className="font-semibold text-white">✅ Best:</span> open this on a <b className="text-white">laptop or desktop</b>.
          </div>
          <div className="font-semibold text-white mb-1">📱 Staying on your phone? Do these two things:</div>
          <div className="pl-1">
            <div className="mb-1"><b className="text-white">1.</b> Turn on <b className="text-white">Desktop site</b> — open your browser menu (<b className="text-white">⋮</b> on Chrome, <b className="text-white">Aa</b> on Safari) and tick <b className="text-white">“Desktop site”</b>.</div>
            <div><b className="text-white">2.</b> Rotate your phone to <b className="text-white">landscape</b> (turn it sideways).</div>
          </div>
        </div>
        <div className="rounded-xl bg-white/10 border border-white/15 p-3 text-[12px] text-blue-100/90 mb-6 text-left">
          <div className="font-semibold text-white mb-1">📋 Or open on a computer</div>
          Copy this link and open it in a desktop browser:
          <div className="mt-1.5 font-mono text-[11px] break-all text-white/90 bg-black/20 rounded px-2 py-1.5">{href}</div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-[13px] font-semibold text-white/70 underline underline-offset-4 hover:text-white transition-colors"
        >
          Continue on mobile anyway (cramped) →
        </button>
      </div>
    </div>
  );
}
