/**
 * "The same medicine under another brand" at the pharmacy counter.
 *
 * A prescription for "Paracetamol 650 mg Tablet" is filled from whatever brand the shelf holds — Dolo 650, Crocin 650 — so a drug that is
 * out of stock under one name is never a dead end while the same medicine (same ingredient, strength and form) sits under another. Under a
 * dispensing line this shows the other brands that have stock, the one whose stock expires first leading (the order the shelf is emptied
 * in), and lets the person behind the counter switch to one — or, when the brand on the line is not enough, take the rest from another.
 * The line always names the brand that is actually handed over, so the bill, the batch and the Schedule H register say exactly what left
 * the shelf. A brand that was PRESCRIBED is never swapped silently: only a generic-named line is filled from another brand by itself.
 */
import { otherBrandsInStock, type MedicineLike, type StockLike } from '../../lib/medicineGroups';
import { fmtDate } from '../../lib/utils';

type DrugRow = MedicineLike & StockLike & { medicine_key?: string | null };

export function BrandChoice<T extends DrugRow>({ drugs, drugId, qty, swappedFrom, onUse, onTakeRest }: {
  /** Every active drug (pharmacy:listDrugs rows, with stock). */
  drugs: T[];
  /** The drug on this line. */
  drugId: number | undefined;
  /** Units wanted on this line. */
  qty: number;
  /** Set when the line was filled from another brand than the prescription named. */
  swappedFrom?: string;
  /** Replace the line's drug with this brand. */
  onUse: (d: T) => void;
  /** Keep what this brand has, and take the rest of the quantity from the other brand (a new line). */
  onTakeRest: (d: T, rest: number) => void;
}) {
  const cur = drugId != null ? drugs.find((d) => d.id === drugId) : undefined;
  if (!cur) return null;
  const others = otherBrandsInStock(drugs, cur);
  if (!others.length && !swappedFrom) return null;
  const have = Math.max(0, Number(cur.stock_qty) || 0);
  const want = Number(qty) || 0;
  const short = want > have;
  const rest = want - have;
  return (
    <div className="mt-1 space-y-1" data-testid="brand-choice">
      {swappedFrom && (
        <div className="text-[10px] text-sky-700 dark:text-sky-300">
          Prescribed as <b>{swappedFrom}</b> — given from the stock you hold as <b>{cur.name}</b> (same medicine).
        </div>
      )}
      {others.length > 0 && (
        <div className={`text-[10px] flex flex-wrap items-center gap-1 ${short ? 'text-amber-800 dark:text-amber-200' : 'text-gray-500 dark:text-slate-400'}`}>
          <span>
            {short
              ? (have > 0 ? `Only ${have} of ${cur.name} — the same medicine is also on your shelf as:` : `${cur.name} is out — the same medicine is on your shelf as:`)
              : 'Same medicine, other brands in stock:'}
          </span>
          {others.slice(0, 4).map((o) => {
            const take = short && have > 0;
            return (
              <button
                key={o.id}
                type="button"
                title={take ? `Keep the ${have} of ${cur.name}, add a line for the other ${rest} from ${o.name}` : `Give ${o.name} instead of ${cur.name}`}
                onClick={() => (take ? onTakeRest(o, rest) : onUse(o))}
                className={`rounded-full border px-2 py-0.5 font-medium hover:bg-blue-50 dark:hover:bg-slate-700 ${short ? 'border-amber-300 dark:border-amber-700 bg-white/60 dark:bg-slate-800' : 'border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800'} text-gray-800 dark:text-slate-100`}
              >
                {take ? `Take the other ${rest} from ${o.name}` : `Use ${o.name}`}
                <span className="text-gray-500 dark:text-slate-400 font-normal"> · {o.stock_qty} in stock{o.next_expiry ? ` · exp ${fmtDate(o.next_expiry)}` : ''}</span>
              </button>
            );
          })}
          {others.length > 4 && <span>+{others.length - 4} more</span>}
        </div>
      )}
    </div>
  );
}

/** Which row of a prescription's drug list is the stock drug to dispense? The exact name first, then the whole text, then the first word (the old rule). */
export function drugForRx<T extends { id: number; name: string }>(drugs: T[], rx: { drug_master_id?: number | null; drug_name?: string | null }): T | undefined {
  if (rx.drug_master_id) { const hit = drugs.find((d) => d.id === rx.drug_master_id); if (hit) return hit; }
  const text = String(rx.drug_name || '').trim().toLowerCase();
  if (!text) return undefined;
  return drugs.find((d) => d.name.toLowerCase() === text)
    || drugs.find((d) => d.name.toLowerCase().startsWith(text) || text.startsWith(d.name.toLowerCase()))
    || drugs.find((d) => d.name.toLowerCase().includes(text.split(' ')[0]));
}

