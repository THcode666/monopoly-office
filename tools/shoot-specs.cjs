// Phase 1 视觉规范验收：截一张 component-preview.html 的全屏截图给 TH 验收
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const htmlPath = path.resolve(__dirname, 'component-preview.html');
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));

  // 等待字体加载
  await page.waitForTimeout(800);

  const outPath = path.resolve(__dirname, '../docs/shots/05b-visual-specs-v2.png');
  await page.screenshot({ path: outPath, fullPage: true });
  console.log('OK:', outPath);

  // 也截一张"专注模式开启"的状态做对比
  await page.click('.focus-toggle');
  await page.waitForTimeout(500);
  const outFocus = path.resolve(__dirname, '../docs/shots/05b-visual-specs-v2-focus.png');
  await page.screenshot({ path: outFocus, fullPage: true });
  console.log('OK:', outFocus);

  await browser.close();
})();
