import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FileText, Printer } from 'lucide-react';
import { OpdSlip } from './OpdSlip';
import type { AppointmentWithJoins, Consultation, Doctor } from '../types';

/**
 * Settings-side preview of the OPD slip with fake patient + visit data.
 * Lets the admin verify how the slip will print without registering a real patient.
 */
export function SlipPreviewLauncher() {
  const [open, setOpen] = useState(false);
  // Bumping this on every preview-open forces React to mount a fresh OpdSlip
  // so any newly-saved settings / doctor data is visible immediately, even
  // within the 5-second staleTime of the global query cache.
  const [previewNonce, setPreviewNonce] = useState(0);
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
    refetchOnMount: 'always',
  });
  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => window.electronAPI.doctors.list(true),
    refetchOnMount: 'always',
  });

  // Force-fresh fetch right before opening so the preview reflects whatever the
  // user just edited in Clinic Info / Doctors above on this same Settings page.
  const openPreview = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['settings'] }),
      qc.invalidateQueries({ queryKey: ['doctors'] }),
      qc.invalidateQueries({ queryKey: ['doctors-all'] }),
    ]);
    setPreviewNonce((n) => n + 1);
    setOpen(true);
  };

  if (!settings) return null;

  const sampleDoctor: Doctor = doctors[0] || {
    id: 1,
    name: 'Dr. Sunil Mulgund',
    specialty: 'General Physician',
    phone: '9019263206',
    email: 'sunil@mmc.clinic',
    room_number: '101',
    is_active: 1,
    default_fee: 500,
    qualifications: 'MBBS, MD (Medicine)',
    registration_no: 'KMC-12345',
    signature: null,
    color: '#10b981',
  };

  const today = new Date();
  const dobYears3 = new Date(today.getFullYear() - 3, today.getMonth(), today.getDate() - 12);
  const sampleAppointment: AppointmentWithJoins = {
    id: 9999,
    patient_id: 9999,
    doctor_id: sampleDoctor.id,
    appointment_date: today.toISOString().slice(0, 10),
    appointment_time: '10:30',
    token_number: 7,
    consultation_token: null,
    status: 'Done',
    notes: 'Fever since 3 days, cough, body ache',
    created_at: today.toISOString(),
    patient_name: 'Rohit Kulkarni (sample)',
    patient_uhid: 'PT-PREVIEW-0001',
    patient_dob: dobYears3.toISOString().slice(0, 10),
    patient_gender: 'M',
    patient_phone: '9876543210',
    patient_blood_group: 'O+',
    patient_created_at: today.toISOString(),
    doctor_name: sampleDoctor.name,
    doctor_specialty: sampleDoctor.specialty,
    doctor_room: sampleDoctor.room_number,
  } as AppointmentWithJoins;

  const sampleConsultation: Consultation = {
    id: 9999,
    appointment_id: 9999,
    patient_id: 9999,
    doctor_id: sampleDoctor.id,
    history: 'Fever since 3 days, cough, body ache. No vomiting or loose stools. Eating reduced since yesterday.',
    examination: 'Throat congested, mild tonsillar enlargement. Chest clear. CVS — S1 S2 normal. P/A — soft, non-tender.',
    impression: 'Acute viral upper respiratory tract infection.',
    advice: 'Steam inhalation BD\nWarm fluids generously\nReturn for review if fever persists > 48h or any new symptoms appear.',
    follow_up_date: new Date(today.getTime() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    vitals: { bp: '110/72', pulse: '92', temp: '101.4', spo2: '98', rr: '20', weight: '14', height: '95' },
    created_at: today.toISOString(),
    updated_at: today.toISOString(),
  } as Consultation;

  const sampleRx = [
    { drug_name: 'Crocin Syrup 60ml', dosage: '5 ml', frequency: 'TID', duration: '3 days', instructions: 'After food' },
    { drug_name: 'ORS Sachet', dosage: '1 sachet', frequency: 'PRN', duration: 'As needed', instructions: 'In 200 ml water' },
    { drug_name: 'Cetirizine 10mg', dosage: '½ tab', frequency: 'HS', duration: '5 days', instructions: 'At night' },
  ] as any;

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">OPD Slip Preview</h2>
        </div>
        <button className="btn-primary text-xs" onClick={openPreview}>
          <Eye className="w-3.5 h-3.5" /> Preview Slip
        </button>
      </div>
      <p className="text-[11px] text-gray-500 dark:text-slate-400">
        See how a real OPD slip will look using your clinic's current logo, name, contact info, and the first
        active doctor — with sample patient/visit data filled in. Once it looks right, you can hit
        <Printer className="inline w-3 h-3 mx-1" /> in the preview to print a test page on your printer.
      </p>
      <ul className="text-[11px] text-gray-600 dark:text-slate-300 mt-2 list-disc pl-5 space-y-0.5">
        <li>Clinic branding pulls from <b>Clinic Info</b> above (logo, name, tagline, reg no, address, phone, email).</li>
        <li>Doctor row pulls from the first active doctor in <b>Doctors</b>; their qualifications, color, signature show as configured.</li>
        <li>Patient block uses sample 3-year-old paediatric data — confirms age (Y/M/D), UHID and Visit ID layout work.</li>
        <li>To change the visual layout, edit <code className="font-mono">src/components/OpdSlip.tsx</code> (or ask Claude to change it for you).</li>
      </ul>

      {open && (
        <OpdSlip
          key={previewNonce}
          appointment={sampleAppointment}
          consultation={sampleConsultation}
          doctor={sampleDoctor}
          settings={settings}
          rxItems={sampleRx}
          labOrders={[]}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}
