import { chromium } from '@playwright/test';
const out = process.argv[2];
const sample = process.argv[3] ?? 'hollow-box';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 940, height: 1100 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 300)}`));
await page.goto(`http://localhost:5199/?sample=${sample}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.waitForSelector('canvas', { timeout: 60000 });
await page.waitForTimeout(2500);
const shot = async (name) => { await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${sample}-${name}.png` }); console.log('shot', name); };
await shot('01-default');
const overlay = page.locator('select').first();
console.log('overlay options:', await overlay.locator('option').allTextContents());
await overlay.selectOption('thickness');
await shot('02-thickness');
await overlay.selectOption('');
const box = page.getByLabel('Mould (cope / drag)');
if (await box.count()) {
  await box.check();
  await shot('03-mould');
  const range = page.locator('input[type=range]').first();
  await range.fill('100');
  await shot('04-mould-open');
  await range.fill('0');
  await page.getByLabel('Section').check();
  await shot('05-section');
  await page.getByLabel('Section').uncheck();
}
const stages = page.getByRole('button', { name: /^\d\. / });
console.log('stage buttons:', await stages.count());
for (const i of [0, 1, 3, 6]) { if (i < await stages.count()) { await stages.nth(i).click(); await shot(`06-stage-${i + 1}`); } }
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
