import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, UserPlus, Search, LogOut, User } from 'lucide-react';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../hooks/useToast';
import { cn, fmtDateTime } from '../lib/utils';

type Tab = 'admitted' | 'discharged' | 'all';

export function IPD() {
  const [tab, setTab] = useState<Tab>('admitted');
  const [admitOpen, setAdmitOpen] = useState(false);
  const [dischargeTarget, setDischargeTarget] = useState<any | null>(null);
  const qc = useQueryClient();
  const toast = useToast();

  const { data: admissions = [] } = useQuery({
    queryKey: ['ip-admissions', tab],
    queryFn: () => window.electronAPI.ip.list({ status: tab === 'all' ? undefined : tab }),
    refetchInterval: 30_000,
  });

  const discharge = useMutation({
    mutationFn: ({ id, summary }: { id: number; summary: string }) => window.electronAPI.ip.discharge(id, summary),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ip-admissions'] }); toast('Discharged'); setDischargeTarget(null); },
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">In-Patient (IPD)</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">Admissions, ward & bed management, discharge summaries.</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex bg-gray-100 dark:bg-slate-700 p-1 rounded-lg">
            <TabBtn active={tab === 'admitted'} onClick={() => setTab('admitted')}>Admitted</TabBtn>
            <TabBtn active={tab === 'discharged'} onClick={() => setTab('discharged')}>Discharged</TabBtn>
            <TabBtn active={tab === 'all'} onClick={() => setTab('all')}>All</TabBtn>
          </div>
          <button className="btn-primary" onClick={() => setAdmitOpen(true)}>
            <UserPlus className="w-4 h-4" /> Admit Patient
          </button>
        </div>
      </div>

      <div className="card p-4">
        {admissions.length === 0 ? (
          <EmptyState icon={BedDouble} title="No admissions" description="Click “Admit Patient” to add an in-patient." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                <th className="py-2">Admission #</th>
                <th className="py-2">Patient</th>
                <th className="py-2">Doctor</th>
                <th className="py-2">Ward / Bed</th>
                <th className="py-2">Admitted</th>
                <th className="py-2">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {admissions.map((a) => (
                <tr key={a.id} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="py-2 font-mono text-xs text-gray-700 dark:text-slate-200">{a.admission_number}</td>
                  <td className="py-2">
                    <div className="font-medium text-gray-900 dark:text-slate-100">{a.patient_name}</div>
                    <div className="text-[11px] text-gray-500 dark:text-slate-400">{a.patient_uhid} · {a.patient_phone}</div>
                  </td>
                  <td className="py-2 text-gray-600 dark:text-slate-300">{a.doctor_name || '—'}</td>
                  <td className="py-2 text-gray-700 dark:text-slate-200">
                    {a.ward || '—'} / {a.bed_number || '—'}
                  </td>
                  <td className="py-2 text-xs text-gray-500 dark:text-slate-400">{fmtDateTime(a.admitted_at)}</td>
                  <td className="py-2">
                    <span className={cn(
                      'badge',
                      a.status === 'admitted' && 'bg-emerald-100 text-emerald-700',
                      a.status === 'discharged' && 'bg-gray-200 text-gray-700',
                      a.status === 'cancelled' && 'bg-red-100 text-red-700'
                    )}>{a.status}</span>
                  </td>
                  <td className="py-2 text-right">
                    {a.status === 'admitted' && (
                      <button className="btn-secondary text-xs" onClick={() => setDischargeTarget(a)}>
                        <LogOut className="w-3.5 h-3.5" /> Discharge
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AdmitModal open={admitOpen} onClose={() => setAdmitOpen(false)} onAdmitted={() => { qc.invalidateQueries({ queryKey: ['ip-admissions'] }); toast('Patient admitted'); setAdmitOpen(false); }} />

      <Modal open={!!dischargeTarget} onClose={() => setDischargeTarget(null)} title="Discharge Summary" size="lg">
        {dischargeTarget && (
          <DischargeForm
            admission={dischargeTarget}
            onSubmit={(summary) => discharge.mutate({ id: dischargeTarget.id, summary })}
            pending={discharge.isPending}
          />
        )}
      </Modal>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('px-3 py-1.5 rounded-md text-xs font-medium', active ? 'bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 shadow-sm' : 'text-gray-600 dark:text-slate-300')}>
      {children}
    </button>
  );
}

function AdmitModal({ open, onClose, onAdmitted }: { open: boolean; onClose: () => void; onAdmitted: () => void }) {
  const [q, setQ] = useState('');
  const [patient, setPatient] = useState<any | null>(null);
  const [doctorId, setDoctorId] = useState<number | ''>('');
  const [bed, setBed] = useState('');
  const [ward, setWard] = useState('General');
  const [notes, setNotes] = useState('');

  const { data: searchResults = [] } = useQuery({
    queryKey: ['patient-search-admit', q],
    queryFn: () => window.electronAPI.patients.search(q),
    enabled: open && !patient,
  });
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });

  const admit = useMutation({
    mutationFn: () => window.electronAPI.ip.admit({
      patient_id: patient.id,
      admission_doctor_id: doctorId === '' ? undefined : Number(doctorId),
      bed_number: bed || undefined,
      ward: ward || undefined,
      admission_notes: notes || undefined,
    }),
    onSuccess: onAdmitted,
  });

  return (
    <Modal open={open} onClose={onClose} title="Admit Patient" size="lg">
      <div className="space-y-4">
        {patient ? (
          <div className="flex items-center justify-between card p-3">
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{patient.first_name} {patient.last_name}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400">{patient.uhid} · {patient.phone}</div>
            </div>
            <button className="btn-ghost text-xs" onClick={() => setPatient(null)}>Change</button>
          </div>
        ) : (
          <div>
            <label className="label">Patient *</label>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input className="input pl-9" placeholder="Search name / UHID / phone" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <ul className="mt-2 max-h-52 overflow-auto border border-gray-200 dark:border-slate-700 rounded-lg divide-y divide-gray-100 dark:divide-slate-700">
              {searchResults.slice(0, 10).map((p: any) => (
                <li key={p.id} onClick={() => setPatient(p)} className="px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700">
                  <div className="text-sm text-gray-900 dark:text-slate-100">{p.first_name} {p.last_name}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400">{p.uhid} · {p.phone}</div>
                </li>
              ))}
              {searchResults.length === 0 && (
                <li className="text-center text-xs text-gray-400 py-4">No matches</li>
              )}
            </ul>
          </div>
        )}

        <div>
          <label className="label">Admitting Doctor</label>
          <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">—</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.specialty}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Ward</label><input className="input" value={ward} onChange={(e) => setWard(e.target.value)} /></div>
          <div><label className="label">Bed Number</label><input className="input" value={bed} onChange={(e) => setBed(e.target.value)} /></div>
        </div>

        <div>
          <label className="label">Admission Notes</label>
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason for admission, diagnosis…" />
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => admit.mutate()} disabled={!patient || admit.isPending}>
            {admit.isPending ? 'Admitting…' : 'Confirm Admission'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DischargeForm({ admission, onSubmit, pending }: { admission: any; onSubmit: (s: string) => void; pending: boolean }) {
  const [summary, setSummary] = useState('');
  return (
    <div className="space-y-3">
      <div className="card p-3 bg-gray-50 dark:bg-slate-900">
        <div className="flex items-center gap-2"><User className="w-4 h-4 text-blue-600" /><div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{admission.patient_name}</div></div>
        <div className="text-xs text-gray-500 dark:text-slate-400">{admission.admission_number} · Admitted {fmtDateTime(admission.admitted_at)}</div>
      </div>
      <div>
        <label className="label">Discharge Summary *</label>
        <textarea className="input" rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Condition on admission, treatment given, condition at discharge, advice, medications, follow-up…" />
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-primary" disabled={pending || !summary.trim()} onClick={() => onSubmit(summary)}>
          {pending ? 'Discharging…' : 'Confirm Discharge'}
        </button>
      </div>
    </div>
  );
}
