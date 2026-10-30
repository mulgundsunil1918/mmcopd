// WhatsApp → Lab Ready: the dialog that asks WHICH report to send as a PDF.   npx electron tools/ui-shots.cjs tests/ui/screens-whatsapp-report.cjs <outDir>
module.exports = [
  { file: 'wa-lab-report-picker', url: '#/whatsapp', run: async (h) => {
      await h.wait(1200);
      // the demo's visits are in the past: add one for today so the patient list has someone to send to
      await h.js(`(async () => { const t = new Date().toLocaleDateString('en-CA'); await window.electronAPI.appointments.create({ patient_id: 1, doctor_id: 1, appointment_date: t, appointment_time: '10:30' }); location.hash = '#/lab'; await new Promise(r => setTimeout(r, 400)); location.hash = '#/whatsapp'; return true; })()`);
      await h.wait(1500);
      await h.js(`(() => { const b = [...document.querySelectorAll('button')].find(x => /WhatsApp Business/.test(x.textContent) && /Module 1/.test(x.textContent)); if (b) b.click(); return !!b; })()`); await h.wait(1200);
      await h.js(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Lab Ready/.test(x.textContent)); if (b) b.click(); return !!b; })()`);
      await h.waitText('Which report should'); await h.wait(600);
      await h.js(`(() => { const r = document.querySelector('input[name="wa-report"]'); if (r) r.click(); return !!r; })()`); await h.wait(300);
      return h.shot('01-whatsapp-which-report');
  } },
];
