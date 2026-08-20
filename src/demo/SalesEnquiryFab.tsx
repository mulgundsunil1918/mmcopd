/**
 * Floating "Sales Enquiry" launcher for the public showcase.
 *
 * Sits in the bottom-right corner at 50% opacity (rises to full on hover), with
 * a companion contact-email button. Opening it shows a compact enquiry form that
 * submits to FormSubmit (→ help@curedesk.co.in) with a mailto fallback, so a
 * prospect can reach out without leaving the demo.
 *
 * Self-contained (inline styles) so it never depends on app CSS or state.
 */
import React, { useState } from 'react';

const ENQUIRY_EMAIL = 'help@curedesk.co.in';
const FORMSUBMIT = 'https://formsubmit.co/ajax/' + ENQUIRY_EMAIL;

type Status = { kind: 'idle' | 'sending' | 'ok' | 'err'; msg?: string };

export function SalesEnquiryFab() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (fd.get('_honey')) return; // bot trap
    const d = Object.fromEntries(fd.entries()) as Record<string, string>;
    if (!d.name?.trim() || !d.contact?.trim() || !d.email?.trim()) {
      setStatus({ kind: 'err', msg: 'Name, contact and email are required.' });
      return;
    }
    setStatus({ kind: 'sending' });
    const payload = {
      Name: d.name, 'Clinic / City': d.place || '', Contact: d.contact, Email: d.email,
      Message: d.message || '',
      _subject: 'CureDesk Sales Enquiry — ' + d.name,
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
      setTimeout(() => { setOpen(false); setStatus({ kind: 'idle' }); }, 2600);
    } catch {
      const body = `Name: ${d.name}%0D%0AClinic / City: ${d.place || ''}%0D%0AContact: ${d.contact}%0D%0AEmail: ${d.email}%0D%0AMessage: ${d.message || ''}`;
      setStatus({ kind: 'err', msg: '' });
      window.location.href = `mailto:${ENQUIRY_EMAIL}?subject=CureDesk%20Sales%20Enquiry&body=${body}`;
    }
  }

  const input: React.CSSProperties = {
    padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: 14,
    width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', color: '#0f172a', background: '#fff',
  };

  return (
    <>
      {/* Floating launcher */}
      <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 2147483000, display: 'flex', alignItems: 'center', gap: 10 }}>
        <a
          href={`mailto:${ENQUIRY_EMAIL}?subject=CureDesk%20HMS%20enquiry`}
          title={`Email ${ENQUIRY_EMAIL}`}
          aria-label={`Email us at ${ENQUIRY_EMAIL}`}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48,
            borderRadius: '50%', background: '#0f172a', color: '#fff', textDecoration: 'none',
            boxShadow: '0 10px 24px rgba(15,23,42,.32)', opacity: 0.5, transition: 'opacity .18s, transform .18s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.transform = 'none'; }}
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
        </a>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open the sales enquiry form"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 9, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg,#4f46e5,#2563eb)', color: '#fff', fontWeight: 800, fontSize: 15,
            padding: '15px 24px', borderRadius: 999, boxShadow: '0 12px 30px rgba(79,70,229,.38)',
            opacity: 0.5, transition: 'opacity .18s, transform .18s', fontFamily: 'inherit',
          }}
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
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 460, boxShadow: '0 24px 60px rgba(0,0,0,.35)', fontFamily: 'inherit' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: '#0f172a' }}>Sales Enquiry</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 22, lineHeight: 1, color: '#64748b' }}>×</button>
            </div>
            <p style={{ marginTop: 4, marginBottom: 16, color: '#475569', fontSize: 13.5 }}>
              Tell us about your clinic — we usually reply the same day.
            </p>
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <input name="name" required placeholder="Your name (Dr / Owner)" autoComplete="name" style={input} />
              <input name="place" placeholder="Clinic name / City" style={input} />
              <div style={{ display: 'flex', gap: 10 }}>
                <input name="contact" required type="tel" inputMode="tel" placeholder="Contact number" autoComplete="tel" style={input} />
                <input name="email" required type="email" placeholder="Email" autoComplete="email" style={input} />
              </div>
              <textarea name="message" placeholder="What do you need? (optional)" rows={3} style={{ ...input, resize: 'vertical' }} />
              <input type="text" name="_honey" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />
              {status.msg ? (
                <div style={{ fontSize: 13, color: status.kind === 'ok' ? '#059669' : '#dc2626', fontWeight: status.kind === 'ok' ? 700 : 600 }}>{status.msg}</div>
              ) : null}
              <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
                <button
                  type="submit"
                  disabled={status.kind === 'sending'}
                  style={{ flex: 1, border: 'none', cursor: 'pointer', background: '#2563eb', color: '#fff', fontWeight: 700, fontSize: 14, padding: '11px 18px', borderRadius: 10, opacity: status.kind === 'sending' ? 0.7 : 1 }}
                >
                  {status.kind === 'sending' ? 'Sending…' : status.kind === 'ok' ? 'Sent ✓' : 'Send enquiry'}
                </button>
                <a href={`mailto:${ENQUIRY_EMAIL}?subject=CureDesk%20HMS%20enquiry`} style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', fontWeight: 600, fontSize: 14, padding: '11px 18px', borderRadius: 10, textDecoration: 'none' }}>Email us</a>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
