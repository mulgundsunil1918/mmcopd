import { format, parseISO } from 'date-fns';
import { Printer, X, MapPin, Phone, Mail, HeartPulse } from 'lucide-react';
import { age, fmt12h, fmtDate, fmtDateTime } from '../lib/utils';
import type { AppointmentWithJoins, Consultation, Doctor, LabOrder, PrescriptionItem, Settings, Vitals } from '../types';

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

  return (
    <div className="fixed inset-0 z-[100] overflow-auto" style={{ backgroundColor: '#94a3b8' }}>
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
          <PageTwo appointment={appointment} consultation={consultation} doctor={doctor} settings={settings} rxItems={rxItems} labOrders={labOrders} />
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
            <div className="text-sm font-extrabold tracking-tight" style={{ color: '#1e3a8a' }}>{settings.clinic_name || 'Mulgund Multispeciality Clinic'}</div>
            <div className="text-[9px]" style={{ color: '#64748b' }}>Continued — Page 2 of 2</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold" style={{ color: '#0f172a' }}>{appointment.patient_name}</div>
          <div className="text-[9px]" style={{ color: '#475569' }}>UHID: {appointment.patient_uhid} · Visit ID: {visitId}</div>
          <div className="text-[9px]" style={{ color: '#475569' }}>Token #{appointment.token_number} · {slipDate}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ borderTop: '4px solid #1d4ed8', borderBottom: '1px solid #cbd5e1' }} className="pb-3 mb-3">
      <div className="flex items-start justify-between pt-3">
        <div className="flex items-center gap-3">
          {settings.clinic_logo ? (
            <img src={settings.clinic_logo} alt="Clinic logo" className="w-16 h-16 object-contain rounded-lg" style={{ background: '#ffffff' }} />
          ) : (
            <div className="w-16 h-16 rounded-xl flex items-center justify-center text-white shadow" style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #4f46e5 100%)' }}>
              <HeartPulse className="w-10 h-10" />
            </div>
          )}
          <div>
            <div className="text-2xl font-extrabold tracking-tight leading-tight" style={{ color: '#1e3a8a' }}>
              {settings.clinic_name || 'Mulgund Multispeciality Clinic'}
            </div>
            {settings.clinic_tagline && <div className="text-[10px] italic" style={{ color: '#475569' }}>{settings.clinic_tagline}</div>}
            {settings.clinic_registration_no && (
              <div className="text-[9px] uppercase tracking-wider mt-0.5" style={{ color: '#64748b' }}>
                Reg. No.: {settings.clinic_registration_no}
              </div>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="inline-block px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold" style={{ background: '#1d4ed8', color: '#ffffff' }}>OPD Slip</div>
          <div className="text-base font-bold mt-1" style={{ color: '#0f172a' }}>Token #{appointment.token_number}</div>
          <div className="text-[10px]" style={{ color: '#475569' }}>{slipDate}</div>
          <div className="text-[10px] font-mono" style={{ color: '#1e40af' }}>Visit ID: {visitId}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[10px]" style={{ color: '#475569' }}>
        {settings.clinic_address && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" style={{ color: '#1d4ed8' }} /> {settings.clinic_address}</span>}
        {settings.clinic_phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" style={{ color: '#1d4ed8' }} /> {settings.clinic_phone}</span>}
        {settings.clinic_email && <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" style={{ color: '#1d4ed8' }} /> {settings.clinic_email}</span>}
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', fontSize: '11px', lineHeight: 1.35 }}>
      <Letterhead appointment={appointment} doctor={doctor} settings={settings} />

      {/* Doctor + Patient blocks */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border border-gray-300 rounded p-2">
          <div className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: '#64748b' }}>Consulting Doctor</div>
          <div className="text-sm font-bold mt-0.5" style={{ color: '#0f172a' }}>{doctor.name}</div>
          {doctor.qualifications && <div className="text-[10px] font-medium" style={{ color: '#1e40af' }}>{doctor.qualifications}</div>}
          <div className="text-[10px]" style={{ color: '#475569' }}>{doctor.specialty}{doctor.room_number ? ` · Room ${doctor.room_number}` : ''}</div>
          {doctor.registration_no && <div className="text-[9px]" style={{ color: '#64748b' }}>Reg: {doctor.registration_no}</div>}
        </div>
        <div className="border border-gray-300 rounded p-2">
          <div className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: '#64748b' }}>Patient</div>
          <div className="flex flex-wrap gap-x-4 mt-0.5">
            <div className="text-sm font-bold" style={{ color: '#0f172a' }}>{appointment.patient_name}</div>
          </div>
          <div className="flex flex-wrap gap-x-4 text-[10px]" style={{ color: '#374151' }}>
            <span><b>UHID:</b> {appointment.patient_uhid}</span>
            <span>Age: {age(appointment.patient_dob)} yrs</span>
            <span>Sex: {appointment.patient_gender}</span>
            <span>Ph: {appointment.patient_phone}</span>
            {appointment.patient_blood_group && <span>BG: {appointment.patient_blood_group}</span>}
          </div>
          {regDate && <div className="text-[9px] mt-0.5" style={{ color: '#64748b' }}>Registered: {regDate}</div>}
        </div>
      </div>

      {/* Vitals strip */}
      <Section title="Vitals">
        <div className="grid grid-cols-7 gap-2 mt-1 text-center">
          <Vital label="BP (mmHg)" value={vitals.bp} />
          <Vital label="Pulse" value={vitals.pulse} />
          <Vital label="Temp (°F)" value={vitals.temp} />
          <Vital label="SpO₂ (%)" value={vitals.spo2} />
          <Vital label="RR" value={vitals.rr} />
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
  appointment, consultation, doctor, settings, rxItems, labOrders,
}: {
  appointment: AppointmentWithJoins;
  consultation: Consultation | null;
  doctor: Doctor;
  settings: Settings;
  rxItems: PrescriptionItem[];
  labOrders: LabOrder[];
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', fontSize: '11px', lineHeight: 1.35 }}>
      <Letterhead appointment={appointment} doctor={doctor} settings={settings} compact />

      {/* Impression / Diagnosis — 3 to 4 lines */}
      <Section title="Impression / Diagnosis">
        <BlankArea value={consultation?.impression} minHeight="22mm" />
      </Section>

      {/* Investigations (if any) */}
      {labOrders.length > 0 && (
        <Section title="Investigations Ordered">
          <ul style={{ marginLeft: 14, listStyle: 'disc' }} className="text-[10px]">
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
          <table className="w-full text-[10px] mb-2" style={{ borderCollapse: 'collapse' }}>
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

      {/* Next Visit box — pre-printed, blank, filled by receptionist at checkout */}
      <NextVisitBox suggestedDate={consultation?.follow_up_date || null} />

      {/* Footer with signature */}
      <div className="grid grid-cols-2 gap-4 mt-3 pt-3" style={{ borderTop: '1px solid #cbd5e1' }}>
        <div>
          <div className="text-[9px] uppercase font-semibold" style={{ color: '#64748b' }}>Patient ID</div>
          <div className="text-[10px] mt-0.5 font-mono" style={{ color: '#0f172a' }}>
            UHID: {appointment.patient_uhid}
          </div>
          <div className="text-[10px] font-mono" style={{ color: '#0f172a' }}>
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
            <div className="text-[10px] mt-1" style={{ color: '#475569' }}>
              {doctor.name}{doctor.qualifications ? `, ${doctor.qualifications}` : ''} — Signature
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pre-printed Next Visit box — receptionist fills date/time/reason at checkout. */
function NextVisitBox({ suggestedDate }: { suggestedDate: string | null }) {
  return (
    <div
      className="mt-3 rounded"
      style={{
        border: '1.5px solid #1d4ed8',
        background: '#eff6ff',
        padding: '6px 10px',
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#1e3a8a' }}>
          📅 Next Visit
        </div>
        {suggestedDate && (
          <div className="text-[9px]" style={{ color: '#475569' }}>
            Doctor suggested: <b>{fmtDate(suggestedDate)}</b>
          </div>
        )}
      </div>
      <div className="grid grid-cols-12 gap-2 items-center text-[10px]" style={{ color: '#0f172a' }}>
        <span className="col-span-1 font-semibold">Date:</span>
        <span className="col-span-5 inline-flex items-end gap-1">
          <DateBlank w="10mm" />/<DateBlank w="10mm" />/<DateBlank w="14mm" />
        </span>
        <span className="col-span-1 font-semibold text-right">Time:</span>
        <span className="col-span-5 inline-flex items-end gap-1">
          <DateBlank w="10mm" />:<DateBlank w="10mm" />
          <span className="ml-1 text-[9px]" style={{ color: '#475569' }}>AM / PM</span>
        </span>
        <span className="col-span-1 font-semibold">Reason:</span>
        <span className="col-span-11">
          <span style={{ display: 'inline-block', borderBottom: '1px solid #94a3b8', width: '100%', height: '12px' }} />
        </span>
      </div>
    </div>
  );
}

function DateBlank({ w }: { w: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        borderBottom: '1px solid #94a3b8',
        width: w,
        height: '12px',
      }}
    />
  );
}

function PageFooter({ pageNum, totalPages, clinicName }: { pageNum: number; totalPages: number; clinicName: string }) {
  return (
    <div className="text-center text-[9px] mt-2 pt-1" style={{ color: '#94a3b8', borderTop: '1px dashed #cbd5e1' }}>
      System generated by {clinicName} · Page {pageNum} of {totalPages} · Not valid without doctor's signature
    </div>
  );
}

function Section({ title, children, grow = false }: { title: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <div className="mt-3" style={grow ? { flex: 1, display: 'flex', flexDirection: 'column' } : undefined}>
      <div className="text-[10px] uppercase tracking-wider font-bold pb-0.5 mb-1" style={{ color: '#1e40af', borderBottom: '1px solid #bfdbfe' }}>
        {title}
      </div>
      {grow ? <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>{children}</div> : children}
    </div>
  );
}

function Vital({ label, value }: { label: string; value?: string }) {
  return (
    <div className="border border-gray-200 rounded py-1 px-1">
      <div className="text-[8px] uppercase tracking-wider" style={{ color: '#64748b' }}>{label}</div>
      <div className="text-xs font-semibold mt-0.5 min-h-[16px]" style={{ color: '#0f172a' }}>{value || '\u00A0'}</div>
    </div>
  );
}

/** Blank writing area — preserves height for handwriting; no dotted lines or ruler. */
function BlankArea({ value, minHeight, grow = false }: { value?: string | null; minHeight?: string; grow?: boolean }) {
  if (value && value.trim()) {
    return (
      <div
        className="text-[11px] whitespace-pre-wrap leading-relaxed"
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
