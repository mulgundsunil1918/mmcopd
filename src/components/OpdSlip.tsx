import { format, parseISO } from 'date-fns';
import { Printer, X, MapPin, Phone, Mail, HeartPulse, IdCard } from 'lucide-react';
import { age, fmt12h, fmtDate, fmtDateTime } from '../lib/utils';
import type { AppointmentWithJoins, Consultation, Doctor, LabOrder, PrescriptionItem, Settings } from '../types';

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
    <div className="fixed inset-0 z-50 bg-gray-900/60 overflow-auto">
      <div className="no-print flex justify-between items-center p-4 sticky top-0 bg-gray-900/90 backdrop-blur z-10">
        <div className="text-white text-sm">OPD Slip preview · Token #{appointment.token_number}</div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onClose}>
            <X className="w-4 h-4" /> Close
          </button>
          <button className="btn-primary" onClick={() => window.print()}>
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      <div className="p-4 pb-10 flex justify-center">
        <div className="print-area bg-white shadow-xl" style={{ width: '210mm', minHeight: '297mm', padding: '14mm 14mm 12mm' }}>
          <SlipBody
            appointment={appointment}
            consultation={consultation}
            doctor={doctor}
            settings={settings}
            vitals={v}
            rxItems={rxItems}
            labOrders={labOrders}
          />
        </div>
      </div>
    </div>
  );
}

function SlipBody({
  appointment, consultation, doctor, settings, vitals, rxItems, labOrders,
}: {
  appointment: AppointmentWithJoins;
  consultation: Consultation | null;
  doctor: Doctor;
  settings: Settings;
  vitals: NonNullable<Consultation['vitals']> | Record<string, string | undefined>;
  rxItems: PrescriptionItem[];
  labOrders: LabOrder[];
}) {
  const slipDate = (() => {
    try {
      const d = parseISO(`${appointment.appointment_date}T${appointment.appointment_time}:00`);
      return format(d, "dd MMM yyyy '·' hh:mm a");
    } catch {
      return `${appointment.appointment_date} · ${fmt12h(appointment.appointment_time)}`;
    }
  })();

  const regDate = appointment.patient_created_at
    ? (() => { try { return fmtDateTime(appointment.patient_created_at); } catch { return appointment.patient_created_at; } })()
    : null;

  return (
    <div className="text-gray-900" style={{ fontSize: '11px', lineHeight: 1.35 }}>
      {/* ===== LETTERHEAD ===== */}
      <div style={{ borderTop: '4px solid #1d4ed8', borderBottom: '1px solid #cbd5e1' }} className="pb-3 mb-0">
        <div className="flex items-start justify-between pt-3">
          {/* Left: logo + name + tagline */}
          <div className="flex items-center gap-3">
            {settings.clinic_logo ? (
              <img
                src={settings.clinic_logo}
                alt="Clinic logo"
                className="w-16 h-16 object-contain rounded-lg"
                style={{ background: '#ffffff' }}
              />
            ) : (
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center text-white shadow"
                style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #4f46e5 100%)' }}
              >
                <HeartPulse className="w-10 h-10" />
              </div>
            )}
            <div>
              <div className="text-2xl font-extrabold tracking-tight leading-tight" style={{ color: '#1e3a8a' }}>
                {settings.clinic_name || 'Mulgund Multispeciality Clinic'}
              </div>
              {settings.clinic_tagline && (
                <div className="text-[10px] italic" style={{ color: '#475569' }}>{settings.clinic_tagline}</div>
              )}
              {settings.clinic_registration_no && (
                <div className="text-[9px] uppercase tracking-wider mt-0.5" style={{ color: '#64748b' }}>
                  Reg. No.: {settings.clinic_registration_no}
                </div>
              )}
            </div>
          </div>

          {/* Right: slip meta */}
          <div className="text-right">
            <div
              className="inline-block px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold"
              style={{ background: '#1d4ed8', color: '#ffffff' }}
            >
              OPD Slip
            </div>
            <div className="text-base font-bold mt-1" style={{ color: '#0f172a' }}>Token #{appointment.token_number}</div>
            <div className="text-[10px]" style={{ color: '#475569' }}>{slipDate}</div>
            <div className="text-[9px]" style={{ color: '#64748b' }}>Slip ID: {appointment.patient_uhid}/A{appointment.id}</div>
          </div>
        </div>

        {/* Contact strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[10px]" style={{ color: '#475569' }}>
          {settings.clinic_address && (
            <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" style={{ color: '#1d4ed8' }} /> {settings.clinic_address}</span>
          )}
          {settings.clinic_phone && (
            <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" style={{ color: '#1d4ed8' }} /> {settings.clinic_phone}</span>
          )}
          {settings.clinic_email && (
            <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" style={{ color: '#1d4ed8' }} /> {settings.clinic_email}</span>
          )}
        </div>
      </div>

      {/* Doctor + Patient blocks */}
      <div className="grid grid-cols-2 gap-4 mt-3">
        <div className="border border-gray-300 rounded p-2">
          <div className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Consulting Doctor</div>
          <div className="text-sm font-bold text-gray-900 mt-0.5">{doctor.name}</div>
          <div className="text-[10px] text-gray-600">{doctor.specialty}{doctor.room_number ? ` · Room ${doctor.room_number}` : ''}</div>
        </div>
        <div className="border border-gray-300 rounded p-2">
          <div className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Patient</div>
          <div className="flex flex-wrap gap-x-4 mt-0.5">
            <div className="text-sm font-bold text-gray-900">{appointment.patient_name}</div>
            <div className="text-[10px] text-gray-600">UHID: {appointment.patient_uhid}</div>
          </div>
          <div className="flex flex-wrap gap-x-4 text-[10px] text-gray-700">
            <span>Age: {age(appointment.patient_dob)} yrs</span>
            <span>Sex: {appointment.patient_gender}</span>
            <span>Ph: {appointment.patient_phone}</span>
            {appointment.patient_blood_group && <span>BG: {appointment.patient_blood_group}</span>}
          </div>
          {regDate && (
            <div className="text-[9px] text-gray-500 mt-0.5">Registered: {regDate}</div>
          )}
        </div>
      </div>

      {/* Vitals strip */}
      <Section title="Vitals" inline>
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

      <Section title="Chief Complaints / History">
        <Multiline value={consultation?.history} minLines={3} />
      </Section>

      <Section title="Examination">
        <Multiline value={consultation?.examination} minLines={3} />
      </Section>

      <Section title="Impression / Diagnosis">
        <Multiline value={consultation?.impression} minLines={2} />
      </Section>

      {rxItems.length > 0 && (
        <Section title="Prescription (Rx)">
          <table className="w-full text-[10px]" style={{ borderCollapse: 'collapse' }}>
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
                  <td style={{ padding: '2px 4px', fontWeight: 500 }}>{r.drug_name}</td>
                  <td style={{ padding: '2px 4px' }}>{r.dosage || '—'}</td>
                  <td style={{ padding: '2px 4px' }}>{r.frequency || '—'}</td>
                  <td style={{ padding: '2px 4px' }}>{r.duration || '—'}</td>
                  <td style={{ padding: '2px 4px' }}>{r.instructions || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

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

      <Section title="Advice / Notes">
        <Multiline value={consultation?.advice} minLines={3} />
      </Section>

      {/* Footer */}
      <div className="grid grid-cols-2 gap-4 mt-4 pt-3 border-t border-gray-300">
        <div>
          <div className="text-[9px] uppercase text-gray-500 font-semibold">Follow-up</div>
          <div className="text-xs text-gray-900 mt-0.5">
            {consultation?.follow_up_date ? fmtDate(consultation.follow_up_date) : '—'}
          </div>
        </div>
        <div className="text-right">
          <div className="inline-block text-center">
            {doctor.signature ? (
              <img src={doctor.signature} alt="Signature" className="h-10 w-48 object-contain ml-auto" />
            ) : (
              <div className="border-b border-gray-900 h-10 w-48" />
            )}
            <div className="text-[10px] text-gray-600 mt-1">{doctor.name} — Signature</div>
          </div>
        </div>
      </div>

      <div className="mt-2 text-center text-[9px] text-gray-400">
        This is a system generated OPD slip from {settings.clinic_name}. Not valid without doctor's signature.
      </div>
    </div>
  );
}

function Section({ title, children, inline = false }: { title: string; children: React.ReactNode; inline?: boolean }) {
  return (
    <div className="mt-3">
      <div className="text-[10px] uppercase tracking-wider font-bold text-blue-800 border-b border-blue-200 pb-0.5 mb-1">
        {title}
      </div>
      {inline ? children : <div>{children}</div>}
    </div>
  );
}

function Vital({ label, value }: { label: string; value?: string }) {
  return (
    <div className="border border-gray-200 rounded py-1 px-1">
      <div className="text-[8px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-xs font-semibold text-gray-900 mt-0.5 min-h-[16px]">{value || '\u00A0'}</div>
    </div>
  );
}

function Multiline({ value, minLines }: { value?: string | null; minLines: number }) {
  const lines = (value || '').split('\n').filter(Boolean);
  const fillers = Math.max(0, minLines - lines.length);
  return (
    <div className="text-[11px] text-gray-900 whitespace-pre-wrap leading-snug min-h-0">
      {value ? value : <span className="text-gray-300">—</span>}
      {fillers > 0 && (
        <div className="space-y-2 mt-1">
          {Array.from({ length: fillers }).map((_, i) => (
            <div key={i} className="border-b border-dotted border-gray-300 h-3" />
          ))}
        </div>
      )}
    </div>
  );
}
