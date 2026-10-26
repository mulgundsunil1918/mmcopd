/** "This medicine is not on my Drug List": what will be added when the bill is imported. Starts from the bill's name and ChatGPT's lookup. */
import { HelpTip } from '../../HelpTip';
import { FORMS, SCHEDULES } from '../QuickDrugModal';
import { printedStrength, type DraftLine, type NewDrugSpec } from '../../../lib/billImport';
import { errCls, numOrNull } from './ui';
import { SameMedicineNote } from '../SameMedicineNote';

export function NewMedicineForm({ line, bad, onChange, onCancel }: {
  line: DraftLine; bad: { name?: boolean; schedule?: boolean }; onChange: (spec: NewDrugSpec) => void; onCancel: () => void;
}) {
  const nd = line.new_drug as NewDrugSpec;
  const set = (patch: Partial<NewDrugSpec>) => onChange({ ...nd, ...patch });
  const forms = nd.form && !FORMS.includes(nd.form) ? [...FORMS, nd.form] : FORMS;
  const lk = line.lookup;
  const looked = [lk.brand, lk.generic, lk.strength, lk.form].filter(Boolean).join(' · ');
  const consumable = nd.item_type === 'consumable';
  // a strength the bill itself prints in the name ("KLOTIN INJ 500MG") is offered without any lookup — say so, so it is checked like the rest
  const fromName = !lk.strength && !!nd.strength && nd.strength === printedStrength(line.printed_name);
  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/10 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="text-xs font-semibold text-blue-900 dark:text-blue-100">
          {consumable ? 'New consumable — it is added to your Drug List when you import. Check the name.' : 'New medicine — it is added to your Drug List when you import. Check the name and the schedule on the pack.'}
        </div>
        <button type="button" className="text-[11px] underline text-gray-600 dark:text-slate-300 hover:text-blue-700" onClick={onCancel}>It is not new — choose from my list</button>
      </div>
      {looked && (
        <div className="text-[11px] text-gray-600 dark:text-slate-300">
          ChatGPT’s lookup{lk.source ? ` (${lk.source}${lk.confidence ? `, ${lk.confidence.toLowerCase()} confidence` : ''})` : ''}: {looked}. <i>Advisory only — compare with the pack.</i>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
        <div className="col-span-2">
          <label className="label flex items-center gap-1 h-5">Type
            <HelpTip title="Medicine or consumable">
              <p><b>Medicine</b> — something a patient takes or has applied: tablets, syrups, injections, drips, creams.</p>
              <p><b>Consumable</b> — a syringe, needle, cannula, IV set, suture, tape, bandage, gloves, bed sheet. It has no generic name, strength or schedule, it may print no batch or expiry, and it is not offered in prescriptions. It is still stocked, billed and costed like anything else.</p>
            </HelpTip>
          </label>
          <select className="input" value={consumable ? 'consumable' : 'medicine'}
            onChange={(e) => set(e.target.value === 'consumable'
              ? { item_type: 'consumable', generic_name: '', strength: '', form: 'Consumable', schedule: 'OTC' }
              : { item_type: undefined, form: nd.form === 'Consumable' ? '' : nd.form, schedule: nd.schedule === 'OTC' && nd.item_type === 'consumable' ? 'H' : nd.schedule })}>
            <option value="medicine">Medicine</option>
            <option value="consumable">Consumable (syringe, cannula, suture, tape, bed sheet…)</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">{consumable ? 'Item name *' : 'Medicine name *'}</label>
          <input className={`input ${errCls(!!bad.name)}`} value={nd.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />
        </div>
        {!consumable && <div className="col-span-2"><label className="label">Generic name</label><input className="input" value={nd.generic_name} maxLength={120} onChange={(e) => set({ generic_name: e.target.value })} /></div>}
        {!consumable && (
          <div>
            <label className="label">Strength</label>
            <input className="input" value={nd.strength} maxLength={40} placeholder="500 mg" onChange={(e) => set({ strength: e.target.value })} />
            {fromName && <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">taken from the bill’s own name — check the pack</div>}
          </div>
        )}
        {!consumable && (
          <div>
            <label className="label">Form</label>
            <select className="input" value={nd.form} onChange={(e) => set({ form: e.target.value })}>
              <option value="">—</option>
              {forms.map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>
        )}
        {!consumable && (
          <div className="col-span-2">
            <label className="label inline-flex items-center gap-1">Schedule *
              <HelpTip title="Schedule">
                <p>Look at the pack. <b>Schedule H</b> or “Rx” = needs a prescription. <b>H1</b> = prescription plus an entry in the H1 register (some antibiotics, sleeping pills). <b>X</b> = narcotic. Nothing printed = <b>OTC</b> (sold without a prescription).</p>
                <p>ChatGPT cannot tell this reliably, so please check the pack.</p>
              </HelpTip>
            </label>
            <select className={`input ${errCls(!!bad.schedule)}`} value={nd.schedule} onChange={(e) => set({ schedule: e.target.value as NewDrugSpec['schedule'] })}>
              {SCHEDULES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label inline-flex items-center gap-1">Pack size
            <HelpTip title="Pack size"><p>How many units (tablets, ml…) are in one pack, if you want it recorded. Optional.</p></HelpTip>
          </label>
          <input className="input" type="number" min={0} value={nd.pack_size ?? ''} onChange={(e) => set({ pack_size: numOrNull(e.target.value) })} />
        </div>
        <div><label className="label">HSN code</label><input className="input" value={nd.hsn_code} maxLength={12} onChange={(e) => set({ hsn_code: e.target.value })} /></div>
      </div>
      {!consumable && <SameMedicineNote generic={nd.generic_name} strength={nd.strength} form={nd.form} />}
    </div>
  );
}
