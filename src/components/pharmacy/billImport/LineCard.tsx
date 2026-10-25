/**
 * One line of the bill on the checking screen.
 *   · the name stays exactly as printed; beside it, which medicine in the Drug List it is (or a new one) and how sure the match is;
 *   · every figure is a box the person can correct; a box that still needs filling (batch, expiry, MRP, GST…) is RED;
 *   · what one unit really costs and the profit on it, the same way the purchase bill shows it;
 *   · "Set aside for later" leaves the line out of this import — the others go in now, this one waits.
 */
import { memo } from 'react';
import { CheckCircle2, Pause, Play, Plus } from 'lucide-react';
import { HelpTip } from '../../HelpTip';
import { cn, formatINR } from '../../../lib/utils';
import type { DraftLine, LineMoney, NewDrugSpec, Problem } from '../../../lib/billImport';
import type { DrugMaster } from '../../../types';
import { DrugPicker } from './DrugPicker';
import { NewMedicineForm } from './NewMedicineForm';
import { Pill, Tip, errCls, matchInfo, numOrNull, selectAll, warnCls } from './ui';

const comp = (d: { generic_name?: string | null; strength?: string | null; form?: string | null }) => [d.generic_name, d.strength, d.form].filter(Boolean).join(' · ');

/** What the card can ask the screen to do. One stable object, so only the card that changed is redrawn. */
export interface LineActs {
  patch(id: number, patch: Partial<DraftLine>): void;
  choose(id: number, drugId: number | null): void;
  confirm(id: number): void;
  addNew(id: number): void;
  newSpec(id: number, spec: NewDrugSpec): void;
  clearNew(id: number): void;
  aside(id: number, aside: boolean): void;
}

interface Props { line: DraftLine; problems: Problem[]; money?: LineMoney; drugs: DrugMaster[]; acts: LineActs }

function LineCardView({ line, problems, money, drugs, acts }: Props) {
  const id = line.id;
  const errs = problems.filter((p) => p.severity === 'error');
  const warns = problems.filter((p) => p.severity === 'warn');
  const bad = (f: string) => errs.some((p) => p.field === f);
  const soft = (f: string) => warns.some((p) => p.field === f);
  const info = matchInfo(line.match.kind);
  const chosen = line.drug_id !== null ? drugs.find((d) => d.id === line.drug_id) ?? null : null;
  const needsConfirm = line.drug_id !== null && !line.new_drug && !line.confirmed && !(line.match.kind === 'exact' || line.match.kind === 'alias');
  const reason = chosen ? line.match.candidates.find((c) => c.id === chosen.id)?.reason : '';

  if (line.aside) {
    return (
      <div id={`imp-line-${id}`} className="rounded-xl border border-dashed border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-900/60 p-3 flex items-center gap-3 flex-wrap">
        <Pause className="w-4 h-4 text-gray-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-700 dark:text-slate-200 truncate"><span className="text-gray-400 mr-1">#{line.line_no}</span>{line.printed_name}</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">Set aside — not imported now. It waits in “Waiting to finish” (with the bill picture, if you added one) until you fill it in.</div>
        </div>
        <button type="button" className="btn-secondary text-xs px-2.5 py-1.5" onClick={() => acts.aside(id, false)}><Play className="w-3.5 h-3.5" /> Include it again</button>
      </div>
    );
  }

  const border = errs.length > 0 ? 'border-red-300 dark:border-red-800' : warns.length > 0 ? 'border-amber-300 dark:border-amber-700' : 'border-emerald-200 dark:border-emerald-900';

  return (
    <div id={`imp-line-${id}`} className={cn('rounded-xl border p-3 space-y-2.5 scroll-mt-4', border)}>
      {/* what the bill says, and which medicine it is */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-[200px] flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-gray-400">#{line.line_no}</span>
            <span className="text-sm font-bold text-gray-900 dark:text-slate-100 break-words select-text">{line.printed_name}</span>
            <span className="text-[10px] uppercase tracking-wide text-gray-400">as printed</span>
          </div>
          {(line.pack || line.manufacturer) && <div className="text-[11px] text-gray-500 dark:text-slate-400">{[line.pack && `Pack ${line.pack}`, line.manufacturer].filter(Boolean).join(' · ')}</div>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {line.new_drug ? <Pill tone="blue"><Plus className="w-3 h-3" /> New medicine</Pill>
            : line.drug_id !== null && (line.confirmed || info.sure) ? <Pill tone="green"><CheckCircle2 className="w-3 h-3" /> {line.confirmed && !info.sure ? 'You confirmed this' : info.label}</Pill>
            : <Pill tone={info.tone}>{info.label}</Pill>}
          <button type="button" className="btn-ghost text-xs px-2 py-1 text-gray-600 dark:text-slate-300" onClick={() => acts.aside(id, true)} title="Leave this line out of this import and finish it later">
            <Pause className="w-3.5 h-3.5" /> Set aside for later
          </button>
          <HelpTip title="Set aside for later" align="right">
            <p>Not sure about this line — a batch you cannot read, a medicine nobody can name? <b>Set it aside.</b> The other lines are imported now; this one waits (with the bill’s picture, if you added one) in “Waiting to finish” until you can fill it in.</p>
            <p>A set-aside line is not in your stock until you finish it.</p>
          </HelpTip>
        </div>
      </div>

      <div className="grid md:grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
        <div>
          <label className="label">Which medicine is this? *</label>
          <DrugPicker value={line.drug_id} newSelected={!!line.new_drug} candidates={line.match.candidates} drugs={drugs} invalid={bad('drug')}
            onPick={(d) => acts.choose(id, d)} onNew={() => acts.addNew(id)} />
        </div>
        {needsConfirm && (
          <button type="button" className="btn-primary text-xs px-3 py-2 whitespace-nowrap" onClick={() => acts.confirm(id)}>
            <CheckCircle2 className="w-4 h-4" /> Yes, it is this one
          </button>
        )}
      </div>

      {chosen && (
        <div className="text-[11px] text-gray-600 dark:text-slate-300">
          In your Drug List: <b>{chosen.name}</b>{comp(chosen) ? ` — ${comp(chosen)}` : ''}{reason ? <span className="text-gray-400"> · {reason}</span> : null}
        </div>
      )}
      {!line.new_drug && (line.lookup.brand || line.lookup.generic || line.lookup.strength) && (
        <div className="text-[11px] text-gray-500 dark:text-slate-400">
          ChatGPT’s lookup{line.lookup.source ? ` (${line.lookup.source}${line.lookup.confidence ? `, ${line.lookup.confidence.toLowerCase()}` : ''})` : ''}:{' '}
          {[line.lookup.brand, line.lookup.generic, line.lookup.strength, line.lookup.form].filter(Boolean).join(' · ')} <i>— advisory only</i>
        </div>
      )}
      {line.new_drug && (
        <NewMedicineForm line={line} bad={{ name: !line.new_drug.name.trim(), schedule: !line.new_drug.schedule }}
          onChange={(spec) => acts.newSpec(id, spec)} onCancel={() => acts.clearNew(id)} />
      )}

      {/* the figures */}
      <div className="flex gap-2.5 flex-wrap items-start">
        <div className="w-32">
          <Tip label="Batch *" title="Batch number"><p>The batch number printed on the strip or bottle (look for “B.No.” or “Batch”). Type the real one — stock is tracked, sold and recalled by batch.</p></Tip>
          <input className={cn('input font-mono', errCls(bad('batch')))} value={line.batch} onChange={(e) => acts.patch(id, { batch: e.target.value })} />
        </div>
        <div className="w-44">
          <Tip label="Expiry *" title="Expiry date"><p>The date printed as “Exp” on the pack. A month alone means the last day of that month. The earliest-expiring stock is sold first, and the pharmacy warns you before it expires.</p></Tip>
          <input type="date" className={cn('input', errCls(bad('expiry')), warnCls(soft('expiry') && !bad('expiry')))} value={line.expiry} onChange={(e) => acts.patch(id, { expiry: e.target.value, expiry_problem: '' })} />
          {line.expiry_printed && <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5 whitespace-nowrap">bill: {line.expiry_printed}</div>}
        </div>
        <div className="w-24">
          <Tip label="Qty *" title="Quantity you paid for"><p>How many units the dealer billed you for — the “Qty” column. Free units are NOT counted here — they go in “Free”.</p></Tip>
          <input type="number" min={0} onFocus={selectAll} className={cn('input text-right px-2', errCls(bad('qty')))} value={line.qty ?? ''} onChange={(e) => acts.patch(id, { qty: numOrNull(e.target.value) })} />
        </div>
        <div className="w-24">
          <Tip label="Free" title="Free quantity"><p>Extra units the dealer gives you free on top of what you buy — a “scheme”, like <b>10 + 2</b>: you pay for 10 and receive 12. Leave 0 if the bill has none.</p><p>The free units are on your shelf, so what you paid is spread over ALL the units — each unit’s true cost is lower.</p></Tip>
          <input type="number" min={0} onFocus={selectAll} className={cn('input text-right px-2', errCls(bad('free')))} value={line.free_qty} onChange={(e) => acts.patch(id, { free_qty: Number(e.target.value) || 0 })} />
        </div>
        <div className="w-28">
          <Tip label="Dealer's rate ₹ *" title="Dealer's rate (what you pay for one unit)"><p>What the dealer charges for ONE unit, before any discount and before GST — the “Rate” column on the bill. It is not the MRP; it is what YOU pay.</p></Tip>
          <input type="number" min={0} step="0.01" onFocus={selectAll} className={cn('input text-right px-2', errCls(bad('rate')))} value={line.rate ?? ''} onChange={(e) => acts.patch(id, { rate: numOrNull(e.target.value) })} />
        </div>
        <div className="w-20">
          <Tip label="Disc %" title="Discount on this line"><p>The dealer’s trade discount on this line (the “Disc %” column). 0 if there is none. A discount on the whole bill goes in the bill box below.</p></Tip>
          <input type="number" min={0} max={100} step="0.01" onFocus={selectAll} className={cn('input text-right px-2', errCls(bad('disc')))} value={line.disc_pct} onChange={(e) => acts.patch(id, { disc_pct: Number(e.target.value) || 0 })} />
        </div>
        <div className="w-28">
          <Tip label="MRP ₹ *" title="MRP"><p>The Maximum Retail Price printed on the pack — the most you may charge a patient for one unit. It is not what you paid. If the bill has no MRP, read it off the pack.</p></Tip>
          <input type="number" min={0} step="0.01" onFocus={selectAll} className={cn('input text-right px-2', errCls(bad('mrp')), warnCls(soft('mrp') && !bad('mrp')))} value={line.mrp ?? ''} onChange={(e) => acts.patch(id, { mrp: numOrNull(e.target.value) })} />
        </div>
        <div className="w-28">
          <Tip label="Sell ₹" title="Your selling price"><p>What you will actually charge for one unit. Leave it empty to sell at the MRP. It can be lower than the MRP (a discount to your patients), never higher.</p></Tip>
          <input type="number" min={0} step="0.01" onFocus={selectAll} className="input text-right px-2" placeholder="= MRP" value={line.selling_price ?? ''} onChange={(e) => acts.patch(id, { selling_price: numOrNull(e.target.value) })} />
        </div>
        <div className="w-24">
          <Tip label="GST % *" title="GST rate"><p>The TOTAL GST rate of this line, as on the bill (CGST + SGST added together, or the IGST). Most medicines are taxed at 5%. A bill that shows 2.5 and 2.5 means 5.</p></Tip>
          <select className={cn('input px-2', errCls(bad('gst')))} value={line.gst_rate ?? ''} onChange={(e) => acts.patch(id, { gst_rate: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">—</option>
            {[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}</option>)}
            {line.gst_rate !== null && ![0, 5, 12, 18, 28].includes(line.gst_rate) && <option value={line.gst_rate}>{line.gst_rate} (not usual)</option>}
          </select>
        </div>
        <div className="w-24 text-right" title="Value of the line after discount, before GST">
          <div className="label">Line ₹</div>
          <div className="font-semibold text-sm py-1.5">{money ? formatINR(money.taxable) : '—'}</div>
          {line.printed_amount !== null && <div className={cn('text-[10px] whitespace-nowrap', soft('amount') ? 'text-amber-700 dark:text-amber-300 font-semibold' : 'text-gray-500 dark:text-slate-400')}>bill: {formatINR(line.printed_amount)}</div>}
        </div>
        <div className="w-36 text-right">
          <div className="label inline-flex items-center justify-end gap-1">You pay / unit
            <HelpTip title="What one unit really costs you" align="right"><p>The true cost of ONE unit: the dealer’s rate, less discounts, with the free units spread in, plus freight — and GST too, if you cannot claim it back.</p><p>Your profit is worked out from this figure.</p></HelpTip>
          </div>
          {money && money.units > 0 ? (
            <>
              <div className="font-semibold text-sm leading-tight pt-1.5">{formatINR(money.unit_cost)}</div>
              {money.margin_pct !== null && money.profit !== null && (
                <div className={cn('text-[10px] leading-tight', money.margin_pct < 0 ? 'text-red-600 dark:text-red-400 font-semibold' : money.margin_pct < 10 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-slate-400')}>
                  profit {formatINR(money.profit)} / unit · {money.margin_pct.toFixed(1)}%
                </div>
              )}
            </>
          ) : <div className="text-gray-400 py-1.5">—</div>}
        </div>
      </div>

      {(errs.length > 0 || warns.length > 0) && (
        <ul className="space-y-0.5 text-[11.5px]">
          {errs.map((p, i) => <li key={`e${i}`} className="text-red-700 dark:text-red-300">● {p.message}</li>)}
          {warns.map((p, i) => <li key={`w${i}`} className="text-amber-800 dark:text-amber-300">▲ {p.message}</li>)}
        </ul>
      )}
    </div>
  );
}

const sig = (ps: Problem[]) => ps.map((p) => `${p.code}:${p.severity}:${p.field ?? ''}:${p.message}`).join('|');
const sameMoney = (a?: LineMoney, b?: LineMoney) =>
  a === b || (!!a && !!b && a.taxable === b.taxable && a.gst === b.gst && a.units === b.units && a.unit_cost === b.unit_cost && a.profit === b.profit && a.margin_pct === b.margin_pct);

/** Redrawn only when this line, its figures, its problems or the Drug List changed. */
export const LineCard = memo(LineCardView, (a, b) => a.line === b.line && a.drugs === b.drugs && a.acts === b.acts && sameMoney(a.money, b.money) && sig(a.problems) === sig(b.problems));
