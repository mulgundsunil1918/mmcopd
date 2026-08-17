import { format, parseISO } from 'date-fns';
import { PREVIEW_APPOINTMENT_ID } from '../db/slip-templates';
import { Printer, X, MapPin, Phone, Mail, HeartPulse } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ageStringFull, fmt12h, fmtDateTime } from '../lib/utils';
import { rxKannadaLine } from '../lib/rxKannada';
import type { AppointmentWithJoins, Consultation, Doctor, FollowupSummary, LabOrder, PrescriptionItem, Settings, SlipLayout, SlipTemplate, SlipTemplateSection, Vitals } from '../types';
import { DEFAULT_LAYOUT } from '../db/slip-templates';

const RESERVED_KEYS = new Set(['history', 'examination', 'impression', 'advice']);

/**
 * A lab order as the slip receives it: the header, plus the char(31)-joined
 * test names that lab:listOrders attaches so the slip can print what was
 * actually ordered rather than just the order number.
 */
type SlipLabOrder = LabOrder & { test_names?: string | null };


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

function resolveLayout(template: SlipTemplate): SlipLayout {
  return { ...DEFAULT_LAYOUT, ...(template.layout ?? {}) };
}

/** Auto-split at the 'impression' boundary; falls back to midpoint. */
function splitSections(sections: SlipTemplateSection[]): [SlipTemplateSection[], SlipTemplateSection[]] {
  let idx = sections.findIndex((s) => s.key === 'impression');
  if (idx === -1) idx = sections.findIndex((s) => s.key === 'advice');
  if (idx === -1) idx = Math.max(1, Math.floor(sections.length / 2));
  return [sections.slice(0, idx), sections.slice(idx)];
}

/** Use explicit page1Keys / page2Keys when the user has pinned sections; otherwise auto-split. */
function splitSectionsWithLayout(sections: SlipTemplateSection[], layout: SlipLayout): [SlipTemplateSection[], SlipTemplateSection[]] {
  if (layout.page1Keys.length > 0 || layout.page2Keys.length > 0) {
    const assigned = new Set([...layout.page1Keys, ...layout.page2Keys]);
    const unassigned = sections.filter((s) => !assigned.has(s.key));
    const p1 = [...sections.filter((s) => layout.page1Keys.includes(s.key)), ...unassigned];
    const p2 = sections.filter((s) => layout.page2Keys.includes(s.key));
    return [p1, p2];
  }
  return splitSections(sections);
}

const LOGO_SIZE: Record<SlipLayout['logoSize'], number> = { none: 0, small: 18, medium: 22, large: 28 };

export function OpdSlip({
  appointment,
  consultation,
  doctor,
  settings,
  rxItems = [],
  labOrders = [],
  onClose,
  layoutOverride,
}: {
  appointment: AppointmentWithJoins;
  consultation: Consultation | null;
  doctor: Doctor;
  settings: Settings;
  rxItems?: PrescriptionItem[];
  labOrders?: SlipLabOrder[];
  onClose: () => void;
  /** Override layout — e.g. from the template slot picker. Defaults to template.layout ?? DEFAULT_LAYOUT. */
  layoutOverride?: Partial<SlipLayout>;
}) {
  const v = consultation?.vitals ?? {};


  // Pull the follow-up summary so the FOLLOW-UP / ಮರು ಭೇಟಿ box on Page 2 can show
  // exactly how many free visits remain and till what date.
  const [followup, setFollowup] = useState<FollowupSummary | null>(null);
  useEffect(() => {
    if (!settings.followup_enabled) return;
    let cancelled = false;

    /**
     * The PREVIEW uses a synthetic appointment (id 9999) that does not exist in
     * the database, so the real lookup returns nothing and the whole bilingual
     * FOLLOW-UP / ಮರು ಭೇಟಿ box silently vanished from the preview — making it
     * look as though the feature had been removed. A preview whose job is to
     * show what will print must not drop a section, so it renders the box with
     * clearly-marked example figures instead.
     */
    if (appointment.id === PREVIEW_APPOINTMENT_ID) {
      const till = new Date();
      till.setDate(till.getDate() + (settings.followup_window_days || 7));
      setFollowup({
        enabled: true,
        mode: 'today_paid',
        doctor_name: doctor?.name ? `Dr. ${doctor.name}` : 'Dr. (example)',
        free_remaining: settings.followup_free_visits || 2,
        valid_till: till.toISOString().slice(0, 10),
      });
      return;
    }

    window.electronAPI.followup.summaryForAppointment(appointment.id).then((s) => {
      if (!cancelled) setFollowup(s);
    });
    return () => { cancelled = true; };
  }, [appointment.id, settings.followup_enabled, settings.followup_window_days, settings.followup_free_visits, doctor?.name]);

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

  const layout = useMemo<SlipLayout>(() => {
    return { ...resolveLayout(template), ...(layoutOverride ?? {}) };
  }, [template, layoutOverride]);

  const [pageOneSections, pageTwoSections] = useMemo(() => {
    const printable = template.sections.filter((s) => s.printed !== false);
    const base = printable.length === 0 ? FALLBACK_TEMPLATE.sections : printable;
    return splitSectionsWithLayout(base, layout);
  }, [template, layout, FALLBACK_TEMPLATE]);

  const totalPages = layout.pages;
  const printLabel = totalPages === 1 ? 'Print' : 'Print Both Pages';

  return (
    <div className="fixed inset-0 z-[100] overflow-auto print-overlay" style={{ backgroundColor: '#94a3b8' }}>
      <div className="no-print sticky top-3 z-10 flex justify-center pointer-events-none">
        <div className="px-4 py-1.5 rounded-full text-xs font-semibold text-white shadow-lg" style={{ backgroundColor: '#1e293b' }}>
          OPD Slip preview · Token #{appointment.token_number} · {totalPages} {totalPages === 1 ? 'page' : 'pages'}
        </div>
      </div>

      <div className="p-6 pb-28 flex flex-col items-center gap-4">
        {totalPages === 1 ? (
          <Page fontSize={layout.fontSize}>
            <SinglePageContent
              appointment={appointment} consultation={consultation} doctor={doctor}
              settings={settings} vitals={v} rxItems={rxItems} labOrders={labOrders}
              followup={followup} sections={[...pageOneSections, ...pageTwoSections]} layout={layout}
            />
            <PageFooter pageNum={1} totalPages={1} clinicName={settings.clinic_name} />
          </Page>
        ) : (
          <>
            <Page fontSize={layout.fontSize}>
              <PageOne appointment={appointment} consultation={consultation} doctor={doctor} settings={settings} vitals={v} sections={pageOneSections} layout={layout} />
              <PageFooter pageNum={1} totalPages={2} clinicName={settings.clinic_name} />
            </Page>
            <Page fontSize={layout.fontSize}>
              <PageTwo appointment={appointment} consultation={consultation} doctor={doctor} settings={settings} rxItems={rxItems} labOrders={labOrders} followup={followup} sections={pageTwoSections} layout={layout} />
              <PageFooter pageNum={2} totalPages={2} clinicName={settings.clinic_name} />
            </Page>
          </>
        )}
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
          <Printer className="w-4 h-4" /> {printLabel}
        </button>
      </div>
    </div>
  );
}

/** A single A4 page sized container. Print CSS forces a sheet break between pages. */
function Page({ children, fontSize = 13 }: { children: React.ReactNode; fontSize?: number }) {
  return (
    <div
      className="print-area print-page bg-white shadow-2xl"
      style={{
        width: '210mm',
        height: '297mm',
        padding: '14mm 14mm 12mm',
        /*
         * border-box + hidden make the PREVIEW behave exactly like the printed
         * sheet, which already sets both in the @media print block.
         *
         * Without them the preview let long content spill past the padding and
         * run to the very edge of the paper, so the slip looked as though it had
         * no bottom margin at all — while the real printout, being clipped, did
         * have one. A preview that disagrees with the printer is worse than no
         * preview, because the user trusts it and only finds out after printing.
         */
        boxSizing: 'border-box',
        overflow: 'hidden',
        backgroundColor: '#ffffff',
        color: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
        fontSize: `${fontSize}px`,
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
  logoSize = 'large',
}: {
  appointment: AppointmentWithJoins;
  doctor: Doctor;
  settings: Settings;
  compact?: boolean;
  logoSize?: SlipLayout['logoSize'];
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
            <div className="text-base font-extrabold tracking-tight" style={{ color: '#1e3a8a' }}>{settings.clinic_name || 'CureDesk HMS'}</div>
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
          {/* === LOGO (size controlled by logoSize prop) === */}
          {logoSize !== 'none' && (() => {
            const mm = LOGO_SIZE[logoSize];
            const innerMm = mm - 4;
            return (
              <div className="flex-shrink-0">
                {settings.clinic_logo ? (
                  <div
                    className="rounded-lg flex items-center justify-center"
                    style={{
                      width: `${mm}mm`, height: `${mm}mm`,
                      background: '#ffffff', border: '1px solid #e2e8f0',
                      boxShadow: '0 1px 2px rgba(15,23,42,0.05)',
                    }}
                  >
                    <img src={settings.clinic_logo} alt="Clinic logo" className="object-contain"
                      style={{ maxWidth: `${innerMm}mm`, maxHeight: `${innerMm}mm` }} />
                  </div>
                ) : (
                  <div className="rounded-lg flex items-center justify-center text-white shadow"
                    style={{ width: `${mm}mm`, height: `${mm}mm`, background: 'linear-gradient(135deg, #1d4ed8 0%, #4f46e5 100%)' }}>
                    <HeartPulse className="w-10 h-10" />
                  </div>
                )}
              </div>
            );
          })()}

          {/* === IDENTITY (clinic name, tagline, reg) — gets the big middle space === */}
          <div className="min-w-0 flex-1">
            <div
              className="font-extrabold tracking-tight uppercase"
              style={{ color: '#1e3a8a', fontSize: '24px', lineHeight: 1.1, letterSpacing: '0.5px' }}
            >
              {settings.clinic_name || 'CureDesk HMS'}
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
  appointment, consultation, doctor, settings, vitals, sections, layout,
}: {
  appointment: AppointmentWithJoins;
  consultation: Consultation | null;
  doctor: Doctor;
  settings: Settings;
  vitals: Vitals;
  sections: SlipTemplateSection[];
  layout: SlipLayout;
}) {
  const regDate = appointment.patient_created_at
    ? (() => { try { return fmtDateTime(appointment.patient_created_at); } catch { return appointment.patient_created_at; } })()
    : null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', lineHeight: 1.35 }}>
      <Letterhead appointment={appointment} doctor={doctor} settings={settings} logoSize={layout.logoSize} />
      <DoctorPatientBlocks appointment={appointment} doctor={doctor} regDate={regDate} />
      {layout.showVitals && <VitalsStrip vitals={vitals} />}
      <DynamicSections sections={sections} consultation={consultation} growLast />
    </div>
  );
}

function DoctorPatientBlocks({ appointment, doctor, regDate }: { appointment: AppointmentWithJoins; doctor: Doctor; regDate: string | null }) {
  return (
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
  );
}

function VitalsStrip({ vitals }: { vitals: Vitals }) {
  return (
    <Section title="Vitals">
      <div className="grid grid-cols-7 gap-2 mt-1 text-center">
        <Vital label="Temp" unit="°F" value={vitals.temp} />
        <Vital label="Pulse" unit="bpm" value={vitals.pulse} />
        <Vital label="RR" unit="cpm" value={vitals.rr} />
        <Vital label="SpO₂" unit="%" value={vitals.spo2} />
        <Vital label="BP" unit="mmHg" value={vitals.bp} />
        <Vital label="Weight" unit="kg" value={vitals.weight} />
        <Vital label="Height" unit="cm" value={vitals.height} />
      </div>
    </Section>
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

function RxTable({ rxItems }: { rxItems: PrescriptionItem[] }) {
  if (rxItems.length === 0) return null;
  return (
    <table className="w-full mb-2" style={{ borderCollapse: 'collapse', fontSize: 'inherit' }}>
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
        {rxItems.map((r, idx) => {
          const kn = rxKannadaLine(r);
          return (
            <Fragment key={idx}>
              <tr style={{ borderBottom: kn ? 'none' : '1px dotted #e2e8f0' }}>
                <td style={{ padding: '3px 4px', fontWeight: 600 }}>{r.drug_name}</td>
                <td style={{ padding: '3px 4px' }}>{r.dosage || ''}</td>
                <td style={{ padding: '3px 4px' }}>{r.frequency || ''}</td>
                <td style={{ padding: '3px 4px' }}>{r.duration || ''}</td>
                <td style={{ padding: '3px 4px' }}>{r.instructions || ''}</td>
              </tr>
              {kn && (
                <tr style={{ borderBottom: '1px dotted #e2e8f0' }}>
                  <td></td>
                  <td colSpan={4} style={{ padding: '0 4px 4px', color: '#475569', fontStyle: 'italic', fontSize: '0.92em' }}>{kn}</td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The tests the doctor ordered, by name.
 *
 * This used to print the order NUMBER — a patient walked out holding a slip that
 * read "LAB-20260817-0001 (ordered)", which tells them nothing about what was
 * asked for and is useless at any outside lab. The names are what the slip is
 * for; the order number is only an internal handle.
 *
 * Names arrive char(31)-joined from lab:listOrders (a comma would be ambiguous —
 * "Vitamin D, 25-Hydroxy" is one test). If an order somehow has no items we fall
 * back to the number rather than rendering an empty bullet.
 */
function InvestigationsList({ labOrders, fontSize }: { labOrders: SlipLabOrder[]; fontSize?: string }) {
  return (
    <ul style={{ marginLeft: 14, listStyle: 'disc', ...(fontSize ? { fontSize } : {}) }} className={fontSize ? undefined : 'text-[12px]'}>
      {labOrders.flatMap((o) => {
        const tests = (o.test_names || '').split('\u001f').map((t) => t.trim()).filter(Boolean);
        if (tests.length === 0) {
          return [(
            <li key={o.id}>
              <span className="font-mono" style={{ color: '#1e40af' }}>{o.order_number}</span> ({o.status.replace('_', ' ')})
            </li>
          )];
        }
        return tests.map((name, i) => (
          <li key={`${o.id}-${i}`}>
            <span style={{ color: '#0f172a' }}>{name}</span>
            {/* Status belongs on the order, so state it once — on the last test. */}
            {i === tests.length - 1 && (
              <span style={{ color: '#64748b' }}> ({o.status.replace('_', ' ')})</span>
            )}
          </li>
        ));
      })}
    </ul>
  );
}

function SignatureBlock({ doctor, appointment }: { doctor: Doctor; appointment: AppointmentWithJoins }) {
  return (
    <div className="grid grid-cols-2 gap-4 mt-3 pt-3" style={{ borderTop: '1px solid #cbd5e1' }}>
      <div>
        <div className="text-[13px] uppercase font-semibold" style={{ color: '#64748b' }}>Patient ID</div>
        <div className="text-[12px] mt-0.5 font-mono" style={{ color: '#0f172a' }}>UHID: {appointment.patient_uhid}</div>
        <div className="text-[12px] font-mono" style={{ color: '#0f172a' }}>Visit ID: {appointment.patient_uhid}/V{appointment.id}</div>
      </div>
      <div className="text-right">
        {/*
          The rule and the caption must derive from ONE width, or they drift apart.
          A fixed-width rule with a free-flowing caption meant a doctor with long
          qualifications ("MBBS, MD (RGUHS Gold Medalist), DNB, FIPN") stretched
          this box to the caption's width while the rule stayed pinned at its left
          edge — the signature line sat visibly off-centre from the name under it.

          Now the box shrink-wraps the caption between a floor and a ceiling, and
          the rule spans w-full, so the two are concentric at any name length. The
          ceiling also forces a long caption to wrap instead of running off the
          page, and `balance` splits it into even lines rather than leaving a
          stranded ", FIPN — Signature" on its own.
        */}
        <div className="inline-block text-center min-w-[12rem] max-w-[17rem]">
          {doctor.signature
            ? <img src={doctor.signature} alt="Signature" className="h-12 w-full object-contain" />
            : <div className="border-b border-gray-900 h-12 w-full" />}
          <div className="text-[12px] mt-1" style={{ color: '#475569', textWrap: 'balance' }}>
            {doctor.name}{doctor.qualifications ? `, ${doctor.qualifications}` : ''} — Signature
          </div>
        </div>
      </div>
    </div>
  );
}

function PageTwo({
  appointment, consultation, doctor, settings, rxItems, labOrders, followup, sections, layout,
}: {
  appointment: AppointmentWithJoins;
  consultation: Consultation | null;
  doctor: Doctor;
  settings: Settings;
  rxItems: PrescriptionItem[];
  labOrders: SlipLabOrder[];
  followup: FollowupSummary | null;
  sections: SlipTemplateSection[];
  layout: SlipLayout;
}) {
  const adviceIdx = sections.findIndex((s) => s.key === 'advice');
  const beforeAdvice = adviceIdx === -1 ? sections : sections.slice(0, adviceIdx);
  const adviceSection = adviceIdx === -1 ? null : sections[adviceIdx];
  const afterAdvice = adviceIdx === -1 ? [] : sections.slice(adviceIdx + 1);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', lineHeight: 1.35 }}>
      <Letterhead appointment={appointment} doctor={doctor} settings={settings} compact logoSize={layout.logoSize} />
      <DynamicSections sections={beforeAdvice} consultation={consultation} />

      {labOrders.length > 0 && (
        <Section title="Investigations Ordered">
          <InvestigationsList labOrders={labOrders} />
        </Section>
      )}

      <Section title={adviceSection?.title || 'Advice / Prescription (Rx)'} grow>
        {layout.showRxTable && <RxTable rxItems={rxItems} />}
        <BlankArea value={readSection(consultation, 'advice')} grow={afterAdvice.length === 0} />
      </Section>

      {afterAdvice.length > 0 && (
        <DynamicSections sections={afterAdvice} consultation={consultation} growLast />
      )}

      {layout.showSignature && <SignatureBlock doctor={doctor} appointment={appointment} />}
      {layout.showFollowupBox && <FollowUpBox followup={followup} settings={settings} showQr={layout.showQrCodes} />}
      {layout.showQrCodes && !layout.showFollowupBox && <QrRow settings={settings} />}
    </div>
  );
}

/** Single-page layout — everything on one A4 sheet. */
function SinglePageContent({
  appointment, consultation, doctor, settings, vitals, rxItems, labOrders, followup, sections, layout,
}: {
  appointment: AppointmentWithJoins;
  consultation: Consultation | null;
  doctor: Doctor;
  settings: Settings;
  vitals: Vitals;
  rxItems: PrescriptionItem[];
  labOrders: SlipLabOrder[];
  followup: FollowupSummary | null;
  sections: SlipTemplateSection[];
  layout: SlipLayout;
}) {
  const regDate = appointment.patient_created_at
    ? (() => { try { return fmtDateTime(appointment.patient_created_at); } catch { return appointment.patient_created_at; } })()
    : null;

  const adviceIdx = sections.findIndex((s) => s.key === 'advice');
  const beforeAdvice = adviceIdx === -1 ? sections : sections.slice(0, adviceIdx);
  const adviceSection = adviceIdx === -1 ? null : sections[adviceIdx];
  const afterAdvice = adviceIdx === -1 ? [] : sections.slice(adviceIdx + 1);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
      <Letterhead appointment={appointment} doctor={doctor} settings={settings}
        compact={layout.headerStyle === 'compact'} logoSize={layout.logoSize} />
      <DoctorPatientBlocks appointment={appointment} doctor={doctor} regDate={regDate} />
      {layout.showVitals && <VitalsStrip vitals={vitals} />}
      <DynamicSections sections={beforeAdvice} consultation={consultation} />

      {labOrders.length > 0 && (
        <Section title="Investigations Ordered">
          <InvestigationsList labOrders={labOrders} fontSize="0.9em" />
        </Section>
      )}

      <Section title={adviceSection?.title || 'Advice / Prescription (Rx)'} grow>
        {layout.showRxTable && <RxTable rxItems={rxItems} />}
        <BlankArea value={readSection(consultation, 'advice')} grow={afterAdvice.length === 0} />
      </Section>

      {afterAdvice.length > 0 && (
        <DynamicSections sections={afterAdvice} consultation={consultation} growLast />
      )}

      {layout.showSignature && <SignatureBlock doctor={doctor} appointment={appointment} />}
      {layout.showFollowupBox && <FollowUpBox followup={followup} settings={settings} showQr={layout.showQrCodes} />}
      {layout.showQrCodes && !layout.showFollowupBox && <QrRow settings={settings} />}
    </div>
  );
}


/** Single QR code rendered as an inline SVG data-URI img tag. */
function QrBox({ img, label, size = 72 }: { img: string; label: string; size?: number }) {
  if (!img) return null;
  return (
    <div className="flex flex-col items-center gap-1">
      <img src={img} alt={label} style={{ width: size, height: size, display: 'block', objectFit: 'contain' }} />
      <div className="text-[10px] font-medium text-center" style={{ color: '#475569', maxWidth: size + 10 }}>{label}</div>
    </div>
  );
}

/** Row of 1 or 2 QR codes shown on page 2, below the signature. Hidden if no images are uploaded. */
function QrRow({ settings }: { settings: Settings }) {
  const hasQr1 = !!settings.qr1_img;
  const hasQr2 = !!settings.qr2_img;
  if (!hasQr1 && !hasQr2) return null;
  return (
    <div
      className="mt-3 flex items-center justify-center gap-8 rounded"
      style={{ border: '1px solid #e2e8f0', padding: '8px 16px', background: '#f8fafc' }}
    >
      {hasQr1 && <QrBox img={settings.qr1_img} label={settings.qr1_label || 'QR Code'} />}
      {hasQr2 && <QrBox img={settings.qr2_img} label={settings.qr2_label || 'QR Code'} />}
    </div>
  );
}

/** Bilingual follow-up offer box. Hidden when the patient has no entitlement. */
function FollowUpBox({ followup, settings, showQr = true }: { followup: FollowupSummary | null; settings: Settings; showQr?: boolean }) {
  const hasQr = showQr && !!(settings.qr1_img || settings.qr2_img);
  if (!followup || !followup.enabled || followup.mode === 'hidden' || followup.free_remaining < 0) {
    return hasQr ? <QrRow settings={settings} /> : null;
  }

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

  const qrCount = showQr ? (settings.qr1_img ? 1 : 0) + (settings.qr2_img ? 1 : 0) : 0;
  const qrSize = qrCount === 2 ? 58 : 82;

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
      <div className="flex items-center gap-3">
        {/* Left: bilingual text */}
        <div className={`flex-1 min-w-0 ${qrCount === 0 ? 'text-center' : ''}`}>
          <div className="text-[12px] leading-snug" style={{ color: '#064e3b' }}>{englishLine}</div>
          <div className="text-[12px] leading-snug mt-1.5" style={{ color: '#064e3b' }}>{kannadaLine}</div>
        </div>
        {/* Right: QR codes */}
        {qrCount > 0 && (
          <div
            className="flex items-center justify-center gap-2 shrink-0"
            style={{ borderLeft: '1px solid #a7f3d0', paddingLeft: '10px' }}
          >
            {settings.qr1_img && <QrBox img={settings.qr1_img} label={settings.qr1_label || 'QR Code'} size={qrSize} />}
            {settings.qr2_img && <QrBox img={settings.qr2_img} label={settings.qr2_label || 'QR Code'} size={qrSize} />}
          </div>
        )}
      </div>
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

function Vital({ label, unit, value }: { label: string; unit?: string; value?: string }) {
  return (
    <div className="border border-gray-200 rounded py-1 px-1">
      <div className="text-[11px] tracking-wide whitespace-nowrap text-center" style={{ color: '#64748b' }}>
        {label}{unit && <span className="text-[9px] ml-0.5">({unit})</span>}
      </div>
      <div className="text-sm font-semibold mt-0.5 min-h-[18px] text-center" style={{ color: '#0f172a' }}>{value || '\u00A0'}</div>
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
