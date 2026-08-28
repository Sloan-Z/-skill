/**
 * connect.mjs — 通过 CDP 连接已启动的 Edge 浏览器
 *
 * 用法: node scripts/connect.mjs
 *
 * 前提: 用户已通过以下命令启动 Edge:
 *   msedge --remote-debugging-port=9222 --user-data-dir=".edge-profile"
 */

import { chromium } from 'playwright-core';
import { connectToBrowser, disconnectFromBrowser } from './lib/cdp.mjs';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';

async function connect() {
  try {
    const { browser, pages } = await connectToBrowser(CDP_URL);
    const contexts = browser.contexts();

    console.log(`✅ Connected to Edge at ${CDP_URL}`);
    console.log(`   Browser contexts: ${contexts.length}`);
    console.log(`   Open pages: ${pages.length}`);

    if (pages.length > 0) {
      console.log('   Pages:');
      for (const page of pages) {
        const title = await page.title().catch(() => '(untitled)');
        console.log(`     - ${title} | ${page.url()}`);
      }
    }

    // 只断开客户端，不关闭用户的 Edge。
    disconnectFromBrowser(browser);

    return { success: true, contexts: contexts.length, pages: pages.length };
  } catch (err) {
    if (err.message.includes('ECONNREFUSED') || err.message.includes('connect')) {
      console.error(`❌ 无法连接到 Edge (${CDP_URL})`);
      console.error('   请确保 Edge 已通过以下命令启动:');
      console.error('   msedge --remote-debugging-port=9222 --user-data-dir=".edge-profile"');
    } else {
      console.error(`❌ 连接错误: ${err.message}`);
    }
    return { success: false, error: err.message };
  }
}

connect();
