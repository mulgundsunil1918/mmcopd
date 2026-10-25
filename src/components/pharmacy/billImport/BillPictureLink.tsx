/** "View the bill picture" on a purchase bill that was imported with one — the picture is kept in the app's own folder, so it is read through the app. */
import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { Modal } from '../../Modal';
import { base64ToBlob } from '../../../lib/base64';
import { PhotoPanel, type BillPicture } from './PhotoPanel';

export function BillPictureLink({ path }: { path: string }) {
  const [pic, setPic] = useState<BillPicture | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = useRef<string | null>(null);

  useEffect(() => () => { if (url.current) URL.revokeObjectURL(url.current); }, []);

  const open = async () => {
    setBusy(true); setMissing(false);
    try {
      const ph = await window.electronAPI.purchaseImport.photo(path);
      if (!ph) { setMissing(true); return; }
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(base64ToBlob(ph.base64, ph.mime));
      setPic({ url: url.current, mime: ph.mime, name: ph.name });
    } catch { setMissing(true); } finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={open}><Camera className="w-3.5 h-3.5" /> {busy ? 'Opening…' : 'View the bill picture'}</button>
      {missing && <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">The picture file could not be found (it may have been moved or deleted).</span>}
      {pic && (
        <Modal open onClose={() => setPic(null)} title="The supplier’s bill" size="xl">
          <div style={{ height: '70vh' }}><PhotoPanel picture={pic} onHide={() => setPic(null)} /></div>
        </Modal>
      )}
    </>
  );
}
