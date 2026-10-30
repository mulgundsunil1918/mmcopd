// Lab: entering results into parameter boxes, the Normal values editor, and the printed report — screenshots in the app's own engine:
//   npx electron tools/ui-shots.cjs tests/ui/screens-lab.cjs <outDir>      (demo served on :5199)
// The first demo order belongs to a 4-year-old boy, so the ranges shown are the CHILD ranges (Hb 11.5 - 13.5, TLC 5,500 - 15,500), picked from the date of birth.
const openOrder = async (h) => {
  await h.waitText('LAB-20261020-001');
  await h.js(`(() => { const el = [...document.querySelectorAll('li')].find(e => (e.textContent || '').includes('LAB-20261020-001')); if (el) el.click(); return !!el; })()`);
  await h.waitText('type the values in the boxes below');
};
const fill = async (h) => {
  await h.js(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const ins = [...document.querySelectorAll('input[data-param]')];
    const put = (i, v) => { if (!ins[i]) return; set.call(ins[i], v); ins[i].dispatchEvent(new Event('input', { bubbles: true })); };
    put(0, '10.8'); put(1, '4.2'); put(2, '33'); put(3, '79'); put(7, '14200'); put(8, '40'); put(9, '50'); put(13, '420000'); put(14, '0.9'); put(15, '0.3'); put(17, '62'); return ins.length; })()`);
  await h.wait(400);
};
module.exports = [
  { file: 'lab-results', url: '#/lab', run: async (h) => { await openOrder(h); await fill(h); return h.shot('01-lab-results-entry'); } },
  { file: 'lab-normal-values', url: '#/lab', run: async (h) => {
      await h.waitText('Orders'); await h.clickText('Test Catalog', { exact: false }); await h.wait(600);
      await h.js(`(() => { const row = [...document.querySelectorAll('tr')].find(t => /Complete Blood Count/.test(t.textContent)); const b = row && [...row.querySelectorAll('button')].find(x => /Normal values/.test(x.textContent)); if (b) b.click(); return !!b; })()`);
      await h.waitText('Normal values —'); await h.wait(500); return h.shot('02-lab-normal-values-editor');
  } },
  { file: 'lab-report', url: '#/lab', run: async (h) => {
      await openOrder(h); await fill(h); await h.clickText('Save Results', { exact: true }); await h.wait(900);
      await h.clickText('Print Report', { exact: false }); await h.waitText('LABORATORY REPORT'); await h.wait(900); return h.shot('03-lab-report');
  } },
  { file: 'lab-age-groups', url: '#/lab', run: async (h) => {
      await h.waitText('Orders'); await h.clickText('Test Catalog', { exact: false }); await h.wait(600);
      await h.js(`(() => { const row = [...document.querySelectorAll('tr')].find(t => /Complete Blood Count/.test(t.textContent)); const b = row && [...row.querySelectorAll('button')].find(x => /Normal values/.test(x.textContent)); if (b) b.click(); return !!b })()`);
      await h.waitText('Normal range, by age group and sex'); await h.wait(500); await h.shot('04-lab-age-groups');
      // type a decimal into a box (the old editor lost the dot), then pick another parameter
      await h.js(`(() => { const el = document.querySelector('[data-group="child"] input[aria-label="Child everyone from"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '11.2'); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value })()`);
      await h.wait(300);
      return h.js(`(() => ({ child_from: document.querySelector('[data-group="child"] input[aria-label="Child everyone from"]').value, rows: [...document.querySelectorAll('[data-group]')].map(r => r.getAttribute('data-group')).join() }))()`);
  } },
];
