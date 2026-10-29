// The Accounts, Analytics → Doctors and Settings → Accounts / Pay-and-cuts screens, as screenshots in the app's own engine:
//   npx electron tools/ui-shots.cjs tests/ui/screens-accounts.cjs <outDir>      (demo served on :5199)
// Not a pass/fail test — it is how these screens are looked at before they are shown to the owner.
module.exports = [
  { file: 'accounts-overview', url: '#/accounts', run: async (h) => { await h.waitText('Latest vouchers'); await h.wait(500); return h.shot('01-accounts-overview'); } },
  { file: 'accounts-money-in', url: '#/accounts?tab=in', run: async (h) => { await h.waitText('Money that came in'); await h.wait(700); return h.shot('02-accounts-money-in'); } },
  { file: 'accounts-money-out', url: '#/accounts?tab=out', run: async (h) => { await h.waitText('Supplier payment'); await h.wait(500); return h.shot('03-accounts-money-out'); } },
  { file: 'voucher-dialog', url: '#/accounts?tab=out', run: async (h) => {
      await h.waitText('Supplier payment'); await h.clickText('Voucher', { exact: false, sel: 'button.btn-primary' }); await h.waitText('Paid out');
      await h.setInput('input[placeholder="e.g. Hand wash"]', 'Hand wash'); await h.wait(300); return h.shot('04-voucher-dialog');
  } },
  { file: 'accounts-staff', url: '#/accounts?tab=staff', run: async (h) => { await h.waitText('Pay salary'); await h.clickText('Attendance', { exact: true }); await h.wait(700); return h.shot('05-accounts-staff-attendance'); } },
  { file: 'accounts-daybook', url: '#/accounts?tab=daybook', run: async (h) => { await h.waitText('Closing cash'); await h.wait(500); return h.shot('06-accounts-daybook'); } },
  { file: 'accounts-pnl', url: '#/accounts?tab=pnl', run: async (h) => { await h.waitText('Money in (collected)'); await h.wait(900); return h.shot('07-accounts-profit-and-loss'); } },
  { file: 'analytics-doctors', url: '#/analytics?tab=doctors', run: async (h) => { await h.waitText('New patient'); await h.wait(900); return h.shot('08-analytics-doctors'); } },
  { file: 'doctors-pay', url: '#/analytics?tab=doctors', run: async (h) => {
      await h.waitText('New patient'); await h.clickText('Pay', { exact: true, sel: 'button.btn-primary' }); await h.waitText('Days being paid'); await h.wait(700); return h.shot('09-pay-doctor-voucher');
  } },
  { file: 'settings-accounts', url: '#/settings', run: async (h) => {
      await h.unlock(); await h.clickText('Accounts & Analytics'); await h.waitText('Staff and salaries'); await h.wait(500); return h.shot('10-settings-accounts');
  } },
  { file: 'settings-accounts-vouchers', url: '#/settings', run: async (h) => {
      await h.unlock(); await h.clickText('Accounts & Analytics'); await h.waitText('Who may raise and cancel vouchers'); await h.scrollText('Who may raise and cancel vouchers'); await h.wait(500); return h.shot('11-settings-voucher-roles');
  } },
  { file: 'settings-pay-cuts', url: '#/settings', run: async (h) => {
      await h.unlock(); await h.clickText('Doctors & Templates'); await h.waitText('Pay and Cuts'); await h.scrollText('Pay and Cuts'); await h.wait(400);
      await h.clickText('How the doctor is paid', { exact: false, sel: 'button', timeout: 800 }).catch(() => {});
      return h.shot('12-settings-pay-and-cuts');
  } },
  { file: 'settings-what-to-show', url: '#/settings', run: async (h) => {
      await h.unlock(); await h.clickText('Reception & Fees'); await h.waitText('What to show'); await h.scrollText('What to show'); await h.wait(500); return h.shot('13-settings-what-to-show');
  } },
  { file: 'analytics-overview', url: '#/analytics', run: async (h) => { await h.waitText('Revenue today'); await h.wait(900); return h.shot('14-analytics-overview-small-figures'); } },
];
