/**
 * Floating "Sales Enquiry" launcher for the public showcase.
 *
 * Sits in the bottom-right corner at 50% opacity (rises to full on hover), with
 * a companion contact-email button. Opening it shows the SAME rich enquiry form
 * as the landing page — plan + add-ons + live total — and submits to FormSubmit
 * (→ help@curedesk.co.in) with a mailto fallback.
 *
 * Self-contained (inline styles) so it never depends on app CSS or state.
 */
import React, { useMemo, useState } from 'react';

const ENQUIRY_EMAIL = 'help@curedesk.co.in';
const FORMSUBMIT = 'https://formsubmit.co/ajax/' + ENQUIRY_EMAIL;
const BASE = 8999;

const ADDONS: { value: string; price: number; wa?: boolean }[] = [
  { value: 'Laboratory', price: 999 },
  { value: 'Pharmacy', price: 1999 },
  { value: 'In-Patient (IPD)', price: 4999 },
  { value: 'WhatsApp Basic', price: 999, wa: true },
  { value: 'WhatsApp Pro', price: 1999, wa: true },
];

const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman & Nicobar', 'Chandigarh',
  'Dadra & Nagar Haveli and Daman & Diu', 'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

const INR = (n: number) => n.toLocaleString('en-IN');

type Status = { kind: 'idle' | 'sending' | 'ok' | 'err'; msg?: string };

export function SalesEnquiryFab() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [notSure, setNotSure] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const total = useMemo(
    () => BASE + ADDONS.filter((a) => selected.includes(a.value)).reduce((s, a) => s + a.price, 0),
    [selected],
  );

  function toggleAddon(a: { value: string; wa?: boolean }, checked: boolean) {
    setSelected((prev) => {
      let next = prev.filter((v) => v !== a.value);
      if (checked) {
        // WhatsApp Basic / Pro are mutually exclusive — keep only one.
        if (a.wa) next = next.filter((v) => !ADDONS.find((x) => x.value === v)?.wa);
        next = [...next, a.value];
      }
      return next;
    });
  }

  function reset() {
    setSelected([]);
    setNotSure(false);
    setStatus({ kind: 'idle' });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (fd.get('_honey')) return; // bot trap
    const d = Object.fromEntries(fd.entries()) as Record<string, string>;

    const fail = (msg: string) => setStatus({ kind: 'err', msg });
    for (const [k, label] of [['name', 'Your name'], ['place', 'Place / City'], ['state', 'State'], ['contact', 'Contact number'], ['email', 'Email']] as const) {
      if (!String(d[k] || '').trim()) return fail(label + ' is required.');
    }
    if (String(d.contact).replace(/\D/g, '').length < 10) return fail('Enter a valid 10-digit contact number.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.email).trim())) return fail('Enter a valid email address.');

    const subscription = notSure
      ? 'Not sure — please recommend a plan'
      : selected.length
        ? 'Included plan + ' + selected.join(', ')
        : 'Included plan only (Registration / OPD / Lab / Pediatrics / Analytics / Billing)';
    const totalStr = notSure ? 'To be advised' : '₹' + INR(total) + ' / yr';

    setStatus({ kind: 'sending' });
    const payload = {
      Name: d.name, Place: d.place, State: d.state,
      Subscription: subscription, 'Estimated total': totalStr, Contact: d.contact, Email: d.email,
      _subject: 'CureDesk Sales Enquiry — ' + d.name + ' (' + d.place + ')',
      _replyto: d.email, _template: 'table', _captcha: 'false',
    };
    try {
      const r = await fetch(FORMSUBMIT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || j.success === 'false' || j.success === false) {
        const m = String(j.message || '').toLowerCase();
        if (m.includes('activat') || m.includes('confirm')) {
          setStatus({ kind: 'err', msg: 'Almost there — this form needs a one-time confirmation. We just emailed a link to our team; enquiries arrive right after it is clicked.' });
          return;
        }
        throw new Error(j.message || ('HTTP ' + r.status));
      }
      setStatus({ kind: 'ok', msg: '✓ Thank you! Your enquiry has been sent — we will be in touch shortly.' });
      form.reset();
      setTimeout(() => { setOpen(false); reset(); }, 2600);
    } catch {
      const body = `Name: ${d.name}%0D%0APlace: ${d.place}%0D%0AState: ${d.state}%0D%0ASubscription: ${subscription}%0D%0AEstimated total: ${totalStr}%0D%0AContact: ${d.contact}%0D%0AEmail: ${d.email}`;
      setStatus({ kind: 'err', msg: '' });
      window.location.href = `mailto:${ENQUIRY_EMAIL}?subject=CureDesk%20Sales%20Enquiry&body=${body}`;
    }
  }

  const input: React.CSSProperties = {
    padding: '11px 12px', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: 14,
    width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', color: '#0f172a', background: '#fff',
  };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 5, display: 'block' };

  return (
    <>
      {/* Floating launcher */}
      <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 2147483000, display: 'flex', alignItems: 'center', gap: 10 }}>
        <a
          href={`mailto:${ENQUIRY_EMAIL}?subject=CureDesk%20HMS%20enquiry`}
          title={`Email ${ENQUIRY_EMAIL}`}
          aria-label={`Email us at ${ENQUIRY_EMAIL}`}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: '50%', background: '#0f172a', color: '#fff', textDecoration: 'none', boxShadow: '0 10px 24px rgba(15,23,42,.32)', opacity: 0.5, transition: 'opacity .18s, transform .18s' }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.transform = 'none'; }}
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
        </a>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open the sales enquiry form"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 9, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#4f46e5,#2563eb)', color: '#fff', fontWeight: 800, fontSize: 15, padding: '15px 24px', borderRadius: 999, boxShadow: '0 12px 30px rgba(79,70,229,.38)', opacity: 0.5, transition: 'opacity .18s, transform .18s', fontFamily: 'inherit' }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.transform = 'none'; }}
        >
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          Sales Enquiry
        </button>
      </div>

      {/* Modal */}
      {open && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          style={{ position: 'fixed', inset: 0, zIndex: 2147483001, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 540, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,.35)', fontFamily: 'inherit' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0f172a' }}>Sales Enquiry</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 24, lineHeight: 1, color: '#64748b' }}>×</button>
            </div>
            <p style={{ marginTop: 4, marginBottom: 16, color: '#475569', fontSize: 13.5 }}>
              Tell us about your clinic and the plan you need — we usually reply the same day.
            </p>
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div>
                <label style={label}>Your name</label>
                <input name="name" required autoComplete="name" placeholder="Dr / Owner name" style={input} />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={label}>Place / City</label>
                  <input name="place" required placeholder="e.g. Gadag" style={input} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={label}>State</label>
                  <select name="state" required defaultValue="" style={input}>
                    <option value="" disabled>Select state…</option>
                    {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label style={label}>Plan</label>
                <div style={{ border: '1px solid #c7d2fe', background: '#eef2ff', borderRadius: 10, padding: '11px 13px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, color: '#0f172a' }}>
                    <b>Included — every plan</b><span style={{ fontWeight: 800, color: '#4338ca' }}>₹8,999 / yr</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 4, lineHeight: 1.5 }}>
                    Registration · OPD / Doctors · Pediatrics <span style={{ color: '#059669', fontWeight: 600 }}>(free)</span> · Analytics · Billing
                  </div>
                </div>
              </div>

              <div>
                <label style={label}>Add-ons <span style={{ fontWeight: 400, color: '#64748b' }}>(optional — tick what you need)</span></label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ADDONS.map((a) => {
                    const checked = selected.includes(a.value);
                    return (
                      <label key={a.value} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, color: '#0f172a', cursor: 'pointer', border: `1px solid ${checked ? '#c7d2fe' : '#e2e8f0'}`, borderRadius: 9, padding: '9px 12px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <input type="checkbox" checked={checked} onChange={(e) => toggleAddon(a, e.target.checked)} style={{ width: 16, height: 16, accentColor: '#4f46e5' }} />
                          {a.value}
                        </span>
                        <span style={{ fontWeight: 700, color: '#4338ca', fontSize: 13, whiteSpace: 'nowrap' }}>+ ₹{INR(a.price)}</span>
                      </label>
                    );
                  })}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: '#475569', cursor: 'pointer', marginTop: 10 }}>
                  <input type="checkbox" checked={notSure} onChange={(e) => setNotSure(e.target.checked)} style={{ width: 15, height: 15, accentColor: '#4f46e5' }} />
                  I'm not sure — please recommend a plan for me
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f172a', color: '#fff', borderRadius: 10, padding: '12px 15px', fontSize: 14, opacity: notSure ? 0.45 : 1 }}>
                <span>Estimated total</span>
                <span style={{ fontWeight: 800, fontSize: 18 }}>{notSure ? '—' : <>₹{INR(total)} <small style={{ fontSize: 11, fontWeight: 600, opacity: 0.7 }}>/ yr</small></>}</span>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={label}>Contact number</label>
                  <input name="contact" required type="tel" inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" style={input} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={label}>Email</label>
                  <input name="email" required type="email" autoComplete="email" placeholder="you@example.com" style={input} />
                </div>
              </div>

              <input type="text" name="_honey" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />
              {status.msg ? (
                <div style={{ fontSize: 13, textAlign: 'center', color: status.kind === 'ok' ? '#059669' : '#dc2626', fontWeight: status.kind === 'ok' ? 700 : 600 }}>{status.msg}</div>
              ) : null}
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={status.kind === 'sending'} style={{ flex: 1, border: 'none', cursor: 'pointer', background: '#2563eb', color: '#fff', fontWeight: 700, fontSize: 14, padding: '11px 18px', borderRadius: 10, opacity: status.kind === 'sending' ? 0.7 : 1 }}>
                  {status.kind === 'sending' ? 'Sending…' : status.kind === 'ok' ? 'Sent ✓' : 'Send enquiry'}
                </button>
                <button type="button" onClick={() => setOpen(false)} style={{ border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', fontWeight: 600, fontSize: 14, padding: '11px 18px', borderRadius: 10, cursor: 'pointer' }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
