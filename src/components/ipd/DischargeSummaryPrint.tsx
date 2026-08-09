import { useQuery } from '@tanstack/react-query';
import { HeartPulse, Printer, X } from 'lucide-react';
import type { Settings } from '../../types';

/**
 * Printable discharge summary on the clinic letterhead — the same header family
 * as the bill and OPD slip. Used two ways:
 *   1. from the discharge screen, to print the real summary for a patient;
 *   2. from the template editor, to PREVIEW how a template will look (with a
 *      sample patient) before saving.
 *
 * Everything the doctor writes flows in as `doc`; this component only lays it out
 * on paper. Uses the shared .print-area / @media print scaffold in index.css.
 */
export interface DischargeSection { label: string; body: string }

export interface DischargeDoc {
  patient?: { name?: string; uhid?: string; dob?: string | null; gender?: string | null; phone?: string | null; address?: string | null };
  admission?: { number?: string; ward?: string | null; bed?: string | null; admittedAt?: string | null; dischargedAt?: string | null };
  outcome?: string | null;
  diagnosis?: string | null;
  condition?: string | null;
  followup?: string | null;
  sections?: DischargeSection[];
  doctorName?: string | null;
  isPreview?: boolean;
}

const OUTCOME_LABEL: Record<string, string> = {
  discharged: 'Discharged (recovered)', lama: 'LAMA (Left Against Medical Advice)',
  dama: 'DAMA (Discharged Against Medical Advice)', referred: 'Referred', death: 'Expired', absconded: 'Absconded',
};

function ageSex(dob?: string | null, gender?: string | null): string {
  const parts: string[] = [];
  if (dob) {
    const b = new Date(dob).getTime();
    if (!Number.isNaN(b)) {
      const months = Math.max(0, Math.floor((Date.now() - b) / (30.44 * 86_400_000)));
      const y = Math.floor(months / 12), m = months % 12;
      parts.push(y > 0 ? `${y}y${m ? ` ${m}m` : ''}` : `${m}m`);
    }
  }
  if (gender) parts.push(gender === 'M' ? 'Male' : gender === 'F' ? 'Female' : gender);
  return parts.join(' · ');
}

function fmt(dt?: string | null): string {
  if (!dt) return '—';
  const t = new Date(dt).getTime();
  return Number.isNaN(t) ? '—' : new Date(dt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Whole-day length of stay, inclusive of the admission day (min 1). */
function lengthOfStay(a?: string | null, b?: string | null): string {
  if (!a) return '—';
  const start = new Date(a).getTime();
  const end = b ? new Date(b).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—';
  const days = Math.max(1, Math.round((end - start) / 86_400_000));
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function DischargeSummaryPrint({ doc, onClose }: { doc: DischargeDoc; onClose: () => void }) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  if (!settings) {
    return <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center"><div className="card p-8">Loading…</div></div>;
  }
  const s = settings as Settings;
  const p = doc.patient || {};
  const a = doc.admission || {};

  // Structured rows (diagnosis / condition / follow-up) shown first, then the
  // doctor's own named sections — skipping anything empty.
  const leadRows: DischargeSection[] = [
    { label: 'Discharge Diagnosis', body: doc.diagnosis || '' },
    { label: 'Condition at Discharge', body: doc.condition || '' },
  ].filter((r) => r.body.trim());
  const sections = (doc.sections || []).filter((sec) => (sec.body || '').trim());
  const tailRows: DischargeSection[] = [
    { label: 'Follow-up / Advice', body: doc.followup || '' },
  ].filter((r) => r.body.trim());
  const allRows = [...leadRows, ...sections, ...tailRows];

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 overflow-auto p-4 no-print-bg">
      <div className="no-print max-w-[210mm] mx-auto flex items-center justify-between gap-2 mb-2">
        {doc.isPreview && <span className="text-white text-[12px] bg-black/40 rounded px-2 py-1">Preview — sample patient details</span>}
        <div className="flex-1" />
        <button className="btn-primary" onClick={() => window.print()}><Printer className="w-4 h-4" /> Print</button>
        <button className="btn-secondary" onClick={onClose}><X className="w-4 h-4" /> Close</button>
      </div>

      <div className="print-area mx-auto bg-white text-slate-900" style={{ width: '210mm', minHeight: '297mm', padding: '12mm 14mm' }}>
        {/* Letterhead — mirrors the bill / OPD slip */}
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
            <div className="text-[11px] text-slate-600">
              {s.clinic_phone && <>☎ {s.clinic_phone} </>}
              {s.clinic_registration_no && <> · Reg. {s.clinic_registration_no}</>}
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="text-center my-3">
          <span className="inline-block px-4 py-1 rounded font-bold tracking-wide" style={{ background: '#eff6ff', color: '#1e3a8a', fontSize: 14 }}>DISCHARGE SUMMARY</span>
        </div>

        {/* Patient + admission block */}
        <div className="flex justify-between gap-6 text-[12px] mb-4 p-3 rounded" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Patient</div>
            <div className="font-bold text-[13px] text-slate-900">{p.name || '—'}</div>
            <div className="text-slate-600">
              {p.uhid ? <>UHID: {p.uhid}</> : null}
              {ageSex(p.dob, p.gender) ? <> · {ageSex(p.dob, p.gender)}</> : null}
            </div>
            {p.phone && <div className="text-slate-600">☎ {p.phone}</div>}
            {p.address && <div className="text-slate-600" style={{ maxWidth: '80mm' }}>{p.address}</div>}
          </div>
          <div className="text-right space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Admission</div>
            {a.number && <div><b>No:</b> {a.number}</div>}
            {(a.ward || a.bed) && <div className="text-slate-600">{a.ward || ''}{a.bed ? ` / ${a.bed}` : ''}</div>}
            <div className="text-slate-600"><b>Admitted:</b> {fmt(a.admittedAt)}</div>
            <div className="text-slate-600"><b>Discharged:</b> {fmt(a.dischargedAt)}</div>
            <div className="text-slate-600"><b>Stay:</b> {lengthOfStay(a.admittedAt, a.dischargedAt)}</div>
            {doc.outcome && <div className="text-slate-600"><b>Outcome:</b> {OUTCOME_LABEL[doc.outcome] || doc.outcome}</div>}
          </div>
        </div>

        {/* Body — each section as a titled block */}
        {allRows.length === 0 ? (
          <div className="text-[12px] text-slate-400 py-6 text-center">No summary content yet.</div>
        ) : (
          <div className="space-y-3">
            {allRows.map((sec, i) => (
              <div key={i}>
                <div className="text-[11px] uppercase tracking-wide font-bold" style={{ color: '#1e3a8a' }}>{sec.label}</div>
                <div className="text-[12px] text-slate-800 whitespace-pre-wrap mt-0.5" style={{ borderLeft: '2px solid #e2e8f0', paddingLeft: 8 }}>{sec.body}</div>
              </div>
            ))}
          </div>
        )}

        {/* Footer + signature */}
        <div className="flex justify-between items-end mt-12 text-[11px]">
          <div className="text-slate-500">
            <div>This is a computer-generated discharge summary.</div>
            <div>Please bring this document on every follow-up visit.</div>
          </div>
          <div className="text-center">
            <div style={{ borderTop: '1px solid #94a3b8', width: '55mm', paddingTop: 4 }}>{doc.doctorName ? `Dr. ${doc.doctorName}` : 'Treating Doctor'}</div>
            <div className="text-slate-600 mt-0.5">For {s.clinic_name || 'the hospital'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
