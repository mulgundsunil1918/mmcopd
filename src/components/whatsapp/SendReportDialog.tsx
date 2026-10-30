/**
 * WhatsApp → "Lab Ready" / "Radiology Ready": ask WHICH report, make it a PDF, put the PDF on the clipboard as a file and open the patient's chat with the message
 * typed — the person clicks the message box, presses Ctrl+V (the PDF attaches) and Send. (WhatsApp cannot be handed a file by a link, so this is the way to send a
 * real PDF without any account or setup.) If the file cannot be copied, its folder is opened so it can be dragged into the chat.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, FolderOpen, Send } from 'lucide-react';
import { Modal } from '../Modal';
import { useToast } from '../../hooks/useToast';
import { buildWhatsAppUrl } from '../../lib/whatsapp';
import { cleanForWhatsApp } from '../../lib/messageText';
import { fmtDateTime } from '../../lib/utils';

export interface ReportTarget { patient_id: number; patient_name: string; patient_phone?: string | null }
type Row = { id: number; order_number: string; when: string; tests: string[]; reported: boolean };

export function SendReportDialog({ patient, kind, clinicName, countryCode, onClose, onSent }: {
  patient: ReportTarget; kind: 'lab' | 'radiology'; clinicName: string; countryCode: string; onClose: () => void; onSent: (what: string) => void;
}) {
  const toast = useToast();
  const word = kind === 'lab' ? 'lab' : 'radiology';
  const { data: rows, isLoading } = useQuery({
    queryKey: ['wa-reports', kind, patient.patient_id],
    queryFn: async (): Promise<Row[]> => {
      if (kind === 'lab') {
        const o = await window.electronAPI.lab.listOrders({ patient_id: patient.patient_id, window: 'all' });
        return o.map((x: any) => ({ id: x.id, order_number: x.order_number, when: x.ordered_at, tests: String(x.test_names || '').split('\u001f').filter(Boolean), reported: x.status === 'reported' }));
      }
      const o = await window.electronAPI.radiology.listOrders({ patient_id: patient.patient_id });
      return o.map((x: any) => ({ id: x.id, order_number: x.order_number, when: x.ordered_at, tests: String(x.test_names || '').split('\u001f').filter(Boolean), reported: x.status === 'reported' }));
    },
  });
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ path: string; copied: boolean; fileName: string } | null>(null);
  const chosen = rows?.find((r) => r.id === pick) ?? null;

  const send = async () => {
    if (!chosen) return;
    if (!patient.patient_phone?.replace(/\D/g, '')) { toast(`No phone number on record for ${patient.patient_name}`, 'error'); return; }
    setBusy(true);
    try {
      const pdf = await window.electronAPI.reports.makePdf(kind, chosen.id);
      if (!pdf.ok) { toast(pdf.error, 'error'); return; }
      const copied = (await window.electronAPI.app.copyFileToClipboard(pdf.path)).ok;
      const message = cleanForWhatsApp(`Hello ${patient.patient_name},\n\nPlease find your ${word} report (${chosen.order_number}) from *${clinicName}* attached as a PDF.\n\nThank you.`);
      const url = buildWhatsAppUrl(patient.patient_phone, message, countryCode);
      if (!url) { toast('Invalid phone number', 'error'); return; }
      const opened = await window.electronAPI.app.openExternal(url);
      if (!opened.ok) { toast(opened.error || 'Could not open WhatsApp', 'error'); return; }
      if (!copied) await window.electronAPI.app.showFile(pdf.path);
      setDone({ path: pdf.path, copied, fileName: pdf.fileName });
      onSent(`${kind === 'lab' ? 'Lab report' : 'Radiology report'} PDF`);
    } catch (e: any) { toast(e?.message || 'Could not prepare the report', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Send a ${word} report to ${patient.patient_name}`} size="lg">
      {done ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3 text-sm text-emerald-900 dark:text-emerald-200">
            <b>{done.fileName}</b> is ready. {done.copied
              ? <>WhatsApp is open on {patient.patient_name}’s chat: click the message box, press <b>Ctrl + V</b> (the PDF attaches), then press <b>Send</b>.</>
              : <>The PDF’s folder is open — drag <b>{done.fileName}</b> into the WhatsApp chat (or use the paper-clip), then press <b>Send</b>.</>}
          </div>
          <div className="flex justify-between gap-2">
            <button className="btn-secondary" onClick={() => window.electronAPI.app.showFile(done.path)}><FolderOpen className="w-4 h-4" /> Show the PDF file</button>
            <button className="btn-secondary" onClick={async () => { const r = await window.electronAPI.app.copyFileToClipboard(done.path); toast(r.ok ? 'PDF copied again — press Ctrl+V in the chat' : (r.error || 'Could not copy'), r.ok ? 'success' : 'error'); }}>Copy the PDF again</button>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-gray-600 dark:text-slate-400">Which report should {patient.patient_name} receive? It is sent as a PDF.</div>
          <div className="max-h-72 overflow-auto space-y-1.5">
            {isLoading && <div className="text-xs text-gray-500">Looking for {patient.patient_name}’s {word} reports…</div>}
            {rows && rows.length === 0 && <div className="text-sm text-gray-500 py-4 text-center">{patient.patient_name} has no {word} reports yet.</div>}
            {rows?.map((r) => (
              <label key={r.id} className={`flex items-start gap-3 rounded-lg border p-2.5 cursor-pointer ${pick === r.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'}`}>
                <input type="radio" name="wa-report" className="mt-1" checked={pick === r.id} onChange={() => setPick(r.id)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs">{r.order_number}</span>
                    <span className={`badge ${r.reported ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{r.reported ? 'Reported' : 'Not marked ready yet'}</span></div>
                  <div className="text-sm text-gray-900 dark:text-slate-100 truncate"><FileText className="w-3.5 h-3.5 inline mr-1 text-gray-400" />{r.tests.join(' · ') || 'Tests'}</div>
                  <div className="text-[11px] text-gray-500">{fmtDateTime(r.when)}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={!chosen || busy} onClick={send}><Send className="w-4 h-4" /> {busy ? 'Making the PDF…' : 'Make the PDF and open WhatsApp'}</button></div>
        </div>
      )}
    </Modal>
  );
}
