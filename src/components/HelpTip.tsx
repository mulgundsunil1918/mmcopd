/**
 * The little "?" that explains a setting in plain language.
 *
 * A clinic owner should never have to guess what a switch does, or go hunting in
 * a manual. Every settings section carries one of these; clicking it opens a
 * short, jargon-free explanation right where the question was asked — what it
 * does, when you'd want it, and what happens if you get it wrong.
 *
 * Deliberately click-to-open rather than hover: hover tooltips are unusable on a
 * touchscreen reception PC and unreadable if the text is longer than a line.
 */
import { useEffect, useRef, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';

export function HelpTip({ title, children, align = 'left' }: {
  title?: string;
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape, so it never traps the user.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <span className="relative inline-flex" ref={boxRef}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label={title ? `What is ${title}?` : 'What does this do?'}
        title="What does this do?"
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition align-middle"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          className={`absolute z-[300] top-6 ${align === 'right' ? 'right-0' : 'left-0'} w-[320px] max-w-[85vw]
            rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-3 text-left`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            {title && <div className="text-[12px] font-bold text-gray-900 dark:text-slate-100">{title}</div>}
            <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 shrink-0 ml-auto">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="text-[11.5px] text-gray-600 dark:text-slate-300 leading-relaxed space-y-1.5 normal-case tracking-normal font-normal">
            {children}
          </div>
        </div>
      )}
    </span>
  );
}
