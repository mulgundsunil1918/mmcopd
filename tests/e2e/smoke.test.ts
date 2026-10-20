import { boot, call, channels, attempt } from './harness';
boot();
(async () => {
  console.log('channels registered:', channels().length);
  const s = await call('settings:get');
  console.log('clinic name:', s.clinic_name);
  const docs = await attempt('doctors:list');
  console.log('doctors:list ->', docs.ok ? `${docs.value.length} rows` : docs.error);
  process.exit(0);
})().catch((e) => { console.error('SMOKE FAILED', e); process.exit(1); });
