import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LogOut, BedDouble, User, Phone, Calendar, ShieldAlert, Printer } from 'lucide-react';
import { Modal } from '../Modal';
import { WardCare } from './WardCare';
import { BillPreview } from '../billing/BillPreview';
import { BillPrint } from '../billing/BillPrint';
import { DischargeModal } from './DischargeModal';
import { fmtDateTime } from '../../lib/utils';

/**
 * The hub for one admitted patient: header, the in-ward clinical record, the
 * running bill, and the discharge action. Opened from the ward map or the
 * admitted list.
 */
export function AdmissionDetail({ admissionId, onClose }: { admissionId: number; onClose: () => void }) {
  const [discharging, setDischarging] = useState(false);
  const [printing, setPrinting] = useState(false);

  // The admitted list already carries the joined patient fields; fetch the row.
  const { data: admissions = [] } = useQuery({
    queryKey: ['ip-admissions', 'admitted'],
    queryFn: () => window.electronAPI.ip.list({ status: 'admitted' }),
  });
  const admission = admissions.find((a: any) => a.id === admissionId);

  if (!admission) {
    return (
      <Modal open onClose={onClose} title="Admission" size="xl">
        <div className="p-6 text-center text-[13px] text-gray-500">
          This admission is no longer in the admitted list — it may have just been discharged. Close and refresh.
        </div>
      </Modal>
    );
  }

  const daysIn = (() => {
    const t = new Date(admission.admitted_at).getTime();
    return Number.isNaN(t) ? 0 : Math.max(1, Math.floor((Date.now() - t) / 86_400_000) + 1);
  })();

  return (
    <>
      <Modal open onClose={onClose} title={`${admission.patient_name} · ${admission.admission_number}`} size="xl">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b dark:border-slate-700">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-gray-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> {admission.patient_uhid}</span>
              <span className="inline-flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {admission.patient_phone}</span>
              <span className="inline-flex items-center gap-1.5"><BedDouble className="w-3.5 h-3.5" /> {admission.ward || '—'} / {admission.bed_number || '—'}</span>
              <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Day {daysIn} · admitted {fmtDateTime(admission.admitted_at)}</span>
              {admission.doctor_name && <span>Dr. {admission.doctor_name}</span>}
              {admission.is_mlc ? <span className="inline-flex items-center gap-1 text-amber-600 font-semibold"><ShieldAlert className="w-3.5 h-3.5" /> MLC</span> : null}
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary text-xs" onClick={() => setPrinting(true)}>
                <Printer className="w-3.5 h-3.5" /> Print bill
              </button>
              <button className="btn-primary text-xs" onClick={() => setDischarging(true)}>
                <LogOut className="w-3.5 h-3.5" /> Discharge
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <WardCare admissionId={admissionId} />
            </div>
            <div>
              <BillPreview admissionId={admissionId} />
            </div>
          </div>
        </div>
      </Modal>

      {discharging && (
        <DischargeModal
          admission={admission}
          onClose={() => setDischarging(false)}
          onDischarged={() => { setDischarging(false); onClose(); }}
        />
      )}

      {printing && <BillPrint admissionId={admissionId} onClose={() => setPrinting(false)} />}
    </>
  );
}
