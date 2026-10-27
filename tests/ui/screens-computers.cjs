// The "Computers & staff" screens (Part A: how many computers, one-computer Reception; Part C: connect-your-computers guide), as screenshots in the app's own
// engine:   npx electron tools/ui-shots.cjs tests/ui/screens-computers.cjs <outDir>      (demo served on :5199; SHOT_UA=win shows the Windows buttons)
// Not a pass/fail test — it is how a change to these screens is looked at before it is shown to the owner.
const toMulti = async (h) => {
  await h.unlock(); await h.clickText('Computers & staff'); await h.waitText('How many computers?');
  await h.clickText('More than one computer', { exact: false }); await h.wait(600);
  await h.waitText('Connect your computers');
};
const pick = async (h, text) => { await h.clickText(text, { exact: false, sel: 'button[role="radio"]' }); await h.wait(500); };
module.exports = [
  { file: 'setup-first-question', url: '?setup#/reception', run: async (h) => { await h.waitText('How many computers will you use'); return h.shot('01-setup-first-question'); } },
  { file: 'setup-more-than-one', url: '?setup#/reception', run: async (h) => {
      await h.waitText('How many computers will you use'); await h.clickText('More than one computer', { exact: false }); await h.wait(500);
      await h.scrollText('How is this computer connected'); await h.wait(300); return h.shot('02-setup-more-than-one-connection');
  } },
  { file: 'setup-guide-dialog', url: '?setup#/reception', run: async (h) => {
      await h.waitText('How many computers will you use'); await h.clickText('More than one computer', { exact: false }); await h.wait(500);
      await h.clickText('Open the step-by-step guide', { exact: false }); await h.wait(900); return h.shot('03-setup-guide-dialog');
  } },
  { file: 'settings-single', url: '#/settings', run: async (h) => {
      await h.unlock(); await h.clickText('Computers & staff'); await h.waitText('What can Reception do?');
      await h.scrollText('What can Reception do?'); await h.wait(300); return h.shot('04-settings-reception-list');
  } },
  { file: 'settings-multi', url: '#/settings', run: async (h) => {
      await toMulti(h); await pick(h, 'Network cable to the router or a switch');
      await h.scrollText('Connect the computers'); await h.wait(300); return h.shot('05-settings-guide-cable');
  } },
  { file: 'settings-windows', url: '#/settings', run: async (h) => {
      await toMulti(h); await pick(h, 'Wi-Fi');
      await h.clickText('Windows settings on every computer', { exact: false }); await h.wait(500);
      await h.clickText('Allow CureDesk through the Windows Firewall', { exact: false }); await h.wait(300);
      await h.scrollText('Windows settings on every computer'); await h.wait(300); return h.shot('06-windows-settings-wifi');
  } },
  { file: 'settings-check', url: '#/settings', run: async (h) => {
      await toMulti(h); await pick(h, 'Network cable to the router or a switch');
      await h.clickText('Check the connection', { exact: false }); await h.wait(500);
      await h.clickText('Check this computer', { exact: true }); await h.wait(1200);
      await h.scrollText('CureDesk looks at this computer'); await h.wait(300); return h.shot('07-check-this-computer');
  } },
  { file: 'diagrams', url: '#/settings', run: async (h) => {
      await toMulti(h);
      for (const [id, text] of [['cable', 'Network cable to the router or a switch'], ['wifi', 'Wi-Fi'], ['direct', 'One cable straight between two computers']]) {
        await pick(h, text); await h.shotEl('08-diagram-' + id, 'li#connect-step-choose svg[role="img"]', 6);
      }
      return 'ok';
  } },
];
