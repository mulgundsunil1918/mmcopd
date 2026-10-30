// Lab: entering results into parameter boxes, the Normal values editor, and the printed report — screenshots in the app's own engine:
//   npx electron tools/ui-shots.cjs tests/ui/screens-lab.cjs <outDir>      (demo served on :5199)
const openOrder = async (h) => {
  await h.waitText('LAB-20261020-001');
  await h.js(`(() => { const el = [...document.querySelectorAll('li')].find(e => (e.textContent || '').includes('LAB-20261020-001')); if (el) el.click(); return !!el; })()`);
  await h.waitText('type the values in the boxes below');
};
const fill = async (h) => {
  await h.js(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const ins = [...document.querySelectorAll('input[data-param]')];
    const put = (i, v) => { if (!ins[i]) return; set.call(ins[i], v); ins[i].dispatchEvent(new Event('input', { bubbles: true })); };
    put(0, '9.2'); put(1, '3.9'); put(2, '33'); put(3, '79'); put(7, '14200'); put(8, '60'); put(9, '30'); put(13, '250000'); put(14, '0.9'); put(15, '0.3'); put(17, '62'); return ins.length; })()`);
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
];
