import {
  ageFromBirthDate,
  INTERNAL_VALUE,
  formatMonth,
  getValue,
  isEmpty,
  joinText,
} from './resume-mapper.mjs';
import { requiredSemanticRecordCounts } from './semantic-form-reader.mjs';

const normalize = (value) => String(value || '')
  .replace(/[：:（）()\s＊*]/g, '')
  .replace(/必填/g, '')
  .replace(/^(请输入|请填写|请选择|请说明)/, '')
  .trim();

const ALIASES = {
  basic: [
    [['姓名', '真实姓名', '姓名拼音'], 'basic.name'],
    [['手机号码', '手机号', '联系电话', '联系电话号码', '电话'], 'basic.phone'],
    [['邮箱', '电子邮箱', '邮箱地址'], 'basic.email'],
    [['性别'], 'basic.gender'],
    [['年龄'], 'basic.birthDate'],
    [['出生日期', '出生年月日'], 'basic.birthDate'],
    [['当前所处地', '所在地点', '所在地', '现居城市', '当前城市', '当前居住城市'], 'basic.currentCity'],
    [['家乡', '籍贯', '户籍所在地'], 'basic.hometownCity'],
    [['期望工作地点', '意向城市', '期望城市', '工作城市'], 'basic.preferredCities[0]'],
    [['政治面貌'], 'basic.politicalStatus'],
    [['到岗时间', '可到岗时间', '入职时间'], 'basic.availability'],
  ],
  education: [
    [['学校名称', '学校', '院校', '毕业院校'], 'school'],
    [['学院名称', '学院', '院系', '所在院系', '专业学院'], 'college'],
    [['专业名称', '专业', '所学专业'], 'major'],
    [['学历', '学位', '学历层次'], 'degree'],
    [['开始时间', '入学时间'], 'startTime'],
    [['毕业时间', '结束时间', '预计毕业时间'], 'endTime'],
    [['成绩排名', '年级成绩排名', '专业排名', '排名'], 'rank'],
    [['绩点', 'GPA', 'GPA成绩'], 'gpa'],
    [['学历类型', '培养方式', '受教育类型', '教育类型'], 'educationType'],
  ],
  work: [
    [['公司名称', '公司', '实习公司', '工作单位', '雇主'], 'company'],
    [['职位名称', '职位', '担任岗位', '岗位名称', '职务'], 'title'],
    [['所在部门', '部门名称', '任职部门', '部门'], 'department'],
    [['开始时间', '入职时间'], 'startTime'],
    [['结束时间', '离职时间'], 'endTime'],
    [['工作描述', '工作职责', '实习描述', '实习内容', '职责描述', '描述'], 'achievements'],
  ],
  project: [
    [['项目名称', '项目名'], 'name'],
    [['项目角色', '在项目中担任的角色', '项目岗位'], 'role'],
    [['项目链接', '项目地址', '项目网址'], 'link'],
    [['开始时间'], 'startTime'],
    [['结束时间'], 'endTime'],
    [['项目描述', '项目职责', '项目内容', '描述'], 'description'],
  ],
  campus: [
    [['校园经历名称', '组织名称', '活动名称', '社团名称'], 'organization'],
    [['角色', '担任职务', '职位'], 'role'],
    [['校园经历描述', '活动描述', '社会实践描述', '描述'], 'description'],
  ],
  awards: [
    [['荣誉名称', '获奖名称', '奖项名称', '获奖项'], 'name'],
    [['获奖级别', '荣誉级别'], 'level'],
    [['获奖时间', '获得时间'], 'date'],
    [['荣誉描述', '获奖描述', '奖项说明', '描述'], 'description'],
  ],
  language: [
    [['语言', '语言类别', '英语证书名称'], 'language'],
    [['精通程度', '掌握程度', '听说能力', '读写能力'], 'proficiency'],
    [['成绩', '考试分数', '分数'], 'score'],
  ],
  certificates: [
    [['证书名称', '资格证名称'], 'name'],
    [['获得时间', '取得时间', '证书时间'], 'date'],
    [['证书描述', '证书说明', '描述'], 'description'],
  ],
  portfolio: [
    [['作品名称', '作品名'], 'name'],
    [['作品链接', '个人主页超链接', '作品地址'], 'link'],
    [['描述', '作品描述'], 'description'],
  ],
};

const SECTION_KEYS = {
  education: 'education',
  work: 'workExperience',
  project: 'projectExperience',
  campus: 'campusExperience',
  awards: 'awards',
  language: 'languages',
  certificates: 'certificates',
  portfolio: 'portfolio',
};

function matches(label, aliases) {
  const normalized = normalize(label);
  return aliases.some((alias) => normalized === normalize(alias)
    || (normalized.startsWith(normalize(alias)) && /^(请|建议|提示|确保|务必)/.test(normalized.slice(normalize(alias).length))));
}

function labelMapping(sectionKind, label) {
  return (ALIASES[sectionKind] || []).find(([aliases]) => matches(label, aliases));
}

function confidenceFor(field, mapping) {
  const exact = mapping && normalize(field.label) === normalize(mapping[0][0]);
  const base = Number.isFinite(field.confidence) ? field.confidence : 0.35;
  return Math.round(Math.min(base, exact ? 0.98 : base) * 100) / 100;
}

function result(field, details, { showValues = false } = {}) {
  const output = {
    fieldId: field.fieldId,
    label: field.label,
    controlText: field.controlText,
    sectionTitle: field.sectionTitle,
    sectionKind: field.sectionKind,
    sectionIndex: field.sectionIndex,
    recordIndex: field.recordIndex,
    fieldIndex: field.fieldIndex,
    controlIndex: field.controlIndex,
    required: field.required,
    maxLength: field.maxLength,
    confidence: field.confidence,
    locator: field.locator,
    ...details,
  };
  if (Object.hasOwn(output, 'value')) {
    output[INTERNAL_VALUE] = output.value;
    if (showValues) output.valuePreview = output.value;
    delete output.value;
  }
  return output;
}

function methodFor(field, fallback = 'text') {
  return {
    file: 'file',
    password: 'manual',
    radio: 'radio',
    checkbox: 'checkbox',
    'native-select': 'select',
    'custom-select': 'select',
    date: 'date',
    'date-range': 'date-range',
  }[field.controlKind] || fallback;
}

function source(field, path, value, method, options = {}) {
  const { status, reason, needsConfirmation = false, showValues = false, confidence = field.confidence ?? 0.35 } = options;
  const base = { resumePath: path || null, method, reason, confidence };
  if (status) return result(field, { ...base, status }, options);
  if (field.controlKind === 'password' || method === 'manual') {
    return result(field, { ...base, status: 'manual', reason: reason || '该字段必须手动处理' }, options);
  }
  if (field.disabled) return result(field, { ...base, status: 'blocked', reason: reason || '控件不可编辑' }, options);
  if (isEmpty(value)) return result(field, { ...base, status: 'missing', reason: reason || 'resume.json 中没有对应信息' }, options);
  if (field.hasValue) return result(field, { ...base, status: 'filled-skip', reason: '页面已有内容，默认不覆盖' }, options);
  if (['date', 'date-range', 'file'].includes(method)) {
    return result(field, { ...base, status: 'manual', reason: reason || '日期、日期范围和附件保留手动处理' }, options);
  }
  const uncertain = confidence < 0.8 || needsConfirmation || ['select', 'radio', 'checkbox'].includes(method);
  return result(field, {
    ...base,
    status: uncertain ? 'needs-confirmation' : 'ready',
    value,
    reason: uncertain ? reason || '通用识别置信度不足，需要用户确认' : reason,
  }, options);
}

function optionSource(field, path, value, options) {
  if (isEmpty(value)) return source(field, path, value, methodFor(field), options);
  if (field.controlText && normalize(field.controlText) !== normalize(value)) {
    return source(field, path, undefined, methodFor(field), { ...options, status: 'skip', reason: '不是目标选项' });
  }
  return source(field, path, value, methodFor(field), options);
}

function basic(field, resume, options) {
  const mapping = labelMapping('basic', field.label);
  if (mapping?.[1] === 'basic.birthDate' && matches(field.label, ['年龄'])) {
    return source(field, 'basic.birthDate', ageFromBirthDate(resume.basic?.birthDate), methodFor(field), {
      ...options, reason: '年龄仅由用户明确提供的完整出生日期计算', confidence: confidenceFor(field, mapping),
    });
  }
  if (!mapping) return source(field, null, undefined, 'manual', { ...options, reason: '通用识别无法确认基础字段的简历来源' });
  const [aliases, path] = mapping;
  let value = getValue(resume, path);
  if (path === 'basic.preferredCities[0]') value = resume.basic?.preferredCities?.[0];
  const method = methodFor(field);
  return field.controlKind === 'radio' || field.controlKind === 'checkbox'
    ? optionSource(field, path, value, { ...options, confidence: confidenceFor(field, mapping), needsConfirmation: true })
    : source(field, path, value, method, { ...options, confidence: confidenceFor(field, mapping) });
}

function experience(field, resume, sectionKind, options) {
  const key = SECTION_KEYS[sectionKind];
  const index = field.recordIndex || 0;
  const item = resume[key]?.[index];
  const mapping = labelMapping(sectionKind, field.label);
  if (matches(field.label, ['起止时间', '在校时间', '在职时间', '项目时间', '校园经历时间'])) {
    const property = field.controlIndex % 2 === 0 ? 'startTime' : 'endTime';
    const path = `${key}[${index}].${property}`;
    return source(field, path, formatMonth(item?.[property]), 'date-range', { ...options, reason: '日期范围控件保留手动处理', confidence: 0.95 });
  }
  if (!mapping) return source(field, null, undefined, 'manual', { ...options, reason: `通用识别无法确认${sectionKind}字段的简历来源` });
  const [, property] = mapping;
  const path = `${key}[${index}].${property}`;
  let value = item?.[property];
  if (property === 'achievements') value = joinText(value, '\n');
  if (property === 'description' && sectionKind === 'project') value = joinText([item?.description, ...(item?.achievements || [])], '\n');
  if (['startTime', 'endTime', 'date'].includes(property)) value = formatMonth(value);
  return source(field, path, value, methodFor(field), { ...options, confidence: confidenceFor(field, mapping) });
}

function skills(field, resume, options) {
  const values = Object.values(resume.skills || {}).flatMap((items) => Array.isArray(items) ? items : []);
  return source(field, 'skills.*', joinText(values, '、'), methodFor(field), {
    ...options, confidence: Math.min(field.confidence ?? 0.35, 0.72), needsConfirmation: true,
    reason: '通用页面可能要求拆分技能条目，需要确认填写方式',
  });
}

export function mapGenericForm(form, resume, { showValues = false } = {}) {
  return form.fields.map((field) => {
    const options = { showValues, confidence: field.confidence ?? 0.35 };
    if (field.controlKind === 'file' || field.type === 'file' || field.sectionKind === 'attachment') {
      return result(field, { status: 'manual', method: 'file', resumePath: null, reason: '附件必须由用户手动上传' }, options);
    }
    if (field.controlKind === 'password') return result(field, { status: 'manual', method: 'manual', resumePath: null, reason: '密码字段禁止自动填写' }, options);
    switch (field.sectionKind) {
      case 'basic': return basic(field, resume, options);
      case 'education':
      case 'work':
      case 'project':
      case 'campus':
      case 'awards':
      case 'language':
      case 'certificates':
      case 'portfolio': return experience(field, resume, field.sectionKind, options);
      case 'skills': return skills(field, resume, options);
      case 'evaluation': {
        const path = 'selfEvaluation';
        return source(field, path, resume.selfEvaluation, methodFor(field), options);
      }
      case 'family':
      case 'contact': return result(field, { status: 'manual', method: 'manual', resumePath: null, reason: '隐私或关系人字段必须由用户决定' }, options);
      default: return source(field, null, undefined, 'manual', { ...options, reason: '通用识别无法确认字段分区' });
    }
  });
}

export function planGenericMappings(form, resume, options = {}) {
  // Generic locators point to the current DOM, so synthetic copies made
  // before clicking an add button could target the wrong record. The filler
  // expands missing records after APPLY and re-reads the page before mapping.
  // Preview therefore reports only controls that actually exist.
  return mapGenericForm(form, resume, options);
}

export function summarizeGenericMappings(mappings) {
  return mappings.reduce((summary, item) => {
    summary[item.status] = (summary[item.status] || 0) + 1;
    return summary;
  }, {});
}
