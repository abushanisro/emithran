// Logs in through the real Auth0 page with a headless browser and writes the session cookie header to a file (mode 600), so the load test can call the
// app exactly as a signed-in customer's browser does (frontend proxy -> backend -> data API -> database).
//   LOAD_BASE=https://app.emithran.com LOAD_EMAIL=... LOAD_PASSWORD=... node scripts/loadtest/session.mjs <out-file>
// The credentials come from the environment and are never written anywhere; the output holds only the session cookie, which expires with the session.
import { chromium } from '@playwright/test';
import { chmodSync, writeFileSync } from 'node:fs';

const base = process.env.LOAD_BASE ?? 'https://app.emithran.com';
const { LOAD_EMAIL: email, LOAD_PASSWORD: password } = process.env;
const out = process.argv[2];
if (!email || !password || !out) { console.error('LOAD_EMAIL, LOAD_PASSWORD and an output file are required'); process.exit(2); }

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${base}/auth/login`);
await page.locator('input[name="username"], input[type="email"]').first().fill(email);
await page.locator('input[name="password"], input[type="password"]').first().fill(password);
await page.locator('button[type="submit"]:not([data-action-button-secondary])').first().click();
await page.waitForURL((u) => u.origin === new URL(base).origin && !u.pathname.startsWith('/auth/'), { timeout: 60_000 });
await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
const host = new URL(base).hostname;
const cookie = (await ctx.cookies()).filter((c) => host.endsWith(c.domain.replace(/^\./, ''))).map((c) => `${c.name}=${c.value}`).join('; ');
await browser.close();
if (!cookie) { console.error('no session cookie was set: login did not complete'); process.exit(1); }
writeFileSync(out, cookie, { mode: 0o600 }); chmodSync(out, 0o600);
console.log(`signed in; session cookie saved (${cookie.split('; ').length} cookies)`);
