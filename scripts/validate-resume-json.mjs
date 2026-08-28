import fs from 'node:fs/promises';
import path from 'node:path';

const OBJECT = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const STRING_OR_NULL = (value) => value === null || typeof value === 'string';
const DATE_PATTERN = /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/;

function addIssue(list, issuePath, message) {
  list.push({ path: issuePath, message });
}

function checkString(object, key, issuePath, errors) {
  if (Object.hasOwn(object, key) && !STRING_OR_NULL(object[key])) {
    addIssue(errors, `${issuePath}.${key}`, 'must be a string or null');
  }
}

function checkStringArray(value, issuePath, errors) {
  if (!Array.isArray(value)) {
    addIssue(errors, issuePath, 'must be an array');
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string') addIssue(errors, `${issuePath}[${index}]`, 'must be a string');
  });
}

function checkDate(value, issuePath, errors, warnings) {
  if (value === null || value === undefined || value === '') return;
  if (typeof value !== 'string') {
    addIssue(errors, issuePath, 'must be a canonical date string or null');
  } else if (!DATE_PATTERN.test(value)) {
    addIssue(warnings, issuePath, 'should use YYYY-MM or YYYY');
  }
}

function checkObjectArray(root, key, errors, warnings, validateItem) {
  const value = root[key];
  if (!Array.isArray(value)) {
    addIssue(errors, key, 'must be an array');
    return 0;
  }
  value.forEach((item, index) => {
    const itemPath = `${key}[${index}]`;
    if (!OBJECT(item)) {
      addIssue(errors, itemPath, 'must be an object');
      return;
    }
    validateItem(item, itemPath, errors, warnings);
  });
  return value.length;
}

function checkCommonPeriod(item, itemPath, errors, warnings) {
  checkDate(item.startTime, `${itemPath}.startTime`, errors, warnings);
  checkDate(item.endTime, `${itemPath}.endTime`, errors, warnings);
  if (Object.hasOwn(item, 'current') && typeof item.current !== 'boolean') {
    addIssue(errors, `${itemPath}.current`, 'must be a boolean');
  }
  if (item.current === true && item.endTime) {
    addIssue(warnings, `${itemPath}.endTime`, 'should be null when current is true');
  }
}

export function validateResumeJson(resume, { requireConfirmed = false } = {}) {
  const errors = [];
  const warnings = [];
  const counts = {};

  if (!OBJECT(resume)) {
    addIssue(errors, '$', 'resume JSON must be an object');
    return { valid: false, errors, warnings, summary: { status: null, schemaVersion: null, counts } };
  }

  if (resume.schemaVersion === undefined) {
    addIssue(warnings, 'schemaVersion', 'legacy file: schemaVersion is missing');
  } else if (resume.schemaVersion !== 1) {
    addIssue(errors, 'schemaVersion', 'only schemaVersion 1 is supported');
  }

  if (resume.status === undefined) {
    addIssue(warnings, 'status', 'legacy file: confirmation status is missing');
  } else if (!['draft', 'confirmed'].includes(resume.status)) {
    addIssue(errors, 'status', 'must be draft or confirmed');
  } else if (requireConfirmed && resume.status !== 'confirmed') {
    addIssue(errors, 'status', 'draft resume must be reviewed before external form filling');
  }

  if (!OBJECT(resume.basic)) {
    addIssue(errors, 'basic', 'must be an object');
  } else {
    for (const key of ['name', 'phone', 'email', 'gender', 'birthDate', 'currentCity', 'hometownCity', 'availability', 'politicalStatus']) {
      checkString(resume.basic, key, 'basic', errors);
    }
    if (typeof resume.basic.birthDate === 'string' && !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(resume.basic.birthDate)) {
      addIssue(warnings, 'basic.birthDate', 'should use YYYY-MM-DD when a full birth date is provided');
    }
    if (!resume.basic.name) addIssue(warnings, 'basic.name', 'name is missing');
    if (resume.basic.preferredCities !== undefined) {
      checkStringArray(resume.basic.preferredCities, 'basic.preferredCities', errors);
    }
    if (typeof resume.basic.email === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resume.basic.email)) {
      addIssue(warnings, 'basic.email', 'email format looks unusual');
    }
    if (typeof resume.basic.phone === 'string') {
      const digits = resume.basic.phone.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 20) addIssue(warnings, 'basic.phone', 'phone format looks unusual');
    }
  }

  counts.education = checkObjectArray(resume, 'education', errors, warnings, (item, itemPath, itemErrors, itemWarnings) => {
    for (const key of ['school', 'college', 'degree', 'major', 'rank', 'gpa', 'educationType']) checkString(item, key, itemPath, itemErrors);
    if (item.schoolType !== undefined) checkStringArray(item.schoolType, `${itemPath}.schoolType`, itemErrors);
    checkCommonPeriod(item, itemPath, itemErrors, itemWarnings);
    if (!item.school) addIssue(itemWarnings, `${itemPath}.school`, 'school is missing');
  });

  counts.workExperience = checkObjectArray(resume, 'workExperience', errors, warnings, (item, itemPath, itemErrors, itemWarnings) => {
    for (const key of ['company', 'title', 'projectName', 'projectBackground']) checkString(item, key, itemPath, itemErrors);
    if (item.achievements !== undefined) checkStringArray(item.achievements, `${itemPath}.achievements`, itemErrors);
    checkCommonPeriod(item, itemPath, itemErrors, itemWarnings);
    if (!item.company) addIssue(itemWarnings, `${itemPath}.company`, 'company is missing');
  });

  counts.projectExperience = checkObjectArray(resume, 'projectExperience', errors, warnings, (item, itemPath, itemErrors, itemWarnings) => {
    for (const key of ['name', 'role', 'link', 'description']) checkString(item, key, itemPath, itemErrors);
    for (const key of ['achievements', 'technologies']) {
      if (item[key] !== undefined) checkStringArray(item[key], `${itemPath}.${key}`, itemErrors);
    }
    checkCommonPeriod(item, itemPath, itemErrors, itemWarnings);
    if (!item.name) addIssue(itemWarnings, `${itemPath}.name`, 'project name is missing');
  });

  const optionalArrays = {
    portfolio: ['name', 'link', 'description'],
    campusExperience: ['organization', 'role', 'description'],
    awards: ['name', 'level', 'description'],
    languages: ['language', 'proficiency', 'score'],
    certificates: ['name', 'description'],
  };
  for (const [key, stringKeys] of Object.entries(optionalArrays)) {
    if (resume[key] === undefined) {
      addIssue(warnings, key, 'recommended canonical array is missing');
      counts[key] = 0;
      continue;
    }
    counts[key] = checkObjectArray(resume, key, errors, warnings, (item, itemPath, itemErrors, itemWarnings) => {
      for (const stringKey of stringKeys) checkString(item, stringKey, itemPath, itemErrors);
      for (const dateKey of ['date', 'startTime', 'endTime']) checkDate(item[dateKey], `${itemPath}.${dateKey}`, itemErrors, itemWarnings);
      if (Object.hasOwn(item, 'current') && typeof item.current !== 'boolean') addIssue(itemErrors, `${itemPath}.current`, 'must be a boolean');
    });
  }

  if (resume.skills !== undefined) {
    if (!OBJECT(resume.skills)) {
      addIssue(errors, 'skills', 'must be an object');
    } else {
      for (const [key, value] of Object.entries(resume.skills)) checkStringArray(value, `skills.${key}`, errors);
    }
  }
  if (resume.selfEvaluation !== undefined && !STRING_OR_NULL(resume.selfEvaluation)) {
    addIssue(errors, 'selfEvaluation', 'must be a string or null');
  }

  if (resume.review !== undefined) {
    if (!OBJECT(resume.review)) {
      addIssue(errors, 'review', 'must be an object');
    } else {
      if (resume.review.missingFields !== undefined) checkStringArray(resume.review.missingFields, 'review.missingFields', errors);
      if (resume.review.userProvidedFields !== undefined) checkStringArray(resume.review.userProvidedFields, 'review.userProvidedFields', errors);
      if (resume.review.notApplicableFields !== undefined) checkStringArray(resume.review.notApplicableFields, 'review.notApplicableFields', errors);
      for (const key of ['uncertainties', 'normalizations']) {
        if (resume.review[key] !== undefined && !Array.isArray(resume.review[key])) addIssue(errors, `review.${key}`, 'must be an array');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      schemaVersion: resume.schemaVersion ?? null,
      status: resume.status ?? 'legacy',
      counts,
    },
  };
}

function getOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function defaultResumePath() {
  const current = path.resolve(process.cwd(), 'resume.json');
  return current;
}

async function main() {
  const args = process.argv.slice(2);
  const resumePath = getOption(args, '--resume')
    || args.find((arg) => !arg.startsWith('-'))
    || process.env.RESUME_PATH
    || await defaultResumePath();
  const requireConfirmed = args.includes('--require-confirmed');
  const jsonOnly = args.includes('--json');
  const resume = JSON.parse(await fs.readFile(resumePath, 'utf8'));
  const report = validateResumeJson(resume, { requireConfirmed });

  if (jsonOnly) {
    console.log(JSON.stringify({ file: path.resolve(resumePath), ...report }, null, 2));
  } else {
    console.log(`${report.valid ? 'VALID' : 'INVALID'}: ${path.resolve(resumePath)}`);
    console.log(`schema=${report.summary.schemaVersion ?? 'legacy'} status=${report.summary.status} counts=${JSON.stringify(report.summary.counts)}`);
    for (const issue of report.errors) console.log(`ERROR ${issue.path}: ${issue.message}`);
    for (const issue of report.warnings) console.log(`WARN  ${issue.path}: ${issue.message}`);
  }
  if (!report.valid) process.exitCode = 1;
}

if (import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((error) => {
    console.error(`INVALID: ${error.message}`);
    process.exitCode = 1;
  });
}
