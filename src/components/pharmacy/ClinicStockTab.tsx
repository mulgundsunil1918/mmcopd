/**
 * "Drugs in my clinic" — the drugs the clinic actually holds, one row each (this replaces the old Stock & Batches tab and the
 * stock column of Drug Master). What each shelf looks like: units in stock, the next expiry, what a unit costs, what it sells for.
 * Click a drug to see its batches. The low-stock / expiry alerts live here as filters. Which drugs exist at all is the Drug List's job.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, Layers, Pencil, Plus, Search } from 'lucide-react';
import { Modal } from '../Modal';
import { EmptyState } from '../EmptyState';
import { useToast } from '../../hooks/useToast';
import { cn, fmtDate, formatINR } from '../../lib/utils';
import type { ClinicStockRow, DrugMaster, DrugStockBatch } from '../../types';
import { DrugEditModal } from './DrugEditModal';
import { QuickDrugModal } from './QuickDrugModal';
import { Field, ScheduleBadge, daysUntil } from './shared';

export type ClinicFilter = 'all' | 'low' | 'out' | 'expiring' | 'expired' | 'cost';

const CHIPS: { key: ClinicFilter; label: string; tone: string; title: string }[] = [
  { key: 'all', label: 'All', tone: 'blue', title: 'Every drug the clinic holds' },
  { key: 'low', label: 'Low stock', tone: 'amber', title: 'Some left, but at or below the drug’s low-stock level' },
  { key: 'out', label: 'Out of stock', tone: 'red', title: 'None left' },
  { key: 'expiring', label: 'Expiring within 90 days', tone: 'amber', title: 'A batch with units left expires within the next 90 days' },
  { key: 'expired', label: 'Expired', tone: 'red', title: 'A batch with units left is past its expiry date' },
  { key: 'cost', label: 'Cost not recorded', tone: 'gray', title: 'Some of the stock was typed in by hand or has no cost, so profit on it is a guess' },
];

const matches = (r: ClinicStockRow, f: ClinicFilter) =>
  f === 'all' ? true : f === 'low' ? r.low_stock : f === 'out' ? r.out_of_stock : f === 'expiring' ? r.expiring_soon : f === 'expired' ? r.expired : r.cost_unverified;

/** How many drugs fall under each filter — the Pharmacy page's slim alert line uses the same counts. */
export function clinicCounts(rows: ClinicStockRow[]): Record<ClinicFilter, number> {
  return {
    all: rows.length,
    low: rows.filter((r) => r.low_stock).length,
    out: rows.filter((r) => r.out_of_stock).length,
    expiring: rows.filter((r) => r.expiring_soon).length,
    expired: rows.filter((r) => r.expired).length,
    cost: rows.filter((r) => r.cost_unverified).length,
  };
}

export const CLINIC_STOCK_KEY = 'pharmacy-clinic-stock';
export const useClinicStock = () => useQuery({
  queryKey: [CLINIC_STOCK_KEY],
  queryFn: () => window.electronAPI.pharmacy.clinicStock(),
  refetchInterval: 60_000,
});

export function ClinicStockTab({ filter, onFilter }: { filter: ClinicFilter; onFilter: (f: ClinicFilter) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [editing, setEditing] = useState<(Partial<DrugStockBatch> & { drug_master_id: number; drug_name?: string }) | null>(null);
  const [editDrug, setEditDrug] = useState<Partial<DrugMaster> | null>(null);
  const [costOpen, setCostOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);

  const { data: rows = [], isLoading } = useClinicStock();
  const counts = useMemo(() => clinicCounts(rows), [rows]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => matches(r, filter)
      && (!t || r.name.toLowerCase().includes(t) || (r.generic_name || '').toLowerCase().includes(t)
        || (r.manufacturer || '').toLowerCase().includes(t) || (r.barcode || '') === q.trim()));
  }, [rows, q, filter]);

  const save = useMutation({
    mutationFn: (b: Partial<DrugStockBatch>) => window.electronAPI.pharmacy.upsertBatch(b),
    onSuccess: () => {
      for (const k of ['pharmacy-drugs', 'pharmacy-drugs-active', 'pharmacy-alerts', 'pharmacy-batches', CLINIC_STOCK_KEY]) qc.invalidateQueries({ queryKey: [k] });
      toast('Batch saved');
      setEditing(null);
    },
  });

  const startBatch = (d: { id: number; name: string; default_mrp: number }) =>
    setEditing({ drug_master_id: d.id, drug_name: d.name, batch_no: '', expiry: '', manufacture_date: '', qty_received: 0, qty_remaining: 0, mrp: d.default_mrp, is_active: 1 });

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="input pl-9" placeholder="Search by name / generic / manufacturer" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-secondary text-xs whitespace-nowrap" onClick={() => setCostOpen(true)}
            title="Stock you typed in by hand carries a cost nobody can vouch for — clear it so profit is not based on a guess">
            Cost not recorded…
          </button>
          <button className="btn-primary" onClick={() => setPickOpen(true)} title="For stock that did not come on a supplier bill — bills from a supplier go under Purchases">
            <Plus className="w-4 h-4" /> Add stock by hand
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3" role="tablist" aria-label="Filter the drugs">
        {CHIPS.map((c) => {
          const n = counts[c.key];
          const on = filter === c.key;
          const hot = c.key !== 'all' && c.key !== 'cost' && n > 0;
          return (
            <button
              key={c.key}
              role="tab"
              aria-selected={on}
              title={c.title}
              onClick={() => onFilter(on && c.key !== 'all' ? 'all' : c.key)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                on ? 'bg-blue-600 border-blue-600 text-white'
                  : hot && c.tone === 'red' ? 'border-red-300 text-red-700 bg-red-50 hover:bg-red-100 dark:border-red-800 dark:text-red-200 dark:bg-red-900/30'
                  : hot ? 'border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:bg-amber-900/30'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700/40',
              )}
            >
              {hot && !on && <AlertTriangle className="w-3 h-3" />}
              {c.label} <b className="tabular-nums">{n}</b>
            </button>
          );
        })}
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400 mb-2">
        Click a drug to see its batches. Stock is sold earliest-expiry first. Record what you buy from a supplier under <b>Purchases</b>; the drugs themselves (names, prices, GST) are kept in the <b>Drug List</b>.
      </div>
      {costOpen && <CostNotRecordedModal onClose={() => setCostOpen(false)} />}

      {isLoading ? (
        <div className="text-xs text-gray-500 py-8 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Nothing in stock yet"
          description="Record what you bought from a supplier under Purchases, or add stock by hand. Drugs appear here once the clinic holds them."
          action={<button className="btn-primary" onClick={() => setPickOpen(true)}><Plus className="w-4 h-4" /> Add stock by hand</button>}
        />
      ) : shown.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-slate-400 py-10 text-center">
          No drugs match.{' '}
          <button className="text-blue-600 hover:underline" onClick={() => { setQ(''); onFilter('all'); }}>Show all</button>
        </div>
      ) : (
        <>
          <div className="hidden md:grid grid-cols-[1.25rem_minmax(0,1fr)_3.5rem_6rem_9rem_7rem_9rem_8rem] gap-3 px-2 pb-1.5 text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
            <span />
            <span>Drug</span>
            <span>Sched.</span>
            <span className="text-right">In stock</span>
            <span>Next expiry</span>
            <span className="text-right" title="What one unit really cost: free units, discount, freight and unclaimable GST included">Cost / unit</span>
            <span className="text-right" title="What it sells for (a range when batches differ)">Price</span>
            <span />
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {shown.map((d) => {
              const isOpen = openId === d.id;
              const days = d.next_expiry ? daysUntil(d.next_expiry) : null;
              return (
                <li key={d.id}>
                  {/* A div, not a <button>: it holds the "+ Batch" button, and a button inside a button is invalid HTML. */}
                  <div
                    role="button"
                    tabIndex={0}
                    className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] md:grid-cols-[1.25rem_minmax(0,1fr)_3.5rem_6rem_9rem_7rem_9rem_8rem] items-center gap-3 py-2.5 px-2 hover:bg-gray-50 dark:hover:bg-slate-800/40 text-left cursor-pointer"
                    onClick={() => setOpenId(isOpen ? null : d.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(isOpen ? null : d.id); } }}
                  >
                    {isOpen ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">
                        {d.name}
                        {Number(d.is_active) === 0 && <span className="badge bg-gray-200 text-gray-600 ml-2 align-middle" title="Removed from the Drug List, but units are still on the shelf">Inactive</span>}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-slate-400 truncate">
                        {[d.form, d.strength, d.manufacturer].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                    <div className="hidden md:block"><ScheduleBadge schedule={d.schedule} /></div>
                    <div className="hidden md:block text-right">
                      <span className={cn('text-sm font-bold tabular-nums', d.out_of_stock ? 'text-red-600 dark:text-red-400' : d.low_stock ? 'text-amber-700 dark:text-amber-300' : '')}>{d.stock_qty}</span>
                      {d.out_of_stock && <div className="text-[10px] font-semibold text-red-600 dark:text-red-400">Out</div>}
                      {d.low_stock && <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">Low</div>}
                    </div>
                    <div className="hidden md:block text-xs">
                      {d.next_expiry ? (
                        <>
                          <div className={cn(d.expired ? 'text-red-600 dark:text-red-400 font-semibold' : d.expiring_soon ? 'text-amber-700 dark:text-amber-300 font-semibold' : '')}>{fmtDate(d.next_expiry)}</div>
                          {d.expired ? <div className="text-[10px] font-semibold text-red-600 dark:text-red-400">EXPIRED</div>
                            : d.expiring_soon && days != null ? <div className="text-[10px] text-amber-700 dark:text-amber-300">{days === 0 ? 'today' : `in ${days}d`}</div> : null}
                        </>
                      ) : <span className="text-gray-400">—</span>}
                    </div>
                    <div className="hidden md:block text-right text-sm tabular-nums">
                      {d.avg_cost != null ? formatINR(d.avg_cost) : <span className="text-gray-400">—</span>}
                      {d.cost_unverified && (
                        <span className="ml-1 text-amber-600" title="Some of this stock was typed in by hand or has no recorded cost — profit on it is a guess"><AlertTriangle className="w-3 h-3 inline -mt-0.5" /></span>
                      )}
                    </div>
                    <div className="hidden md:block text-right text-sm tabular-nums">
                      {d.price_min == null ? <span className="text-gray-400">—</span>
                        : d.price_min === d.price_max ? formatINR(d.price_min) : <>{formatINR(d.price_min)}<span className="text-gray-400"> – </span>{formatINR(d.price_max as number)}</>}
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <span className="md:hidden text-sm font-bold tabular-nums mr-2">{d.stock_qty}</span>
                      <button type="button" className="btn-ghost text-xs" title="Add a batch of this drug by hand" onClick={(e) => { e.stopPropagation(); startBatch(d); }}>
                        <Plus className="w-3.5 h-3.5" /> Batch
                      </button>
                      <button type="button" className="btn-ghost text-xs" title="Edit the drug (name, schedule, GST, MRP, low-stock level)" onClick={(e) => { e.stopPropagation(); setEditDrug(d); }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {isOpen && <BatchList drugMasterId={d.id} drugName={d.name} drugDefaultMrp={d.default_mrp} onEdit={(b) => setEditing({ ...b, drug_master_id: d.id, drug_name: d.name })} />}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {pickOpen && <StockDrugPicker onClose={() => setPickOpen(false)} onPick={(d) => { setPickOpen(false); startBatch(d); }} />}
      {editDrug && <DrugEditModal drug={editDrug} onClose={() => setEditDrug(null)} />}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit Batch · ${editing.drug_name}` : `New Batch · ${editing?.drug_name}`} size="md">
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Batch No *"><input className="input font-mono" value={editing.batch_no || ''} onChange={(e) => setEditing({ ...editing, batch_no: e.target.value })} /></Field>
              <div />
              <Field label="Mfg date"><input type="month" className="input" value={editing.manufacture_date || ''} onChange={(e) => setEditing({ ...editing, manufacture_date: e.target.value })} /></Field>
              <Field label="Expiry *"><input type="date" className="input" value={editing.expiry || ''} onChange={(e) => setEditing({ ...editing, expiry: e.target.value })} /></Field>
              <Field label="Qty Received *"><input type="number" className="input" value={editing.qty_received ?? 0} onChange={(e) => setEditing({ ...editing, qty_received: Number(e.target.value) })} /></Field>
              <Field label="Qty Remaining"><input type="number" className="input" value={editing.qty_remaining ?? editing.qty_received ?? 0} onChange={(e) => setEditing({ ...editing, qty_remaining: Number(e.target.value) })} /></Field>
              <Field label="Purchase Price (₹)"><input type="number" className="input" value={editing.purchase_price ?? ''} onChange={(e) => setEditing({ ...editing, purchase_price: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
              <Field label="MRP (₹)"><input type="number" className="input" value={editing.mrp ?? 0} onChange={(e) => setEditing({ ...editing, mrp: Number(e.target.value) })} /></Field>
              <Field label="Selling price (₹) — blank = MRP"><input type="number" className="input" value={editing.selling_price ?? ''} onChange={(e) => setEditing({ ...editing, selling_price: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
              <div className="col-span-2">
                <Field label="Manufacturer Lic. No."><input className="input" placeholder="optional — printed on strip" value={editing.manufacturer_license_no || ''} onChange={(e) => setEditing({ ...editing, manufacturer_license_no: e.target.value })} /></Field>
              </div>
            </div>
            <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
              💡 For wholesaler-bought stock, prefer creating a <b>Purchase Invoice</b> in the Purchases tab — that auto-creates batches AND records the bill for compliance. Manual batch entry is for samples / corrections only. Changing the purchase price here changes what the <i>remaining</i> units cost; sales already made keep the cost they were made at, and the change is written to the audit log.
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => save.mutate(editing as DrugStockBatch)} disabled={save.isPending || !editing.batch_no || !editing.expiry || (editing.selling_price != null && editing.selling_price > (editing.mrp ?? 0))}>
                {save.isPending ? 'Saving…' : 'Save Batch'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

/** Step one of "Add stock by hand": which drug? Search the Drug List, or add a drug that is not there yet. */
function StockDrugPicker({ onClose, onPick }: { onClose: () => void; onPick: (d: DrugMaster) => void }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const { data: drugs = [] } = useQuery({
    queryKey: ['pharmacy-drugs-active'],
    queryFn: () => window.electronAPI.pharmacy.listDrugs({ activeOnly: true }),
  });
  const t = q.trim().toLowerCase();
  const found = (t ? drugs.filter((d) => d.name.toLowerCase().includes(t) || (d.generic_name || '').toLowerCase().includes(t) || (d.barcode || '') === q.trim()) : drugs).slice(0, 12);
  if (adding) return <QuickDrugModal initialName={q.trim()} onClose={() => setAdding(false)} onCreated={(d) => onPick(d)} />;
  return (
    <Modal open onClose={onClose} title="Add stock by hand — which drug?" size="md">
      <div className="space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="input pl-9" autoFocus placeholder="Type the drug's name" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="border border-gray-200 dark:border-slate-700 rounded-lg divide-y divide-gray-100 dark:divide-slate-800 max-h-72 overflow-auto">
          <li>
            <button type="button" className="w-full text-left px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-slate-800/60" onClick={() => setAdding(true)}>
              ＋ Add this drug to the Drug List…
            </button>
          </li>
          {found.map((d) => (
            <li key={d.id}>
              <button type="button" className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800/60" onClick={() => onPick(d)}>
                <div className="text-sm text-gray-900 dark:text-slate-100">{d.name}</div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400">{[d.form, d.strength, d.manufacturer].filter(Boolean).join(' · ') || '—'}</div>
              </button>
            </li>
          ))}
          {found.length === 0 && <li className="px-3 py-3 text-xs text-gray-500 dark:text-slate-400">No drug by that name in the Drug List — add it with the first line above.</li>}
        </ul>
        <div className="flex justify-end"><button className="btn-secondary" onClick={onClose}>Cancel</button></div>
      </div>
    </Modal>
  );
}

/**
 * "Cost not recorded": stock somebody typed in (or the starter stock a new install ships with) has a cost that is
 * only a guess. This clears that cost on those batches — and, if asked, on the sales already made from them — so profit
 * and stock value leave them out instead of treating the guess as fact. Batches received through a purchase bill are
 * never touched. Nothing is deleted, and the old figures are written to the audit log.
 */
function CostNotRecordedModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [includePast, setIncludePast] = useState(false);
  const [sure, setSure] = useState(false);
  const { data: sum, isLoading } = useQuery({
    queryKey: ['pharmacy-cost-summary'],
    queryFn: () => window.electronAPI.pharmacy.costSummary(),
  });
  const run = useMutation({
    mutationFn: () => window.electronAPI.pharmacy.clearManualCost({ include_past_sales: includePast }),
    onSuccess: (r) => {
      if (!r.ok) { toast(r.error, 'error'); return; }
      for (const k of ['pharmacy-drugs', 'pharmacy-drugs-active', 'pharmacy-batches', 'pharmacy-cost-summary', 'pharmacy-profit', 'pharmacy-valuation', 'pharmacy-checks', CLINIC_STOCK_KEY]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      toast(`Cost cleared on ${r.batches} batch${r.batches === 1 ? '' : 'es'}${includePast ? ` and ${r.register_rows} past sale line${r.register_rows === 1 ? '' : 's'}` : ''}`);
      onClose();
    },
    onError: (e: any) => toast(e?.message || 'Could not clear the costs', 'error'),
  });
  const n = sum?.batches ?? 0;
  return (
    <Modal open onClose={onClose} title="Cost not recorded" size="md">
      <div className="space-y-3 text-[13px] text-gray-700 dark:text-slate-300">
        <p>
          Stock that was typed in by hand — or the starter stock a new install comes with — has a cost nobody can vouch for.
          Mark it <b>cost not recorded</b> and profit and stock value will stop treating that guess as fact. Real costs come
          from supplier bills entered under <b>Purchases</b>.
        </p>
        {isLoading ? <div className="text-xs text-gray-500">Checking stock…</div> : n === 0 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 p-3 text-emerald-800 dark:text-emerald-200">
            Nothing to clear — every batch with a cost came from a purchase bill.
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-3 space-y-1">
            <div><b>{n}</b> batch{n === 1 ? '' : 'es'} carry a hand-typed cost.</div>
            <div className="text-[12px]">
              {sum!.units_in_stock} unit{sum!.units_in_stock === 1 ? '' : 's'} in stock, valued at {formatINR(sum!.value_in_stock)} at that cost.
              {sum!.past_sale_units > 0 && <> {sum!.past_sale_units} unit{sum!.past_sale_units === 1 ? ' has' : 's have'} already been sold from them.</>}
            </div>
          </div>
        )}
        {n > 0 && (
          <>
            <label className="flex items-start gap-2 text-[12px]">
              <input type="checkbox" className="mt-0.5" checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} />
              <span>
                Also clear the cost recorded on <b>past sales</b> from these batches
                {sum && sum.past_sale_slices > 0 ? ` (${sum.past_sale_slices} line${sum.past_sale_slices === 1 ? '' : 's'})` : ''}.
                Past profit will then leave them out. Leave this off to keep the profit already reported.
              </span>
            </label>
            <label className="flex items-start gap-2 text-[12px]">
              <input type="checkbox" className="mt-0.5" checked={sure} onChange={(e) => setSure(e.target.checked)} />
              <span>I understand this clears costs on {n} batch{n === 1 ? '' : 'es'}. It can be re-entered later; the old figures are kept in the audit log.</span>
            </label>
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          {n > 0 && (
            <button className="btn-primary" disabled={!sure || run.isPending} onClick={() => run.mutate()}>
              {run.isPending ? 'Clearing…' : 'Mark cost not recorded'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function BatchList({ drugMasterId, drugName: _drugName, drugDefaultMrp: _drugDefaultMrp, onEdit }: { drugMasterId: number; drugName: string; drugDefaultMrp: number; onEdit: (b: DrugStockBatch) => void }) {
  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['pharmacy-batches', drugMasterId],
    queryFn: () => window.electronAPI.pharmacy.listBatches(drugMasterId),
  });
  if (isLoading) return <div className="text-xs text-gray-500 px-8 py-2">Loading batches…</div>;
  if (batches.length === 0) return <div className="text-xs text-gray-500 px-8 py-2 italic">No batches recorded yet — receive a purchase invoice or add one manually.</div>;
  return (
    <div className="px-8 pb-3 pt-1">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-100 dark:border-slate-800 text-left">
            <th className="py-1.5">Batch</th>
            <th className="py-1.5">Expiry</th>
            <th className="py-1.5 text-right">Received</th>
            <th className="py-1.5 text-right">Remaining</th>
            <th className="py-1.5 text-right" title="True cost of one unit: free units, discount, freight and unclaimable GST included">Cost / unit</th>
            <th className="py-1.5 text-right">MRP</th>
            <th className="py-1.5 text-right" title="Blank = sold at MRP">Sell ₹</th>
            <th className="py-1.5">Mfg. Lic.</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => {
            const days = daysUntil(b.expiry);          // calendar days on the PC's own date — the same count the row above uses
            const expired = days < 0;
            const expiringSoon = days >= 0 && days <= 90;
            return (
              <tr key={b.id} className="border-b border-gray-100 dark:border-slate-800">
                <td className="py-1.5 font-mono">{b.batch_no}</td>
                <td className={cn('py-1.5', expired ? 'text-red-600 font-bold' : expiringSoon ? 'text-amber-700' : '')}>
                  {(() => { try { return fmtDate(b.expiry); } catch { return b.expiry; } })()} {expired ? '(EXPIRED)' : expiringSoon ? `(in ${days}d)` : ''}
                </td>
                <td className="py-1.5 text-right">{b.qty_received}</td>
                <td className="py-1.5 text-right font-semibold">{b.qty_remaining}</td>
                <td className="py-1.5 text-right">{(b.unit_cost ?? b.purchase_price) != null ? formatINR((b.unit_cost ?? b.purchase_price) as number) : <span className="text-gray-400" title="No cost recorded — left out of profit figures">—</span>}</td>
                <td className="py-1.5 text-right">{formatINR(b.mrp)}</td>
                <td className="py-1.5 text-right">{b.selling_price != null ? formatINR(b.selling_price) : <span className="text-gray-400">= MRP</span>}</td>
                <td className="py-1.5 text-[10px] font-mono text-gray-500">{b.manufacturer_license_no || '—'}</td>
                <td className="py-1.5 text-right">
                  <button className="text-xs text-blue-600 hover:underline" onClick={() => onEdit(b)}>Edit</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
