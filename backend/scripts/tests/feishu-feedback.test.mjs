import assert from 'node:assert/strict';
import { mapFeishuForm } from '../lib/feishu-resume-mapper.mjs';
import {
  applyResumeAnswers,
  buildMissingFieldReport,
} from '../../../scripts/resume-feedback.mjs';

const resume = {
  schemaVersion: 1,
  status: 'confirmed',
  basic: {
    name: 'Test User', phone: '13800000000', email: 'test@example.com', gender: null,
    birthDate: null, currentCity: null, hometownCity: null, preferredCities: [], availability: null,
  },
  education: [{
    school: 'School A', college: null, degree: '本科', major: 'Major A', schoolType: [],
    startTime: '2020-09', endTime: '2024-06', current: false, rank: null, gpa: null, educationType: null,
  }],
  workExperience: [{
    company: 'Company A', title: 'Intern', startTime: '2025-01', endTime: '2025-03', current: false,
    projectName: null, projectBackground: 'Background', achievements: ['Did A', 'Did B'],
  }],
  projectExperience: [{
    name: 'Project A', role: 'Owner', startTime: null, endTime: null, current: false, link: null,
    description: 'Built A', achievements: ['Improved B'], technologies: [],
  }],
  portfolio: [], campusExperience: [], awards: [], languages: [], certificates: [], skills: {}, selfEvaluation: null,
  review: {
    missingFields: ['basic.gender', 'basic.birthDate', 'basic.currentCity', 'basic.preferredCities'],
    uncertainties: [], normalizations: [],
  },
};

function field(overrides) {
  return {
    fieldId: 'field', sourceFieldId: 'source', fieldName: 'field', label: '', sectionKind: 'unknown',
    sectionTitle: '', sectionIndex: 0, recordIndex: 0, controlIndex: 0, controlKind: 'text',
    disabled: false, readonly: false, required: false, hasValue: false,
    locator: { strategy: 'feishu-field' },
    ...overrides,
  };
}

const mappings = mapFeishuForm({ fields: [
  field({ fieldId: 'age', fieldName: 'age', label: '年龄', sectionKind: 'basic' }),
  field({ fieldId: 'city', fieldName: 'location', label: '所在地点', sectionKind: 'basic', controlKind: 'select', readonly: true }),
  field({ fieldId: 'education-type', fieldName: 'education_type', label: '学历类型', sectionKind: 'education', controlKind: 'select', readonly: true }),
  field({ fieldId: 'work-desc', fieldName: 'desc', label: '描述', sectionKind: 'work' }),
  field({ fieldId: 'project-start', fieldName: 'start_end_time', label: '起止时间', sectionKind: 'project', controlKind: 'date-range', controlIndex: 0 }),
  field({ fieldId: 'project-end', fieldName: 'start_end_time', label: '起止时间', sectionKind: 'project', controlKind: 'date-range', controlIndex: 1 }),
  field({ fieldId: 'project-desc', fieldName: 'desc', label: '描述', sectionKind: 'project' }),
] }, resume, { showValues: true });

const byId = Object.fromEntries(mappings.map((item) => [item.fieldId, item]));
assert.equal(byId.age.status, 'missing');
assert.equal(byId.age.resumePath, 'basic.birthDate');
assert.equal(byId.city.resumePath, 'basic.currentCity');
assert.equal(byId['education-type'].resumePath, 'education[0].educationType');
assert.equal(byId['work-desc'].status, 'ready');
assert.equal(byId['work-desc'].valuePreview, 'Did A\nDid B');
assert.equal(byId['project-desc'].status, 'ready');
assert.equal(byId['project-desc'].valuePreview, 'Built A\nImproved B');
assert.equal(byId['project-start'].status, 'missing');
assert.equal(byId['project-start'].resumePath, 'projectExperience[0].startTime');
assert.equal(byId['project-end'].resumePath, 'projectExperience[0].endTime');

const report = buildMissingFieldReport(resume, mappings);
assert.equal(report.questions.filter((item) => item.path === 'basic.birthDate').length, 1, 'age and birth date must produce one canonical question');
assert.ok(report.questions.some((item) => item.path === 'basic.currentCity'));
assert.ok(report.questions.some((item) => item.path === 'education[0].educationType'));
assert.ok(report.questions.some((item) => item.path === 'projectExperience[0].startTime'));
assert.ok(!report.questions.some((item) => item.path === 'workExperience[0].achievements'));

const applied = applyResumeAnswers(resume, { answers: [
  { path: 'basic.birthDate', value: '2000/01/02' },
  { path: 'basic.currentCity', value: 'City A' },
  { path: 'basic.preferredCities', value: 'City A，City B' },
  { path: 'projectExperience[0].startTime', value: '2025.04' },
  { path: 'projectExperience[0].link', action: 'not-applicable' },
] });
assert.equal(applied.resume.status, 'draft');
assert.equal(applied.resume.basic.birthDate, '2000-01-02');
assert.deepEqual(applied.resume.basic.preferredCities, ['City A', 'City B']);
assert.equal(applied.resume.projectExperience[0].startTime, '2025-04');
assert.equal(resume.basic.birthDate, null, 'input resume must not be mutated');
assert.ok(applied.resume.review.userProvidedFields.includes('basic.birthDate'));
assert.ok(applied.resume.review.notApplicableFields.includes('projectExperience[0].link'));
assert.ok(!buildMissingFieldReport(applied.resume, mappings).questions.some((item) => item.path === 'projectExperience[0].link'));

assert.throws(() => applyResumeAnswers(applied.resume, { answers: [
  { path: 'basic.currentCity', value: 'City C' },
] }), /已有值/);

console.log('feishu and feedback tests passed');
