import assert from 'node:assert/strict';
import { mapSemanticForm, planSemanticMappings } from '../lib/semantic-resume-mapper.mjs';

const resume = {
  basic: { name: 'Test User', phone: '13800000000', email: 'test@example.com', gender: '男' },
  education: [
    { school: 'School A', major: 'Major A', degree: '本科', startTime: '2020-09', endTime: '2024-06' },
    { school: 'School B', major: 'Major B', degree: '硕士', startTime: '2024-09', endTime: '2027-06' },
  ],
  workExperience: [{ company: 'Company A', title: 'Intern', achievements: ['Did A'] }],
  projectExperience: [{ name: 'Project A', role: 'Owner', description: 'Built A' }],
  campusExperience: [],
  awards: [],
  languages: [],
  certificates: [],
  portfolio: [],
  skills: {},
};

function field(overrides = {}) {
  return {
    fieldId: 'field',
    label: '',
    placeholder: '',
    name: '',
    controlText: null,
    sectionTitle: '',
    sectionKind: 'unknown',
    sectionIndex: 0,
    recordIndex: 0,
    fieldIndex: 0,
    controlIndex: 0,
    controlKind: 'text',
    disabled: false,
    readonly: false,
    hasValue: false,
    locator: { strategy: 'semantic-field' },
    ...overrides,
  };
}

const mapped = mapSemanticForm({ fields: [
  field({ fieldId: 'name', sectionKind: 'basic', label: '姓名' }),
  field({ fieldId: 'existing-email', sectionKind: 'basic', label: '邮箱', hasValue: true }),
  field({ fieldId: 'emergency', sectionKind: 'basic', label: '紧急联系人', placeholder: '请输入紧急联系人姓名' }),
  field({ fieldId: 'gender-male', sectionKind: 'basic', label: '性别', controlKind: 'radio', controlText: '男' }),
  field({ fieldId: 'gender-female', sectionKind: 'basic', label: '性别', controlKind: 'radio', controlText: '女' }),
  field({ fieldId: 'school-2', sectionKind: 'education', label: '学校名称', recordIndex: 1 }),
  field({ fieldId: 'date-start', sectionKind: 'education', label: '起止时间', controlKind: 'date-range', controlIndex: 0 }),
  field({ fieldId: 'date-end', sectionKind: 'education', label: '起止时间', controlKind: 'date-range', controlIndex: 1 }),
] }, resume);

const byId = Object.fromEntries(mapped.map((item) => [item.fieldId, item]));
assert.equal(byId.name.status, 'ready');
assert.equal(byId.name.resumePath, 'basic.name');
assert.equal(byId['existing-email'].status, 'filled-skip');
assert.equal(byId.emergency.status, 'missing');
assert.equal(byId.emergency.resumePath, null);
assert.equal(byId['gender-male'].status, 'needs-confirmation');
assert.equal(byId['gender-female'].status, 'skip');
assert.equal(byId['school-2'].resumePath, 'education[1].school');
assert.equal(byId['date-start'].status, 'manual');
assert.equal(byId['date-start'].resumePath, 'education[0].startTime');
assert.equal(byId['date-end'].resumePath, 'education[0].endTime');

const template = field({
  fieldId: 'award-template',
  sectionKind: 'awards',
  sectionIndex: 4,
  label: '奖项名称',
  locator: { strategy: 'semantic-field', record: { selector: '.record', index: 0 } },
});
const planned = planSemanticMappings({
  fields: [template],
  sections: [{ sectionIndex: 4, sectionKind: 'awards', recordCount: 1, dynamicSection: true }],
}, { ...resume, awards: [{ name: 'A' }, { name: 'B' }] });
assert.equal(planned.length, 2);
assert.equal(planned[1].recordIndex, 1);
assert.equal(planned[1].resumePath, 'awards[1].name');
assert.equal(planned[1].locator.record.index, 1);

console.log('semantic mapper tests passed');
