import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateResumeJson } from './validate-resume-json.mjs';

const SIMPLE_PATH = /^(?:basic\.[A-Za-z][A-Za-z0-9]*(?:\[\d+\])?|(?:education|workExperience|projectExperience|portfolio|campusExperience|awards|languages|certificates)\[\d+\]\.[A-Za-z][A-Za-z0-9]*|(?:languages|certificates|portfolio|campusExperience|awards)|selfEvaluation)$/;
const RESTRICTED_LABEL = /身份证|证件号|护照|银行卡|紧急联系人|家庭成员|亲属|家属|薪资证明/;
const DATE_PATH = /(?:birthDate|startTime|endTime|\.date)$/;
const ARRAY_PATH = /(?:preferredCities|schoolType|achievements|technologies)$/;

const BASIC_META = {
  'basic.gender': ['性别', '请按招聘网站可选项提供性别。', 'string', 'personal'],
  'basic.birthDate': ['出生日期', '请提供完整出生日期（YYYY-MM-DD）；年龄只会由这个日期计算，不会反推日期。', 'date', 'personal'],
  'basic.currentCity': ['现居地', '请提供当前居住城市。', 'string', 'personal'],
  'basic.hometownCity': ['家乡/籍贯', '请提供家乡或籍贯城市。', 'string', 'personal'],
  'basic.preferredCities': ['期望工作地点', '请提供一个或多个期望工作城市，用逗号分隔。', 'string-array', 'standard'],
  'basic.availability': ['到岗时间', '请提供预计可到岗时间。', 'string', 'standard'],
  'basic.politicalStatus': ['政治面貌', '请按招聘网站可选项提供政治面貌。', 'string', 'personal'],
  selfEvaluation: ['自我评价', '请提供希望复用在招聘表单中的自我评价；不会根据其他经历自动编写。', 'string', 'standard'],
  languages: ['语言能力', '请提供语言、熟练程度及明确的考试成绩；没有可回答“无”。', 'object-array', 'standard'],
  certificates: ['证书', '请提供证书名称和取得时间；没有可回答“无”。', 'object-array', 'standard'],
};

function getValue(root, valuePath) {
  if (!valuePath || !SIMPLE_PATH.test(valuePath)) return undefined;
  return valuePath.split('.').reduce((current, segment) => {
    const match = segment.match(/^([^\[]+)(?:\[(\d+)\])?$/);
    if (!match || current == null) return undefined;
    const next = current[match[1]];
    return match[2] === undefined ? next : next?.[Number(match[2])];
  }, root);
}

function empty(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function dynamicMeta(valuePath) {
  const match = valuePath.match(/^(education|workExperience|projectExperience|portfolio|campusExperience|awards|languages|certificates)\[(\d+)\]\.([A-Za-z][A-Za-z0-9]*)$/);
  if (!match) return null;
  const [, section, indexText, property] = match;
  const index = Number(indexText) + 1;
  const sectionNames = {
    education: '教育经历',
    workExperience: '实习/工作经历',
    projectExperience: '项目经历',
    portfolio: '作品',
    campusExperience: '校园经历',
    awards: '获奖经历',
    languages: '语言能力',
    certificates: '证书',
  };
  const propertyNames = {
    school: '学校', college: '学院', degree: '学历', major: '专业', startTime: '开始时间',
    endTime: '结束时间', rank: '成绩排名', gpa: '绩点', educationType: '学历类型',
    company: '公司名称', title: '职位名称', department: '部门', projectName: '项目名称',
    projectBackground: '项目背景', achievements: '详细描述/成果', name: '名称', role: '角色',
    link: '链接', description: '描述', technologies: '技术栈', organization: '组织名称',
    level: '级别', date: '日期', language: '语言', proficiency: '熟练程度', score: '成绩',
  };
  const label = `${sectionNames[section]}第 ${index} 条 - ${propertyNames[property] || property}`;
  const type = ARRAY_PATH.test(property) ? 'string-array' : DATE_PATH.test(property) ? 'date' : 'string';
  const format = type === 'date' ? '请使用 YYYY-MM；只有出生日期使用 YYYY-MM-DD。'
    : type === 'string-array' ? '可逐条提供，系统会保留为数组。' : '请提供原始事实，不需要猜测或代写。';
  return [label, `${label}：${format}`, type, 'standard'];
}

function metaFor(valuePath, fallbackLabel = '') {
  const preferredBase = valuePath?.replace(/\[\d+\]$/, '');
  const meta = BASIC_META[valuePath] || BASIC_META[preferredBase] || dynamicMeta(valuePath);
  if (meta) return meta;
  return [fallbackLabel || valuePath || '未识别字段', `请提供“${fallbackLabel || valuePath}”的准确内容。`, 'string', 'standard'];
}

function candidateFromMapping(mapping, resume) {
  if (!['missing', 'manual'].includes(mapping.status)) return null;
  if (mapping.method === 'file' || mapping.controlKind === 'file') return null;
  const valuePath = typeof mapping.resumePath === 'string' && SIMPLE_PATH.test(mapping.resumePath)
    ? mapping.resumePath : null;
  if (valuePath && (resume.review?.notApplicableFields || []).includes(valuePath)) return null;
  if (mapping.status === 'manual' && (!valuePath || !empty(getValue(resume, valuePath)))) return null;
  const label = mapping.label || mapping.fieldName || '未识别字段';
  if (!valuePath) {
    const restricted = RESTRICTED_LABEL.test(label);
    return {
      key: `page:${mapping.sectionKind || 'unknown'}:${mapping.recordIndex || 0}:${label}`,
      path: null,
      label,
      prompt: restricted
        ? `“${label}”属于敏感或关系人信息，请仅在当前申请确有必要时手工提供，不写入通用简历 JSON。`
        : `“${label}”没有可靠的通用简历字段。请说明本次申请要填写的内容；默认只用于当前申请。`,
      expectedType: 'string',
      persistence: restricted ? 'sensitive-manual' : 'application-only',
      sensitivity: restricted ? 'restricted' : 'standard',
      requiredOnPage: Boolean(mapping.required),
      pageLabels: [label],
      source: 'page',
    };
  }
  const [canonicalLabel, prompt, expectedType, sensitivity] = metaFor(valuePath, label);
  return {
    key: `canonical:${valuePath}`,
    path: valuePath,
    label: canonicalLabel,
    prompt,
    expectedType,
    persistence: 'canonical',
    sensitivity,
    requiredOnPage: Boolean(mapping.required),
    pageLabels: [label],
    source: 'page',
  };
}

export function buildMissingFieldReport(resume, mappings = []) {
  const candidates = [];
  for (const mapping of mappings) {
    const candidate = candidateFromMapping(mapping, resume);
    if (candidate) candidates.push(candidate);
  }
  for (const valuePath of resume.review?.missingFields || []) {
    if (typeof valuePath !== 'string' || !SIMPLE_PATH.test(valuePath) || !empty(getValue(resume, valuePath))) continue;
    if ((resume.review?.notApplicableFields || []).includes(valuePath)) continue;
    const [label, prompt, expectedType, sensitivity] = metaFor(valuePath);
    candidates.push({
      key: `canonical:${valuePath}`,
      path: valuePath,
      label,
      prompt,
      expectedType,
      persistence: 'canonical',
      sensitivity,
      requiredOnPage: false,
      pageLabels: [],
      source: 'resume-review',
    });
  }

  const merged = new Map();
  for (const candidate of candidates) {
    const existing = merged.get(candidate.key);
    if (!existing) {
      merged.set(candidate.key, candidate);
      continue;
    }
    existing.requiredOnPage ||= candidate.requiredOnPage;
    existing.source = existing.source === 'page' || candidate.source === 'page' ? 'page' : 'resume-review';
    existing.pageLabels = [...new Set([...existing.pageLabels, ...candidate.pageLabels])];
  }
  const questions = [...merged.values()].sort((left, right) => {
    if (left.requiredOnPage !== right.requiredOnPage) return left.requiredOnPage ? -1 : 1;
    if (left.source !== right.source) return left.source === 'page' ? -1 : 1;
    return left.label.localeCompare(right.label, 'zh-CN');
  }).map(({ key, ...question }, index) => ({ id: `missing-${index + 1}`, ...question }));

  return {
    schemaVersion: 1,
    summary: {
      total: questions.length,
      canonical: questions.filter((item) => item.persistence === 'canonical').length,
      applicationOnly: questions.filter((item) => item.persistence === 'application-only').length,
      sensitiveManual: questions.filter((item) => item.persistence === 'sensitive-manual').length,
    },
    questions,
  };
}

function parsePath(valuePath) {
  if (!SIMPLE_PATH.test(valuePath)) throw new Error(`不支持回写路径: ${valuePath}`);
  return valuePath.split('.').map((segment) => {
    const match = segment.match(/^([^\[]+)(?:\[(\d+)\])?$/);
    return { key: match[1], index: match[2] === undefined ? null : Number(match[2]) };
  });
}

function setValue(root, valuePath, value) {
  const segments = parsePath(valuePath);
  let current = root;
  segments.forEach((segment, position) => {
    const last = position === segments.length - 1;
    if (segment.index === null) {
      if (last) current[segment.key] = value;
      else {
        current[segment.key] ??= segments[position + 1].index === null ? {} : [];
        current = current[segment.key];
      }
      return;
    }
    current[segment.key] ??= [];
    if (last) current[segment.key][segment.index] = value;
    else {
      current[segment.key][segment.index] ??= {};
      current = current[segment.key][segment.index];
    }
  });
}

function normalizeAnswer(valuePath, value, expectedType) {
  if (expectedType === 'string-array') {
    const items = Array.isArray(value) ? value : String(value || '').split(/[,，、;；\n]+/);
    return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
  }
  if (expectedType === 'object-array') {
    if (!Array.isArray(value)) throw new Error(`${valuePath} 必须是 JSON 数组`);
    return value;
  }
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${valuePath} 的回答不能为空`);
  if (expectedType === 'date') {
    const normalized = text.replace(/[./]/g, '-');
    const expression = valuePath === 'basic.birthDate' ? /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/
      : /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/;
    if (!expression.test(normalized)) throw new Error(`${valuePath} 日期格式不正确`);
    return normalized;
  }
  return text;
}

export function applyResumeAnswers(resume, answerDocument) {
  const answers = Array.isArray(answerDocument) ? answerDocument : answerDocument?.answers;
  if (!Array.isArray(answers)) throw new Error('answers 必须是数组');
  const output = structuredClone(resume);
  const updated = [];
  const notApplicable = [];
  for (const answer of answers) {
    if (!answer || answer.action === 'skip') continue;
    const valuePath = answer.path;
    if (typeof valuePath !== 'string' || !SIMPLE_PATH.test(valuePath)) throw new Error(`回答缺少可回写的 canonical path: ${valuePath}`);
    if (answer.action === 'not-applicable') {
      notApplicable.push(valuePath);
      continue;
    }
    const [, , expectedType] = metaFor(valuePath);
    const value = normalizeAnswer(valuePath, answer.value, answer.expectedType || expectedType);
    const previous = getValue(output, valuePath);
    if (!empty(previous) && JSON.stringify(previous) !== JSON.stringify(value) && answer.override !== true) {
      throw new Error(`${valuePath} 已有值；如需纠正请显式设置 override: true`);
    }
    setValue(output, valuePath, value);
    updated.push(valuePath);
  }
  output.schemaVersion = 1;
  output.status = 'draft';
  output.review ??= {};
  output.review.missingFields = (output.review.missingFields || []).filter((valuePath) => !updated.includes(valuePath) && !notApplicable.includes(valuePath));
  output.review.uncertainties ??= [];
  output.review.normalizations ??= [];
  output.review.userProvidedFields = [...new Set([...(output.review.userProvidedFields || []), ...updated])];
  output.review.notApplicableFields = [...new Set([...(output.review.notApplicableFields || []), ...notApplicable])];
  const validation = validateResumeJson(output);
  if (!validation.valid) throw new Error(`更新后的 JSON 校验失败: ${validation.errors.map((item) => `${item.path} ${item.message}`).join('; ')}`);
  return { resume: output, updated, notApplicable, validation };
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function writeNewFile(file, content, overwrite) {
  if (!overwrite) {
    try {
      await fs.access(file);
      throw new Error(`输出文件已存在: ${file}；使用 --overwrite 才允许替换`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await fs.writeFile(file, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const resumeFile = option(args, '--resume');
  if (!['report', 'apply'].includes(command) || !resumeFile) {
    throw new Error('用法: resume-feedback.mjs report|apply --resume <file> [--mappings <file>] [--answers <file> --output <file>]');
  }
  const resume = await readJson(resumeFile);
  if (command === 'report') {
    const mappingsFile = option(args, '--mappings');
    const mappingDocument = mappingsFile ? await readJson(mappingsFile) : null;
    const report = buildMissingFieldReport(resume, Array.isArray(mappingDocument) ? mappingDocument : mappingDocument?.mappings || []);
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`缺失字段: ${report.summary.total}（可回写 ${report.summary.canonical}，仅本次 ${report.summary.applicationOnly}，敏感手工 ${report.summary.sensitiveManual}）`);
      for (const question of report.questions) console.log(`- ${question.id} | ${question.persistence} | ${question.path || question.label} | ${question.prompt}`);
    }
    return;
  }
  const answersFile = option(args, '--answers');
  const outputFile = option(args, '--output');
  if (!answersFile || !outputFile) throw new Error('apply 需要 --answers 和 --output；默认不覆盖原 JSON');
  const result = applyResumeAnswers(resume, await readJson(answersFile));
  await writeNewFile(outputFile, result.resume, args.includes('--overwrite'));
  console.log(`已生成 draft: ${path.resolve(outputFile)}；更新路径: ${result.updated.join(', ') || '无'}；标记不适用: ${result.notApplicable.join(', ') || '无'}`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error) => {
    console.error(`反馈处理失败: ${error.message}`);
    process.exitCode = 1;
  });
}
