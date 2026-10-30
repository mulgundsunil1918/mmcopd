/**
 * What the hidden window shows when CureDesk makes a report into a PDF (#/pdf/lab/<id> or #/pdf/radiology/<id>): the report on its own, on white paper, with no
 * sign-in screen or menus in the way. The main process waits for the sheet to say it is ready, then prints the window to a PDF file.
 */
import { LabReportDocument } from './lab/LabReportDocument';
import { RadiologyPrint } from './radiology/RadiologyPrint';

export function PdfPage() {
  const m = /^#\/pdf\/(lab|radiology)\/(\d+)/.exec(window.location.hash);
  if (!m) return null;
  const id = Number(m[2]);
  return <div style={{ background: '#fff' }}>{m[1] === 'lab' ? <LabReportDocument orderId={id} /> : <RadiologyPrint orderId={id} onClose={() => undefined} />}</div>;
}
