import {
  ageFromBirthDate,
  INTERNAL_VALUE,
  formatMonth,
  getValue,
  isEmpty,
  joinText,
} from './resume-mapper.mjs';

const ARRAY_PATHS = {
  education: 'education',
  work: 'workExperience',
  project: 'projectExperience',
  portfolio: 'portfolio',
  awards: 'awards',
  language: 'languages',
};

const LABEL = (field) => String(field.label || '').replace(/[：:（）()\s]/g, '');

const FEISHU_FIELD_TEMPLATES = {
  education: [
    ['school', '学校名称', 'text'],
    ['degree', '学历', 'select'],
    ['field_of_study', '专业', 'text'],
    ['start_end_time', '起止时间', 'date-range'],
    ['start_end_time', '起止时间', 'date-range'],
    ['education_type', '学历类型', 'select'],
    ['academic_ranking', '成绩排名', 'select'],
  ],
  work: [
    ['company', '公司名称', 'text'],
    ['title', '职位名称', 'text'],
    ['start_end_time', '起止时间', 'date-range'],
    ['start_end_time', '起止时间', 'date-range'],
    ['desc', '描述', 'text'],
  ],
  project: [
    ['name', '项目名称', 'text'],
    ['role', '项目角色', 'text'],
    ['start_end_time', '起止时间', 'date-range'],
    ['start_end_time', '起止时间', 'date-range'],
    ['link', '项目链接', 'text'],
    ['desc', '描述', 'text'],
  ],
  portfolio: [
    ['link', '作品链接', 'text'],
    ['attachment', '作品附件', 'file'],
    ['desc', '描述', 'text'],
  ],
  awards: [
    ['name', '获奖名称', 'text'],
    ['date', '获奖时间', 'date'],
    ['desc', '描述', 'text'],
  ],
  language: [
    ['language', '语言', 'select'],
    ['proficiency', '精通程度', 'select'],
  ],
  evaluation: [
    ['self_evaluation', '自我评价', 'text'],
  ],
};

function templateFields(section) {
  const counts = new Map();
  return (FEISHU_FIELD_TEMPLATES[section.sectionKind] || []).map(([fieldName, label, controlKind]) => {
    const controlIndex = counts.get(fieldName) || 0;
    counts.set(fieldName, controlIndex + 1);
    return {
      fieldId: `${section.sectionKind}:0:${fieldName}:${controlIndex}`,
      sourceFieldId: fieldName,
      fieldName,
      label,
      sectionKind: section.sectionKind,
      sectionTitle: section.title,
      sectionIndex: section.sectionIndex,
      recordIndex: 0,
      controlIndex,
      controlKind,
      disabled: false,
      readonly: controlKind === 'select',
      hasValue: false,
      locator: {
        strategy: 'feishu-field',
        sectionIndex: section.sectionIndex,
        sectionKind: section.sectionKind,
        recordIndex: 0,
        fieldName,
        controlIndex,
        controlKind,
      },
    };
  });
}

function result(field, details, { showValues = false } = {}) {
  const output = {
    fieldId: field.fieldId,
    sourceFieldId: field.sourceFieldId,
    fieldName: field.fieldName,
    label: field.label,
    sectionKind: field.sectionKind,
    sectionTitle: field.sectionTitle,
    sectionIndex: field.sectionIndex,
    recordIndex: field.recordIndex,
    controlIndex: field.controlIndex,
    controlKind: field.controlKind,
    required: field.required,
    maxLength: field.maxLength,
    locator: field.locator,
    ...details,
  };
  if (Object.hasOwn(output, 'value')) {
    output[INTERNAL_VALUE] = output.value;
    if (showValues) output.valuePreview = output.value;
  }
  delete output.value;
  return output;
}

function source(field, resumePath, value, method, {
  showValues = false,
  reason,
  needsConfirmation = false,
} = {}) {
  const base = { resumePath: resumePath || null, method, reason };
  // Feishu's searchable combobox input is intentionally readonly; its parent
  // popup is still clickable and is the supported way to choose an option.
  if (field.disabled || (field.readonly && field.controlKind !== 'select')) {
    return result(field, { ...base, status: 'blocked', reason: reason || '控件不可编辑' }, { showValues });
  }
  if (field.hasValue && field.controlKind !== 'file') return result(field, { ...base, status: 'filled-skip', reason: '页面已有内容，默认不覆盖' }, { showValues });
  if (isEmpty(value)) return result(field, { ...base, status: 'missing', reason: reason || 'resume.json 中没有对应信息' }, { showValues });
  if (method === 'manual' || method === 'date-range') {
    return result(field, { ...base, status: 'manual', reason: reason || '该字段保留手动处理' }, { showValues });
  }
  if (method === 'date') {
    return result(field, { ...base, status: 'manual', reason: reason || '日期控件保留手动处理' }, { showValues });
  }
  if (needsConfirmation) return result(field, { ...base, status: 'needs-confirmation', value, reason: reason || '自定义控件，填写前需要确认' }, { showValues });
  return result(field, { ...base, status: 'ready', value }, { showValues });
}

function arrayItem(resume, sectionKind, recordIndex) {
  const path = ARRAY_PATHS[sectionKind];
  return path ? { item: getValue(resume, `${path}[${recordIndex}]`), path } : { item: undefined, path: null };
}

function mapBasic(field, resume, options) {
  const label = LABEL(field);
  const mappings = {
    姓名: ['basic.name', 'text'],
    邮箱: ['basic.email', 'text'],
    性别: ['basic.gender', 'select'],
    所在地点: ['basic.currentCity', 'select'],
    所在地: ['basic.currentCity', 'select'],
    现居城市: ['basic.currentCity', 'select'],
    家乡: ['basic.hometownCity', 'select'],
    籍贯: ['basic.hometownCity', 'select'],
    期望工作地点: ['basic.preferredCities[0]', 'select'],
    期望城市: ['basic.preferredCities[0]', 'select'],
  };
  if (label === '出生日期') {
    return source(field, 'basic.birthDate', getValue(resume, 'basic.birthDate'), 'date', {
      ...options,
      reason: '出生日期必须来自用户明确提供的完整日期',
    });
  }
  if (label === '年龄') {
    return source(field, 'basic.birthDate', ageFromBirthDate(getValue(resume, 'basic.birthDate')), 'text', {
      ...options,
      reason: '年龄仅由用户明确提供的完整出生日期计算',
    });
  }
  const mapping = mappings[label];
  if (!mapping) return source(field, null, undefined, 'manual', { ...options, reason: '当前 resume.json 没有该基础字段的可靠来源' });
  const [path, method] = mapping;
  let value = getValue(resume, path);
  if (path === 'basic.preferredCities[0]') value = resume.basic?.preferredCities?.[0];
  return source(field, path, value, method, {
    ...options,
    needsConfirmation: method === 'select',
    reason: method === 'select' ? '飞书自定义下拉，需要确认选项与履历值一致' : undefined,
  });
}

function mapEducation(field, resume, options) {
  const { item } = arrayItem(resume, 'education', field.recordIndex);
  const key = LABEL(field);
  const properties = {
    学校名称: ['school', 'text'],
    学历: ['degree', 'select'],
    专业: ['major', 'text'],
    学历类型: ['educationType', 'select'],
    成绩排名: ['rank', 'select'],
  };
  if (key === '起止时间') {
    const property = field.controlIndex % 2 === 0 ? 'startTime' : 'endTime';
    const path = `education[${field.recordIndex}].${property}`;
    return source(field, path, formatMonth(item?.[property]), 'date-range', { ...options, reason: '日期范围控件暂保留手动填写' });
  }
  const mapping = properties[key];
  if (!mapping) return source(field, null, undefined, 'manual', { ...options, reason: '学历类型等字段在 resume.json 中没有可靠来源' });
  const [property, method] = mapping;
  const path = `education[${field.recordIndex}].${property}`;
  return source(field, path, item?.[property], method, {
    ...options,
    needsConfirmation: method === 'select',
    reason: method === 'select' ? '飞书自定义下拉，需要确认选项与履历值一致' : undefined,
  });
}

function mapWork(field, resume, options) {
  const { item } = arrayItem(resume, 'work', field.recordIndex);
  const key = LABEL(field);
  if (key === '起止时间') {
    const property = field.controlIndex % 2 === 0 ? 'startTime' : 'endTime';
    const path = `workExperience[${field.recordIndex}].${property}`;
    return source(field, path, formatMonth(item?.[property]), 'date-range', { ...options, reason: '日期范围控件暂保留手动填写' });
  }
  const properties = {
    公司名称: ['company', 'text'],
    职位名称: ['title', 'text'],
    描述: ['achievements', 'text'],
    工作描述: ['achievements', 'text'],
  };
  const mapping = properties[key];
  if (!mapping) return source(field, null, undefined, 'manual', { ...options, reason: '该实习字段在 resume.json 中没有可靠来源' });
  const [property, method] = mapping;
  const path = `workExperience[${field.recordIndex}].${property}`;
  const value = property === 'achievements' ? joinText(item?.[property], '\n') : item?.[property];
  return source(field, path, value, method, options);
}

function mapProject(field, resume, options) {
  const { item } = arrayItem(resume, 'project', field.recordIndex);
  const key = LABEL(field);
  if (key === '起止时间') {
    const property = field.controlIndex % 2 === 0 ? 'startTime' : 'endTime';
    const path = `projectExperience[${field.recordIndex}].${property}`;
    return source(field, path, formatMonth(item?.[property]), 'date-range', { ...options, reason: '日期范围控件暂保留手动填写' });
  }
  if (key === '项目名称') return source(field, `projectExperience[${field.recordIndex}].name`, item?.name, 'text', options);
  if (key === '项目角色') return source(field, `projectExperience[${field.recordIndex}].role`, item?.role, 'text', options);
  if (key === '项目链接') return source(field, `projectExperience[${field.recordIndex}].link`, item?.link, 'text', options);
  if (key === '描述' || key === '项目描述') {
    const value = joinText([item?.description, ...(item?.achievements || [])], '\n');
    return source(field, `projectExperience[${field.recordIndex}].description + achievements`, value, 'text', options);
  }
  return source(field, null, undefined, 'manual', { ...options, reason: '该项目字段在 resume.json 中没有可靠来源' });
}

function mapPortfolio(field, resume, options) {
  const { item } = arrayItem(resume, 'portfolio', field.recordIndex);
  const key = LABEL(field);
  if (key === '作品链接') return source(field, `portfolio[${field.recordIndex}].link`, item?.link, 'text', options);
  if (key === '描述') return source(field, `portfolio[${field.recordIndex}].description`, item?.description, 'text', options);
  return source(field, null, undefined, 'manual', { ...options, reason: '作品附件必须手动处理' });
}

function mapAward(field, resume, options) {
  const { item } = arrayItem(resume, 'awards', field.recordIndex);
  const key = LABEL(field);
  if (key === '获奖名称') return source(field, `awards[${field.recordIndex}].name`, item?.name, 'text', options);
  if (key === '获奖时间') return source(field, `awards[${field.recordIndex}].date`, item?.date, 'date', options);
  if (key === '描述') return source(field, `awards[${field.recordIndex}].description`, item?.description, 'text', options);
  return source(field, null, undefined, 'manual', { ...options, reason: '该获奖字段在 resume.json 中没有可靠来源' });
}

function mapLanguage(field, resume, options) {
  const { item } = arrayItem(resume, 'language', field.recordIndex);
  const key = LABEL(field);
  if (key === '语言') return source(field, `languages[${field.recordIndex}].language`, item?.language, 'select', { ...options, needsConfirmation: true });
  if (key === '精通程度') return source(field, `languages[${field.recordIndex}].proficiency`, item?.proficiency, 'select', { ...options, needsConfirmation: true });
  return source(field, null, undefined, 'manual', { ...options, reason: '该语言字段在 resume.json 中没有可靠来源' });
}

export function mapFeishuForm(form, resume, { showValues = false } = {}) {
  return form.fields.map((field) => {
    if (field.controlKind === 'file') return result(field, { status: 'manual', method: 'file', resumePath: null, reason: '附件上传必须由用户手动完成' }, { showValues });
    switch (field.sectionKind) {
      case 'basic': return mapBasic(field, resume, { showValues });
      case 'education': return mapEducation(field, resume, { showValues });
      case 'work': return mapWork(field, resume, { showValues });
      case 'project': return mapProject(field, resume, { showValues });
      case 'portfolio': return mapPortfolio(field, resume, { showValues });
      case 'awards': return mapAward(field, resume, { showValues });
      case 'language': return mapLanguage(field, resume, { showValues });
      case 'evaluation': {
        const path = !isEmpty(resume.selfEvaluation) ? 'selfEvaluation' : 'basic.selfEvaluation';
        return source(field, path, getValue(resume, path), 'text', { showValues });
      }
      default: return source(field, null, undefined, 'manual', { showValues, reason: '当前 resume.json 没有该分区的可靠来源' });
    }
  });
}

export function summarizeFeishuMappings(mappings) {
  return mappings.reduce((summary, item) => {
    summary[item.status] = (summary[item.status] || 0) + 1;
    return summary;
  }, {});
}

export function requiredFeishuRecordCounts(resume) {
  return {
    ...Object.fromEntries(Object.entries(ARRAY_PATHS)
      .map(([sectionKind, path]) => [sectionKind, Array.isArray(resume[path]) ? resume[path].length : 0])),
    evaluation: isEmpty(resume.selfEvaluation) && isEmpty(resume.basic?.selfEvaluation) ? 0 : 1,
  };
}

/**
 * Build a value-bearing preview for records that are not rendered yet. The
 * returned locators are only used after expandFeishuSections has materialized
 * those records; before that this function is strictly non-mutating.
 */
export function planFeishuMappings(form, resume, { showValues = false } = {}) {
  const required = requiredFeishuRecordCounts(resume);
  const fields = [...form.fields];
  for (const section of form.sections || []) {
    const targetCount = required[section.sectionKind] || 0;
    if (!section.dynamicSection || targetCount <= section.recordCount) continue;
    let templates = fields.filter((field) => (
      field.sectionKind === section.sectionKind && field.recordIndex === 0
    ));
    if (!templates.length) templates = templateFields(section);
    for (let recordIndex = section.recordCount; recordIndex < targetCount; recordIndex += 1) {
      for (const template of templates) {
        fields.push({
          ...template,
          fieldId: `${template.sectionKind}:${recordIndex}:${template.fieldName}:${template.controlIndex}`,
          recordIndex,
          locator: {
            ...template.locator,
            recordIndex,
          },
        });
      }
    }
  }
  return mapFeishuForm({ ...form, fields }, resume, { showValues });
}

export function formatFeishuDate(value) {
  return formatMonth(value);
}
