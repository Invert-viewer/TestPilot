import { chromium, firefox, webkit } from 'playwright';
import fs from 'node:fs';
import { httpUrl, substitute } from './http.mjs';
import { runtimeSettings } from './runtime.mjs';

export function browserPath() {
  if (runtimeSettings().browserPath) return fs.existsSync(runtimeSettings().browserPath) ? runtimeSettings().browserPath : undefined;
  return [process.env.TESTPILOT_BROWSER_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    chromium.executablePath()].find(p => p && fs.existsSync(p));
}
export function availableBrowsers() {
  return { chromium: Boolean(browserPath()), firefox: fs.existsSync(firefox.executablePath()), webkit: fs.existsSync(webkit.executablePath()) };
}
export async function openBrowser(signal, engine = 'chromium') {
  if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error('不支持的浏览器内核');
  const executablePath = engine === 'chromium' ? browserPath() : ({ firefox, webkit }[engine]).executablePath();
  if (!executablePath || !fs.existsSync(executablePath)) throw new Error(`未找到 ${engine} 浏览器，请安装对应浏览器，或运行 npx playwright install ${engine}`);
  const browser = await ({ chromium, firefox, webkit }[engine]).launch({ executablePath, headless: runtimeSettings().headless !== false });
  const cancel = () => { browser.close().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) { await browser.close(); throw new Error('执行已取消'); }
  return { browser, close: async () => { signal.removeEventListener('abort', cancel); await browser.close(); } };
}
async function screenshot(page) {
  try { return 'data:image/png;base64,' + (await page.screenshot({ timeout: 5000, fullPage: false })).toString('base64'); }
  catch { return undefined; }
}
export async function runUi(draft, variables, signal) {
  if (!draft || !Array.isArray(draft.steps) || !draft.steps.length || draft.steps.length > 100) throw new Error('请添加 1 至 100 个执行步骤');
  const width = Number(draft.width), height = Number(draft.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || width > 3840 || height < 240 || height > 2160) throw new Error('视口宽度范围为 320–3840，高度范围为 240–2160');
  const s = value => substitute(String(value ?? ''), variables);
  const startUrl = httpUrl(s(draft.url)).href;
  const session = await openBrowser(signal);
  const started = performance.now(), results = [];
  try {
    const context = await session.browser.newContext({ viewport: { width, height } });
    await context.route('**/*', route => {
      const protocol = new URL(route.request().url()).protocol;
      return ['http:', 'https:', 'data:', 'blob:', 'about:'].includes(protocol) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000); page.setDefaultNavigationTimeout(20000);
    await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
    let failed = false;
    for (let index = 0; index < draft.steps.length; index++) {
      const step = draft.steps[index];
      if (signal.aborted) throw new Error('执行已取消');
      if (failed && draft.stopOnFailure) { results.push({ index: index + 1, ...step, status: 'SKIPPED', durationMs: 0 }); continue; }
      const t = performance.now();
      let image;
      try {
        const value = s(step.value), selector = s(step.selector);
        const locator = () => {
          if (!selector.trim()) throw new Error('此操作需要选择器');
          return page.locator(selector);
        };
        switch (step.action) {
          case 'goto': await page.goto(httpUrl(new URL(value || startUrl, page.url()).href).href, { waitUntil: 'domcontentloaded' }); break;
          case 'fill': await locator().fill(value); break;
          case 'click': await locator().click(); break;
          case 'press': if (selector) await locator().press(value || 'Enter'); else await page.keyboard.press(value || 'Enter'); break;
          case 'wait': { const n = Number(value); if (!Number.isFinite(n) || n < 0 || n > 30000) throw new Error('等待时间须为 0–30000 ms'); await page.waitForTimeout(n); break; }
          case 'waitFor': await locator().waitFor({ state: 'visible' }); break;
          case 'assertText': await locator().filter({ hasText: value }).first().waitFor({ state: 'visible' }); break;
          case 'assertVisible': await locator().first().waitFor({ state: 'visible' }); break;
          case 'assertHidden': await locator().first().waitFor({ state: 'hidden' }); break;
          case 'assertUrl': await page.waitForURL(url => url.href.includes(value), { timeout: 7000 }); break;
          case 'assertTitle': if (!(await page.title()).includes(value)) throw new Error(`标题未包含“${value}”，实际为“${await page.title()}”`); break;
          case 'assertCount': { const actual = await locator().count(); if (actual !== Number(value)) throw new Error(`期望 ${value} 个元素，实际 ${actual} 个`); break; }
          case 'select': await locator().selectOption(value); break;
          case 'hover': await locator().hover(); break;
          case 'screenshot': image = await screenshot(page); if (!image) throw new Error('截图失败'); break;
          case 'check': await locator().check(); break;
          case 'uncheck': await locator().uncheck(); break;
          case 'scroll': { const n = Number(value || 600); if (!Number.isFinite(n)) throw new Error('滚动距离须为数字'); await page.evaluate(y => window.scrollBy(0, y), n); break; }
          default: throw new Error('不支持的步骤操作：' + step.action);
        }
        results.push({ index: index + 1, ...step, status: 'PASSED', durationMs: Math.round(performance.now() - t), screenshot: image });
      } catch (error) {
        if (signal.aborted) throw new Error('执行已取消');
        failed = true;
        results.push({ index: index + 1, ...step, status: 'FAILED', durationMs: Math.round(performance.now() - t), error: error.message, screenshot: await screenshot(page) });
      }
    }
    return { passed: !failed, durationMs: Math.round(performance.now() - started), steps: results,
      url: page.url(), title: await page.title(), screenshot: await screenshot(page) };
  } finally { await session.close(); }
}
export async function inspectPage(url, variables, signal) {
  const target = httpUrl(substitute(url, variables)).href;
  const session = await openBrowser(signal);
  try {
    const page = await session.browser.newPage();
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const elements = await page.locator('input,textarea,button,select,a[href],[role="button"]').evaluateAll(nodes => nodes.slice(0, 80).map(element => {
      const esc = v => CSS.escape(v);
      const selector = element.id ? '#' + esc(element.id) : element.getAttribute('data-testid') ? `[data-testid="${esc(element.getAttribute('data-testid'))}"]` : element.getAttribute('name') ? `${element.tagName.toLowerCase()}[name="${esc(element.getAttribute('name'))}"]` : element.tagName.toLowerCase();
      return { tag: element.tagName.toLowerCase(), type: element.getAttribute('type') || '', selector,
        text: (element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.textContent || '').trim().slice(0, 100),
        unique: document.querySelectorAll(selector).length === 1 };
    }));
    return { title: await page.title(), url: page.url(), elements, screenshot: await screenshot(page) };
  } finally { await session.close(); }
}
