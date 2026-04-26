import { useState } from 'react';
import { X, Sparkles, ExternalLink } from 'lucide-react';

/**
 * Sticky banner shown at the top of every page in the GitHub Pages demo.
 * Tells visitors the data is fake, mutations don't persist, and links
 * back to the source repo.
 */
export function DemoBanner() {
  const [closed, setClosed] = useState(false);
  if (closed) return null;
  return (
    <div
      className="no-print"
      style={{
        position: 'sticky', top: 0, zIndex: 200,
        background: 'linear-gradient(90deg, #4f46e5 0%, #7c3aed 50%, #ec4899 100%)',
        color: '#ffffff',
        padding: '6px 14px',
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      }}
    >
      <Sparkles className="w-4 h-4 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <b>DEMO MODE</b> — read-only showcase. All data is fake (50 patients, 5 doctors, dummy bills + sales).
        Mutations stay in your browser memory; they vanish on reload. Hooks like printing, backups, and updates are stubs.
      </div>
      <a
        href="https://github.com/mulgundsunil1918/mmcopd"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap"
        style={{ background: 'rgba(255,255,255,0.18)', color: '#ffffff', textDecoration: 'none' }}
      >
        <ExternalLink className="w-3 h-3" /> Source on GitHub
      </a>
      <button
        onClick={() => setClosed(true)}
        className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-white/20"
        title="Hide banner"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
