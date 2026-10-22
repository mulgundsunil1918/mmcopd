/**
 * The consultation bill form for ONE visit, shared by the Billing page (the patient portal's "Bill now", the billing queue) and the visit list
 * (the Bill button on a visit that has no bill yet). It starts from the doctor's default fee; the person can edit the lines, give a discount
 * (with a reason) and pick how it is paid.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Receipt, Trash2 } from 'lucide-react';
import { Modal } from '../Modal';
import { useToast } from '../../hooks/useToast';
import { cn, fmtDate, formatINR } from '../../lib/utils';
import type { AppointmentWithJoins, BillItem, BillWithJoins, PaymentMode } from '../../types';

/** The consultation bill form for one visit, opened from the patient portal. */
export function VisitBillModal({ appointmentId, onClose, onGenerated }: {
  appointmentId: number; onClose: () => void; onGenerated: (b: BillWithJoins) => void;
}) {
  const { data: appt, isLoading } = useQuery({
    queryKey: ['appointment', appointmentId],
    queryFn: () => window.electronAPI.appointments.get(appointmentId),
  });
  return (
    <Modal open onClose={onClose} title="Bill this visit" size="xl">
      {isLoading ? <div className="text-sm text-gray-500 p-4">Loading the visit…</div>
        : !appt ? <div className="text-sm text-red-600 p-4">That visit no longer exists. Close this and refresh.</div>
        : <BillForm key={appt.id} appointment={appt} onGenerated={onGenerated} />}
    </Modal>
  );
}

export function BillForm({ appointment, onGenerated }: { appointment: AppointmentWithJoins; onGenerated: (b: BillWithJoins) => void }) {
  const toast = useToast();
  const qc = useQueryClient();

  const { data: doctor } = useQuery({
    queryKey: ['doctors', appointment.doctor_id],
    queryFn: () => window.electronAPI.doctors.get(appointment.doctor_id),
  });

  const [items, setItems] = useState<BillItem[]>([{ description: 'Consultation Fee', qty: 1, rate: 500, amount: 500 }]);
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<'flat' | 'percent'>('flat');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [discountReason, setDiscountReason] = useState('');
  const { data: billSettings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });

  useEffect(() => {
    if (doctor) {
      setItems([{ description: 'Consultation Fee', qty: 1, rate: doctor.default_fee, amount: doctor.default_fee }]);
    }
  }, [doctor?.id]);

  const subtotal = useMemo(() => items.reduce((s, it) => s + Number(it.amount || 0), 0), [items]);
  const discountValue = discountType === 'percent' ? (subtotal * discount) / 100 : discount;
  const exactTotal = Math.max(0, subtotal - discountValue);
  // The saved bill is rounded to the rupee when "Round bill totals" is on (the same rule as every other bill); show that here.
  const total = billSettings?.bill_round_off === false ? Math.round(exactTotal * 100) / 100 : Math.round(exactTotal);
  const roundOff = Math.round((total - exactTotal) * 100) / 100;

  const setItem = (idx: number, patch: Partial<BillItem>) => {
    setItems((arr) => {
      const next = [...arr];
      next[idx] = { ...next[idx], ...patch };
      next[idx].amount = Number(next[idx].qty || 0) * Number(next[idx].rate || 0);
      return next;
    });
  };

  const create = useMutation({
    mutationFn: () =>
      window.electronAPI.bills.create({
        appointment_id: appointment.id,
        patient_id: appointment.patient_id,
        items,
        discount,
        discount_type: discountType,
        payment_mode: paymentMode,
        discount_reason: discount > 0 ? discountReason.trim() || null : null,
      }),
    onSuccess: (bill) => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['billing-queue'] });
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['billing-portal'] });
      toast('Bill generated');
      onGenerated(bill);
    },
    onError: (e: any) => toast(e.message || 'Failed', 'error'),
  });

  return (
    <div className="card p-6">
      <div className="border-b border-gray-200 pb-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500">Token #{appointment.token_number} · {fmtDate(appointment.appointment_date)} {appointment.appointment_time}</div>
            <h2 className="text-base font-bold text-gray-900 mt-1">{appointment.patient_name}</h2>
            <div className="text-xs text-gray-500">{appointment.patient_uhid} · {appointment.patient_phone}</div>
          </div>
          <div className="text-right text-xs text-gray-600">
            <div>{appointment.doctor_name}</div>
            <div className="text-[11px] text-gray-400">{appointment.doctor_specialty}</div>
          </div>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-gray-200 text-xs uppercase text-gray-500">
            <th className="py-2">Description</th>
            <th className="py-2 w-16 text-right">Qty</th>
            <th className="py-2 w-28 text-right">Rate</th>
            <th className="py-2 w-28 text-right">Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => (
            <tr key={idx} className="border-b border-gray-100">
              <td className="py-1.5 pr-2">
                <input className="input" value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} />
              </td>
              <td className="py-1.5 px-1">
                <input type="number" className="input text-right" value={it.qty} onChange={(e) => setItem(idx, { qty: Number(e.target.value) })} />
              </td>
              <td className="py-1.5 px-1">
                <input type="number" className="input text-right" value={it.rate} onChange={(e) => setItem(idx, { rate: Number(e.target.value) })} />
              </td>
              <td className="py-1.5 px-1 text-right font-medium">{formatINR(it.amount)}</td>
              <td className="py-1.5 pl-2 text-right">
                {items.length > 1 && (
                  <button onClick={() => setItems(items.filter((_, i) => i !== idx))} className="text-red-500 hover:text-red-700">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="btn-ghost text-xs mt-2"
        onClick={() => setItems([...items, { description: '', qty: 1, rate: 0, amount: 0 }])}
      >
        <Plus className="w-3.5 h-3.5" /> Add line
      </button>

      <div className="mt-6 grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <div>
            <label className="label">Payment Mode</label>
            <div className="flex gap-2">
              {(['Cash', 'Card', 'UPI'] as PaymentMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMode(m)}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-md border',
                    paymentMode === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 text-gray-700'
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2 bg-gray-50 border border-gray-200 rounded-lg p-4">
          <Row label="Subtotal" value={formatINR(subtotal)} />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">Discount</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                className="input w-20 text-right py-1"
                value={discount}
                onChange={(e) => setDiscount(Number(e.target.value))}
              />
              <select
                className="input w-16 py-1"
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as any)}
              >
                <option value="flat">₹</option>
                <option value="percent">%</option>
              </select>
            </div>
          </div>
          <Row label="Discount value" value={'- ' + formatINR(discountValue)} />
          {discount > 0 && (
            <input className="input py-1 text-xs" placeholder="Reason for the discount (recorded with who gave it)" maxLength={120}
              value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
          )}
          {roundOff !== 0 && <Row label="Round off" value={(roundOff > 0 ? '+ ' : '- ') + formatINR(Math.abs(roundOff))} />}
          <div className="border-t border-gray-300 pt-2 flex items-center justify-between">
            <span className="text-sm font-bold">Total</span>
            <span className="text-lg font-bold text-blue-700">{formatINR(total)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-6">
        <button className="btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
          <Receipt className="w-4 h-4" /> {create.isPending ? 'Generating…' : 'Generate Bill'}
        </button>
      </div>
    </div>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs text-gray-600">
      <span>{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}
