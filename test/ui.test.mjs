// End-to-end check in a real browser: every tab, both views, the item sheet and
// all six themes, on an iPhone viewport and a desktop one. Needs Playwright:
//   npm i -D playwright && npx playwright install chromium && npm run test:ui
// Screenshots land in .shots/ (SHOT_DIR to change that).
import { chromium, devices } from 'playwright';
import { start } from './mock-app-server.mjs';

const OUT = process.env.SHOT_DIR || new URL('../.shots/', import.meta.url).pathname;
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });

const server = await start(8787);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const ctx = await browser.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Los_Angeles' });
const page = await ctx.newPage();

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.addInitScript(() => localStorage.setItem('hw_key', 'test-key'));
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle' });
await page.waitForSelector('.today, .item', { timeout: 8000 });

const shot = n => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
const report = {};

// --- Upcoming ---
await shot('01-upcoming');
report.todayCard = await page.locator('.today-body h3').first().textContent();
report.forecastBars = await page.locator('.bar').count();
report.sections = await page.locator('.section h2').allTextContents();
report.items = await page.locator('.item').count();

// --- search ---
await page.fill('#q', 'midterm');
await page.waitForTimeout(260);
report.searchTitles = await page.locator('.item .title').allTextContents();
await page.fill('#q', '');
await page.waitForTimeout(260);

// --- course filter ---
const chip = page.locator('.fchip', { hasText: 'AMATH 301' }).first();
if (await chip.count()) { await chip.click(); await page.waitForTimeout(150); report.filteredCourses = [...new Set(await page.locator('.chip').allTextContents())]; await page.locator('.fchip.all').click(); }

// --- week view ---
await page.click('[data-act="view"][data-view="week"]');
await page.waitForTimeout(200);
report.weekDays = await page.locator('.wday').count();
report.weekPills = await page.locator('.wpill').count();
await shot('02-week');
await page.click('[data-act="view"][data-view="list"]');
await page.waitForTimeout(150);

// --- item sheet ---
await page.locator('.item .body').first().click();
await page.waitForTimeout(250);
report.sheetOpen = await page.locator('#sheet[open]').count() === 1;
report.sheetTitle = await page.locator('#sheetTitle').textContent();
await shot('03-sheet');
await page.click('#estRow button:nth-child(4)');
await page.fill('#sheetNote', 'bring the lab notebook');
await page.click('#snoozeRow button:nth-child(2)');
await page.click('#sheetForm button[type="submit"]');
await page.waitForTimeout(400);
report.afterSave = await page.locator('.tag.note').count() > 0;

// --- check something off ---
const before = await page.locator('.item.done').count();
await page.locator('.item:not(.done) .check').first().click();
await page.waitForTimeout(400);
report.checkedOff = (await page.locator('.item.done').count()) > before;

// --- tabs ---
for (const [t, name] of [['prep', '04-prep'], ['courses', '05-courses'], ['done', '06-done']]) {
  await page.click(`.tabs [data-tab="${t}"]`);
  await page.waitForTimeout(350);
  await shot(name);
}
report.stats = await page.locator('.stat b').allTextContents();

// --- settings + themes ---
await page.click('.tabs [data-tab="settings"]');
await page.waitForTimeout(300);
report.swatches = await page.locator('.swatch').count();
await shot('07-settings');
for (const t of ['husky', 'midnight', 'forest', 'sunrise', 'mono']) {
  await page.click(`[data-act="theme"][data-theme="${t}"]`);
  await page.waitForTimeout(220);
  report[`theme_${t}`] = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
}
await page.click('[data-act="theme"][data-theme="husky"]');
await page.click('[data-act="mode"][data-mode="dark"]');
await page.waitForTimeout(250);
report.darkBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
report.themeMeta = await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.content);
await shot('08-settings-husky-dark');
await page.click('.tabs [data-tab="upcoming"]');
await page.waitForTimeout(350);
await shot('09-upcoming-husky-dark');

// theme persists across reload
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
report.persistedTheme = await page.evaluate(() => document.documentElement.dataset.theme + '/' + document.documentElement.dataset.mode);

// --- desktop width ---
const dctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, timezoneId: 'America/Los_Angeles' });
const dp = await dctx.newPage();
dp.on('pageerror', e => errors.push('desktop pageerror: ' + e.message));
await dp.addInitScript(() => localStorage.setItem('hw_key', 'test-key'));
await dp.goto('http://localhost:8787/', { waitUntil: 'networkidle' });
await dp.waitForTimeout(500);
await dp.keyboard.press('w');
await dp.waitForTimeout(250);
report.keyboardWeek = await dp.locator('.wday').count() > 0;
await dp.screenshot({ path: `${OUT}/10-desktop-week.png`, fullPage: true });
await dp.keyboard.press('4');
await dp.waitForTimeout(250);
report.keyboardTab = await dp.locator('h1#title').textContent();

report.errors = errors;
console.log(JSON.stringify(report, null, 2));
await browser.close();
server.close();
