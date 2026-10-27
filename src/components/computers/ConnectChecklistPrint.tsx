/**
 * The printed "Connecting our computers" checklist — two A4 sheets to keep next to the computers while somebody sets them up: what to buy, how to plug in, the
 * Windows settings with a box for EVERY computer (so each can be ticked off as it is done), the steps for the main computer and each other computer, the check,
 * and the five things to look at first when it does not work. Built from the same words as the on-screen guide (lib/connectGuide.ts), for the way of connecting
 * the person chose. Prints through the .print-area / .print-page scaffold, so "Save as PDF" in the print dialog makes a PDF.
 */
import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { format } from 'date-fns';
import { DIRECT_ADDRESSES, WIN_SHORT, WORKING_SIGNS, connectionInfo, shoppingFor, windowsStepsFor, type Connection } from '../../lib/connectGuide';
import { PrintHeader } from '../print/PrintHeader';

const INK = '#0f172a';
const MUTED = '#475569';
const RULE = '#cbd5e1';
const BOX = { display: 'inline-block', width: 13, height: 13, border: '1.5px solid #334155', borderRadius: 2, verticalAlign: 'middle', flex: 'none' } as const;
const H = { fontSize: 12.5, fontWeight: 800, color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: '.04em', margin: '12px 0 5px', borderBottom: `1.5px solid ${RULE}`, paddingBottom: 2 } as const;
const COMPUTERS = ['Main', 'PC 2', 'PC 3', 'PC 4'];

function Tick({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', margin: '4px 0', fontSize: 11.5, lineHeight: 1.4 }}>
      <span style={{ ...BOX, marginTop: 2 }} />
      <div><span style={{ fontWeight: 600 }}>{children}</span>{sub && <span style={{ color: MUTED }}> — {sub}</span>}</div>
    </div>
  );
}

const PLUG_SHORT: Record<Connection, string[]> = {
  cable: [
    'Router (and switch) where every cable can reach; one cable from the router to the switch if you use one.',
    'One cable from each computer’s network socket to a free socket on the router or switch — it clicks. The socket lights blink.',
  ],
  wifi: [
    'Router in the middle of the clinic, up high. Every computer joins the SAME clinic Wi-Fi (not “Guest”).',
    'The main computer on a cable to the router if you can.',
  ],
  direct: [
    'One cable from the main computer’s network socket to the other computer’s network socket — it clicks. The socket lights come on.',
    `Then the fixed addresses (below): main ${DIRECT_ADDRESSES.main}, other ${DIRECT_ADDRESSES.other}, mask ${DIRECT_ADDRESSES.mask}.`,
  ],
};

export function ConnectChecklistPrint({ choice, onClose }: { choice: Connection | ''; onClose: () => void }) {
  const { data: clinic } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const c: Connection = choice || 'cable';
  const info = connectionInfo(c);
  const shop = shoppingFor(c);
  const steps = windowsStepsFor(c);
  const sheet = { width: '210mm', height: '297mm', padding: '14mm', backgroundColor: '#ffffff', color: INK, display: 'flex', flexDirection: 'column' } as const;
  const printed = format(new Date(), 'do MMM yyyy');

  return (
    <div className="fixed inset-0 z-[400] overflow-auto print-overlay" style={{ backgroundColor: '#94a3b8' }}>
      <div className="no-print sticky top-3 z-10 flex justify-center pointer-events-none">
        <div className="px-4 py-1.5 rounded-full text-xs font-semibold text-white shadow-lg" style={{ backgroundColor: '#1e293b' }}>
          Checklist · {info.title}{choice ? '' : ' (you have not chosen yet — this is for a cable)'}
        </div>
      </div>

      <div className="p-6 pb-28 flex flex-col items-center gap-4">
        {/* ---------------------------------------------------------------- sheet 1 */}
        <div className="print-area print-page bg-white shadow-2xl" style={sheet}>
          {clinic && <PrintHeader settings={clinic} compact />}
          <div style={{ textAlign: 'center', margin: '8px 0 2px' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#1e3a8a' }}>Connecting our computers — checklist</div>
            <div style={{ fontSize: 10.5, color: MUTED }}>How: <b style={{ color: INK }}>{info.title}</b> · Sheet 1 of 2 · {printed}</div>
          </div>

          <div style={H}>1 · What you need</div>
          {shop.map((i) => <Tick key={i.id} sub={i.optional ? 'only if you need it' : undefined}>{i.title}</Tick>)}

          <div style={H}>2 · Plug it in</div>
          {PLUG_SHORT[c].map((t) => <Tick key={t}>{t}</Tick>)}

          <div style={H}>3 · Windows settings — tick each one on every computer</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#eff6ff', color: '#1e3a8a' }}>
                <th style={{ border: `1px solid ${RULE}`, padding: '3px 5px', textAlign: 'left' }}>Setting</th>
                {COMPUTERS.map((n) => <th key={n} style={{ border: `1px solid ${RULE}`, padding: '4px 2px', width: 42 }}>{n}</th>)}
              </tr>
            </thead>
            <tbody>
              {steps.map((s) => (
                <tr key={s.id}>
                  <td style={{ border: `1px solid ${RULE}`, padding: '5px 6px', verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 700 }}>{s.title}{s.need === 'recommended' ? <span style={{ fontWeight: 400, color: MUTED }}> (recommended)</span> : null}</div>
                    <div style={{ color: MUTED, fontSize: 10 }}>{WIN_SHORT[s.id]}</div>
                  </td>
                  {COMPUTERS.map((n, i) => (
                    <td key={n} style={{ border: `1px solid ${RULE}`, textAlign: 'center', verticalAlign: 'middle', background: s.who === 'main' && i > 0 ? '#f1f5f9' : undefined }}>
                      {s.who === 'main' && i > 0 ? <span style={{ color: '#94a3b8' }}>—</span> : <span style={BOX} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>“Main” = the computer that holds the clinic’s data. “—” = only needed on the main computer.</div>
        </div>

        {/* ---------------------------------------------------------------- sheet 2 */}
        <div className="print-area print-page bg-white shadow-2xl" style={sheet}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#1e3a8a', marginBottom: 2 }}>Connecting our computers — checklist <span style={{ fontWeight: 400, color: MUTED, fontSize: 10.5 }}>· Sheet 2 of 2</span></div>

          <div style={H}>4 · The main computer</div>
          <Tick>CureDesk installed and opened. Setup guide: “More than one computer” → “This is the main computer”.</Tick>
          <Tick>Named, for example “Reception Desk”: ______________________</Tick>
          <Tick sub="lasts 10 minutes — press “New code” for another">Join code written here: ______________</Tick>
          <Tick>Windows asked about the firewall → ticked Private networks → Allow access{c === 'direct' ? ' (and Public)' : ''}.</Tick>
          <Tick>CureDesk stays open all day; the computer never sleeps.</Tick>

          <div style={H}>5 · Each other computer</div>
          <Tick>CureDesk installed. Setup guide: “More than one computer” → “This computer joins a clinic that is already set up”. Pick the main computer, type the join code exactly (capitals matter), name the computer, restart CureDesk once.</Tick>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginTop: 6 }}>
            <thead>
              <tr style={{ background: '#eff6ff', color: '#1e3a8a' }}>
                {['Name of the computer', 'Where it is', 'Its job', 'Joined', 'Checked'].map((h, i) => <th key={h} style={{ border: `1px solid ${RULE}`, padding: '3px 5px', textAlign: i > 2 ? 'center' : 'left', width: i > 2 ? 46 : undefined }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3].map((r) => (
                <tr key={r} style={{ height: 28 }}>
                  <td style={{ border: `1px solid ${RULE}` }} /><td style={{ border: `1px solid ${RULE}` }} /><td style={{ border: `1px solid ${RULE}` }} />
                  <td style={{ border: `1px solid ${RULE}`, textAlign: 'center' }}><span style={BOX} /></td><td style={{ border: `1px solid ${RULE}`, textAlign: 'center' }}><span style={BOX} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={H}>6 · Check the connection</div>
          <Tick>On every computer: Settings → Computers &amp; staff → “Check this computer” — every line green or blue.</Tick>
          <Tick>On the main computer the check says how many other computers are connected.</Tick>
          {WORKING_SIGNS.map((w) => <Tick key={w}>{w}</Tick>)}

          <div style={H}>7 · People and jobs</div>
          <Tick>Users &amp; Access → Add User for everybody: their own username, password and role.</Tick>
          <Tick>On each computer: Settings → Computers &amp; staff → This Computer’s Job (reception desk, doctor’s cabin, pharmacy counter …).</Tick>

          <div style={H}>Not working? Look at these five first</div>
          <div style={{ margin: '3px 0 0', paddingLeft: 4, fontSize: 11.5, lineHeight: 1.55 }}>
            {[
              <>Are both computers on the <b>same router</b> — not a “Guest” Wi-Fi?</>,
              <>Is the Windows network set to <b>Private</b>?{c === 'direct' ? ' (A direct cable shows Public — that is normal.)' : ''}</>,
              <>Was the firewall question answered <b>Allow access</b>?</>,
              <>Is the <b>main computer on</b>, awake, with CureDesk open?</>,
              <>Was the <b>join code</b> typed exactly, within 10 minutes?</>,
            ].map((t, i) => <div key={i} style={{ display: 'flex', gap: 6 }}><span style={{ width: 14, fontWeight: 700 }}>{i + 1}.</span><span>{t}</span></div>)}
          </div>

          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 10, color: MUTED }}>Notes</div>
          {[0, 1, 2].map((i) => <div key={i} style={{ borderBottom: `1px solid ${RULE}`, height: 20 }} />)}
          <div style={{ fontSize: 9, color: MUTED, marginTop: 6, textAlign: 'center' }}>The full step-by-step guide, with the exact clicks for Windows 10 and 11, is in CureDesk: Settings → Computers &amp; staff.</div>
        </div>
      </div>

      <div className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-3 px-5 py-3 rounded-2xl shadow-2xl" style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}>
        <button onClick={onClose} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ backgroundColor: '#e2e8f0', color: '#0f172a' }}>
          <X className="w-4 h-4" /> Close
        </button>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #2563eb, #4f46e5)' }}>
          <Printer className="w-4 h-4" /> Print the checklist
        </button>
      </div>
    </div>
  );
}
