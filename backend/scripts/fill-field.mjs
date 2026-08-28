/**
 * fill-field.mjs — 填写指定的表单字段
 *
 * 用法: node scripts/fill-field.mjs <selector> <value> [method]
 *   selector: CSS 选择器（如 #name, input[name="email"]）
 *   value:    要填写的值
 *   method:   填写方式，可选值:
 *             - input (默认) 逐字输入，触发 input/change 事件
 *             - fill          直接设值（更快，但某些框架可能不触发事件）
 *             - select        下拉选择（value 为选项文本）
 *             - click         点击元素（用于触发下拉等交互）
 *             - type          模拟键盘输入（最像真人，但慢）
 *
 * 示例:
 *   node scripts/fill-field.mjs "#name" "示例姓名"
 *   node scripts/fill-field.mjs "select[name='province']" "北京" select
 *   node scripts/fill-field.mjs ".upload-btn" "" click
 */

import { chromium } from 'playwright-core';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';

const [,, selector, ...valueParts] = process.argv;
const value = valueParts.filter(v => v !== 'input' && v !== 'fill' && v !== 'select' && v !== 'click' && v !== 'type').join(' ');
const method = valueParts.includes('select') ? 'select'
  : valueParts.includes('click') ? 'click'
  : valueParts.includes('type') ? 'type'
  : valueParts.includes('fill') ? 'fill'
  : 'input';

if (!selector) {
  console.error('用法: node fill-field.mjs <selector> <value> [method]');
  console.error('示例: node fill-field.mjs "#name" "示例姓名"');
  process.exit(1);
}

async function fillField() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 5000 });
    const page = browser.contexts()[0]?.pages()[0];

    if (!page) {
      console.error('❌ 没有找到打开的页面');
      process.exit(1);
    }

    // 等待元素出现（最多 10 秒）
    const element = await page.waitForSelector(selector, { timeout: 10000 });

    if (!element) {
      console.error(`❌ 找不到元素: ${selector}`);
      process.exit(1);
    }

    const tagName = await element.evaluate(el => el.tagName.toLowerCase());
    const isVisible = await element.isVisible();

    if (!isVisible) {
      console.error(`❌ 元素不可见: ${selector}`);
      process.exit(1);
    }

    console.log(`📝 正在填写 [${selector}] → "${value}" (方法: ${method})`);

    switch (method) {
      case 'fill':
        await element.fill(value);
        break;

      case 'select':
        // 尝试通过文本选择下拉选项
        if (tagName === 'select') {
          await element.selectOption({ label: value });
        } else {
          // 非原生 select，先点击展开，再点击选项
          await element.click();
          await page.waitForTimeout(500);
          // 查找匹配的选项
          const option = await page.getByText(value, { exact: true }).first();
          if (option) {
            await option.click();
          } else {
            console.error(`❌ 找不到选项: "${value}"`);
            process.exit(1);
          }
        }
        break;

      case 'click':
        await element.click();
        break;

      case 'type':
        await element.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await element.type(value, { delay: 50 });
        break;

      case 'input':
      default:
        // 先清空，再逐字输入，同时触发 input 和 change 事件
        await element.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await element.evaluate((el, val) => {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          // React 需要的合成事件
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          )?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, value);
        break;
    }

    if (tagName === 'input' && await element.getAttribute('type') === 'file') {
      throw new Error('文件上传必须由用户手动操作');
    }

    // 读取填写后的值
    const newValue = await element.evaluate(el => el.value || el.textContent || '');
    console.log(`✅ 填写完成。当前值: "${newValue.trim()}"`);

    return { success: true, selector, value, method, currentValue: newValue.trim() };
  } catch (err) {
    console.error(`❌ 填写失败: ${err.message}`);
    process.exit(1);
  } finally {
    if (browser && typeof browser.disconnect === 'function') browser.disconnect();
  }
}

fillField();
