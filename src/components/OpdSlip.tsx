import { format, parseISO } from 'date-fns';
import { Printer, X, MapPin, Phone, Mail, HeartPulse } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ageStringFull, fmt12h, fmtDateTime } from '../lib/utils';
import type { AppointmentWithJoins, Consultation, Doctor, FollowupSummary, LabOrder, PrescriptionItem, Settings, SlipTemplate, SlipTemplateSection, Vitals } from '../types';

const RESERVED_KEYS = new Set(['history', 'examination', 'impression', 'advice']);

/** Read a section's value from the consultation — well-known fields from columns,
 *  everything else from extra_fields. Undefined / empty returns ''. */
function readSection(consultation: Consultation | null, key: string): string {
  if (!consultation) return '';
  if (key === 'history') return consultation.history || '';
  if (key === 'examination') return consultation.examination || '';
  if (key === 'impression') return consultation.impression || '';
  if (key === 'advice') return consultation.advice || '';
  return (consultation.extra_fields || {})[key] || '';
}

/** Format a single-line / date / number / dropdown value for the print sheet. */
function formatValue(s: SlipTemplateSection, raw: string): string {
  if (!raw) return '';
  if (s.type === 'date') {
    try { return format(parseISO(raw), 'do MMMM yyyy'); } catch { return raw; }
  }
  return raw;
}

/** Split a template's sections at the 'impression' boundary so Page 1 holds the
 *  intake/exam fields and Page 2 holds the diagnostic + advice / Rx fields.
 *  Falls back to a midpoint split for templates that omit impression entirely. */
function splitSections(sections: SlipTemplateSection[]): [SlipTemplateSection[], SlipTemplateSection[]] {
  let idx = sections.findIndex((s) => s.key === 'impression');
  if (idx === -1) idx = sections.findIndex((s) => s.key === 'advice');
  if (idx === -1) idx = Math.max(1, Math.floor(sections.length / 2));
  return [sections.slice(0, idx), sections.slice(idx)];
}

export function OpdSlip({
  appointment,
  consultation,
  doctor,
  settings,
  rxItems = [],
  labOrders = [],
  onClose,
}: {
  appointment: AppointmentWithJoins;
  consultation: Consultation | null;
  doctor: Doctor;
  settings: Settings;
  rxItems?: PrescriptionItem[];
  labOrders?: LabOrder[];
  onClose: () => void;
}) {
  const v = consultation?.vitals ?? {};

  // Pull the follow-up summary so the FOLLOW-UP / ಮರು ಭೇಟಿ box on Page 2 can show
  // exactly how many free visits remain and till what date.
  const [followup, setFollowup] = useState<FollowupSummary | null>(null);
  useEffect(() => {
    if (!settings.followup_enabled) return;
    let cancelled = false;
    window.electronAPI.followup.summaryForAppointment(appointment.id).then((s) => {
      if (!cancelled) setFollowup(s);
    });
    return () => { cancelled = true; };
  }, [appointment.id, settings.followup_enabled]);

  // Pull the doctor's body template (drives Page 1 + Page 2 dynamic sections).
  // Use react-query so it's invalidatable from the preview launcher's "Preview"
  // button — direct calls cached at component-level were going stale right after
  // the user edited a template and clicked Preview again.
  const { data: templates = [] } = useQuery({
    queryKey: ['slip-templates'],
    queryFn: () => window.electronAPI.templates.list().catch(() => [] as SlipTemplate[]),
    refetchOnMount: 'always',
  });
  // Fallback template — used when the IPC returns nothing (old binary, missing
  // setting row, transient error). Guarantees the slip body always renders the
  // classic 4-section layout instead of going blank.
  const FALLBACK_TEMPLATE: SlipTemplate = useMemo(() => ({
    id: 0,
    name: 'General (fallback)',
    sections: [
      { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 55, printed: true },
      { key: 'examination', title: 'Examination', type: 'textarea', height_mm: 60, printed: true },
      { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 22, printed: true },
      { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 60, printed: true },
    ],
  }), []);
  const template = useMemo<SlipTemplate>(() => {
    if (templates.length === 0) return FALLBACK_TEMPLATE;
    return templates.find((t) => t.id === doctor.template_id) || templates[0] || FALLBACK_TEMPLATE;
  }, [templates, doctor.template_id, FALLBACK_TEMPLATE]);
  const [pageOneSections, pageTwoSections] = useMemo(() => {
    const printable = template.sections.filter((s) => s.printed !== false);
    if (printable.length === 0) return splitSections(FALLBACK_TEMPLATE.sections);
    return splitSections(printable);
  }, [template, FALLBACK_TEMPLATE]);

  return (
    <div className="fixed inset-0 z-[100] overflow-auto print-overlay" style={{ backgroundColor: '#94a3b8' }}>
      <div className="no-print sticky top-3 z-10 flex justify-center pointer-events-none">
        <div className="px-4 py-1.5 rounded-full text-xs font-semibold text-white shadow-lg" style={{ backgroundColor: '#1e293b' }}>
          OPD Slip preview · Token #{appointment.token_number} · 2 pages
        </div>
      </div>

      <div className="p-6 pb-28 flex flex-col items-center gap-4">
        <Page>
          <PageOne appointment={appointment} consultation={consultation} doctor={doctor} settings={settings} vitals={v} sections={pageOneSections} />
          <PageFooter pageNum={1} totalPages={2} clinicName={settings.clinic_name} />
        </Page>
        <Page>
          <PageTwo appointment={appointment} consultation={consultation} doctor={doctor} settings={settings} rxItems={rxItems} labOrders={labOrders} followup={followup} sections={pageTwoSections} />
          <PageFooter pageNum={2} totalPages={2} clinicName={settings.clinic_name} />
        </Page>
      </div>

      <div
        className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-3 px-5 py-3 rounded-2xl shadow-2xl"
        style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
      >
        <button
          onClick={onClose}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold"
          style={{ backgroundColor: '#e2e8f0', color: '#0f172a' }}
        >
          <X className="w-4 h-4" /> Close
        </button>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, #2563eb, #4f46e5)' }}
        >
          <Printer className="w-4 h-4" /> Print Both Pages
        </button>
      </div>
    </div>
  );
}

/** A single A4 page sized container. Print CSS forces a sheet break between pages. */
function Page({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="print-area print-page bg-white shadow-2xl"
      style={{
        width: '210mm',
        height: '297mm',
        padding: '14mm 14mm 12mm',
        backgroundColor: '#ffffff',
        color: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </div>
  );
}

function Letterhead({
  appointment,
  doctor,
  settings,
  compact = false,
}: {
  appointment: AppointmentWithJoins;
  doctor: Doctor;
  settings: Settings;
  compact?: boolean;
}) {
  const slipDate = (() => {
    try {
      const d = parseISO(`${appointment.appointment_date}T${appointment.appointment_time}:00`);
      return format(d, "do MMMM yyyy '·' hh:mm a");
    } catch {
      return `${appointment.appointment_date} · ${fmt12h(appointment.appointment_time)}`;
    }
  })();

  const visitId = `${appointment.patient_uhid}/V${appointment.id}`;

  if (compact) {
    return (
      <div style={{ borderTop: '3px solid #1d4ed8', borderBottom: '1px solid #cbd5e1' }} className="pb-2 mb-3 pt-2 flex items-center justify-between" >
        <div className="flex items-center gap-2">
          {settings.clinic_logo ? (
            <img src={settings.clinic_logo} alt="Logo" className="w-8 h-8 object-contain rounded" style={{ background: '#ffffff' }} />
          ) : (
            <div className="w-8 h-8 rounded flex items-center justify-center text-white" style={{ background: '#1d4ed8' }}>
              <HeartPulse className="w-5 h-5" />
            </div>
          )}
          <div>
            <div className="text-base font-extrabold tracking-tight" style={{ color: '#1e3a8a' }}>{settings.clinic_name || 'Mulgund Multispeciality Clinic'}</div>
            <div className="text-[13px]" style={{ color: '#64748b' }}>Continued — Page 2 of 2</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-bold" style={{ color: '#0f172a' }}>{appointment.patient_name}</div>
          <div className="text-[13px]" style={{ color: '#475569' }}>UHID: {appointment.patient_uhid} · Visit ID: {visitId}</div>
          <div className="text-[13px]" style={{ color: '#475569' }}>Token #{appointment.token_number} · {slipDate}</div>
        </div>
      </div>
    );
  }

  // Split appointment date/time for cleaner two-line display in the visit card.
  const [apptDateLine, apptTimeLine] = (() => {
    try {
      const d = parseISO(`${appointment.appointment_date}T${appointment.appointment_time}:00`);
      return [format(d, 'do MMMM yyyy'), format(d, 'hh:mm a')];
    } catch {
      return [appointment.appointment_date, fmt12h(appointment.appointment_time)];
    }
  })();

  return (
    <div className="mb-3" style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid #cbd5e1' }}>
      {/* === Thin accent stripe (the brand line on top) === */}
      <div style={{ height: 5, background: 'linear-gradient(90deg, #1d4ed8 0%, #4f46e5 50%, #1d4ed8 100%)' }} />

      {/* === Hero band: logo | identity | visit card === */}
      <div
        className="px-3 py-3"
        style={{ background: 'linear-gradient(180deg, #f0f7ff 0%, #ffffff 70%)' }}
      >
        <div className="flex items-center justify-between gap-4">
          {/* === LOGO (large, in a soft white tile) === */}
          <div className="flex-shrink-0">
            {settings.clinic_logo ? (
              <div
                className="rounded-lg flex items-center justify-center"
                style={{
                  width: '28mm',
                  height: '28mm',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 1px 2px rgba(15,23,42,0.05)',
                }}
              >
                <img
                  src={settings.clinic_logo}
                  alt="Clinic logo"
                  className="object-contain"
                  style={{ maxWidth: '24mm', maxHeight: '24mm' }}
                />
              </div>
            ) : (
              <div
                className="rounded-lg flex items-center justify-center text-white shadow"
                style={{
                  width: '28mm',
                  height: '28mm',
                  background: 'linear-gradient(135deg, #1d4ed8 0%, #4f46e5 100%)',
                }}
              >
                <HeartPulse className="w-14 h-14" />
              </div>
            )}
          </div>

          {/* === IDENTITY (clinic name, tagline, reg) — gets the big middle space === */}
          <div className="min-w-0 flex-1">
            <div
              className="font-extrabold tracking-tight uppercase"
              style={{ color: '#1e3a8a', fontSize: '24px', lineHeight: 1.1, letterSpacing: '0.5px' }}
            >
              {settings.clinic_name || 'Mulgund Multispeciality Clinic'}
            </div>
            {settings.clinic_tagline && (
              <div
                className="italic mt-1 inline-block"
                style={{
                  color: '#1e40af',
                  fontSize: '13px',
                  borderTop: '1px solid #bfdbfe',
                  borderBottom: '1px solid #bfdbfe',
                  padding: '1px 8px',
                  letterSpacing: '0.4px',
                }}
              >
                {settings.clinic_tagline}
              </div>
            )}
            {settings.clinic_registration_no && (
              <div
                className="text-[11px] uppercase tracking-wider mt-1.5 font-semibold"
                style={{ color: '#475569' }}
              >
                Reg. No. {settings.clinic_registration_no}
              </div>
            )}
          </div>

          {/* === VISIT CARD (Token, Room, Date, Time) === */}
          <div
            className="flex-shrink-0 rounded-md overflow-hidden text-center"
            style={{
              border: '1.5px solid #1d4ed8',
              minWidth: '60mm',
              boxShadow: '0 1px 3px rgba(29,78,216,0.15)',
            }}
          >
            <div
              className="px-3 py-0.5 text-[11px] uppercase tracking-widest font-bold text-white"
              style={{ background: '#1d4ed8' }}
            >
              OPD Slip
            </div>
            <div className="px-2 py-2 flex items-stretch justify-around gap-2" style={{ background: '#ffffff' }}>
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#64748b' }}>Token</div>
                <div className="text-3xl font-extrabold leading-none mt-0.5" style={{ color: '#0f172a' }}>
                  #{appointment.token_number}
                </div>
              </div>
              {doctor.room_number && (
                <>
                  <div style={{ borderLeft: '1px solid #e2e8f0' }} />
                  <div className="flex-1">
                    <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#64748b' }}>Room</div>
                    <div className="text-3xl font-extrabold leading-none mt-0.5" style={{ color: '#1e3a8a' }}>
                      {doctor.room_number}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div
              className="px-2 py-1 flex items-center justify-around gap-2 border-t"
              style={{ background: '#eff6ff', borderTopColor: '#bfdbfe' }}
            >
              <div className="flex-1">
                <div className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: '#64748b' }}>Date</div>
                <div className="text-[12px] font-bold" style={{ color: '#1e3a8a' }}>{apptDateLine}</div>
              </div>
              <div style={{ borderLeft: '1px solid #bfdbfe', height: 22 }} />
              <div className="flex-1">
                <div className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: '#64748b' }}>Time</div>
                <div className="text-[12px] font-bold" style={{ color: '#1e3a8a' }}>{apptTimeLine}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* === Contact bar — full width, subtle background === */}
      <div
        className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12px]"
        style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0', color: '#334155' }}
      >
        {settings.clinic_address && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" style={{ color: '#1d4ed8' }} />
            <span>{settings.clinic_address}</span>
          </span>
        )}
        <span className="inline-flex items-center gap-x-3 gap-y-0 flex-wrap">
          {settings.clinic_phone && (
            <span className="inline-flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" style={{ color: '#1d4ed8' }} />
              <span>{settings.clinic_phone}</span>
            </span>
          )}
          {settings.clinic_email && (
            <span className="inline-flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" style={{ color: '#1d4ed8' }} />
              <span>{settings.clinic_email}</span>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function PageOne({
  appointment, consultation, doctor, settings, vitals, sections,
}: {
  appointment: AppointmentWithJoins;
  consultation: Consultation | null;
  doctor: Doctor;
  settings: Settings;
  vitals: Vitals;
  sections: SlipTemplateSection[];
}) {
  const regDate = appointment.patient_created_at
    ? (() => { try { return fmtDateTime(appointment.patient_created_at); } catch { return appointment.patient_created_at; } })()
    : null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', fontSize: '13px', lineHeight: 1.35 }}>
      <Letterhead appointment={appointment} doctor={doctor} settings={settings} />

      {/* Doctor + Patient blocks */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border border-gray-300 rounded p-2">
          <div className="text-[13px] uppercase tracking-wider font-semibold" style={{ color: '#64748b' }}>Consulting Doctor</div>
          <div className="text-base font-bold mt-0.5" style={{ color: '#0f172a' }}>{doctor.name}</div>
          {doctor.qualifications && <div className="text-[12px] font-medium" style={{ color: '#1e40af' }}>{doctor.qualifications}</div>}
          <div className="text-[12px]" style={{ color: '#475569' }}>{doctor.specialty}{doctor.room_number ? ` · Room ${doctor.room_number}` : ''}</div>
          {doctor.registration_no && <div className="text-[13px]" style={{ color: '#64748b' }}>Reg: {doctor.registration_no}</div>}
        </div>
        <div className="border border-gray-300 rounded p-2">
          <div className="text-[13px] uppercase tracking-wider font-semibold" style={{ color: '#64748b' }}>Patient</div>
          <div className="flex flex-wrap gap-x-4 mt-0.5">
            <div className="text-base font-bold" style={{ color: '#0f172a' }}>{appointment.patient_name}</div>
          </div>
          <div className="flex flex-wrap gap-x-4 text-[12px]" style={{ color: '#374151' }}>
            <span><b>UHID:</b> {appointment.patient_uhid}</span>
            <span><b>Age:</b> {ageStringFull(appointment.patient_dob)}</span>
            <span><b>Sex:</b> {appointment.patient_gender}</span>
            <span><b>Ph:</b> {appointment.patient_phone}</span>
            {appointment.patient_blood_group && <span><b>BG:</b> {appointment.patient_blood_group}</span>}
          </div>
          {regDate && <div className="text-[13px] mt-0.5" style={{ color: '#64748b' }}>Registered: {regDate}</div>}
        </div>
      </div>

      {/* Vitals strip — order: Temp, Pulse, RR, SpO2, BP, Weight, Height */}
      <Section title="Vitals">
        <div className="grid grid-cols-7 gap-2 mt-1 text-center">
          <Vital label="Temp (°F)" value={vitals.temp} />
          <Vital label="Pulse" value={vitals.pulse} />
          <Vital label="RR" value={vitals.rr} />
          <Vital label="SpO₂ (%)" value={vitals.spo2} />
          <Vital label="BP (mmHg)" value={vitals.bp} />
          <Vital label="Weight (kg)" value={vitals.weight} />
          <Vital label="Height (cm)" value={vitals.height} />
        </div>
      </Section>

      {/* Template-driven body sections — Page 1 holds intake / examination fields. */}
      <DynamicSections sections={sections} consultation={consultation} growLast />
    </div>
  );
}

/** Render template sections sequentially. Textarea sections become BlankAreas
 *  with the configured min-height; everything else prints inline next to the title. */
function DynamicSections({
  sections, consultation, growLast = false,
}: {
  sections: SlipTemplateSection[];
  consultation: Consultation | null;
  /** When true, the LAST textarea section absorbs remaining vertical space. */
  growLast?: boolean;
}) {
  if (sections.length === 0) return null;
  // Find the last textarea so we can let it grow (fills the rest of the sheet).
  let lastTextareaIdx = -1;
  if (growLast) {
    for (let i = sections.length - 1; i >= 0; i--) {
      if (sections[i].type === 'textarea') { lastTextareaIdx = i; break; }
    }
  }
  return (
    <>
      {sections.map((s, i) => {
        const raw = readSection(consultation, s.key);
        const isGrow = i === lastTextareaIdx;
        if (s.type === 'textarea') {
          return (
            <Section key={s.key} title={s.title} grow={isGrow}>
              <BlankArea value={raw} minHeight={`${s.height_mm ?? 22}mm`} grow={isGrow} />
            </Section>
          );
        }
        // Inline single-line / date / number / dropdown — small label + value strip.
        return (
          <div key={s.key} className="mt-3 flex items-baseline gap-2 pb-1" style={{ borderBottom: '1px solid #e2e8f0' }}>
            <span className="text-[12px] uppercase tracking-wider font-bold whitespace-nowrap" style={{ color: '#1e40af' }}>{s.title}:</span>
            <span className="text-[13px] flex-1" style={{ color: '#0f172a' }}>{formatValue(s, raw) || ' '}</span>
          </div>
        );
      })}
    </>
  );
}

function PageTwo({
  appointment, consultation, doctor, settings, rxItems, labOrders, followup, sections,
}: {
  appointment: AppointmentWithJoins;
  consultation: Consultation | null;
  doctor: Doctor;
  settings: Settings;
  rxItems: PrescriptionItem[];
  labOrders: LabOrder[];
  followup: FollowupSummary | null;
  sections: SlipTemplateSection[];
}) {
  // Pull "advice" out of the dynamic flow so we can interleave the Rx table
  // before/inside it. Everything else (impression, custom fields like ECG findings,
  // heart sounds, etc.) renders sequentially via DynamicSections.
  const adviceIdx = sections.findIndex((s) => s.key === 'advice');
  const beforeAdvice = adviceIdx === -1 ? sections : sections.slice(0, adviceIdx);
  const adviceSection = adviceIdx === -1 ? null : sections[adviceIdx];
  const afterAdvice = adviceIdx === -1 ? [] : sections.slice(adviceIdx + 1);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', fontSize: '13px', lineHeight: 1.35 }}>
      <Letterhead appointment={appointment} doctor={doctor} settings={settings} compact />

      {/* Pre-advice template sections (impression + any custom fields). */}
      <DynamicSections sections={beforeAdvice} consultation={consultation} />

      {/* Investigations (if any) */}
      {labOrders.length > 0 && (
        <Section title="Investigations Ordered">
          <ul style={{ marginLeft: 14, listStyle: 'disc' }} className="text-[12px]">
            {labOrders.map((o) => (
              <li key={o.id}>
                <span className="font-mono" style={{ color: '#1e40af' }}>{o.order_number}</span> ({o.status.replace('_', ' ')})
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Advice / Prescription — Rx table comes first, then template advice text. */}
      <Section title={adviceSection?.title || 'Advice / Prescription (Rx)'} grow>
        {rxItems.length > 0 && (
          <table className="w-full text-[12px] mb-2" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #cbd5e1' }}>
                <th style={{ textAlign: 'left', padding: '2px 4px' }}>Drug</th>
                <th style={{ textAlign: 'left', padding: '2px 4px', width: 60 }}>Dose</th>
                <th style={{ textAlign: 'left', padding: '2px 4px', width: 70 }}>Frequency</th>
                <th style={{ textAlign: 'left', padding: '2px 4px', width: 70 }}>Duration</th>
                <th style={{ textAlign: 'left', padding: '2px 4px' }}>Instructions</th>
              </tr>
            </thead>
            <tbody>
              {rxItems.map((r, idx) => (
                <tr key={idx} style={{ borderBottom: '1px dotted #e2e8f0' }}>
                  <td style={{ padding: '3px 4px', fontWeight: 600 }}>{r.drug_name}</td>
                  <td style={{ padding: '3px 4px' }}>{r.dosage || ''}</td>
                  <td style={{ padding: '3px 4px' }}>{r.frequency || ''}</td>
                  <td style={{ padding: '3px 4px' }}>{r.duration || ''}</td>
                  <td style={{ padding: '3px 4px' }}>{r.instructions || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <BlankArea value={readSection(consultation, 'advice')} grow={afterAdvice.length === 0} />
      </Section>

      {/* Any sections that come AFTER advice in the template (rare but supported). */}
      {afterAdvice.length > 0 && (
        <DynamicSections sections={afterAdvice} consultation={consultation} growLast />
      )}

      {/* Footer with signature */}
      <div className="grid grid-cols-2 gap-4 mt-3 pt-3" style={{ borderTop: '1px solid #cbd5e1' }}>
        <div>
          <div className="text-[13px] uppercase font-semibold" style={{ color: '#64748b' }}>Patient ID</div>
          <div className="text-[12px] mt-0.5 font-mono" style={{ color: '#0f172a' }}>
            UHID: {appointment.patient_uhid}
          </div>
          <div className="text-[12px] font-mono" style={{ color: '#0f172a' }}>
            Visit ID: {appointment.patient_uhid}/V{appointment.id}
          </div>
        </div>
        <div className="text-right">
          <div className="inline-block text-center">
            {doctor.signature ? (
              <img src={doctor.signature} alt="Signature" className="h-12 w-48 object-contain ml-auto" />
            ) : (
              <div className="border-b border-gray-900 h-12 w-48" />
            )}
            <div className="text-[12px] mt-1" style={{ color: '#475569' }}>
              {doctor.name}{doctor.qualifications ? `, ${doctor.qualifications}` : ''} — Signature
            </div>
          </div>
        </div>
      </div>

      {/* FOLLOW-UP / ಮರು ಭೇಟಿ box — Page 2 only, hidden when nothing to offer */}
      <FollowUpBox followup={followup} />
    </div>
  );
}

/** Bilingual follow-up offer box. Hidden when the patient has no entitlement. */
function FollowUpBox({ followup }: { followup: FollowupSummary | null }) {
  if (!followup || !followup.enabled || followup.mode === 'hidden' || followup.free_remaining < 0) return null;

  const visitWord = followup.free_remaining === 1 ? 'visit' : 'visits';
  const dateLabel = (() => { try { return format(parseISO(followup.valid_till), 'do MMMM yyyy'); } catch { return followup.valid_till; } })();

  let englishLine: React.ReactNode;
  let kannadaLine: React.ReactNode;

  if (followup.mode === 'today_paid') {
    englishLine = <>You have <b>{followup.free_remaining} free follow-up {visitWord}</b> with <b>{followup.doctor_name}</b> — valid till <b>{dateLabel}</b>.</>;
    kannadaLine = <>{followup.doctor_name} ರ ಬಳಿ <b>{dateLabel}</b> ರವರೆಗೆ <b>{followup.free_remaining} ಉಚಿತ ಮರು ಭೇಟಿ{followup.free_remaining === 1 ? '' : 'ಗಳು'}</b> ಲಭ್ಯ.</>;
  } else if (followup.mode === 'today_free') {
    englishLine = <>✓ <b>Today's visit is a free follow-up.</b> {followup.free_remaining > 0 ? <>{followup.free_remaining} free {visitWord} still remaining till <b>{dateLabel}</b>.</> : <>Window expires <b>{dateLabel}</b>; next visit will be charged.</>}</>;
    kannadaLine = <>✓ <b>ಇಂದಿನ ಭೇಟಿಯು ಉಚಿತ ಮರು ಭೇಟಿ.</b> {followup.free_remaining > 0 ? <><b>{dateLabel}</b> ರವರೆಗೆ <b>{followup.free_remaining} ಉಚಿತ ಭೇಟಿ</b> ಇನ್ನೂ ಲಭ್ಯ.</> : <>ಮುಂದಿನ ಭೇಟಿಗೆ ಶುಲ್ಕ ಅನ್ವಯಿಸುತ್ತದೆ.</>}</>;
  } else if (followup.mode === 'today_relaxed') {
    englishLine = <>✓ <b>Today's visit was a courtesy follow-up.</b> {followup.free_remaining > 0 ? <>{followup.free_remaining} free {visitWord} still available till <b>{dateLabel}</b>.</> : <>Cycle complete — next visit will be charged.</>}</>;
    kannadaLine = <>✓ <b>ಇಂದಿನ ಭೇಟಿ ಸೌಜನ್ಯ ಮರು ಭೇಟಿ ಆಗಿತ್ತು.</b> {followup.free_remaining > 0 ? <><b>{dateLabel}</b> ರವರೆಗೆ <b>{followup.free_remaining} ಉಚಿತ ಭೇಟಿ</b> ಇನ್ನೂ ಲಭ್ಯ.</> : <>ಮುಂದಿನ ಭೇಟಿಗೆ ಶುಲ್ಕ ಅನ್ವಯಿಸುತ್ತದೆ.</>}</>;
  } else {
    return null;
  }

  return (
    <div
      className="mt-3 rounded"
      style={{
        border: '1.5px solid #047857',
        background: '#ecfdf5',
        padding: '8px 12px',
      }}
    >
      <div
        className="text-[12px] uppercase tracking-wider font-bold pb-1 mb-2 text-center"
        style={{ color: '#064e3b', borderBottom: '1px solid #a7f3d0' }}
      >
        FOLLOW-UP · ಮರು ಭೇಟಿ
      </div>
      <div className="text-[12px] leading-snug text-center" style={{ color: '#064e3b' }}>{englishLine}</div>
      <div className="text-[12px] leading-snug mt-1.5 text-center" style={{ color: '#064e3b' }}>{kannadaLine}</div>
    </div>
  );
}

function PageFooter({ pageNum, totalPages, clinicName }: { pageNum: number; totalPages: number; clinicName: string }) {
  return (
    <div className="text-center text-[13px] mt-2 pt-1" style={{ color: '#94a3b8', borderTop: '1px dashed #cbd5e1' }}>
      OPD slip generated by {clinicName} · Page {pageNum} of {totalPages}
    </div>
  );
}

function Section({ title, children, grow = false }: { title: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <div className="mt-3" style={grow ? { flex: 1, display: 'flex', flexDirection: 'column' } : undefined}>
      <div className="text-[12px] uppercase tracking-wider font-bold pb-0.5 mb-1" style={{ color: '#1e40af', borderBottom: '1px solid #bfdbfe' }}>
        {title}
      </div>
      {grow ? <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>{children}</div> : children}
    </div>
  );
}

function Vital({ label, value }: { label: string; value?: string }) {
  return (
    <div className="border border-gray-200 rounded py-1 px-1">
      <div className="text-[12px] uppercase tracking-wider" style={{ color: '#64748b' }}>{label}</div>
      <div className="text-sm font-semibold mt-0.5 min-h-[18px]" style={{ color: '#0f172a' }}>{value || '\u00A0'}</div>
    </div>
  );
}

/** Blank writing area — preserves height for handwriting; no dotted lines or ruler. */
function BlankArea({ value, minHeight, grow = false }: { value?: string | null; minHeight?: string; grow?: boolean }) {
  if (value && value.trim()) {
    return (
      <div
        className="text-[13px] whitespace-pre-wrap leading-relaxed"
        style={{
          color: '#0f172a',
          minHeight: minHeight,
          flex: grow ? 1 : undefined,
        }}
      >
        {value}
      </div>
    );
  }
  return <div style={{ minHeight: minHeight, flex: grow ? 1 : undefined }} />;
}
