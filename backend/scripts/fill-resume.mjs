/**
 * Safe two-phase resume filling for supported vivo/Beisen and Feishu pages.
 *
 * Default: preview only.
 * Apply: node scripts/fill-resume.mjs --url <url> --apply
 * The command never submits, uploads files, enters passwords, or bypasses
 * CAPTCHA/MFA. It only fills approved text/radio/select fields.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { connectToBrowser, disconnectFromBrowser, findPage } from './lib/cdp.mjs';
import { readPageForm } from './lib/form-reader.mjs';
import { INTERNAL_VALUE, mapVivoForm, summarizeMappings } from './lib/resume-mapper.mjs';
import { validateResumeJson } from '../../scripts/validate-resume-json.mjs';
import { buildMissingFieldReport } from '../../scripts/resume-feedback.mjs';
import { isFeishuResumePage, expandFeishuSections, readFeishuForm } from './lib/feishu-form-reader.mjs';
import {
  mapFeishuForm,
  planFeishuMappings,
  requiredFeishuRecordCounts,
  summarizeFeishuMappings,
} from './lib/feishu-resume-mapper.mjs';
import { loadSiteAdapter } from './lib/site-adapters.mjs';
import {
  closeSemanticSection,
  expandSemanticSections,
  openSemanticSection,
  readSemanticForm,
  requiredSemanticRecordCounts,
} from './lib/semantic-form-reader.mjs';
import {
  planSemanticMappings,
  mapSemanticForm,
  summarizeSemanticMappings,
} from './lib/semantic-resume-mapper.mjs';

const DEFAULT_RESUME_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'resume.json');

function getOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function createPrompt() {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask(question) {
      return new Promise((resolve) => input.question(question, (answer) => resolve(answer.trim())));
    },
    close() {
      input.close();
    },
  };
}

async function locateMapping(page, mapping) {
  if (mapping.locator?.strategy === 'feishu-field') {
    const module = page.locator('.applyFormModuleWrapper-windows').nth(mapping.locator.sectionIndex);
    const isArray = ['education', 'work', 'project', 'portfolio', 'awards', 'language'].includes(mapping.locator.sectionKind);
    const scope = isArray
      ? module.locator([
        '[class*="apply-form-array-card__"]',
        ':not([class*="apply-form-array-card-content__"])',
        ':not([class*="apply-form-array-card-operate__"])',
        ':not([class*="apply-form-array-card-delete__"])',
      ].join('')).nth(mapping.locator.recordIndex)
      : module;
    const field = scope
      .locator(`.ud-formily-item[data-form-field-name="${mapping.locator.fieldName}"]`)
      .first();
    return field.locator('input:not([type="hidden"]), textarea, select, [role="combobox"], [contenteditable="true"]')
      .nth(mapping.locator.controlIndex);
  }
  if (mapping.locator?.strategy === 'semantic-field') {
    let scope = page.locator(mapping.locator.section.selector).nth(mapping.locator.section.index);
    if (mapping.locator.scopeSelector) scope = scope.locator(mapping.locator.scopeSelector).first();
    if (mapping.locator.record) {
      scope = scope.locator(mapping.locator.record.selector).nth(mapping.locator.record.index);
    }
    const field = scope.locator(mapping.locator.field.selector).nth(mapping.locator.field.index);
    return field.locator(mapping.locator.control.selector).nth(mapping.locator.control.index);
  }
  if (!mapping.locator || mapping.locator.strategy !== 'form-item') {
    throw new Error(`${mapping.label || mapping.fieldId} 没有可用的语义定位信息`);
  }

  const item = page.locator('.form-item').nth(mapping.locator.formItemIndex);
  if (mapping.locator.controlKind === 'custom-radio') {
    return item.locator('.phoenix-radio-group__radioItem, [role="radio"]').nth(mapping.locator.controlIndex);
  }

  return item
    .locator('input:not([type="hidden"]):not([type="file"]), textarea, select, [role="combobox"], [contenteditable="true"]')
    .nth(mapping.locator.controlIndex);
}

async function visibleExactText(page, value) {
  const candidates = await page.getByText(String(value), { exact: true }).all();
  const visible = [];
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) visible.push(candidate);
  }
  return visible;
}

async function fillMapping(page, mapping) {
  const value = mapping[INTERNAL_VALUE];
  if (mapping.status !== 'ready' && mapping.status !== 'needs-confirmation') return { skipped: true };
  if (mapping.method === 'date' || mapping.method === 'date-range') {
    return { skipped: true, reason: '日期控件暂不自动操作，请手动填写' };
  }
  if (mapping.method === 'file' || mapping.method === 'manual') {
    return { skipped: true, reason: '该字段必须手动处理' };
  }

  const control = await locateMapping(page, mapping);
  if (!(await control.isVisible().catch(() => false))) throw new Error('控件不可见');

  if (mapping.method === 'radio') {
    await control.click();
    return { filled: true };
  }

  if (mapping.method === 'checkbox') {
    await control.check();
    return { filled: true };
  }

  if (mapping.method === 'select') {
    await control.click();
    await page.waitForTimeout(300);
    const options = await visibleExactText(page, value);
    if (options.length !== 1) {
      throw new Error(`下拉选项“${value}”匹配到 ${options.length} 个可见结果`);
    }
    await options[0].click();
    const selected = await control.evaluate((element) => ({
      value: element.value || element.getAttribute('aria-valuetext') || '',
      fieldText: element.closest('[data-form-field-name]')?.textContent || '',
    }));
    if (String(selected.value).trim() !== String(value).trim()
      && !String(selected.fieldText).replace(/\s+/g, '').includes(String(value).replace(/\s+/g, ''))) {
      throw new Error('下拉选择后控件值未确认');
    }
    return { filled: true };
  }

  await control.fill(String(value));
  await control.press('Tab').catch(() => {});
  const entered = await control.evaluate((element) => element.value || element.textContent || '');
  if (String(entered) !== String(value)) throw new Error('填写后控件值未确认');
  return { filled: true };
}

async function main() {
  const args = process.argv.slice(2);
  const targetUrl = getOption(args, '--url') || args.find((arg) => !arg.startsWith('-'));
  const resumePath = getOption(args, '--resume') || process.env.RESUME_PATH || DEFAULT_RESUME_PATH;
  const apply = args.includes('--apply');
  const showValues = args.includes('--show-values');
  const sectionOption = getOption(args, '--section');

  if (apply && !process.stdin.isTTY) {
    throw new Error('--apply 需要在交互式终端中运行，以便确认填写范围');
  }

  const resume = JSON.parse(await fs.readFile(resumePath, 'utf8'));
  const resumeValidation = validateResumeJson(resume, { requireConfirmed: apply });
  if (!resumeValidation.valid) {
    throw new Error(`resume JSON 校验失败: ${resumeValidation.errors.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`);
  }
  const { browser, pages } = await connectToBrowser();
  const prompt = apply ? createPrompt() : null;
  try {
    const page = findPage(pages, { targetUrl });
    const initialForm = await readPageForm(page);
    const feishu = isFeishuResumePage(initialForm);
    const adapter = feishu ? null : await loadSiteAdapter(initialForm.url);
    if (!feishu && !adapter) throw new Error(`当前页面没有已安装的招聘表单适配器: ${initialForm.url}`);
    const phoenix = adapter?.framework === 'beisen-phoenix';
    const sectionEditor = adapter?.reader?.editorMode === 'section-editor';
    if (sectionEditor && !sectionOption) {
      throw new Error('该站点一次编辑一个分区，请指定 --section basic|education|work|project 等');
    }
    let openedSection = false;
    let form;
    if (feishu) form = await readFeishuForm(page);
    else if (phoenix) form = initialForm;
    else if (sectionEditor) {
      form = await openSemanticSection(page, adapter, sectionOption);
      openedSection = true;
    } else form = await readSemanticForm(page, adapter);

    // Apply mode needs a local, action-time review of the exact values that
    // would be transmitted. Ordinary previews remain value-free by default.
    let mappings = feishu
      ? planFeishuMappings(form, resume, { showValues: showValues || apply })
      : phoenix
        ? mapVivoForm(form, resume, { showValues: showValues || apply })
        : planSemanticMappings(form, resume, { showValues: showValues || apply });
    const actionable = mappings.filter((item) => ['ready', 'needs-confirmation'].includes(item.status));
    console.log(`页面: ${form.title}`);
    console.log(`简历数据: status=${resumeValidation.summary.status} warnings=${resumeValidation.warnings.length}`);
    if (resume.status === 'draft') console.log('注意：当前为未确认草稿，只允许预览；--apply 会被拒绝。');
    const summary = feishu
      ? summarizeFeishuMappings(mappings)
      : phoenix ? summarizeMappings(mappings) : summarizeSemanticMappings(mappings);
    console.log(`控件: ${form.fields.length} | 映射: ${JSON.stringify(summary)}`);
    if (feishu || !phoenix) {
      const required = feishu ? requiredFeishuRecordCounts(resume) : requiredSemanticRecordCounts(resume);
      for (const section of form.sections || []) {
        const target = required[section.sectionKind] || 0;
        if (section.dynamicSection && target > section.recordCount) {
          console.log(`待展开: ${section.title}，当前 ${section.recordCount} 条，需 ${target} 条`);
        }
      }
    }
    console.log(`可填写字段: ${actionable.length}；默认不会覆盖页面已有内容。`);

    for (const item of actionable) {
      const value = (showValues || apply) && item.valuePreview !== undefined ? ` = ${item.valuePreview}` : '';
      const location = feishu
        ? `${item.sectionTitle}[${item.recordIndex + 1}] / ${item.label || item.fieldName}`
        : phoenix
          ? `${item.sectionKind} | ${item.label || '(无标签)'}`
          : `${item.sectionTitle || item.sectionKind}[${item.recordIndex + 1}] | ${item.label || '(无标签)'}`;
      console.log(`- ${item.status} | ${location}${value}`);
    }

    if (!apply) {
      const missing = buildMissingFieldReport(resume, mappings);
      console.log(`待补充字段: ${missing.summary.total}（可回写 JSON ${missing.summary.canonical}，仅本次申请 ${missing.summary.applicationOnly}，敏感手工 ${missing.summary.sensitiveManual}）`);
      console.log('\n这是只读预览。确认映射后，再使用 --apply 执行填写。');
      if (openedSection) await closeSemanticSection(page, adapter, sectionOption);
      return;
    }

    console.log(`\n即将把上面列出的资料输入到：${form.url}`);
    console.log('这会向招聘网站传输个人/职业信息；不会提交申请、保存表单或上传文件。');
    const allApproved = await prompt.ask('确认目标网站和具体字段后，输入 APPLY 继续：');
    if (allApproved !== 'APPLY') {
      console.log('已取消，没有修改页面。');
      if (openedSection) await closeSemanticSection(page, adapter, sectionOption);
      return;
    }

    if (feishu) {
      const required = requiredFeishuRecordCounts(resume);
      form = await expandFeishuSections(page, form, required);
      mappings = mapFeishuForm(form, resume, { showValues: true });
    } else if (!phoenix) {
      const required = requiredSemanticRecordCounts(resume);
      form = await expandSemanticSections(page, form, adapter, required);
      mappings = mapSemanticForm(form, resume, { showValues: true });
    }

    let filled = 0;
    const approvedMappings = feishu || !phoenix
      ? mappings.filter((item) => ['ready', 'needs-confirmation'].includes(item.status))
      : actionable;
    for (const item of approvedMappings) {
      if (item.status === 'needs-confirmation') {
        const answer = await prompt.ask(`确认填写“${item.label || item.fieldId}”吗？输入 y 继续，其他跳过：`);
        if (answer.toLowerCase() !== 'y') {
          console.log(`⏭️ 已跳过 ${item.label || item.fieldId}`);
          continue;
        }
      }
      try {
        const result = await fillMapping(page, item);
        if (result.filled) {
          filled += 1;
          console.log(`✅ 已填写 ${item.label || item.fieldId}`);
        } else {
          console.log(`⏭️ ${item.label || item.fieldId}: ${result.reason || '未执行'}`);
        }
      } catch (error) {
        console.log(`⚠️ ${item.label || item.fieldId}: ${error.message}`);
      }
    }
    console.log(`完成：填写 ${filled} 个字段。请在浏览器中检查结果并手动保存。`);
    const missing = buildMissingFieldReport(resume, mappings);
    if (missing.questions.length) {
      console.log(`下一步需主动向用户收集 ${missing.summary.total} 个缺失字段；回答应先写入新的 draft JSON，再校验和确认。`);
      for (const question of missing.questions) {
        console.log(`- ${question.persistence} | ${question.path || question.label} | ${question.prompt}`);
      }
    }
    if (adapter?.handoff?.savePolicy === 'user-only') {
      console.log(`站点分区仍保持打开：${adapter.handoff.reason}`);
    }
  } finally {
    prompt?.close();
    disconnectFromBrowser(browser);
  }
}

main().catch((error) => {
  console.error(`❌ 填写流程失败: ${error.message}`);
  process.exitCode = 1;
});
