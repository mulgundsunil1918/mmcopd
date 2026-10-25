/**
 * Pharmacy → Purchases → Import bill.
 *
 *   steps 1-2-3  copy the instructions · give ChatGPT the bill · upload the Excel it made          (GuideSteps)
 *   check        every line against the paper, red boxes to fill, set aside what cannot be settled  (ReviewScreen)
 *   IMPORT       typed by the person — only then does anything reach the stock
 *   waiting      the lines that were set aside, to be finished later                                  (WaitingList)
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, FilePlus2, Pause } from 'lucide-react';
import { Modal } from '../../Modal';
import { useToast } from '../../../hooks/useToast';
import { formatINR } from '../../../lib/utils';
import { base64ToBlob } from '../../../lib/base64';
import type { Draft, ImportResult, WaitingRow } from '../../../lib/billImport';
import { GuideSteps, type Parsed } from './GuideSteps';
import { ReviewScreen } from './ReviewScreen';
import { WaitingList, WAITING_KEY } from './WaitingList';
import type { BillPicture } from './PhotoPanel';
import { Banner } from './ui';

type Imported = Extract<ImportResult, { ok: true }>;
type Review = {
  name: 'review'; key: number; draft: Draft; notices: string[]; duplicate: { id: number; date: string } | null;
  picture: BillPicture | null; photoFile: File | null; waitingId: number | null; title: string; backTo: 'guide' | 'waiting';
};
type View = { name: 'guide' } | { name: 'waiting' } | Review | { name: 'done'; result: Imported };

/** Everything an import can change, so the other screens show it at once. */
const CHANGED = ['purchases', 'pharmacy-drugs', 'pharmacy-drugs-active', 'pharmacy-alerts', 'pharmacy-clinic-stock', 'wholesalers', 'wholesalers-summary', 'pharmacy-batches', 'supplier-report',
  'pharmacy-valuation', 'drug-price-history', 'supplier-statement', 'supplier-accounts', WAITING_KEY];

export function ImportBillModal({ onClose, start = 'guide', onOpenBill }: { onClose: () => void; start?: 'guide' | 'waiting'; onOpenBill?: (invoiceId: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<View>(start === 'waiting' ? { name: 'waiting' } : { name: 'guide' });
  const [leave, setLeave] = useState<null | 'close' | 'back'>(null);       // "lose your changes?" before leaving the checking screen
  const [finishing, setFinishing] = useState<number | null>(null);
  const keyRef = useRef(0);
  const urls = useRef<string[]>([]);
  const isDemo = typeof window !== 'undefined' && (window as any).__CUREDESK_DEMO__ === true;
  const { data: waiting = [] } = useQuery({ queryKey: [WAITING_KEY], queryFn: () => window.electronAPI.purchaseImport.waiting() });

  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);
  const track = (url: string) => { urls.current.push(url); return url; };

  const openReview = (r: Omit<Review, 'name' | 'key'>) => { setLeave(null); setView({ name: 'review', key: ++keyRef.current, ...r }); };

  const onParsed = (p: Parsed) => {
    openReview({
      draft: p.result.draft, notices: p.result.notices, duplicate: p.result.duplicate,
      picture: p.photo ? { url: track(p.photo.url), mime: p.photo.file.type, name: p.photo.file.name } : null,
      photoFile: p.photo?.file ?? null, waitingId: null, title: 'Start again with another file', backTo: 'guide',
    });
  };

  const finishById = async (id: number) => {
    setFinishing(id);
    try {
      const r = await window.electronAPI.purchaseImport.waitingGet(id);
      if (!r.ok) { toast(r.error, 'error'); qc.invalidateQueries({ queryKey: [WAITING_KEY] }); return; }
      let picture: BillPicture | null = null;
      if (r.scan_path) {
        const ph = await window.electronAPI.purchaseImport.photo(r.scan_path);
        if (ph) picture = { url: track(URL.createObjectURL(base64ToBlob(ph.base64, ph.mime))), mime: ph.mime, name: ph.name };
      }
      openReview({ draft: r.draft, notices: [], duplicate: null, picture, photoFile: null, waitingId: id, title: 'Back to the waiting list', backTo: 'waiting' });
    } catch (e: any) {
      toast(String(e?.message || 'Could not open it'), 'error');
    } finally { setFinishing(null); }
  };

  const imported = (result: Imported) => {
    for (const k of CHANGED) qc.invalidateQueries({ queryKey: [k] });
    toast(result.duplicate ? 'This bill was already imported — nothing was added twice.' : `Imported · ${result.lines} line${result.lines === 1 ? '' : 's'} added to your stock`);
    setView({ name: 'done', result });
  };

  const requestClose = () => { if (view.name === 'review') setLeave('close'); else onClose(); };
  const requestBack = () => { if (view.name === 'review') setLeave('back'); };
  const confirmLeave = () => {
    if (leave === 'close') { onClose(); return; }
    if (view.name === 'review') setView(view.backTo === 'waiting' ? { name: 'waiting' } : { name: 'guide' });
    setLeave(null);
  };

  return (
    <Modal open onClose={requestClose} title="Import a supplier’s bill" size={view.name === 'review' ? 'full' : 'xl'}>
      {leave && (
        <Banner tone="amber" title={leave === 'close' ? 'Close without importing?' : 'Go back without importing?'} className="mb-3">
          <p>Nothing has been added to your stock. What you have checked or typed on this screen will be lost.</p>
          <div className="flex gap-2 pt-1">
            <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => setLeave(null)}>Keep working</button>
            <button className="btn-danger text-xs px-3 py-1.5" onClick={confirmLeave}>{leave === 'close' ? 'Close' : 'Go back'}</button>
          </div>
        </Banner>
      )}

      {view.name === 'guide' && <GuideSteps waitingCount={waiting.length} onParsed={onParsed} onOpenWaiting={() => setView({ name: 'waiting' })} isDemo={isDemo} />}

      {view.name === 'waiting' && (
        <WaitingList finishing={finishing} onBack={() => setView({ name: 'guide' })} onFinish={(row: WaitingRow) => finishById(row.id)} />
      )}

      {view.name === 'review' && (
        <ReviewScreen key={view.key} initial={view.draft} notices={view.notices} duplicate={view.duplicate} picture={view.picture} photoFile={view.photoFile}
          waitingId={view.waitingId} title={view.title} onBack={requestBack} onImported={imported} />
      )}

      {view.name === 'done' && (
        <div className="space-y-3 max-w-3xl">
          <Banner tone="green" title={`Imported — invoice ${view.result.invoice_number}`}>
            <p>
              <b>{view.result.lines}</b> medicine line{view.result.lines === 1 ? '' : 's'} · <b>{formatINR(view.result.total)}</b> added to your stock{view.result.batches > 0 && <> in {view.result.batches} batch{view.result.batches === 1 ? '' : 'es'}</>}.
            </p>
            {view.result.new_supplier && <p>The supplier was added to your Wholesalers list.</p>}
            {view.result.new_drugs > 0 && <p><b>{view.result.new_drugs}</b> new medicine{view.result.new_drugs === 1 ? ' was' : 's were'} added to your Drug List — you can add the price and other details there later.</p>}
            {view.result.aliases_saved > 0 && <p>CureDesk remembered {view.result.aliases_saved} name{view.result.aliases_saved === 1 ? '' : 's'} you matched, so the next bill from this supplier needs fewer clicks.</p>}
            <p>The amount is on the supplier’s account — see it under Wholesalers → Statement.</p>
          </Banner>
          {view.result.aside > 0 && view.result.waiting_id !== null && (
            <Banner tone="amber" title={`${view.result.aside} line${view.result.aside === 1 ? ' is' : 's are'} waiting — NOT in your stock yet`}>
              <p>You set them aside. They are saved under “Waiting to finish” (with the bill’s picture, if you added one) until you fill them in.</p>
              <div className="flex gap-2 pt-1">
                <button className="btn-primary text-xs px-3 py-1.5" disabled={finishing !== null} onClick={() => finishById(view.result.waiting_id as number)}><Pause className="w-3.5 h-3.5" /> Finish them now</button>
                <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => setView({ name: 'waiting' })}>See the waiting list</button>
              </div>
            </Banner>
          )}
          <div className="flex gap-2 flex-wrap pt-1">
            {onOpenBill && <button className="btn-secondary" onClick={() => { onOpenBill(view.result.invoice_id); onClose(); }}><ExternalLink className="w-4 h-4" /> Open the purchase bill</button>}
            <button className="btn-secondary" onClick={() => setView({ name: 'guide' })}><FilePlus2 className="w-4 h-4" /> Import another bill</button>
            <button className="btn-primary" onClick={onClose}><CheckCircle2 className="w-4 h-4" /> Done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
