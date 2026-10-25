/**
 * The GST on/off button on the Pharmacy page.
 *
 * It is the clinic's one GST switch — the same one as Settings → Billing → "This clinic is GST-registered" — put where the pharmacy needs it.
 *   ON  : medicines are sold at their MRP with the GST inside it, shown on the bill at each medicine's own rate; GST on purchases is claimed back.
 *   OFF : no GST is added or shown anywhere; the GST on a purchase becomes part of what the stock cost.
 * Only the administrator can flip it (it is a tax setting for the whole clinic), and nothing already billed is rewritten.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Percent } from 'lucide-react';
import { Modal } from '../Modal';
import { HelpTip } from '../HelpTip';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';

export function GstSwitch() {
  const qc = useQueryClient();
  const toast = useToast();
  const { adminUnlocked } = useAuth();
  const { data: s } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const [ask, setAsk] = useState(false);
  const on = !!s?.gst_enabled;

  const flip = useMutation({
    mutationFn: () => window.electronAPI.settings.save({
      gst_enabled: !on,
      // ticking "registered" with no type chosen means a regular registration, not "no tax" (same rule as Settings)
      ...(!on && (s?.gst_registration_type ?? 'unregistered') === 'unregistered' ? { gst_registration_type: 'regular' as const } : {}),
    } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast(on ? 'GST is now OFF — no GST is added to bills' : 'GST is now ON — medicines carry their GST', 'success');
      setAsk(false);
    },
    onError: (e: any) => toast(e?.message || 'Could not change GST', 'error'),
  });

  if (!s) return null;
  return (
    <>
      <div className="inline-flex items-center gap-1.5">
        <button type="button"
          onClick={() => { if (!adminUnlocked) { toast('Unlock the administrator (the lock at the top) to change GST.', 'info'); return; } setAsk(true); }}
          className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition',
            on ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
               : 'border-gray-300 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200')}
          title={adminUnlocked ? 'Turn GST on or off for the clinic' : 'Only the administrator can change GST'}>
          <Percent className="w-3.5 h-3.5" /> GST: {on ? 'ON' : 'OFF'}
        </button>
        <HelpTip title="GST on / off" align="right">
          <p><b>ON</b> — each medicine is sold at its MRP with its GST inside it (shown on the bill at the medicine’s own rate), and GST on your purchases is claimed back.</p>
          <p><b>OFF</b> — no GST is added or shown on any bill, and the GST on a purchase becomes part of what the stock cost.</p>
          <p>It is the same switch as Settings → Billing → “This clinic is GST-registered”. Bills already made keep the tax they were made with.</p>
        </HelpTip>
      </div>
      {ask && (
        <Modal open onClose={() => { if (!flip.isPending) setAsk(false); }} title={on ? 'Turn GST off?' : 'Turn GST on?'} size="md">
          <div className="space-y-3 text-sm text-gray-800 dark:text-slate-200">
            {on ? (
              <>
                <p>From now on <b>no GST</b> will be added or shown on any bill, receipt or pharmacy sale, and the GST on purchases will count as part of the cost of the stock.</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">Only do this if the clinic is not registered for GST (or is a composition dealer). Bills already made are not changed. You can turn it back on at any time.</p>
              </>
            ) : (
              <>
                <p>From now on each medicine is sold at its MRP with its <b>GST inside it</b>, shown on the bill at the medicine’s own rate (set in the Drug List), and the GST on your purchases is claimed back.</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">Add your GSTIN under Settings → Billing. Medicines marked 0% carry no GST. Bills already made are not changed. You can turn it off again at any time.</p>
              </>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setAsk(false)} disabled={flip.isPending}>Cancel</button>
              <button className={on ? 'btn-danger' : 'btn-primary'} onClick={() => flip.mutate()} disabled={flip.isPending}>{flip.isPending ? 'Saving…' : on ? 'Turn GST OFF' : 'Turn GST ON'}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
