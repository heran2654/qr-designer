import { chromium } from 'file:///C:/Users/74826/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const root = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
await page.waitForFunction(() => document.querySelector('#status-zxing')?.textContent.includes('✓'), null, { timeout: 20000 });
await page.click('[data-page="export"]');
await page.click('#deep-check');
await page.waitForFunction(() => document.querySelector('#deep-check')?.textContent === '运行深度检查', null, { timeout: 60000 });
const result = await page.evaluate(() => ({
  zxing: document.querySelector('#check-zxing').textContent,
  jsqr: document.querySelector('#check-jsqr').textContent,
  stress: document.querySelector('#check-stress').textContent,
  contrast: document.querySelector('#check-contrast').textContent,
  exportDisabled: document.querySelector('#export-button').disabled,
  status: document.querySelector('#top-status').textContent.trim()
}));
await page.screenshot({ path: path.join(root, 'qa', 'deep-check.png'), fullPage: true });

const pngEvent = page.waitForEvent('download', { timeout: 30000 });
await page.click('#export-button');
const pngDownload = await pngEvent;
const pngPath = path.join(root, 'qa', 'export-test.png');
await pngDownload.saveAs(pngPath);
const pngSize = (await fs.stat(pngPath)).size;

await page.click('[data-format="svg"]');
const svgEvent = page.waitForEvent('download', { timeout: 30000 });
await page.click('#export-button');
const svgDownload = await svgEvent;
const svgPath = path.join(root, 'qa', 'export-test.svg');
await svgDownload.saveAs(svgPath);
const svgText = await fs.readFile(svgPath, 'utf8');
await browser.close();
if (errors.length) throw new Error(errors.join(' | '));
if (result.zxing !== '✓' || result.stress !== '✓' || result.exportDisabled) throw new Error(`深度验证失败: ${JSON.stringify(result)}`);
if (pngSize < 5000 || !svgText.startsWith('<svg')) throw new Error(`导出文件无效: png=${pngSize}, svg=${svgText.slice(0, 20)}`);
console.log(JSON.stringify({ ok: true, result, pngSize, svgBytes: svgText.length }));
