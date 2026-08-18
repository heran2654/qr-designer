/* QR Designer V1 - local-first, no build step. */
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

const state = {
  page: 'qr', content: 'https://example.com/design', ecc: 'H', requestedVersion: 0,
  qr: null, matrix: [], version: 0, moduleCount: 0, maskPattern: null, encodingError: null,
  shape: 'square', rounding: 12, moduleSize: 88, spacing: 14,
  finderRounding: 8, finderSize: 100, finderCore: 74, finderOuterShape: 'square', finderCoreShape: 'square',
  finderSync: true, activeFinder: 'tl', finders: {
    tl: { rounding: 8, size: 100, core: 74 }, tr: { rounding: 8, size: 100, core: 74 }, bl: { rounding: 8, size: 100, core: 74 }
  },
  colorMode: 'solid', foreground: '#171A1F', opacity: 100,
  gradientType: 'linear', gradientStart: '#5367F0', gradientEnd: '#B446E4', gradientAngle: 45,
  textureStrength: 72, textureContrast: 58, textureImage: null,
  logoSize: 15, logoGap: 1, logoGapLocked: true, logoRounding: 18, logoImage: null, logoVisible: true,
  background: '#FFFFFF', backgroundMode: 'solid', zoom: 100,
  exportFormat: 'png', exportSize: 1024,
  quickValid: null, zxingValid: null, stressValid: null
};

const sliderMeta = {
  rounding: ['模块间距', '模块尺寸', '定位点差异'], moduleSize: ['模块间距', '二维码密度'],
  spacing: ['模块尺寸', 'Logo 占用面积', '纠错余量'], finderRounding: ['定位点外框尺寸', '中心识别区域'],
  finderSize: ['静区距离', '二维码版本'], finderCore: ['外框厚度', '中心识别区域'],
  opacity: ['前景与背景对比度', '目标背景亮度'], logoSize: ['纠错余量', '模块间距', 'Logo 安全区'],
  logoGap: ['Logo 大小', '数据模块占用'], logoRounding: ['Logo 大小', '安全区形状'],
  gradientAngle: ['完整角度范围可用'], textureStrength: ['纹理亮部', '前景对比度', '模块完整度'],
  textureContrast: ['图片暗部保护', '目标背景亮度']
};

const capacityCache = new Map();
let toastTimer, validationTimer, logoReflowTimer, validationSequence = 0, zxingLoader;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function createSafetySlider(root) {
  const key = root.dataset.key, label = root.dataset.label;
  const initial = Number(root.dataset.value), min = Number(root.dataset.min || 0), max = Number(root.dataset.max || 100);
  const unit = root.dataset.unit || '%';
  root.dataset.safeMin = root.dataset.safeMin ?? min; root.dataset.safeMax = root.dataset.safeMax ?? max;
  state[key] = state[key] ?? initial;
  root.innerHTML = `<div class="slider-head"><label class="slider-label" for="slider-${key}">${label}</label><span class="slider-value-wrap"><input class="slider-value" id="value-${key}" inputmode="numeric" value="${state[key]}" aria-label="${label}数值"><span class="slider-unit">${unit}</span></span></div><div class="slider-control"><div class="slider-track"><span class="track-active"></span><span class="track-danger-left"></span><span class="track-danger-right"></span></div><span class="slider-thumb"></span><input class="safety-range" id="slider-${key}" type="range" min="${min}" max="${max}" value="${state[key]}" aria-label="${label}"><span class="danger-hit"></span><div class="danger-tooltip"><strong>当前区域不可用</strong><span class="limit-copy"></span><span>主要限制因素：${sliderMeta[key].join('、')}</span></div><span class="safety-boundary"></span></div><div class="slider-scale"><span>${min}${unit}</span><span>${max}${unit}</span></div>`;
  const range = $('.safety-range', root), valueInput = $('.slider-value', root);
  range.addEventListener('input', () => {
    const requested = Number(range.value), safeMin = Number(root.dataset.safeMin), safeMax = Number(root.dataset.safeMax);
    const next = clamp(requested, safeMin, safeMax);
    if (next !== requested) { range.value = next; showToast(`${label}已到达安全${requested > safeMax ? '上限' : '下限'} ${next}${unit}`); }
    setValue(key, next, true);
  });
  range.addEventListener('change', scheduleValidation);
  valueInput.addEventListener('change', () => {
    const requested = Number(valueInput.value.replace(/[^0-9.-]/g, '')) || 0;
    const next = clamp(requested, Number(root.dataset.safeMin), Number(root.dataset.safeMax));
    if (next !== requested) showToast(`${label}已自动限制为 ${next}${unit}`);
    setValue(key, next, true); scheduleValidation();
  });
  updateSlider(root);
}

function updateSlider(root) {
  const key = root.dataset.key, range = $('.safety-range', root); if (!range) return;
  const min = Number(range.min), max = Number(range.max), safeMin = Number(root.dataset.safeMin), safeMax = Number(root.dataset.safeMax);
  const value = clamp(Number(state[key]), safeMin, safeMax); state[key] = value;
  const pct = (value - min) / (max - min) * 100, minPct = (safeMin - min) / (max - min) * 100, maxPct = (safeMax - min) / (max - min) * 100;
  range.value = value; $('.slider-value', root).value = Math.round(value); $('.slider-thumb', root).style.left = `${pct}%`;
  $('.track-active', root).style.width = `${pct}%`; $('.track-danger-left', root).style.width = `${minPct}%`; $('.track-danger-right', root).style.width = `${100 - maxPct}%`;
  const dangerHit = $('.danger-hit', root); dangerHit.style.left = `${maxPct}%`; dangerHit.style.right = '0';
  const boundary = $('.safety-boundary', root); boundary.style.left = `${maxPct}%`; boundary.textContent = maxPct < 99.5 ? `${Math.round(safeMax)}${root.dataset.unit || '%'}` : '';
  $('.limit-copy', root).textContent = safeMin > min ? `安全范围：${Math.round(safeMin)} — ${Math.round(safeMax)}` : `安全上限：${Math.round(safeMax)}`;
}

function setSliderBounds(key, safeMin, safeMax, activeKey) {
  const root = $(`.safety-slider[data-key="${key}"]`); if (!root) return;
  root.dataset.safeMin = Math.round(safeMin); root.dataset.safeMax = Math.round(safeMax);
  if (key !== activeKey && (state[key] < safeMin || state[key] > safeMax)) {
    state[key] = clamp(state[key], safeMin, safeMax); showToast(`${root.dataset.label}已自动限制为 ${Math.round(state[key])}${root.dataset.unit || '%'}`);
  }
  updateSlider(root);
}

function recomputeSafety(activeKey) {
  const eccLogoBase = { L: 15, M: 20, Q: 26, H: 32 }[state.ecc], densityPenalty = Math.max(0, (state.version - 6) * .18);
  const gapPercent = state.moduleCount ? state.logoGap * 200 / state.moduleCount : state.logoGap * 6;
  const spacingMax = clamp(65 - state.logoSize * .72 - (100 - state.moduleSize) * .35 - densityPenalty, 16, 56);
  const logoMax = clamp(eccLogoBase - state.spacing * .30 - gapPercent * .18 - densityPenalty, 10, 34);
  const moduleMin = clamp(58 + state.spacing * .48 + state.logoSize * .20 + densityPenalty, 55, 88);
  if (activeKey === 'spacing') {
    setSliderBounds('spacing', 0, clamp(70 - state.logoSize * .52 - densityPenalty, 18, 56), activeKey);
    setSliderBounds('logoSize', 0, clamp(eccLogoBase + 2 - state.spacing * .40 - gapPercent * .16, 10, 34), activeKey);
  } else if (activeKey === 'logoSize') {
    setSliderBounds('logoSize', 0, clamp(eccLogoBase + 2 - state.spacing * .24 - gapPercent * .14, 10, 36), activeKey);
    setSliderBounds('spacing', 0, spacingMax, activeKey);
  } else { setSliderBounds('spacing', 0, spacingMax, activeKey); setSliderBounds('logoSize', 0, logoMax, activeKey); }
  const maxGapModules = clamp(Math.floor((34 - state.logoSize * .45) * Math.max(state.moduleCount, 21) / 200), 1, 8);
  setSliderBounds('moduleSize', moduleMin, 96, activeKey); setSliderBounds('logoGap', 0, maxGapModules, activeKey);
  setSliderBounds('rounding', 0, clamp(88 - state.spacing * .45 - state.logoSize * .18, 46, 86), activeKey);
  setSliderBounds('opacity', clamp(30 + state.spacing * .35 + state.logoSize * .28, 34, 64), 100, activeKey);
  setSliderBounds('finderRounding', 0, clamp(82 - state.spacing * .28, 56, 82), activeKey); setSliderBounds('finderSize', clamp(66 + state.spacing * .2, 66, 82), 100, activeKey);
  setSliderBounds('finderCore', 56, clamp(91 - state.finderRounding * .08, 78, 91), activeKey); setSliderBounds('logoRounding', 0, clamp(86 - state.logoSize * .5, 58, 86), activeKey);
  setSliderBounds('textureStrength', 0, clamp(92 - state.spacing * .25 - state.logoSize * .15, 58, 88), activeKey); setSliderBounds('textureContrast', clamp(26 + state.textureStrength * .18, 28, 48), 100, activeKey);
}

function setValue(key, value, userAction = false) {
  state[key] = value;
  const finderField = { finderRounding: 'rounding', finderSize: 'size', finderCore: 'core' }[key];
  if (finderField) {
    if (state.finderSync) Object.values(state.finders).forEach(config => { config[finderField] = value; });
    else state.finders[state.activeFinder][finderField] = value;
  }
  if (key === 'logoSize' || key === 'logoGap') scheduleLogoReflow();
  if (userAction) recomputeSafety(key); $$(`.safety-slider[data-key="${key}"]`).forEach(updateSlider); updateVisuals();
}

function encodeQr() {
  const text = state.content || ' ';
  try {
    const initialQr = qrcode(state.requestedVersion, state.ecc); initialQr.addData(text); initialQr.make();
    state.moduleCount = initialQr.getModuleCount(); state.version = (state.moduleCount - 17) / 4;
    const optimized = state.logoVisible ? selectLogoAwareQr(text, initialQr) : { qr: initialQr, maskPattern: null };
    state.qr = optimized.qr; state.maskPattern = optimized.maskPattern;
    state.matrix = matrixFromQr(state.qr); state.encodingError = null;
  } catch (error) { state.qr = null; state.matrix = []; state.encodingError = error; }
  updateContentStats(); recomputeSafety(); updateVisuals(); scheduleValidation();
}

function matrixFromQr(qr) {
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => qr.isDark(y, x)));
}

function selectLogoAwareQr(text, fallbackQr) {
  if (typeof fallbackQr.makeWithMask !== 'function') return { qr: fallbackQr, maskPattern: null };
  let bestQr = fallbackQr, bestMask = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = qrcode(state.version, state.ecc); candidate.addData(text); candidate.makeWithMask(mask);
    let score = 0;
    for (let y = 0; y < state.moduleCount; y++) for (let x = 0; x < state.moduleCount; x++) {
      if (isInLogoMask(x, y, state.moduleCount) && candidate.isDark(y, x)) score++;
    }
    if (score < bestScore) { bestScore = score; bestQr = candidate; bestMask = mask; }
  }
  return { qr: bestQr, maskPattern: bestMask };
}

function scheduleLogoReflow() {
  clearTimeout(logoReflowTimer);
  logoReflowTimer = setTimeout(() => encodeQr(), 140);
}

function utf8Length(text) { return new TextEncoder().encode(text).length; }
function getCapacity(version, ecc) {
  const key = `${version}-${ecc}`; if (capacityCache.has(key)) return capacityCache.get(key);
  let low = 0, high = 3000;
  while (low < high) { const mid = Math.ceil((low + high) / 2); try { const test = qrcode(version, ecc); test.addData('a'.repeat(mid)); test.make(); low = mid; } catch { high = mid - 1; } }
  capacityCache.set(key, low); return low;
}

function updateContentStats() {
  const bytes = utf8Length(state.content), version = state.version || state.requestedVersion || 40, capacity = getCapacity(version, state.ecc);
  $('#capacity-copy').textContent = state.encodingError ? `${bytes} bytes · 已超出容量` : `${bytes} / ${capacity} bytes`;
  $('#capacity-bar').style.width = `${clamp(bytes / Math.max(1, capacity) * 100, 0, 100)}%`; $('#capacity-bar').style.background = state.encodingError ? 'var(--danger)' : '';
  $('#content-error').classList.toggle('is-hidden', !state.encodingError); $('#status-version').textContent = state.version ? `QR V${state.version}` : 'QR V—';
  $('#status-ecc').textContent = state.ecc; $('#status-modules').textContent = state.moduleCount ? `${state.moduleCount} × ${state.moduleCount} modules` : '— × — modules'; $('#status-bytes').textContent = `${bytes} bytes`;
  $('#check-structure').textContent = state.encodingError ? '✕' : '✓'; $('#check-structure').className = state.encodingError ? 'is-fail' : '';
}

function updateVisuals() {
  drawQr($('#qr-canvas'), 720, { validation: false });
  const logo = $('#logo-object'), safe = $('#logo-safe-overlay');
  const geometry = getLogoGridGeometry(state.moduleCount || 21), total = (state.moduleCount || 21) + 8;
  if (logo) { logo.style.width = `${geometry.logoModules / total * 100}%`; logo.style.borderRadius = `${state.logoRounding / 2}%`; logo.style.display = state.logoVisible ? '' : 'none'; }
  if (safe) safe.style.width = `${geometry.maskModules / total * 100}%`;
  if ($('#logo-grid-readout')) $('#logo-grid-readout').textContent = `Logo ${geometry.logoModules} × ${geometry.logoModules} 模块 · 每侧间隙 ${geometry.gapModules} 模块${state.maskPattern === null ? '' : ` · Mask ${state.maskPattern}`}`;
  $('#artboard').classList.toggle('transparent-artboard', state.backgroundMode === 'transparent');
}

function drawQr(canvas, outputSize, options = {}) {
  canvas.width = outputSize; canvas.height = outputSize; const ctx = canvas.getContext('2d', { willReadFrequently: Boolean(options.validation) }); ctx.clearRect(0, 0, outputSize, outputSize);
  if (!state.matrix.length) return canvas;
  const validation = Boolean(options.validation), backgroundMode = validation ? 'solid' : state.backgroundMode;
  const background = validation && state.backgroundMode === 'transparent' ? '#FFFFFF' : state.background;
  if (backgroundMode === 'solid') { ctx.fillStyle = background; ctx.fillRect(0, 0, outputSize, outputSize); }
  const quiet = 4, total = state.moduleCount + quiet * 2, cell = outputSize / total;
  const moduleScale = state.moduleSize / 100, gapScale = state.spacing / 100 * .42, drawScale = Math.max(.34, moduleScale - gapScale);
  const radius = state.shape === 'circle' ? .5 : state.shape === 'rounded' ? state.rounding / 200 : 0;
  const texturePattern = state.colorMode === 'image' && state.textureImage ? makeTexturePattern(ctx, outputSize) : null, fillStyle = getForegroundStyle(ctx, outputSize, texturePattern);
  ctx.globalAlpha = state.opacity / 100;
  for (let y = 0; y < state.moduleCount; y++) for (let x = 0; x < state.moduleCount; x++) {
    if (!state.matrix[y][x] || inFinder(x, y, state.moduleCount)) continue;
    if (state.logoVisible && isInLogoMask(x, y, state.moduleCount)) continue;
    const px = (x + quiet + (1 - drawScale) / 2) * cell, py = (y + quiet + (1 - drawScale) / 2) * cell, s = cell * drawScale;
    ctx.fillStyle = fillStyle; drawModule(ctx, px, py, s, radius);
    if (texturePattern) { ctx.globalAlpha = state.opacity / 100 * (1 - state.textureStrength / 100 * .64); ctx.fillStyle = state.foreground; drawModule(ctx, px, py, s, radius); ctx.globalAlpha = state.opacity / 100; }
  }
  drawFinder(ctx, quiet * cell, quiet * cell, cell, fillStyle, background, 'tl'); drawFinder(ctx, (quiet + state.moduleCount - 7) * cell, quiet * cell, cell, fillStyle, background, 'tr'); drawFinder(ctx, quiet * cell, (quiet + state.moduleCount - 7) * cell, cell, fillStyle, background, 'bl');
  ctx.globalAlpha = 1; if (state.logoVisible) drawLogo(ctx, outputSize); return canvas;
}

function getForegroundStyle(ctx, size, texturePattern) {
  if (texturePattern) return texturePattern; if (state.colorMode !== 'gradient') return state.foreground;
  if (state.gradientType === 'radial') { const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * .58); g.addColorStop(0, state.gradientStart); g.addColorStop(1, state.gradientEnd); return g; }
  if (state.gradientType === 'conic' && ctx.createConicGradient) { const g = ctx.createConicGradient(state.gradientAngle * Math.PI / 180, size / 2, size / 2); g.addColorStop(0, state.gradientStart); g.addColorStop(.5, state.gradientEnd); g.addColorStop(1, state.gradientStart); return g; }
  const a = state.gradientAngle * Math.PI / 180, dx = Math.cos(a) * size / 2, dy = Math.sin(a) * size / 2, g = ctx.createLinearGradient(size / 2 - dx, size / 2 - dy, size / 2 + dx, size / 2 + dy); g.addColorStop(0, state.gradientStart); g.addColorStop(1, state.gradientEnd); return g;
}

function makeTexturePattern(ctx, size) {
  const off = document.createElement('canvas'); off.width = size; off.height = size; const octx = off.getContext('2d'), img = state.textureImage;
  const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight), w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  octx.filter = `contrast(${60 + state.textureContrast}%)`; octx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h); return ctx.createPattern(off, 'no-repeat');
}

function drawModule(ctx, x, y, size, radius) { if (state.shape === 'circle') { ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.fill(); } else roundedRect(ctx, x, y, size, size, size * radius); }
function inFinder(x, y, size) { return (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7); }
function isProtectedFunction(x, y, version, size) {
  if (x === 6 || y === 6 || x === 8 || y === 8) return true;
  if (x < 9 && y < 9 || x >= size - 8 && y < 9 || x < 9 && y >= size - 8) return true;
  const positions = alignmentPositions(version, size);
  return positions.some(cy => positions.some(cx => !(cx < 9 && cy < 9) && !(cx > size - 9 && cy < 9) && !(cx < 9 && cy > size - 9) && Math.abs(x - cx) <= 2 && Math.abs(y - cy) <= 2));
}
function alignmentPositions(version, size) { if (version <= 1) return []; const count = Math.floor(version / 7) + 2, step = version === 32 ? 26 : Math.ceil((version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2, result = [6]; for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos); return result; }
function getLogoGridGeometry(size) {
  if (!size) return { logoModules: 1, gapModules: 0, logoStart: 0, logoEnd: 1, maskStart: 0, maskEnd: 1, maskModules: 1 };
  let logoModules = clamp(Math.round(size * state.logoSize / 100), 1, size - 2);
  if (logoModules % 2 === 0) logoModules += logoModules < size - 2 ? 1 : -1;
  const gapModules = clamp(Math.round(state.logoGap), 0, Math.floor((size - logoModules) / 2));
  const logoStart = (size - logoModules) / 2, logoEnd = logoStart + logoModules;
  const maskStart = logoStart - gapModules, maskEnd = logoEnd + gapModules;
  return { logoModules, gapModules, logoStart, logoEnd, maskStart, maskEnd, maskModules: maskEnd - maskStart };
}
function isInLogoMask(x, y, size) { const g = getLogoGridGeometry(size); return x >= g.maskStart && x < g.maskEnd && y >= g.maskStart && y < g.maskEnd; }

function drawFinder(ctx, x, y, cell, fill, background, finderKey) {
  const config = state.finders[finderKey] || { rounding: state.finderRounding, size: state.finderSize, core: state.finderCore };
  const scale = config.size / 100, inset = (1 - scale) * 3.5 * cell; x += inset; y += inset; cell *= scale;
  const size = 7 * cell, round = state.finderOuterShape === 'square' ? 0 : state.finderOuterShape === 'circle' ? size / 2 : config.rounding / 100 * cell * 2;
  ctx.fillStyle = fill; roundedRect(ctx, x, y, size, size, round);
  ctx.fillStyle = background; roundedRect(ctx, x + cell, y + cell, 5 * cell, 5 * cell, state.finderOuterShape === 'circle' ? 2.5 * cell : round * .65);
  const core = 3 * cell * (config.core / 74), offset = (7 * cell - core) / 2;
  const coreRound = state.finderCoreShape === 'square' ? 0 : state.finderCoreShape === 'circle' ? core / 2 : config.rounding / 100 * cell;
  ctx.fillStyle = fill; roundedRect(ctx, x + offset, y + offset, core, core, coreRound);
}

function drawLogo(ctx, size) {
  const quiet = 4, cell = size / (state.moduleCount + quiet * 2), g = getLogoGridGeometry(state.moduleCount);
  const logoSize = g.logoModules * cell, x = (quiet + g.logoStart) * cell;
  ctx.save(); ctx.beginPath(); roundedPath(ctx, x, x, logoSize, logoSize, logoSize * state.logoRounding / 200); ctx.clip();
  if (state.logoImage) ctx.drawImage(state.logoImage, x, x, logoSize, logoSize);
  else { ctx.fillStyle = '#5667E8'; ctx.fillRect(x, x, logoSize, logoSize); ctx.fillStyle = '#FFFFFF'; ctx.font = `600 ${logoSize * .56}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Q', size / 2, size / 2 + logoSize * .03); }
  ctx.restore();
}
function roundedPath(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
function roundedRect(ctx, x, y, w, h, r) { ctx.beginPath(); roundedPath(ctx, x, y, w, h, r); ctx.fill(); }

function scheduleValidation() {
  const seq = ++validationSequence; setTopStatus('checking', '正在验证'); state.quickValid = null; state.zxingValid = null; state.stressValid = null;
  setValidationBadge('status-zxing', null, 'ZXing'); setValidationBadge('status-jsqr', null, 'jsQR'); updateExportChecks(); clearTimeout(validationTimer);
  validationTimer = setTimeout(async () => {
    if (seq !== validationSequence) return;
    if (state.encodingError) { state.quickValid = false; setTopStatus('danger', '当前不可导出'); updateExportChecks(); return; }
    const canvas = document.createElement('canvas'); drawQr(canvas, 640, { validation: true }); state.quickValid = Boolean(decodeWithJsQr(canvas)); setValidationBadge('status-jsqr', state.quickValid, 'jsQR');
    setTopStatus(state.quickValid ? 'ok' : 'danger', state.quickValid ? '可正常识别' : '当前不可导出'); updateExportChecks();
    if (state.quickValid) { await idle(); if (seq !== validationSequence) return; state.zxingValid = await decodeWithZxing(canvas); setValidationBadge('status-zxing', state.zxingValid, 'ZXing'); if (!state.zxingValid) setTopStatus('danger', '当前不可导出'); updateExportChecks(); }
  }, 360);
}

function decodeWithJsQr(canvas) { try { const ctx = canvas.getContext('2d', { willReadFrequently: true }), image = ctx.getImageData(0, 0, canvas.width, canvas.height), result = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' }); return result && result.data === (state.content || ' '); } catch { return false; } }
function loadZxing() { if (window.ZXingBrowser) return Promise.resolve(window.ZXingBrowser); if (!zxingLoader) zxingLoader = loadScript('vendor/zxing-browser.min.js').then(() => window.ZXingBrowser); return zxingLoader; }
async function decodeWithZxing(canvas) { try { const ZXing = await loadZxing(), reader = new ZXing.BrowserQRCodeReader(), result = await reader.decodeFromCanvas(canvas); return result && result.getText() === (state.content || ' '); } catch { return false; } }

async function runDeepValidation() {
  if (state.encodingError) return false; const button = $('#deep-check'); button.disabled = true; button.textContent = '检查中…'; setTopStatus('checking', '正在深度验证');
  const canvas = document.createElement('canvas'); drawQr(canvas, 768, { validation: true }); state.quickValid = Boolean(decodeWithJsQr(canvas)); state.zxingValid = await decodeWithZxing(canvas); setValidationBadge('status-zxing', state.zxingValid, 'ZXing');
  setValidationBadge('status-jsqr', state.quickValid, 'jsQR'); state.stressValid = await runStressTests();
  const valid = state.quickValid && state.zxingValid && state.stressValid; setTopStatus(valid ? 'ok' : 'danger', valid ? '可正常识别' : '当前不可导出'); button.disabled = false; button.textContent = '运行深度检查'; updateExportChecks(); return valid;
}

async function runStressTests() {
  const base = document.createElement('canvas'); drawQr(base, 512, { validation: true });
  const small = document.createElement('canvas'); small.width = 240; small.height = 240; const sctx = small.getContext('2d', { willReadFrequently: true }); sctx.imageSmoothingEnabled = true; sctx.drawImage(base, 0, 0, 240, 240); const scalePass = decodeWithJsQr(small);
  const blurred = document.createElement('canvas'); blurred.width = 420; blurred.height = 420; const bctx = blurred.getContext('2d', { willReadFrequently: true }); bctx.filter = 'blur(0.45px)'; bctx.drawImage(base, 0, 0, 420, 420); await idle(); return Boolean(scalePass && decodeWithJsQr(blurred));
}

function updateExportChecks() {
  setCheck('check-zxing', state.zxingValid, state.zxingValid === null ? '待检查' : undefined); setCheck('check-jsqr', state.quickValid, state.quickValid === null ? '待检查' : undefined); setCheck('check-stress', state.stressValid, state.stressValid === null ? '待检查' : undefined);
  const contrastOk = getContrastStatus(); setCheck('check-contrast', contrastOk);
  const failed = Boolean(state.encodingError || state.quickValid === false || state.zxingValid === false || state.stressValid === false || !contrastOk);
  $('#export-error').classList.toggle('is-hidden', !failed); $('#export-error-reason').textContent = getFailureReasons().join('、'); $('#export-button').disabled = failed; $('#export-button').textContent = failed ? '无法导出' : '导出二维码';
}
function setCheck(id, value, pendingText) { const el = $(`#${id}`); if (value === null) { el.textContent = pendingText || '待检查'; el.className = 'is-pending'; } else { el.textContent = value ? '✓' : '✕'; el.className = value ? '' : 'is-fail'; } }
function setValidationBadge(id, value, label) { const el = $(`#${id}`); el.innerHTML = value === null ? `<i class="mini-pending">·</i> ${label}` : value ? `<i class="mini-ok">✓</i> ${label}` : `<i class="mini-fail">×</i> ${label}`; }
function getContrastStatus() { const bg = state.backgroundMode === 'transparent' ? '#FFFFFF' : state.background; if (state.colorMode === 'image') return state.textureContrast >= 35; const colors = state.colorMode === 'gradient' ? [state.gradientStart, state.gradientEnd] : [state.foreground]; return colors.every(color => contrastRatio(color, bg) >= 2.4) && state.opacity >= 40; }
function contrastRatio(a, b) { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + .05) / (Math.min(la, lb) + .05); }
function luminance(hex) { const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; }

function getFailureReasons() {
  const reasons = []; if (state.encodingError) reasons.push('内容超过容量'); if (!getContrastStatus()) reasons.push('前景与背景对比度不足');
  if (!state.quickValid || state.zxingValid === false) { if (state.logoSize > 24) reasons.push('Logo 占用面积过大'); if (state.spacing > 22) reasons.push('模块间距过大'); if (state.moduleSize < 72) reasons.push('模块尺寸过小'); if (!reasons.length) reasons.push('当前样式无法可靠解码'); }
  if (state.stressValid === false) reasons.push('缩放或轻微模糊后识别失败'); return [...new Set(reasons)];
}

function autoFix() {
  const changes = [], apply = (key, next, label, unit = '%') => { if (state[key] !== next) { changes.push(`${label} ${Math.round(state[key])}${unit} → ${next}${unit}`); state[key] = next; } };
  apply('logoSize', Math.min(state.logoSize, { L: 10, M: 14, Q: 18, H: 21 }[state.ecc]), 'Logo 大小'); apply('logoGap', Math.min(state.logoGap, 1), '周围空隙', ' 模块'); apply('spacing', Math.min(state.spacing, 12), '模块间距'); apply('moduleSize', Math.max(state.moduleSize, 90), '模块大小'); apply('opacity', Math.max(state.opacity, 92), '透明度');
  if (!getContrastStatus()) { state.colorMode = 'solid'; state.foreground = '#171A1F'; state.background = '#FFFFFF'; state.backgroundMode = 'solid'; changes.push('颜色已恢复为高对比度'); }
  recomputeSafety(); updateAllSliders(); updateVisuals(); scheduleValidation(); showToast(changes.length ? `已最小化调整：${changes.join('；')}` : '当前参数无需调整');
}

function renderSvg(size) {
  const quiet = 4, total = state.moduleCount + quiet * 2, cell = size / total, scale = Math.max(.34, state.moduleSize / 100 - state.spacing / 100 * .42), bg = state.backgroundMode === 'transparent' ? 'none' : state.background;
  const defs = state.colorMode === 'gradient' ? `<defs><linearGradient id="qr-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${state.gradientStart}"/><stop offset="1" stop-color="${state.gradientEnd}"/></linearGradient></defs>` : '', fill = state.colorMode === 'gradient' ? 'url(#qr-gradient)' : state.foreground;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`, defs]; if (bg !== 'none') parts.push(`<rect width="100%" height="100%" fill="${bg}"/>`); parts.push(`<g fill="${fill}" opacity="${state.opacity / 100}">`);
  for (let y = 0; y < state.moduleCount; y++) for (let x = 0; x < state.moduleCount; x++) { if (!state.matrix[y][x] || inFinder(x, y, state.moduleCount)) continue; if (state.logoVisible && isInLogoMask(x, y, state.moduleCount)) continue; const px = (x + quiet + (1 - scale) / 2) * cell, py = (y + quiet + (1 - scale) / 2) * cell, s = cell * scale; parts.push(state.shape === 'circle' ? `<circle cx="${px + s / 2}" cy="${py + s / 2}" r="${s / 2}"/>` : `<rect x="${px}" y="${py}" width="${s}" height="${s}" rx="${state.shape === 'rounded' ? s * state.rounding / 200 : 0}"/>`); }
  parts.push('</g>'); const finderSvg = (x, y) => state.backgroundMode === 'transparent'
    ? `<g fill="${fill}" opacity="${state.opacity / 100}"><path fill-rule="evenodd" d="M${x} ${y}h${7 * cell}v${7 * cell}h-${7 * cell}z M${x + cell} ${y + cell}h${5 * cell}v${5 * cell}h-${5 * cell}z"/><rect x="${x + 2 * cell}" y="${y + 2 * cell}" width="${3 * cell}" height="${3 * cell}"/></g>`
    : `<g fill="${fill}" opacity="${state.opacity / 100}"><rect x="${x}" y="${y}" width="${7 * cell}" height="${7 * cell}" rx="${state.finderRounding / 100 * cell * 2}"/><rect x="${x + cell}" y="${y + cell}" width="${5 * cell}" height="${5 * cell}" fill="${state.background}"/><rect x="${x + 2 * cell}" y="${y + 2 * cell}" width="${3 * cell}" height="${3 * cell}"/></g>`;
  parts.push(finderSvg(quiet * cell, quiet * cell), finderSvg((quiet + state.moduleCount - 7) * cell, quiet * cell), finderSvg(quiet * cell, (quiet + state.moduleCount - 7) * cell));
  if (state.logoVisible) { const g = getLogoGridGeometry(state.moduleCount), ls = g.logoModules * cell, lx = (quiet + g.logoStart) * cell; if (state.logoImage) parts.push(`<image href="${state.logoImage.src}" x="${lx}" y="${lx}" width="${ls}" height="${ls}" preserveAspectRatio="xMidYMid meet"/>`); else parts.push(`<rect x="${lx}" y="${lx}" width="${ls}" height="${ls}" rx="${ls * state.logoRounding / 200}" fill="#5667E8"/><text x="${size / 2}" y="${size / 2 + ls * .18}" text-anchor="middle" font-family="sans-serif" font-size="${ls * .56}" font-weight="600" fill="#fff">Q</text>`); }
  parts.push('</svg>'); return parts.join('');
}

async function exportQr() {
  const valid = await runDeepValidation(); if (!valid) { showToast('导出已阻止：当前设计未通过可靠性检查'); return; }
  const size = clamp(Number($('#export-width').value) || 1024, 256, 8192);
  if (state.exportFormat === 'svg' && state.colorMode !== 'image') downloadBlob(new Blob([renderSvg(size)], { type: 'image/svg+xml;charset=utf-8' }), 'qr-designer.svg');
  else { if (state.exportFormat === 'svg' && state.colorMode === 'image') showToast('图片纹理以 PNG 导出，以保持纹理效果'); const canvas = document.createElement('canvas'); drawQr(canvas, size, { validation: false }); canvas.toBlob(blob => downloadBlob(blob, 'qr-designer.png'), 'image/png'); }
}
function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function loadImageFile(file, callback) { if (!file) return; const reader = new FileReader(); reader.onload = () => { const img = new Image(); img.onload = () => callback(img, reader.result); img.src = reader.result; }; reader.readAsDataURL(file); }

function removeLogoBackground() {
  if (!state.logoImage) { showToast('请先导入 Logo 图片'); return; }
  const size = Math.min(1024, Math.max(state.logoImage.naturalWidth, state.logoImage.naturalHeight)), canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size; const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(state.logoImage, 0, 0, size, size);
  const image = ctx.getImageData(0, 0, size, size), data = image.data; for (let i = 0; i < data.length; i += 4) { const min = Math.min(data[i], data[i + 1], data[i + 2]); if (min > 225) data[i + 3] = Math.round(data[i + 3] * clamp((245 - min) / 20, 0, 1)); }
  ctx.putImageData(image, 0, 0); const img = new Image(); img.onload = () => { state.logoImage = img; updateLogoPreview(); updateVisuals(); scheduleValidation(); showToast('Logo 浅色背景已移除'); }; img.src = canvas.toDataURL('image/png');
}
function updateLogoPreview() { $('#logo-preview').innerHTML = state.logoImage ? `<img src="${state.logoImage.src}" alt="Logo 预览">` : 'Q'; }
function setTopStatus(kind, text) { const status = $('#top-status'); status.className = `recognition-status is-${kind}`; $('.status-copy', status).textContent = text; }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('is-visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2400); }
function setPage(page) { state.page = page; $$('.nav-item').forEach(el => el.classList.toggle('is-active', el.dataset.page === page)); $$('.panel-page').forEach(el => el.classList.toggle('is-active', el.dataset.panel === page)); if (page === 'export' && state.zxingValid === null) scheduleValidation(); }
function setZoom(value) { state.zoom = clamp(value, 50, 200); $('#zoom-slider').value = state.zoom; $('#zoom-value').textContent = `${state.zoom}%`; $('#artboard-wrap').style.transform = `scale(${state.zoom / 100})`; }
function updateAllSliders() { $$('.safety-slider').forEach(updateSlider); }
function updateLogoGapLock() {
  const root = $('.safety-slider[data-key="logoGap"]'); if (!root) return;
  root.classList.toggle('is-locked', state.logoGapLocked);
  $('.safety-range', root).disabled = state.logoGapLocked; $('.slider-value', root).disabled = state.logoGapLocked;
}
function loadScript(src) { return new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = reject; document.head.appendChild(script); }); }
function idle() { return new Promise(resolve => (window.requestIdleCallback ? requestIdleCallback(resolve, { timeout: 500 }) : setTimeout(resolve, 30))); }
function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }

for (let version = 1; version <= 40; version++) $('#qr-version').insertAdjacentHTML('beforeend', `<option value="${version}">Version ${version}</option>`);
$$('.safety-slider').forEach(createSafetySlider); $$('.nav-item').forEach(button => button.addEventListener('click', () => setPage(button.dataset.page))); $$('[data-nav-target]').forEach(button => button.addEventListener('click', () => setPage(button.dataset.navTarget)));
$$('.shape-options').forEach(group => group.addEventListener('click', event => { const button = event.target.closest('.shape-button'); if (!button) return; $$('.shape-button', group).forEach(el => el.classList.remove('is-selected')); button.classList.add('is-selected'); if (button.dataset.shape) { state.shape = button.dataset.shape; $('.safety-slider[data-key="rounding"]').style.display = state.shape === 'circle' ? 'none' : ''; updateVisuals(); scheduleValidation(); } if (button.dataset.finderPart) { state[button.dataset.finderPart] = button.dataset.finderShape; updateVisuals(); scheduleValidation(); } }));
$$('.segmented').forEach(group => group.addEventListener('click', event => { const button = event.target.closest('button'); if (!button) return; $$('button', group).forEach(el => el.classList.remove('is-selected')); button.classList.add('is-selected'); }));

$('#qr-content').addEventListener('input', debounce(event => { state.content = event.target.value; encodeQr(); }, 220)); $('#qr-version').addEventListener('change', event => { state.requestedVersion = Number(event.target.value); encodeQr(); });
$('#ecc-control').addEventListener('click', event => { const button = event.target.closest('[data-ecc]'); if (!button) return; state.ecc = button.dataset.ecc; encodeQr(); });
$('#sync-finders').addEventListener('change', event => {
  state.finderSync = event.target.checked; $('#finder-tabs').classList.toggle('is-hidden', state.finderSync);
  if (state.finderSync) { const source = state.finders[state.activeFinder]; Object.values(state.finders).forEach(config => Object.assign(config, source)); }
  updateVisuals(); scheduleValidation();
});
$('#finder-tabs').addEventListener('click', event => {
  const button = event.target.closest('[data-finder]'); if (!button) return;
  state.activeFinder = button.dataset.finder; $$('#finder-tabs button').forEach(el => el.classList.toggle('is-selected', el === button));
  const config = state.finders[state.activeFinder]; state.finderRounding = config.rounding; state.finderSize = config.size; state.finderCore = config.core; updateAllSliders();
});
$('#show-grid').addEventListener('change', event => $('#module-grid').classList.toggle('is-visible', event.target.checked)); $('#show-safe').addEventListener('change', event => $('#logo-safe-overlay').classList.toggle('is-visible', event.target.checked));

$('#color-mode').addEventListener('click', event => { const button = event.target.closest('[data-color-mode]'); if (!button) return; state.colorMode = button.dataset.colorMode; $$('[data-color-panel]').forEach(panel => panel.classList.toggle('is-active', panel.dataset.colorPanel === state.colorMode)); updateVisuals(); scheduleValidation(); });
$('#foreground-color').addEventListener('input', event => { state.foreground = event.target.value; $('#foreground-hex').value = event.target.value.toUpperCase(); updateVisuals(); scheduleValidation(); });
$('#foreground-hex').addEventListener('change', event => { if (/^#[0-9a-f]{6}$/i.test(event.target.value)) { state.foreground = event.target.value; $('#foreground-color').value = event.target.value; updateVisuals(); scheduleValidation(); } });
$('#gradient-type').addEventListener('change', event => { state.gradientType = event.target.value; updateVisuals(); scheduleValidation(); }); $('#gradient-start').addEventListener('input', event => { state.gradientStart = event.target.value; updateVisuals(); scheduleValidation(); }); $('#gradient-end').addEventListener('input', event => { state.gradientEnd = event.target.value; updateVisuals(); scheduleValidation(); });
$('#texture-file').addEventListener('change', event => loadImageFile(event.target.files[0], img => { state.textureImage = img; state.colorMode = 'image'; updateVisuals(); scheduleValidation(); showToast('图片纹理已应用'); }));

$('#background-mode').addEventListener('click', event => { const button = event.target.closest('[data-background]'); if (!button) return; state.backgroundMode = button.dataset.background; updateVisuals(); scheduleValidation(); });
$('#background-color').addEventListener('input', event => { state.background = event.target.value; $('#background-hex').value = event.target.value.toUpperCase(); updateVisuals(); scheduleValidation(); });
$('#background-hex').addEventListener('change', event => { if (/^#[0-9a-f]{6}$/i.test(event.target.value)) { state.background = event.target.value; $('#background-color').value = event.target.value; updateVisuals(); scheduleValidation(); } });
$('#logo-file').addEventListener('change', event => loadImageFile(event.target.files[0], img => { state.logoImage = img; state.logoVisible = true; $('#logo-file-name').textContent = event.target.files[0].name; updateLogoPreview(); updateVisuals(); scheduleValidation(); }));
$('#remove-logo-bg').addEventListener('click', removeLogoBackground); $('#remove-logo').addEventListener('click', () => { state.logoVisible = !state.logoVisible; $('#remove-logo').textContent = state.logoVisible ? '隐藏 Logo' : '显示 Logo'; encodeQr(); });
$('#one-module-gap').addEventListener('change', event => { state.logoGapLocked = event.target.checked; if (state.logoGapLocked) setValue('logoGap', 1, true); updateLogoGapLock(); scheduleValidation(); });

$('#zoom-slider').addEventListener('input', event => setZoom(Number(event.target.value))); $('#zoom-out').addEventListener('click', () => setZoom(state.zoom - 10)); $('#zoom-in').addEventListener('click', () => setZoom(state.zoom + 10)); $('#fit-canvas').addEventListener('click', () => setZoom(100));
$('#export-format').addEventListener('click', event => { const button = event.target.closest('[data-format]'); if (button) state.exportFormat = button.dataset.format; });
$('#size-presets').addEventListener('click', event => { const button = event.target.closest('[data-size]'); if (!button) return; const size = Number(button.dataset.size); state.exportSize = size; $('#export-width').value = size; $('#export-height').value = size; $$('#size-presets button').forEach(el => el.classList.toggle('is-selected', el === button)); });
$('#export-width').addEventListener('change', event => { const size = clamp(Number(event.target.value) || 1024, 256, 8192); event.target.value = size; $('#export-height').value = size; state.exportSize = size; }); $('#export-height').addEventListener('change', event => { const size = clamp(Number(event.target.value) || 1024, 256, 8192); event.target.value = size; $('#export-width').value = size; state.exportSize = size; });
$('#deep-check').addEventListener('click', runDeepValidation); $('#export-button').addEventListener('click', exportQr); $('#auto-fix').addEventListener('click', autoFix);

$('#reset-style').addEventListener('click', () => { Object.assign(state, { shape: 'square', rounding: 12, moduleSize: 88, spacing: 14 }); $$('[data-shape]').forEach(el => el.classList.toggle('is-selected', el.dataset.shape === 'square')); $('.safety-slider[data-key="rounding"]').style.display = ''; recomputeSafety(); updateAllSliders(); updateVisuals(); scheduleValidation(); showToast('普通模块样式已恢复默认'); });
$('.handle-se').addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); const artboard = $('#artboard').getBoundingClientRect(); const move = e => { const dx = Math.abs(e.clientX - (artboard.left + artboard.width / 2)), visualPercent = dx / artboard.width * 200, symbolPercent = visualPercent * (state.moduleCount + 8) / state.moduleCount, next = clamp(symbolPercent, 0, Number($('.safety-slider[data-key="logoSize"]').dataset.safeMax)); setValue('logoSize', Math.round(next), true); }; const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); scheduleValidation(); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); });

updateLogoGapLock();
encodeQr();
