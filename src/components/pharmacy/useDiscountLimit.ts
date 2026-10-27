import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { capPaise, counterDiscountCap } from '../../lib/discountLimit';

/**
 * The signed-in person's limit on a discount at the pharmacy counter, so the sale screens can say so before the main process
 * has to refuse it. The main process is what enforces it — this only warns early. No one signed in (shared-PC mode) = no limit.
 */
export function useCounterDiscountLimit(subtotal: number, discount: number) {
  const { user } = useAuth();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const shared = !!user && user.role === 'staff';                                    // the shared desk (Reception) — its own number, if the administrator set one
  const role = user && user.id > 0 && user.role !== 'staff' ? user.role : null;
  const pct = shared ? (settings?.shared_desk_discount_pct ?? null) : counterDiscountCap(settings?.pharmacy_discount_caps_json, role);
  const maxAmount = pct == null ? null : capPaise(Math.round(subtotal * 100), pct) / 100;        // whole paise, never rounded up — the main process's own rule
  const over = maxAmount != null && discount > maxAmount + 0.004;
  return { pct, maxAmount, over, role };
}
