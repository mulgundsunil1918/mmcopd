import { useQuery } from '@tanstack/react-query';
import { HeartPulse, Printer, X } from 'lucide-react';
import type { Settings } from '../../types';

/**
 * Print a growth chart (WHO or IAP) on the clinic letterhead — same header family
 * as the OPD slip and bill. The chart SVG is passed in as children so we reuse the
 * exact on-screen chart; this component only wraps it in printable stationery.
 */
export function GrowthChartPrint({ patient, subtitle, children, onClose }: {
  patient: { name?: string; uhid?: string; dob?: string | null; gender?: string | null };
  subtitle: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  if (!settings) return <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center"><div className="card p-8">Loading…</div></div>;
  const s = settings as Settings;

  const ageSex = (() => {
    const parts: string[] = [];
    if (patient.dob) {
      const b = new Date(patient.dob).getTime();
      if (!Number.isNaN(b)) {
        const months = Math.max(0, Math.floor((Date.now() - b) / (30.44 * 86_400_000)));
        const y = Math.floor(months / 12), m = months % 12;
        parts.push(y > 0 ? `${y}y${m ? ` ${m}m` : ''}` : `${m}m`);
      }
    }
    if (patient.gender) parts.push(patient.gender === 'M' ? 'Male' : patient.gender === 'F' ? 'Female' : patient.gender);
    return parts.join(' · ');
  })();

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 overflow-auto p-4 no-print-bg">
      <div className="no-print max-w-[210mm] mx-auto flex justify-end gap-2 mb-2">
        <button className="btn-primary" onClick={() => window.print()}><Printer className="w-4 h-4" /> Print</button>
        <button className="btn-secondary" onClick={onClose}><X className="w-4 h-4" /> Close</button>
      </div>

      <div className="print-area mx-auto bg-white text-slate-900" style={{ width: '210mm', minHeight: '297mm', padding: '12mm 14mm' }}>
        <div className="flex items-start gap-4 pb-3" style={{ borderBottom: '2px solid #1e3a8a' }}>
          {s.clinic_logo ? (
            <img src={s.clinic_logo} alt="Logo" style={{ width: '18mm', height: '18mm', objectFit: 'contain', border: '1px solid #e2e8f0', borderRadius: 8 }} />
          ) : (
            <div className="rounded-lg flex items-center justify-center text-white" style={{ width: '18mm', height: '18mm', background: 'linear-gradient(135deg,#1d4ed8,#4f46e5)' }}>
              <HeartPulse className="w-8 h-8" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-extrabold uppercase" style={{ color: '#1e3a8a', fontSize: 22, lineHeight: 1.1 }}>{s.clinic_name || 'CureDesk HMS'}</div>
            {s.clinic_tagline && <div className="italic" style={{ color: '#1e40af', fontSize: 12 }}>{s.clinic_tagline}</div>}
            <div className="text-[11px] text-slate-600 mt-1">{s.clinic_address}</div>
            <div className="text-[11px] text-slate-600">{s.clinic_phone && <>☎ {s.clinic_phone}</>}{s.clinic_registration_no && <> · Reg. {s.clinic_registration_no}</>}</div>
          </div>
        </div>

        <div className="text-center my-3">
          <span className="inline-block px-4 py-1 rounded font-bold tracking-wide" style={{ background: '#eff6ff', color: '#1e3a8a', fontSize: 14 }}>GROWTH CHART</span>
        </div>

        <div className="flex justify-between gap-6 text-[12px] mb-3 p-3 rounded" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Patient</div>
            <div className="font-bold text-[13px] text-slate-900">{patient.name || '—'}</div>
            <div className="text-slate-600">{patient.uhid ? <>UHID: {patient.uhid}</> : null}{ageSex ? <> · {ageSex}</> : null}</div>
          </div>
          <div className="text-right space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Chart</div>
            <div className="text-slate-700 font-medium">{subtitle}</div>
            <div className="text-slate-600">{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
          </div>
        </div>

        {/* The chart itself */}
        <div className="growth-print-chart">{children}</div>

        <div className="flex justify-between items-end mt-10 text-[11px]">
          <div className="text-slate-500">Computer-generated growth chart.</div>
          <div className="text-center">
            <div style={{ borderTop: '1px solid #94a3b8', width: '55mm', paddingTop: 4 }}>Paediatrician</div>
            <div className="text-slate-600 mt-0.5">For {s.clinic_name || 'the clinic'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
