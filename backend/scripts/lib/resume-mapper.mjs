const EMPTY_VALUES = new Set([undefined, null, '']);
export const INTERNAL_VALUE = Symbol('resumeValue');

export function getValue(root, path) {
  if (!path) return undefined;
  return path.split('.').reduce((current, segment) => {
    const match = segment.match(/^([^\[]+)(?:\[(\d+)\])?$/);
    if (!match || current == null) return undefined;
    const next = current[match[1]];
    return match[2] == null ? next : next?.[Number(match[2])];
  }, root);
}

export function isEmpty(value) {
  return EMPTY_VALUES.has(value) || (Array.isArray(value) && value.length === 0);
}

export function joinText(value, separator = '\n') {
  if (Array.isArray(value)) return value.filter((item) => !isEmpty(item)).join(separator);
  return value == null ? '' : String(value);
}

export function formatMonth(value) {
  if (isEmpty(value)) return undefined;
  const text = String(value).trim().replace(/[./]/g, '-');
  const match = text.match(/^(\d{4})-(\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}` : text;
}

export function ageFromBirthDate(value, now = new Date()) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  let age = now.getFullYear() - year;
  if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age -= 1;
  return age >= 0 && age <= 120 ? String(age) : undefined;
}

function occurrence(fields, index, sectionKind, label) {
  return fields
    .slice(0, index)
    .filter((field) => field.sectionKind === sectionKind && field.label === label)
    .length;
}

function normalizedLabel(label) {
  return (label || '').replace(/[：:（）()\s]/g, '');
}

function makeResult(field, details, { showValues = false } = {}) {
  const result = {
    fieldId: field.fieldId,
    label: field.label,
    controlText: field.controlText,
    sectionKind: field.sectionKind,
    formItemIndex: field.formItemIndex,
    formPartIndex: field.formPartIndex,
    controlIndex: field.controlIndex,
    locator: field.locator,
    ...details,
  };

  if (Object.hasOwn(result, 'value')) {
    result[INTERNAL_VALUE] = result.value;
    if (showValues) result.valuePreview = result.value;
  }
  delete result.value;
  return result;
}

function sourceResult(field, path, value, method, options = {}) {
  const { showValues = false, reason, status, needsConfirmation = false } = options;
  const base = { resumePath: path || null, method, reason };

  if (status) return makeResult(field, { ...base, status }, options);
  if (field.disabled || field.readonly) {
    return makeResult(field, { ...base, status: 'blocked', reason: reason || '控件不可编辑' }, options);
  }
  if (isEmpty(value)) {
    return makeResult(field, { ...base, status: 'missing', reason: reason || 'resume.json 中没有对应信息' }, options);
  }
  if (field.hasValue && field.controlKind !== 'custom-radio') {
    return makeResult(field, { ...base, status: 'filled-skip', reason: '页面已有内容，默认不覆盖' }, options);
  }
  if (needsConfirmation) {
    return makeResult(field, { ...base, status: 'needs-confirmation', value, reason: reason || '需要用户确认' }, options);
  }
  return makeResult(field, { ...base, status: 'ready', value }, options);
}

function mapBasic(field, resume, options) {
  const label = normalizedLabel(field.label);
  const paths = {
    姓名: ['basic.name', 'text'],
    手机号码: ['basic.phone', 'text'],
    邮箱: ['basic.email', 'text'],
    性别: ['basic.gender', 'radio'],
    政治面貌: ['basic.politicalStatus', 'select'],
  };

  if (label === '出生日期') {
    return sourceResult(field, 'basic.birthDate', undefined, 'date', {
      ...options,
      reason: 'resume.json 只有 birthYear，没有完整出生日期，禁止推断',
    });
  }

  const mapping = paths[label];
  if (!mapping) return sourceResult(field, null, undefined, 'manual', { ...options, reason: '该基础字段尚未配置安全数据源' });
  const [path, method] = mapping;
  const value = getValue(resume, path);

  if (method === 'radio') {
    if (field.controlText && field.controlText !== String(value || '')) {
      return sourceResult(field, path, undefined, method, { ...options, status: 'skip', reason: '不是目标单选项' });
    }
    return sourceResult(field, path, value, method, {
      ...options,
      needsConfirmation: true,
      reason: '自定义单选组件，填写前需要确认当前选中状态',
    });
  }

  return sourceResult(field, path, value, method, options);
}

function mapEducation(field, resume, fields, index, options) {
  const recordIndex = occurrence(fields, index, 'education', field.label);
  const item = resume.education?.[recordIndex];
  const paths = {
    开始时间: 'startTime',
    毕业时间: 'endTime',
    学校名称: 'school',
    专业名称: 'major',
    学历: 'degree',
    成绩排名: 'rank',
    绩点: 'gpa',
  };
  const key = normalizedLabel(field.label);
  const property = paths[key];
  if (!property) return sourceResult(field, null, undefined, 'manual', { ...options, reason: '教育字段缺少明确履历来源' });
  const path = `education[${recordIndex}].${property}`;
  let value = item?.[property];
  if (key === '开始时间' || key === '毕业时间') value = formatMonth(value);
  return sourceResult(field, path, value, key === '开始时间' || key === '毕业时间' ? 'date' : 'text', options);
}

function mapWork(field, resume, fields, index, options) {
  const recordIndex = occurrence(fields, index, 'work', field.label);
  const item = resume.workExperience?.[recordIndex];
  const paths = {
    开始时间: 'startTime',
    结束时间: 'endTime',
    公司名称: 'company',
    职位名称: 'title',
    所在部门: 'department',
    工作描述: 'achievements',
  };
  const key = normalizedLabel(field.label);
  const property = paths[key];
  if (!property) return sourceResult(field, null, undefined, 'manual', { ...options, reason: '工作字段缺少明确履历来源' });
  const path = `workExperience[${recordIndex}].${property}`;
  let value = item?.[property];
  if (key === '工作描述') value = joinText(value, '\n');
  if (key === '开始时间' || key === '结束时间') value = formatMonth(value);
  return sourceResult(field, path, value, key === '开始时间' || key === '结束时间' ? 'date' : 'text', options);
}

function mapProject(field, resume, fields, index, options) {
  const recordIndex = occurrence(fields, index, 'project', field.label);
  const item = resume.projectExperience?.[recordIndex];
  const paths = { 项目名称: 'name', 项目描述: 'description' };
  const key = normalizedLabel(field.label);
  const property = paths[key];
  if (!property) return sourceResult(field, null, undefined, 'manual', { ...options, reason: 'resume.json 没有项目职责字段，禁止代写' });
  const path = `projectExperience[${recordIndex}].${property}`;
  let value = item?.[property];
  if (key === '项目描述') {
    value = joinText([item?.description, ...(item?.achievements || [])], '\n');
  }
  return sourceResult(field, path, value, 'text', options);
}

function mapSkills(field, resume, options) {
  const value = [
    ...(resume.skills?.frontend || []),
    ...(resume.skills?.backend || []),
  ];
  return sourceResult(field, 'skills.frontend + skills.backend', joinText(value, '、'), 'text', {
    ...options,
    needsConfirmation: true,
    reason: '页面是单个技能控件，需确认是否拆分为多个技能条目',
  });
}

export function mapVivoForm(form, resume, { showValues = false } = {}) {
  return form.fields.map((field, index, fields) => {
    if (!field.label && field.placeholder === '搜索职位关键词') {
      return makeResult(field, { status: 'skip', method: 'skip', reason: '导航搜索框，不属于履历' }, { showValues });
    }
    if (field.controlKind === 'file' || field.type === 'file' || field.sectionKind === 'attachment') {
      return makeResult(field, { status: 'manual', method: 'file', reason: '附件上传必须由用户手动完成' }, { showValues });
    }

    switch (field.sectionKind) {
      case 'basic':
        return mapBasic(field, resume, { showValues });
      case 'education':
        return mapEducation(field, resume, fields, index, { showValues });
      case 'work':
        return mapWork(field, resume, fields, index, { showValues });
      case 'project':
        return mapProject(field, resume, fields, index, { showValues });
      case 'skills':
        return mapSkills(field, resume, { showValues });
      case 'family':
        return sourceResult(field, null, undefined, 'radio', { showValues, reason: '简历中没有内部亲属信息，必须询问用户' });
      case 'language':
      case 'awards':
      case 'certificates':
      case 'evaluation':
        return sourceResult(field, null, undefined, 'manual', { showValues, reason: '当前 resume.json 没有该分区的结构化来源' });
      default:
        return sourceResult(field, null, undefined, 'manual', { showValues, reason: '无法安全识别字段分区' });
    }
  });
}

export function summarizeMappings(mappings) {
  return mappings.reduce((summary, item) => {
    summary[item.status] = (summary[item.status] || 0) + 1;
    return summary;
  }, {});
}
