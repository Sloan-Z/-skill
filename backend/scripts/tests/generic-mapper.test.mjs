import assert from 'node:assert/strict';
import { mapGenericForm, planGenericMappings, summarizeGenericMappings } from '../lib/generic-resume-mapper.mjs';

const resume = {
  basic: {
    name: 'Test User',
    phone: '13800000000',
    email: 'test@example.com',
    gender: '男',
    birthDate: '2000-01-02',
    currentCity: '西安',
    preferredCities: ['北京'],
  },
  education: [{
    school: 'School A', college: 'College A', major: 'Major A', degree: '本科',
    startTime: '2020-09', endTime: '2024-06',
  }],
  workExperience: [{ company: 'Company A', title: 'Intern', achievements: ['Did A', 'Did B'] }],
  projectExperience: [{
    name: 'Project A', role: 'Owner', description: 'Built A', achievements: ['Improved B'],
  }],
  campusExperience: [],
  awards: [],
  languages: [],
  certificates: [],
  portfolio: [],
  skills: { frontend: ['React', 'TypeScript'] },
  selfEvaluation: 'Self evaluation',
};

function field(overrides = {}) {
  return {
    fieldId: 'field', label: '', controlText: null, sectionTitle: '', sectionKind: 'unknown',
    sectionIndex: 0, recordIndex: 0, fieldIndex: 0, controlIndex: 0, required: false,
    maxLength: null, confidence: 0.96, locator: { strategy: 'generic-control', selector: '#field' },
    controlKind: 'text', disabled: false, readonly: false, hasValue: false, ...overrides,
  };
}

const form = {
  fields: [
    field({ fieldId: 'name', label: '姓名', sectionKind: 'basic' }),
    field({ fieldId: 'phone', label: '联系电话', sectionKind: 'basic' }),
    field({ fieldId: 'email', label: '邮箱地址', sectionKind: 'basic' }),
    field({ fieldId: 'gender-male', label: '性别', sectionKind: 'basic', controlKind: 'radio', controlText: '男' }),
    field({ fieldId: 'gender-female', label: '性别', sectionKind: 'basic', controlKind: 'radio', controlText: '女' }),
    field({ fieldId: 'school', label: '院校', sectionKind: 'education' }),
    field({ fieldId: 'major', label: '所学专业', sectionKind: 'education' }),
    field({ fieldId: 'degree', label: '学历层次', sectionKind: 'education', controlKind: 'native-select' }),
    field({ fieldId: 'work-desc', label: '实习描述', sectionKind: 'work' }),
    field({ fieldId: 'project-desc', label: '项目内容', sectionKind: 'project' }),
    field({ fieldId: 'project-start', label: '开始时间', sectionKind: 'project', controlKind: 'date' }),
    field({ fieldId: 'password', label: '登录密码', sectionKind: 'basic', controlKind: 'password', type: 'password' }),
    field({ fieldId: 'unknown', label: '紧急联系人姓名', sectionKind: 'unknown' }),
  ],
  sections: [],
};

const mapped = mapGenericForm(form, resume, { showValues: true });
const byId = Object.fromEntries(mapped.map((item) => [item.fieldId, item]));

assert.equal(byId.name.status, 'ready');
assert.equal(byId.name.resumePath, 'basic.name');
assert.equal(byId.phone.resumePath, 'basic.phone');
assert.equal(byId.email.resumePath, 'basic.email');
assert.equal(byId.school.resumePath, 'education[0].school');
assert.equal(byId.major.resumePath, 'education[0].major');
assert.equal(byId.degree.status, 'needs-confirmation');
assert.equal(byId['work-desc'].valuePreview, 'Did A\nDid B');
assert.equal(byId['project-desc'].valuePreview, 'Built A\nImproved B');
assert.equal(byId['project-start'].status, 'missing');
assert.equal(byId['project-start'].method, 'date');
assert.equal(byId['gender-male'].status, 'needs-confirmation');
assert.equal(byId['gender-female'].status, 'skip');
assert.equal(byId.password.status, 'manual');
assert.equal(byId.unknown.status, 'manual');

const lowConfidence = mapGenericForm({ fields: [field({
  fieldId: 'low', label: '姓名', sectionKind: 'basic', confidence: 0.55,
})] }, resume);
assert.equal(lowConfidence[0].status, 'needs-confirmation');

const planned = planGenericMappings({
  fields: [field({ fieldId: 'award-template', label: '奖项名称', sectionKind: 'awards', sectionIndex: 2 })],
  sections: [{ sectionIndex: 2, sectionKind: 'awards', recordCount: 1, dynamicSection: true }],
}, { ...resume, awards: [{ name: 'A' }, { name: 'B' }] });
assert.equal(planned.length, 1, 'generic preview must not synthesize locators for records not in the DOM');
assert.equal(planned[0].recordIndex, 0);
assert.equal(planned[0].resumePath, 'awards[0].name');

assert.deepEqual(summarizeGenericMappings(mapped), {
  ready: 7,
  'needs-confirmation': 2,
  skip: 1,
  missing: 1,
  manual: 2,
});

console.log('generic mapper tests passed');
