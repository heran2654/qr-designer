import { chromium } from 'file:///C:/Users/74826/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
await page.waitForFunction(() => document.querySelector('#status-version')?.textContent.includes('QR V'));
await page.waitForFunction(() => !document.querySelector('#top-status')?.classList.contains('is-checking'), null, { timeout: 15000 });
await page.waitForTimeout(3500);

const initial = await page.evaluate(() => ({
  version: document.querySelector('#status-version').textContent,
  modules: document.querySelector('#status-modules').textContent,
  pixels: document.querySelector('#qr-canvas').getContext('2d').getImageData(0, 0, 720, 720).data.some(value => value !== 0)
  ,zxing: document.querySelector('#status-zxing').textContent.trim()
  ,top: document.querySelector('#top-status').textContent.trim()
}));
if (!initial.pixels || initial.version === 'QR V—' || !initial.zxing.includes('✓')) throw new Error(`默认设计未通过真实解码: ${JSON.stringify(initial)}; errors=${errors.join(' | ')}`);

await page.click('[data-page="content"]');
await page.fill('#qr-content', 'https://example.com/测试?source=smoke');
await page.waitForTimeout(500);
await page.waitForFunction(() => document.querySelector('#status-bytes').textContent !== '0 bytes');

await page.click('[data-page="qr"]');
const clamped = await page.evaluate(() => {
  const input = document.querySelector('#slider-spacing');
  input.value = 100;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return Number(input.value) <= Number(input.closest('.safety-slider').dataset.safeMax);
});
if (!clamped) throw new Error('动态安全滑块未阻止越界');

await page.click('[data-page="color"]');
await page.click('[data-color-mode="gradient"]');
if (!(await page.locator('[data-color-panel="gradient"]').isVisible())) throw new Error('渐变面板未显示');

await page.click('[data-page="finder"]');
await page.uncheck('#sync-finders');
await page.click('[data-finder="tr"]');
await page.evaluate(() => { const input = document.querySelector('#slider-finderRounding'); input.value = 40; input.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('[data-finder="tl"]');
const leftFinderValue = await page.inputValue('#slider-finderRounding');
await page.click('[data-finder="tr"]');
const rightFinderValue = await page.inputValue('#slider-finderRounding');
if (leftFinderValue === rightFinderValue) throw new Error('三个定位点解除同步后未保留独立参数');

await page.click('[data-page="logo"]');
const gapLocked = await page.isDisabled('#slider-logoGap');
const initialGap = await page.inputValue('#slider-logoGap');
if (!gapLocked || initialGap !== '1') throw new Error('单模块间隙锁定未生效');
await page.uncheck('#one-module-gap');
await page.evaluate(() => { const input = document.querySelector('#slider-logoGap'); input.value = 2; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(260);
if (!(await page.textContent('#logo-grid-readout')).includes('每侧间隙 2 模块')) throw new Error('Logo 间隙未按整数模块调整');
await page.check('#one-module-gap');
if ((await page.inputValue('#slider-logoGap')) !== '1') throw new Error('恢复单模块间隙失败');
await page.waitForTimeout(220);
await page.screenshot({ path: path.join(root, 'qa', 'logo-module-gap.png'), fullPage: true });
await page.click('#remove-logo');
if (await page.locator('#logo-object').isVisible()) throw new Error('Logo 隐藏功能失败');
await page.click('#remove-logo');

await page.click('[data-page="export"]');
await page.screenshot({ path: path.join(root, 'qa', 'desktop.png'), fullPage: true });

if (errors.length) throw new Error(`浏览器错误: ${errors.join(' | ')}`);
console.log(JSON.stringify({ ok: true, initial, clamped, status: await page.textContent('#top-status') }));
await browser.close();
