import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { PrintHeader } from '../print/PrintHeader';
import { ageStringFull, fmtDateTime } from '../../lib/utils';
import { MODALITY_LABEL } from '../../data/radiology-catalog';
import type { Settings } from '../../types';

/**
 * The radiology REPORT on the clinic letterhead: who the patient is, who referred them, and
 * for each scan the radiologist's findings and impression, signed off with name and time.
 * (The radiology BILL prints through the standard bill — one document, one source of truth.)
 *
 * Long reports flow onto a second sheet cleanly: each scan's block is kept together, and
 * the shared print rules (index.css) make sure a one-page report is exactly one sheet.
 */
export function RadiologyPrint({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: order, isLoading } = useQuery({
    queryKey: ['radiology-order', orderId],
    queryFn: () => window.electronAPI.radiology.getOrder(orderId),
  });

  if (isLoading || !settings || !order) {
    return (
      <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center">
        <div className="card p-8 text-sm">Loading report…</div>
      </div>
    );
  }

  const s = settings as Settings;
  const items = order.items || [];
  const reported = order.status === 'reported';
  const sexWord = order.patient_gender === 'M' ? 'Male' : order.patient_gender === 'F' ? 'Female' : order.patient_gender || '';
  const ageSex = [order.patient_dob ? ageStringFull(order.patient_dob) : '', sexWord].filter(Boolean).join(' · ');
  const when = order.performed_at || order.ordered_at;

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 overflow-auto p-4">
      <div className="no-print max-w-[210mm] mx-auto flex items-center justify-between gap-2 mb-2">
        {!reported && (
          <span className="text-white text-[12px] bg-black/40 rounded px-2 py-1">
            Draft — the report has not been marked ready yet
          </span>
        )}
        <div className="flex-1" />
        <button className="btn-primary" onClick={() => window.print()}><Printer className="w-4 h-4" /> Print</button>
        <button className="btn-secondary" onClick={onClose}><X className="w-4 h-4" /> Close</button>
      </div>

      <div className="print-area mx-auto bg-white text-slate-900" data-report-ready="1" style={{ width: '210mm', minHeight: '297mm', padding: '12mm 14mm' }}>
        <PrintHeader settings={s} accent="#0369a1" />

        <div className="text-center my-3">
          <span className="inline-block px-4 py-1 rounded font-bold tracking-wide" style={{ background: '#f0f9ff', color: '#0369a1', fontSize: 14 }}>
            RADIOLOGY REPORT{!reported ? ' (DRAFT)' : ''}
          </span>
        </div>

        <div className="flex justify-between gap-6 text-[12px] mb-3 p-3 rounded" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Patient</div>
            <div className="font-bold text-[13px] text-slate-900">{order.patient_name || '—'}</div>
            <div className="text-slate-600">
              {order.patient_uhid ? <>UHID: {order.patient_uhid}</> : null}
              {ageSex ? <> · {ageSex}</> : null}
            </div>
            {order.patient_phone && <div className="text-slate-600">☎ {order.patient_phone}</div>}
          </div>
          <div className="text-right space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Order</div>
            <div className="text-slate-700 font-medium font-mono">{order.order_number}</div>
            <div className="text-slate-600">{fmtDateTime(when)}</div>
            {order.referred_by && <div className="text-slate-600"><b>Referral:</b> {order.referred_by}</div>}
            {order.doctor_name && <div className="text-slate-600"><b>Consultant:</b> {order.doctor_name.startsWith('Dr') ? order.doctor_name : `Dr. ${order.doctor_name}`}</div>}
          </div>
        </div>

        {order.clinical_info && (
          <div className="text-[12px] mb-3">
            <span className="font-bold uppercase text-[10px] tracking-wide text-slate-500">Clinical information: </span>
            <span className="whitespace-pre-wrap">{order.clinical_info}</span>
          </div>
        )}

        <div className="space-y-4">
          {items.map((it, i) => (
            <div key={it.id} style={{ breakInside: 'avoid', pageBreakInside: 'avoid', borderTop: i === 0 ? '1.5px solid #cbd5e1' : '1px solid #e2e8f0', paddingTop: 8 }}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-bold text-[14px] uppercase tracking-wide" style={{ color: '#0f172a' }}>{it.test_name}</div>
                {it.modality && <div className="text-[10px] text-slate-500">{MODALITY_LABEL[it.modality] ?? it.modality}</div>}
              </div>
              {(it.findings || it.impression) ? (
                <div className="mt-1.5 space-y-2">
                  {it.findings && (
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Findings</div>
                      <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{it.findings}</div>
                    </div>
                  )}
                  {it.impression && (
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Impression</div>
                      <div className={`text-[13px] leading-relaxed whitespace-pre-wrap font-semibold ${it.is_abnormal ? 'text-red-700' : ''}`}>
                        {it.impression}{it.is_abnormal ? ' ⚑' : ''}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-1.5 text-[12px] text-slate-400 italic">Report not written yet.</div>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-between items-end mt-10 text-[11px]" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          <div className="text-slate-500 max-w-[95mm]">
            ⚑ = abnormal finding. Computer-generated report — correlate clinically. This report is not valid without the radiologist’s signature.
          </div>
          <div className="text-center">
            <div style={{ borderTop: '1px solid #94a3b8', width: '62mm', paddingTop: 4 }}>
              {order.reported_by ? (order.reported_by.toLowerCase().startsWith('dr') ? order.reported_by : `Dr. ${order.reported_by}`) : 'Radiologist'}
            </div>
            <div className="text-slate-600 mt-0.5">
              {order.reported_at ? `Reported ${fmtDateTime(order.reported_at)}` : 'Radiologist / Reporting doctor'}
            </div>
            <div className="text-slate-600">For {s.clinic_name || 'the clinic'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
