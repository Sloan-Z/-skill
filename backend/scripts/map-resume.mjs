/**
 * Generate a safe, non-mutating mapping preview for the current page.
 * Usage:
 *   node scripts/map-resume.mjs --url "https://hr-campus.vivo.com/form?fromPage=editMyResume"
 *   node scripts/map-resume.mjs --url <url> --show-values
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectToBrowser, disconnectFromBrowser, findPage } from './lib/cdp.mjs';
import { readPageForm } from './lib/form-reader.mjs';
import { mapVivoForm, summarizeMappings } from './lib/resume-mapper.mjs';
import { validateResumeJson } from '../../scripts/validate-resume-json.mjs';
import { buildMissingFieldReport } from '../../scripts/resume-feedback.mjs';
import { readFeishuForm, isFeishuResumePage } from './lib/feishu-form-reader.mjs';
import {
  planFeishuMappings,
  requiredFeishuRecordCounts,
  summarizeFeishuMappings,
} from './lib/feishu-resume-mapper.mjs';
import { loadSiteAdapter } from './lib/site-adapters.mjs';
import {
  closeSemanticSection,
  openSemanticSection,
  readSemanticForm,
  requiredSemanticRecordCounts,
} from './lib/semantic-form-reader.mjs';
import {
  planSemanticMappings,
  summarizeSemanticMappings,
} from './lib/semantic-resume-mapper.mjs';

const DEFAULT_RESUME_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'resume.json');

function getOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const targetUrl = getOption(args, '--url') || args.find((arg) => !arg.startsWith('-'));
const resumePath = getOption(args, '--resume') || process.env.RESUME_PATH || DEFAULT_RESUME_PATH;
const showValues = args.includes('--show-values');
const jsonOnly = args.includes('--json');
const sectionOption = getOption(args, '--section');

async function main() {
  const resume = JSON.parse(await fs.readFile(resumePath, 'utf8'));
  const resumeValidation = validateResumeJson(resume);
  if (!resumeValidation.valid) {
    throw new Error(`resume JSON 校验失败: ${resumeValidation.errors.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`);
  }
  const { browser, pages, cdpUrl } = await connectToBrowser();
  try {
    const page = findPage(pages, { targetUrl });
    const initialForm = await readPageForm(page);
    const feishu = isFeishuResumePage(initialForm);
    const adapter = feishu ? null : await loadSiteAdapter(initialForm.url);
    if (!feishu && !adapter) throw new Error(`当前页面没有已安装的招聘表单适配器: ${initialForm.url}`);
    const phoenix = adapter?.framework === 'beisen-phoenix';
    let openedSection = false;
    let form;
    if (feishu) form = await readFeishuForm(page, { includeValues: showValues });
    else if (phoenix) form = await readPageForm(page, { includeValues: showValues });
    else if (sectionOption && adapter.reader?.editorMode === 'section-editor') {
      form = await openSemanticSection(page, adapter, sectionOption);
      openedSection = true;
    } else form = await readSemanticForm(page, adapter, { includeValues: showValues });
    const mappings = feishu
      ? planFeishuMappings(form, resume, { showValues })
      : phoenix
        ? mapVivoForm(form, resume, { showValues })
        : planSemanticMappings(form, resume, { showValues });
    const output = {
      generatedAt: new Date().toISOString(),
      cdpUrl,
      page: { url: form.url, title: form.title, pageType: form.pageType },
      resumeValidation: resumeValidation.summary,
      summary: feishu
        ? summarizeFeishuMappings(mappings)
        : phoenix ? summarizeMappings(mappings) : summarizeSemanticMappings(mappings),
      mappings,
      missingFieldReport: buildMissingFieldReport(resume, mappings),
    };
    if (feishu) {
      output.expansion = {
        required: requiredFeishuRecordCounts(resume),
        current: Object.fromEntries((form.sections || [])
          .filter((section) => section.dynamicSection)
          .map((section) => [section.sectionKind, section.recordCount])),
      };
    } else if (!phoenix) {
      output.sections = form.sections;
      output.expansion = {
        required: requiredSemanticRecordCounts(resume),
        current: Object.fromEntries((form.sections || []).map((section) => [section.sectionKind, section.recordCount])),
      };
    }

    if (jsonOnly) {
      console.log(JSON.stringify(output, null, 2));
      if (openedSection) await closeSemanticSection(page, adapter, sectionOption);
      return;
    }

    console.log(`页面: ${form.title} | ${form.url}`);
    console.log(`简历数据: status=${resumeValidation.summary.status} warnings=${resumeValidation.warnings.length}`);
    if (resume.status === 'draft') console.log('注意：当前为未确认草稿，只允许只读映射预览。');
    console.log(`找到 ${form.fields.length} 个控件，映射摘要: ${JSON.stringify(output.summary)}`);
    if (feishu || !phoenix) {
      for (const [section, required] of Object.entries(output.expansion.required)) {
        const current = output.expansion.current[section] || 0;
        if (required > current) console.log(`需展开 ${section}: 当前 ${current} 条，简历有 ${required} 条`);
      }
    }
    for (const item of mappings) {
      const location = feishu
        ? `${item.sectionKind}[${item.recordIndex}]/${item.fieldName}[${item.controlIndex}]`
        : phoenix
          ? item.formItemIndex == null ? item.fieldId : `form-item[${item.formItemIndex}]`
          : `${item.sectionKind}[${item.recordIndex}]/${item.label || item.fieldId}`;
      const value = showValues && item.valuePreview !== undefined ? ` = ${item.valuePreview}` : '';
      console.log(`${item.status.padEnd(18)} ${location.padEnd(18)} ${item.label || '(无标签)'}${value}${item.reason ? ` | ${item.reason}` : ''}`);
    }
    const missing = output.missingFieldReport;
    console.log(`待补充字段: ${missing.summary.total}（可回写 JSON ${missing.summary.canonical}，仅本次申请 ${missing.summary.applicationOnly}，敏感手工 ${missing.summary.sensitiveManual}）`);
    for (const question of missing.questions.filter((item) => item.source === 'page')) {
      console.log(`- ${question.persistence} | ${question.path || question.label} | ${question.prompt}`);
    }
    if (adapter?.reader?.editorMode === 'section-editor' && !sectionOption) {
      console.log('该站点按分区打开编辑器。使用 --section basic|education|work|project 等读取单个分区。');
    }
    if (openedSection) await closeSemanticSection(page, adapter, sectionOption);
  } finally {
    disconnectFromBrowser(browser);
  }
}

main().catch((error) => {
  console.error(`❌ 映射预览失败: ${error.message}`);
  process.exitCode = 1;
});
