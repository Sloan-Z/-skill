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

function matches(field, aliases) {
  const label = normalize(field.label);
  const expected = aliases.map(normalize);
  if (label) return expected.some((alias) => {
    if (label === alias) return true;
    if (!label.startsWith(alias)) return false;
    return /^(请|建议|提示|确保|务必)/.test(label.slice(alias.length));
  });
  const fallback = [field.placeholder, field.name].map(normalize).filter(Boolean);
  return expected.some((alias) => fallback.some((candidate) => candidate === alias || candidate.startsWith(alias)));
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
  const { showValues = false, status, reason, needsConfirmation = false } = options;
  const base = { resumePath: path || null, method, reason };
  if (status) return result(field, { ...base, status }, options);
  if (field.controlKind === 'password') {
    return result(field, { ...base, status: 'manual', reason: '密码字段禁止自动填写' }, options);
  }
  if (field.disabled || (field.readonly && !['custom-select', 'date', 'date-range'].includes(field.controlKind))) {
    return result(field, { ...base, status: 'blocked', reason: reason || '控件不可编辑' }, options);
  }
  if (isEmpty(value)) {
    return result(field, { ...base, status: 'missing', reason: reason || 'resume.json 中没有对应信息' }, options);
  }
  if (field.hasValue) {
    return result(field, { ...base, status: 'filled-skip', reason: '页面已有内容，默认不覆盖' }, options);
  }
  if (['date', 'date-range', 'file'].includes(method)) {
    return result(field, {
      ...base,
      status: 'manual',
      reason: reason || (method === 'file' ? '附件必须由用户手动处理' : '日期控件保留手动填写'),
    }, options);
  }
  if (needsConfirmation || ['select', 'radio', 'checkbox'].includes(method)) {
    return result(field, {
      ...base,
      status: 'needs-confirmation',
      value,
      reason: reason || '自定义选项控件需要逐字段确认',
    }, options);
  }
  return result(field, { ...base, status: 'ready', value }, options);
}

function optionSource(field, path, value, options) {
  if (isEmpty(value)) return source(field, path, value, methodFor(field), options);
  if (field.controlText && normalize(field.controlText) !== normalize(value)) {
    return source(field, path, undefined, methodFor(field), {
      ...options,
      status: 'skip',
      reason: '不是目标选项',
    });
  }
  return source(field, path, value, methodFor(field), options);
}

function dateRangeValue(field, item, startPath, endPath, options) {
  const isStart = field.controlIndex % 2 === 0;
  const path = isStart ? startPath : endPath;
  const value = formatMonth(isStart ? item?.startTime : item?.endTime);
  return source(field, path, value, 'date-range', options);
}

function mapBasic(field, resume, options) {
  if (matches(field, ['年龄'])) {
    return source(field, 'basic.birthDate', ageFromBirthDate(resume.basic?.birthDate), methodFor(field), {
      ...options,
      reason: '年龄仅由用户明确提供的完整出生日期计算',
    });
  }
  const definitions = [
    [['姓名', '真实姓名'], 'basic.name'],
    [['手机号码', '联系电话', '电话'], 'basic.phone'],
    [['邮箱', '电子邮箱'], 'basic.email'],
    [['性别'], 'basic.gender'],
    [['出生日期'], 'basic.birthDate'],
    [['当前所处地', '所在地点', '所在地', '现居城市', '当前城市', '当前居住城市'], 'basic.currentCity'],
    [['家乡', '籍贯'], 'basic.hometownCity'],
    [['期望工作地点', '意向城市', '期望城市'], 'basic.preferredCities[0]'],
    [['政治面貌'], 'basic.politicalStatus'],
  ];
  const found = definitions.find(([aliases]) => matches(field, aliases));
  if (!found) return source(field, null, undefined, 'manual', { ...options, reason: '基础字段没有可靠的履历来源' });
  const [, path] = found;
  const value = getValue(resume, path);
  if (field.controlKind === 'radio' || field.controlKind === 'checkbox') return optionSource(field, path, value, options);
  return source(field, path, value, methodFor(field), options);
}

function mapEducation(field, resume, options) {
  const index = field.recordIndex || 0;
  const item = resume.education?.[index];
  if (matches(field, ['起止时间', '在校时间'])) {
    return dateRangeValue(field, item, `education[${index}].startTime`, `education[${index}].endTime`, options);
  }
  const definitions = [
    [['学校名称', '学校', '院校'], 'school'],
    [['学院名称', '院系', '所在院系/研究所'], 'college'],
    [['专业名称', '专业'], 'major'],
    [['学历', '学位'], 'degree'],
    [['开始时间', '入学时间'], 'startTime'],
    [['毕业时间', '结束时间'], 'endTime'],
    [['成绩排名', '年级成绩排名'], 'rank'],
    [['绩点', 'GPA-GPA'], 'gpa'],
    [['学历类型', '培养方式', '受教育类型'], 'educationType'],
  ];
  const found = definitions.find(([aliases]) => matches(field, aliases));
  if (!found) return source(field, null, undefined, 'manual', { ...options, reason: '教育字段没有可靠的履历来源' });
  const [, property] = found;
  const path = `education[${index}].${property}`;
  let value = item?.[property];
  if (['startTime', 'endTime'].includes(property)) value = formatMonth(value);
  return source(field, path, value, methodFor(field), options);
}

function mapWork(field, resume, options) {
  const index = field.recordIndex || 0;
  const item = resume.workExperience?.[index];
  if (matches(field, ['起止时间', '在职时间'])) {
    return dateRangeValue(field, item, `workExperience[${index}].startTime`, `workExperience[${index}].endTime`, options);
  }
  const definitions = [
    [['公司名称', '公司', '实习公司'], 'company'],
    [['职位名称', '职位', '担任岗位'], 'title'],
    [['所在部门', '部门名称', '任职部门'], 'department'],
    [['开始时间'], 'startTime'],
    [['结束时间'], 'endTime'],
    [['工作描述', '工作职责', '描述'], 'achievements'],
  ];
  const found = definitions.find(([aliases]) => matches(field, aliases));
  if (!found) return source(field, null, undefined, 'manual', { ...options, reason: '工作字段没有可靠的履历来源' });
  const [, property] = found;
  const path = `workExperience[${index}].${property}`;
  let value = item?.[property];
  if (property === 'achievements') value = joinText(value, '\n');
  if (['startTime', 'endTime'].includes(property)) value = formatMonth(value);
  return source(field, path, value, methodFor(field), options);
}

function mapProject(field, resume, options) {
  const index = field.recordIndex || 0;
  const item = resume.projectExperience?.[index];
  if (matches(field, ['起止时间', '项目时间'])) {
    return dateRangeValue(field, item, `projectExperience[${index}].startTime`, `projectExperience[${index}].endTime`, options);
  }
  const definitions = [
    [['项目名称'], 'name'],
    [['项目角色', '在项目中担任的角色'], 'role'],
    [['项目链接'], 'link'],
    [['开始时间'], 'startTime'],
    [['结束时间'], 'endTime'],
    [['项目描述', '项目职责', '描述'], 'description'],
  ];
  const found = definitions.find(([aliases]) => matches(field, aliases));
  if (!found) return source(field, null, undefined, 'manual', { ...options, reason: '项目字段没有可靠的履历来源' });
  const [, property] = found;
  const path = `projectExperience[${index}].${property}`;
  let value = item?.[property];
  if (property === 'description') value = joinText([item?.description, ...(item?.achievements || [])], '\n');
  if (['startTime', 'endTime'].includes(property)) value = formatMonth(value);
  return source(field, path, value, methodFor(field), options);
}

function mapCampus(field, resume, options) {
  const index = field.recordIndex || 0;
  const item = resume.campusExperience?.[index];
  if (matches(field, ['起止时间', '校园经历时间'])) {
    return dateRangeValue(field, item, `campusExperience[${index}].startTime`, `campusExperience[${index}].endTime`, options);
  }
  const definitions = [
    [['校园经历名称', '组织名称', '活动名称'], 'organization'],
    [['角色', '担任职务'], 'role'],
    [['校园经历描述', '活动描述', '描述'], 'description'],
  ];
  const found = definitions.find(([aliases]) => matches(field, aliases));
  if (!found) return source(field, null, undefined, 'manual', { ...options, reason: '校园经历字段没有可靠来源' });
  const [, property] = found;
  return source(field, `campusExperience[${index}].${property}`, item?.[property], methodFor(field), options);
}

function mapAward(field, resume, options) {
  const index = field.recordIndex || 0;
  const item = resume.awards?.[index];
  const definitions = [
    [['荣誉名称', '获奖名称', '奖项名称', '获奖项'], 'name'],
    [['获奖级别', '荣誉级别'], 'level'],
    [['获奖时间', '获得时间'], 'date'],
    [['荣誉描述', '获奖描述', '奖项说明'], 'description'],
  ];
  const found = definitions.find(([aliases]) => matches(field, aliases));
  if (!found) return source(field, null, undefined, 'manual', { ...options, reason: '获奖字段没有可靠来源' });
  const [, property] = found;
  return source(field, `awards[${index}].${property}`, item?.[property], methodFor(field), options);
}

function mapLanguage(field, resume, options) {
  const index = field.recordIndex || 0;
  const item = resume.languages?.[index];
  const definitions = [
    [['语言', '语言类别', '英语证书名称'], 'language'],
    [['精通程度', '掌握程度', '听说能力', '读写能力'], 'proficiency'],
    [['成绩', '考试分数', '分数'], 'score'],
  ];
  const found = definitions.find(([aliases]) => matches(field, aliases));
  if (!found) return source(field, null, undefined, 'manual', { ...options, reason: '语言字段没有可靠来源' });
  const [, property] = found;
  return source(field, `languages[${index}].${property}`, item?.[property], methodFor(field), options);
}

function mapCertificate(field, resume, options) {
  const index = field.recordIndex || 0;
  const item = resume.certificates?.[index];
  const property = matches(field, ['证书名称']) ? 'name'
    : matches(field, ['获得时间']) ? 'date'
      : matches(field, ['证书描述']) ? 'description' : null;
  if (!property) return source(field, null, undefined, 'manual', { ...options, reason: '证书字段没有可靠来源' });
  return source(field, `certificates[${index}].${property}`, item?.[property], methodFor(field), options);
}

function mapPortfolio(field, resume, options) {
  const index = field.recordIndex || 0;
  const item = resume.portfolio?.[index];
  const property = matches(field, ['作品名称']) ? 'name'
    : matches(field, ['作品链接', '个人主页超链接']) ? 'link'
      : matches(field, ['描述']) ? 'description' : null;
  if (!property) return source(field, null, undefined, 'manual', { ...options, reason: '作品文件必须手动处理' });
  return source(field, `portfolio[${index}].${property}`, item?.[property], methodFor(field), options);
}

function mapSkills(field, resume, options) {
  const values = Object.values(resume.skills || {}).flatMap((items) => Array.isArray(items) ? items : []);
  return source(field, 'skills.*', joinText(values, '、'), methodFor(field), {
    ...options,
    needsConfirmation: true,
    reason: '网站字段可能要求单项技能，需要确认是否合并填写',
  });
}

export function mapSemanticForm(form, resume, { showValues = false } = {}) {
  return form.fields.map((field) => {
    const options = { showValues };
    if (field.controlKind === 'file' || field.type === 'file' || field.sectionKind === 'attachment') {
      return result(field, { status: 'manual', method: 'file', resumePath: null, reason: '附件必须由用户手动上传' }, options);
    }
    if (!field.label && /搜索/.test(field.placeholder || '')) {
      return result(field, { status: 'skip', method: 'skip', resumePath: null, reason: '页面搜索框，不属于履历' }, options);
    }
    switch (field.sectionKind) {
      case 'basic': return mapBasic(field, resume, options);
      case 'education': return mapEducation(field, resume, options);
      case 'work': return mapWork(field, resume, options);
      case 'project': return mapProject(field, resume, options);
      case 'campus': return mapCampus(field, resume, options);
      case 'awards': return mapAward(field, resume, options);
      case 'language': return mapLanguage(field, resume, options);
      case 'certificates': return mapCertificate(field, resume, options);
      case 'portfolio': return mapPortfolio(field, resume, options);
      case 'skills': return mapSkills(field, resume, options);
      case 'evaluation': {
        const path = !isEmpty(resume.selfEvaluation) ? 'selfEvaluation' : 'basic.selfEvaluation';
        return source(field, path, getValue(resume, path), methodFor(field), options);
      }
      case 'family':
      case 'contact': return source(field, null, undefined, methodFor(field), { ...options, reason: '简历中没有该隐私字段，必须由用户决定' });
      default: return source(field, null, undefined, 'manual', { ...options, reason: '无法安全识别字段分区' });
    }
  });
}

export function planSemanticMappings(form, resume, options = {}) {
  const required = requiredSemanticRecordCounts(resume);
  const fields = [...form.fields];
  for (const section of form.sections || []) {
    const target = required[section.sectionKind] || 0;
    if (!section.dynamicSection || !section.recordCount || target <= section.recordCount) continue;
    const templates = fields.filter((field) => field.sectionIndex === section.sectionIndex && field.recordIndex === 0);
    for (let recordIndex = section.recordCount; recordIndex < target; recordIndex += 1) {
      for (const template of templates) {
        fields.push({
          ...template,
          fieldId: `${template.sectionKind}:${recordIndex}:${template.fieldIndex}:${template.controlIndex}`,
          recordIndex,
          hasValue: false,
          checked: false,
          locator: {
            ...template.locator,
            record: template.locator.record ? { ...template.locator.record, index: recordIndex } : null,
          },
        });
      }
    }
  }
  return mapSemanticForm({ ...form, fields }, resume, options);
}

export function summarizeSemanticMappings(mappings) {
  return mappings.reduce((summary, item) => {
    summary[item.status] = (summary[item.status] || 0) + 1;
    return summary;
  }, {});
}
