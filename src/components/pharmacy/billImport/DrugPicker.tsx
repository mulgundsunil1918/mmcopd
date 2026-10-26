/**
 * "Which medicine is this?" — a search box over the Drug List. The suggestions for the bill's name come first; typing narrows the whole list.
 * The list is only drawn while it is open, so a bill with sixty lines stays quick.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, Search } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { Candidate } from '../../../lib/billImport';
import type { DrugMaster } from '../../../types';

const comp = (d: { generic_name?: string | null; strength?: string | null; form?: string | null }) => [d.generic_name, d.strength, d.form].filter(Boolean).join(' · ');
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

type Entry = { id: number; name: string; sub: string; group: 'Suggested for this name' | 'My Drug List'; reason?: string };

export function DrugPicker({ value, newSelected, candidates, drugs, invalid, onPick, onNew }: {
  /** The chosen medicine's id, or null. */
  value: number | null;
  /** The line is set to be added as a new medicine. */
  newSelected: boolean;
  candidates: Candidate[];
  drugs: DrugMaster[];
  invalid?: boolean;
  onPick: (id: number | null) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const chosen = value !== null ? drugs.find((d) => d.id === value) ?? null : null;
  const chosenCand = value !== null ? candidates.find((c) => c.id === value) ?? null : null;

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    // capture phase: the dialog around this screen stops a mouse-down from reaching the document, so a normal listener never heard a click made inside it
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, [open]);
  useEffect(() => { if (open) { setHi(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  const entries = useMemo<Entry[]>(() => {
    if (!open) return [];
    const needle = norm(q);
    const match = (name: string, sub: string) => !needle || needle.split(' ').every((w) => norm(`${name} ${sub}`).includes(w));
    const out: Entry[] = [];
    const seen = new Set<number>();
    for (const c of candidates) {
      if (match(c.name, c.composition)) { out.push({ id: c.id, name: c.name, sub: c.composition, group: 'Suggested for this name', reason: c.reason }); seen.add(c.id); }
    }
    let n = 0;
    for (const d of drugs) {
      if (seen.has(d.id) || !match(d.name, comp(d))) continue;
      out.push({ id: d.id, name: d.name, sub: comp(d), group: 'My Drug List' });
      if (++n >= 60) break;
    }
    return out;
  }, [open, q, candidates, drugs]);

  const pick = (id: number | null) => { setOpen(false); setQ(''); onPick(id); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(entries.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const en = entries[hi]; if (en) pick(en.id); }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
  };

  const label = newSelected ? 'A new medicine (added when you import)' : chosen ? chosen.name : chosenCand ? chosenCand.name : '';
  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className={cn('input text-left flex items-center justify-between gap-2', invalid && 'border-red-500 bg-red-50 dark:bg-red-900/20 ring-1 ring-red-300 dark:ring-red-800')}
        aria-haspopup="listbox" aria-expanded={open}>
        <span className={cn('truncate', !label && 'text-gray-400')}>{label || '— choose the medicine —'}</span>
        <ChevronDown className="w-4 h-4 shrink-0 text-gray-400" />
      </button>
      {open && (
        <div className="absolute z-[250] left-0 right-0 mt-1 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-slate-800">
            <Search className="w-4 h-4 text-gray-400" />
            <input ref={input} className="flex-1 bg-transparent text-sm outline-none" placeholder="Type to search my Drug List…" value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={onKey} />
          </div>
          <ul role="listbox" className="max-h-64 overflow-auto py-1">
            <li>
              <button type="button" className="w-full text-left px-3 py-2 text-sm text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-2"
                onClick={() => { setOpen(false); onNew(); }}>
                <Plus className="w-4 h-4" /> It is not in my list — add it as a new medicine
              </button>
            </li>
            {entries.length === 0 && <li className="px-3 py-3 text-xs text-gray-500">Nothing in your Drug List matches “{q}”. If it is a new medicine, add it above.</li>}
            {entries.map((en, i) => (
              <li key={en.id} role="option" aria-selected={en.id === value}>
                {(i === 0 || entries[i - 1].group !== en.group) && <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">{en.group}</div>}
                <button type="button" onMouseEnter={() => setHi(i)} onClick={() => pick(en.id)}
                  className={cn('w-full text-left px-3 py-1.5 text-sm', i === hi ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-slate-800', en.id === value && 'font-semibold')}>
                  <div className="truncate">{en.name}</div>
                  {(en.sub || en.reason) && <div className="text-[11px] text-gray-500 dark:text-slate-400 truncate">{[en.sub, en.reason].filter(Boolean).join(' · ')}</div>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
