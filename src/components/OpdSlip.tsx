import { format, parseISO } from 'date-fns';
import { Printer, X, MapPin, Phone, Mail, HeartPulse } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ageStringFull, fmt12h, fmtDateTime } from '../lib/utils';
import type { AppointmentWithJoins, Consultation, Doctor, FollowupSummary, LabOrder, PrescriptionItem, Settings, Vitals } from '../types';

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

  return (
    <div className="fixed inset-0 z-[100] overflow-auto print-overlay" style={{ backgroundColor: '#94a3b8' }}>
      <div className="no-print sticky top-3 z-10 flex justify-center pointer-events-none">
        <div className="px-4 py-1.5 rounded-full text-xs font-semibold text-white shadow-lg" style={{ backgroundColor: '#1e293b' }}>
          OPD Slip preview · Token #{appointment.token_number} · 2 pages
        </div>
      </div>

      <div className="p-6 pb-28 flex flex-col items-center gap-4">
        <Page>
          <PageOne appointment={appointment} consultation={consultation} doctor={doctor} settings={settings} vitals={v} />
          <PageFooter pageNum={1} totalPages={2} clinicName={settings.clinic_name} />
        </Page>
        <Page>
          <PageTwo appointment={appointment} consultation={consultation} doctor={doctor} settings={settings} rxItems={rxItems} labOrders={labOrders} followup={followup} />
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
      return format(d, "dd MMM yyyy '·' hh:mm a");
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
      return [format(d, 'dd MMM yyyy'), format(d, 'hh:mm a')];
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
  appointment, consultation, doctor, settings, vitals,
}: {
  appointment: AppointmentWithJoins;
  consultation: Consultation | null;
  doctor: Doctor;
  settings: Settings;
  vitals: Vitals;
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

      {/* Chief Complaints / History — generous blank space, no dotted lines */}
      <Section title="Chief Complaints / History">
        <BlankArea value={consultation?.history} minHeight="55mm" />
      </Section>

      {/* Examination — generous blank space, no dotted lines, takes the rest of page 1 */}
      <Section title="Examination" grow>
        <BlankArea value={consultation?.examination} grow />
      </Section>
    </div>
  );
}

function PageTwo({
  appointment, consultation, doctor, settings, rxItems, labOrders, followup,
}: {
  appointment: AppointmentWithJoins;
  consultation: Consultation | null;
  doctor: Doctor;
  settings: Settings;
  rxItems: PrescriptionItem[];
  labOrders: LabOrder[];
  followup: FollowupSummary | null;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', fontSize: '13px', lineHeight: 1.35 }}>
      <Letterhead appointment={appointment} doctor={doctor} settings={settings} compact />

      {/* Impression / Diagnosis — 3 to 4 lines */}
      <Section title="Impression / Diagnosis">
        <BlankArea value={consultation?.impression} minHeight="22mm" />
      </Section>

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

      {/* Advice / Prescription — rest of the page */}
      <Section title="Advice / Prescription (Rx)" grow>
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
        <BlankArea value={consultation?.advice} grow />
      </Section>

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
  const dateLabel = (() => { try { return format(parseISO(followup.valid_till), 'dd MMM yyyy'); } catch { return followup.valid_till; } })();

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
