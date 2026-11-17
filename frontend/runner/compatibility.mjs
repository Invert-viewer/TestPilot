import fs from 'node:fs/promises';
import path from 'node:path';
import { devices } from 'playwright';
import { openBrowser } from './browser.mjs';
import { httpUrl, substitute } from './http.mjs';
import { numberIn } from './runtime.mjs';

export const viewportProfiles = {
  desktop: { label: '桌面', width: 1440, height: 900 },
  laptop: { label: '笔记本', width: 1280, height: 800 },
  tablet: { label: '平板', width: 768, height: 1024, touch: true },
  phone: { label: '手机 · 390', width: 390, height: 844, touch: true, mobile: true },
  compact: { label: '手机 · 360', width: 360, height: 800, touch: true, mobile: true },
};
export async function runCompatibility(payload, variables, ctx) {
  const url = httpUrl(substitute(payload.url, variables)).href;
  const selected = [...new Set(payload.devices || [])], engines = [...new Set(payload.engines || ['chromium'])];
  if (!selected.length || selected.some(d => !viewportProfiles[d])) throw new Error('请选择有效的设备视口');
  if (!engines.length || engines.some(e => !['chromium', 'firefox', 'webkit'].includes(e))) throw new Error('请选择有效的浏览器内核');
  const settleMs = numberIn(payload.settleMs ?? 500, 0, 3000, '页面稳定等待', true), results = [];
  const started = performance.now(), count = selected.length * engines.length;
  for (const engine of engines) {
    const session = await openBrowser(ctx.signal, engine);
    try { for (const device of selected) {
      if (ctx.signal.aborted) throw new Error('执行已取消');
      const profile = viewportProfiles[device], t = performance.now(), issues = [], networkErrors = [], consoleErrors = [];
      ctx.update({ phase: `${engine} · ${profile.label} ${profile.width}×${profile.height}`, progress: Math.round(results.length / count * 100) });
      const context = await session.browser.newContext({ viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: 1, hasTouch: Boolean(profile.touch), ...(engine === 'chromium' ? { isMobile: Boolean(profile.mobile) } : {}),
        ...(profile.mobile ? { userAgent: devices['Pixel 7']?.userAgent } : {}) });
      const page = await context.newPage();
      let status = 0, title = '', screenshot, dimensions, userAgent = '', overflowElements = [];
      page.on('pageerror', error => { if (consoleErrors.length < 20) consoleErrors.push(error.message.slice(0, 800)); });
      page.on('console', msg => { if (msg.type() === 'error' && consoleErrors.length < 20) consoleErrors.push(msg.text().slice(0, 800)); });
      page.on('requestfailed', request => { if (networkErrors.length < 30 && !/favicon/i.test(request.url())) networkErrors.push({ url: request.url(), error: request.failure()?.errorText || '请求失败' }); });
      page.on('response', response => { if (response.status() >= 400 && networkErrors.length < 30 && !/favicon/i.test(response.url())) networkErrors.push({ url: response.url(), error: 'HTTP ' + response.status() }); });
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); status = response?.status() || 0;
        await page.waitForTimeout(settleMs); title = await page.title();
        const layout = await page.evaluate(() => {
          const width = document.documentElement.clientWidth;
          const overflow = document.documentElement.scrollWidth > width + 2;
          const elements = overflow ? [...document.querySelectorAll('body *')].filter(el => {
            const r = el.getBoundingClientRect(), s = getComputedStyle(el);
            return r.width > 0 && r.right > width + 2 && s.position !== 'fixed' && s.visibility !== 'hidden' && !el.closest('[inert],[aria-hidden="true"]');
          }).slice(0, 10).map(el => ({ selector: el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''), right: Math.round(el.getBoundingClientRect().right), width: Math.round(el.getBoundingClientRect().width) })) : [];
          return { width, scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
            viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '', overflow, elements, userAgent: navigator.userAgent };
        });
        dimensions = { viewport: profile.width, clientWidth: layout.width, scrollWidth: layout.scrollWidth, pageHeight: layout.height };
        overflowElements = layout.elements; userAgent = layout.userAgent;
        if (status < 200 || status >= 400) issues.push({ type: 'http', severity: 'error', message: '页面返回 HTTP ' + status });
        if (layout.overflow || (profile.mobile && layout.width > profile.width + 2)) issues.push({ type: 'overflow', severity: 'error', message: `视口 ${profile.width}px，布局 ${layout.width}px，内容 ${layout.scrollWidth}px，存在横向溢出或移动端缩放` });
        if (profile.mobile && !/width\s*=\s*device-width/.test(layout.viewportMeta)) issues.push({ type: 'viewport', severity: 'warning', message: '未找到 width=device-width 的 viewport 声明' });
        if (consoleErrors.length) issues.push({ type: 'console', severity: 'error', message: `${consoleErrors.length} 条控制台 / 脚本错误` });
        if (networkErrors.length) issues.push({ type: 'resource', severity: 'error', message: `${networkErrors.length} 个资源请求失败` });
        if (payload.requiredSelector?.trim()) {
          const selector = substitute(payload.requiredSelector, variables);
          try { await page.locator(selector).first().waitFor({ state: 'visible', timeout: 5000 }); }
          catch { issues.push({ type: 'element', severity: 'error', message: `关键元素不可见：${selector}` }); }
        }
        const filename = `${engine}-${device}.png`;
        await page.screenshot({ path: path.join(ctx.directory, filename), fullPage: layout.height <= 9000, timeout: 10000 });
        screenshot = ctx.artifact(filename, `${engine} ${profile.label} 截图`);
        if (layout.height > 9000) issues.push({ type: 'capture', severity: 'warning', message: '页面超过 9000px，仅保存当前视口截图' });
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        issues.push({ type: 'navigation', severity: 'error', message: error.message.slice(0, 1000) });
      } finally { await context.close(); }
      results.push({ id: `${engine}-${device}`, engine, device, label: profile.label, width: profile.width, height: profile.height,
        status, title, url, userAgent, dimensions, overflowElements, issues, networkErrors, consoleErrors, screenshot,
        passed: !issues.some(i => i.severity === 'error'), durationMs: Math.round(performance.now() - t) });
      ctx.update({ result: { engine: 'Playwright', url, results: [...results], total: count }, progress: Math.round(results.length / count * 100) });
    } } finally { await session.close(); }
  }
  return { engine: 'Playwright', url, results, total: results.length, passed: results.filter(r => r.passed).length,
    issueCount: results.reduce((n, r) => n + r.issues.length, 0), durationMs: Math.round(performance.now() - started) };
}
