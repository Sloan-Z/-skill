import { chromium } from 'playwright-core';

export const DEFAULT_CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';

/**
 * Connect to an existing Chromium-family browser without closing it on exit.
 */
export async function connectToBrowser(cdpUrl = DEFAULT_CDP_URL) {
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 5000 });
  const pages = browser.contexts().flatMap((context) => context.pages());
  return { browser, pages, cdpUrl };
}

/**
 * Select a page by exact URL first, then by URL pathname. A target URL is
 * never opened implicitly; callers must opt into navigation explicitly.
 */
export function findPage(pages, { targetUrl, pageIndex } = {}) {
  if (!pages.length) {
    throw new Error('没有找到打开的浏览器页面');
  }

  if (Number.isInteger(pageIndex)) {
    const page = pages[pageIndex];
    if (!page) throw new Error(`页面索引不存在: ${pageIndex}`);
    return page;
  }

  if (targetUrl) {
    const exact = pages.find((page) => page.url() === targetUrl);
    if (exact) return exact;

    let target;
    try {
      target = new URL(targetUrl);
    } catch {
      throw new Error(`无效的目标 URL: ${targetUrl}`);
    }

    const samePath = pages.find((page) => {
      try {
        const current = new URL(page.url());
        return current.origin === target.origin && current.pathname === target.pathname;
      } catch {
        return false;
      }
    });
    if (samePath) return samePath;

    const available = pages.map((page, index) => `${index}: ${page.url()}`).join('\n');
    throw new Error(`没有找到目标页面: ${targetUrl}\n当前页面:\n${available}`);
  }

  return pages[0];
}

/**
 * Disconnect the Playwright client while leaving the user's browser running.
 */
export function disconnectFromBrowser(browser) {
  if (browser && typeof browser.disconnect === 'function') browser.disconnect();
}
