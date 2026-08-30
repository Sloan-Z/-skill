/**
 * read-form.mjs — 读取当前页面所有可交互表单元素的结构化信息
 *
 * 用法: node scripts/read-form.mjs [url]
 *   如果提供 url，先导航到该页面再读取
 */

import { connectToBrowser, disconnectFromBrowser, findPage } from './lib/cdp.mjs';
import { readPageForm } from './lib/form-reader.mjs';
import { isFeishuResumePage, readFeishuForm } from './lib/feishu-form-reader.mjs';
import { loadSiteAdapter } from './lib/site-adapters.mjs';
import { readGenericForm } from './lib/generic-form-reader.mjs';
import { closeSemanticSection, openSemanticSection, readSemanticForm } from './lib/semantic-form-reader.mjs';

const args = process.argv.slice(2);
const targetUrl = args.find((arg) => !arg.startsWith('-'));
const includeValues = args.includes('--include-values');
const navigate = args.includes('--navigate');
const forceGeneric = args.includes('--generic');
const sectionOption = (() => {
  const index = args.indexOf('--section');
  return index >= 0 ? args[index + 1] : undefined;
})();

async function readForm() {
  let browser;
  try {
    const connection = await connectToBrowser();
    browser = connection.browser;
    let page;
    if (targetUrl) {
      try {
        page = findPage(connection.pages, { targetUrl });
      } catch (error) {
        if (!navigate) throw error;
        page = connection.pages[0];
        console.log(`📍 导航到: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);
      }
    } else {
      page = findPage(connection.pages);
    }

    const baseForm = await readPageForm(page, { includeValues });
    const feishu = isFeishuResumePage(baseForm);
    const adapter = feishu || forceGeneric ? null : await loadSiteAdapter(baseForm.url);
    const generic = !feishu && !adapter;
    let openedSection = false;
    let form;
    if (feishu) form = await readFeishuForm(page, { includeValues });
    else if (generic) form = await readGenericForm(page, { includeValues });
    else if (adapter.framework === 'beisen-phoenix') form = baseForm;
    else if (sectionOption && adapter.reader?.editorMode === 'section-editor') {
      form = await openSemanticSection(page, adapter, sectionOption);
      openedSection = true;
    } else form = await readSemanticForm(page, adapter, { includeValues });
    console.log(`📄 当前页面: ${form.title} | ${form.url}`);
    console.log(`\n🔍 找到 ${form.fields.length} 个可交互元素:\n`);
    console.log(JSON.stringify(form, null, 2));
    if (openedSection) await closeSemanticSection(page, adapter, sectionOption);
    return form;
  } catch (err) {
    console.error(`❌ 错误: ${err.message}`);
    if (err.message.includes('ECONNREFUSED')) {
      console.error('   请确保 Edge 已启动并开启了调试端口');
    }
    process.exit(1);
  } finally {
    if (browser) disconnectFromBrowser(browser);
  }
}

readForm();
