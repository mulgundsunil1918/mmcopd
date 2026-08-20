import { useState } from 'react';
import { X, Sparkles } from 'lucide-react';

/**
 * Sticky banner shown at the top of every page in the public showcase build.
 * Makes it unmistakable that this is a fake-data demo, and sets the expectation
 * that the real product is a downloadable Windows installer unlocked with an
 * online-activated licence key. No public link back to the source (repo private).
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
        padding: '13px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
      }}
    >
      <Sparkles style={{ width: 22, height: 22, flexShrink: 0 }} />
      <div className="flex-1 min-w-0" style={{ lineHeight: 1.45 }}>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.01em' }}>
          DEMO MODE — this is a live preview with fake sample data only
        </div>
        <div style={{ fontSize: 13, opacity: 0.95, marginTop: 2 }}>
          Everything here is dummy: 50 sample patients, 5 doctors, made-up bills &amp; sales. Any changes live only in your browser and disappear on reload; printing, backups and updates are simulated.{' '}
          <span style={{ fontWeight: 700 }}>
            The real CureDesk is a Windows software installer we send you, unlocked with a licence key that&apos;s activated online.
          </span>
        </div>
      </div>
      <button
        onClick={() => setClosed(true)}
        className="inline-flex items-center justify-center rounded hover:bg-white/20 flex-shrink-0"
        style={{ width: 28, height: 28 }}
        title="Hide banner"
      >
        <X style={{ width: 16, height: 16 }} />
      </button>
    </div>
  );
}
