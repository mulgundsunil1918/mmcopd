/** The bill's picture (or PDF), shown beside the lines while they are checked. */
import { useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';

export interface BillPicture { url: string; mime: string; name: string }

export function PhotoPanel({ picture, onHide }: { picture: BillPicture; onHide: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [broken, setBroken] = useState(false);
  const isPdf = picture.mime === 'application/pdf' || /\.pdf$/i.test(picture.name);
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 flex flex-col h-full min-h-[320px] overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900">
        <div className="text-xs font-semibold truncate" title={picture.name}>Bill: {picture.name}</div>
        <div className="flex items-center gap-1 shrink-0">
          {!isPdf && !broken && (
            <>
              <button type="button" className="btn-ghost px-1.5 py-1" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}><Minus className="w-3.5 h-3.5" /></button>
              <button type="button" className="btn-ghost px-1.5 py-1 text-[11px] min-w-[44px]" title="Fit to the panel" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button type="button" className="btn-ghost px-1.5 py-1" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}><Plus className="w-3.5 h-3.5" /></button>
            </>
          )}
          <button type="button" className="btn-ghost px-1.5 py-1" aria-label="Hide the bill picture" title="Hide the bill picture" onClick={onHide}><X className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-gray-100 dark:bg-slate-950">
        {isPdf ? (
          <iframe src={picture.url} title="Bill PDF" className="w-full h-full min-h-[480px] border-0" />
        ) : broken ? (
          <div className="p-4 text-xs text-gray-600 dark:text-slate-300">This picture format cannot be shown here (for example an iPhone HEIC photo). It will still be kept with the purchase.</div>
        ) : (
          <img src={picture.url} alt="The supplier's bill" style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} onError={() => setBroken(true)} draggable={false} />
        )}
      </div>
    </div>
  );
}
