import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
}) {
  // Track where the mouse was originally pressed. Only treat a backdrop click
  // as a "close" if BOTH mousedown and mouseup landed on the backdrop itself.
  // Otherwise an inside-to-outside drag (e.g. selecting text, layout reflow
  // mid-click) would falsely close the modal.
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);

  if (!open) return null;
  // '2xl' / 'full' are for work surfaces (an IPD admission, a bill) that need
  // room for side-by-side panels — 'xl' (896px) squeezes them.
  const widths: Record<string, string> = {
    sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-2xl', xl: 'max-w-4xl',
    '2xl': 'max-w-6xl', full: 'max-w-[95vw]',
  };
  const tall = size === '2xl' || size === 'full';

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 no-print"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div
        className={`card w-full ${widths[size]} ${tall ? 'h-[92vh] max-h-[92vh]' : 'max-h-[90vh]'} flex flex-col`}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
