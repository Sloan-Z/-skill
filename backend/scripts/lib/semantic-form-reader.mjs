import { verifyAdapterFingerprint } from './site-adapters.mjs';

const DEFAULT_CONTROL_SELECTOR = [
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="combobox"]',
  '[role="textbox"]',
  '[contenteditable="true"]',
].join(',');

function sectionRequirementKey(sectionKind) {
  return {
    education: 'education',
    work: 'workExperience',
    project: 'projectExperience',
    campus: 'campusExperience',
    awards: 'awards',
    language: 'languages',
    certificates: 'certificates',
    portfolio: 'portfolio',
  }[sectionKind];
}

export function requiredSemanticRecordCounts(resume) {
  const result = {};
  for (const kind of ['education', 'work', 'project', 'campus', 'awards', 'language', 'certificates', 'portfolio']) {
    const key = sectionRequirementKey(kind);
    result[kind] = Array.isArray(resume[key]) ? resume[key].length : 0;
  }
  return result;
}

export async function readSemanticForm(page, adapter, { includeValues = false } = {}) {
  const fingerprint = await verifyAdapterFingerprint(page, adapter);
  if (!fingerprint.valid) {
    const failed = fingerprint.checks.filter((check) => !check.valid);
    throw new Error(`页面结构与适配器 ${adapter.formSignature} 不匹配: ${failed.map((check) => check.selector).join(', ')}`);
  }

  const form = await page.evaluate(({ profile, exposeValues, formSignature, framework }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!element) return false;
      if (element.matches('input[type="file"]')) return true;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const unique = (values) => [...new Set(values.filter(Boolean))];
    const stripRequired = (value) => normalize(value)
      .replace(/[＊*]+/g, '')
      .replace(/必填$/g, '')
      .trim();
    const selectorList = (value) => Array.isArray(value) ? value : value ? [value] : [];
    const firstMatch = (scope, selectors) => {
      for (const selector of selectorList(selectors)) {
        const element = scope.querySelector(selector);
        if (element) return element;
      }
      return null;
    };
    const closestMatch = (element, selectors) => {
      for (const selector of selectorList(selectors)) {
        const match = element.closest(selector);
        if (match) return match;
      }
      return null;
    };
    const classifyTitle = (title) => {
      const value = stripRequired(title);
      const rules = [
        ['attachment', /附件|照片|证件照/],
        ['basic', /基本|基础|个人信息/],
        ['education', /教育|学历/],
        ['family', /亲属|家属/],
        ['work', /工作|实习/],
        ['project', /项目/],
        ['campus', /校园|校内|学生干部|社会实践/],
        ['language', /语言|英语/],
        ['skills', /技能/],
        ['certificates', /证书/],
        ['portfolio', /作品/],
        ['awards', /获奖|荣誉|竞赛/],
        ['evaluation', /评价|介绍/],
        ['contact', /联系人/],
      ];
      return rules.find(([, expression]) => expression.test(value))?.[0] || 'unknown';
    };
    const labelText = (item, control) => {
      const isOption = control.matches('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]');
      const direct = !isOption && control.labels?.[0] ? normalize(control.labels[0].textContent) : '';
      if (direct) return stripRequired(direct);
      const labelSelectors = profile.labelSelector || [
        '.el-form-item__label', '.brick-field-label', '.form-item__label',
        '.subtitle', '.mtd-form-item-label', 'label', '[class*="label"]',
      ];
      for (const selector of selectorList(labelSelectors)) {
        for (const element of item.querySelectorAll(selector)) {
          const text = stripRequired(element.textContent);
          if (text) return text;
        }
      }
      return stripRequired(
        control.getAttribute('aria-label')
        || control.getAttribute('placeholder')
        || control.getAttribute('name'),
      );
    };
    const optionText = (control) => {
      if (!control.matches('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]')) return null;
      return stripRequired(
        control.closest('label')?.textContent
        || control.getAttribute('aria-label')
        || control.parentElement?.textContent,
      );
    };
    const classifyControl = (control, item, label) => {
      if (control.matches('input[type="file"]')) return 'file';
      if (control.matches('input[type="password"]')) return 'password';
      if (control.matches('input[type="radio"], [role="radio"]')) return 'radio';
      if (control.matches('input[type="checkbox"], [role="checkbox"]')) return 'checkbox';
      if (control.matches('select')) return 'native-select';
      if (control.matches('textarea, [role="textbox"], [contenteditable="true"]')) return 'text';
      if (closestMatch(control, profile.dateRangeSelector || ['.brick-range-picker', '.el-date-editor--daterange'])
        || /起止时间|在校时间|在职时间|项目时间|经历时间/.test(label)) return 'date-range';
      if (closestMatch(control, profile.dateSelector || ['.brick-date-picker', '.el-date-editor', '[class*="date-picker"]'])
        || /出生日期|毕业时间|获奖时间|获得时间|开始时间|结束时间/.test(label)) return 'date';
      if (control.matches('[role="combobox"]')
        || closestMatch(control, profile.selectSelector || ['.brick-select', '.el-select', '.phoenix-select', '.mtd-select'])) return 'custom-select';
      return 'text';
    };
    const hasControlValue = (control, kind, item) => {
      if (kind === 'file' || kind === 'password') return false;
      if (kind === 'radio' || kind === 'checkbox') {
        return [...item.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]')]
          .some((option) => option.checked || option.getAttribute('aria-checked') === 'true');
      }
      if (kind === 'custom-select') {
        const container = closestMatch(control, profile.selectSelector || ['.brick-select', '.el-select', '.phoenix-select', '.mtd-select']);
        const selected = container?.querySelector(
          '.mtd-select-filter-label[title], .el-select__selected-item, .el-input__inner, .phoenix-select__input, [aria-selected="true"]',
        );
        return Boolean(normalize(('value' in control ? control.value : '') || selected?.textContent || selected?.getAttribute('title')));
      }
      return Boolean(normalize('value' in control ? control.value : control.textContent));
    };
    const sectionRules = profile.sections || [];
    const matchedSectionElements = [];
    const seenSections = new Set();
    for (const rule of sectionRules) {
      for (const element of document.querySelectorAll(rule.selector)) {
        if (rule.titleMatches) {
          const candidateTitle = stripRequired(
            firstMatch(element, rule.titleSelector || profile.sectionTitleSelector)?.textContent,
          );
          const expectedTitles = Array.isArray(rule.titleMatches) ? rule.titleMatches : [rule.titleMatches];
          if (!expectedTitles.some((expected) => candidateTitle === stripRequired(expected))) continue;
        }
        if (seenSections.has(element)) continue;
        seenSections.add(element);
        matchedSectionElements.push({ element, rule });
      }
    }
    if (!matchedSectionElements.length && profile.sectionContainer) {
      for (const element of document.querySelectorAll(profile.sectionContainer)) {
        matchedSectionElements.push({ element, rule: {} });
      }
    }
    if (!matchedSectionElements.length) matchedSectionElements.push({ element: document.body, rule: { kind: 'unknown', title: '页面' } });

    const fields = [];
    const sections = [];
    for (const { element: sectionElement, rule } of matchedSectionElements) {
      const sectionSelector = rule.selector || profile.sectionContainer || 'body';
      const sectionIndex = [...document.querySelectorAll(sectionSelector)].indexOf(sectionElement);
      const titleElement = firstMatch(sectionElement, rule.titleSelector || profile.sectionTitleSelector);
      const title = stripRequired(rule.title || titleElement?.textContent || '');
      const sectionKind = rule.kind || classifyTitle(title);
      const editorSelector = rule.editorSelector || profile.editorSelector || null;
      const editor = editorSelector ? sectionElement.querySelector(editorSelector) : null;
      const closed = Boolean(profile.editorMode === 'section-editor' && !rule.inline && !editor);
      const contentSelector = rule.contentSelector || profile.sectionContentSelector || null;
      const content = editor || (contentSelector ? sectionElement.querySelector(contentSelector) : null) || sectionElement;
      const recordSelector = rule.recordSelector || profile.recordSelector || null;
      let records = recordSelector ? [...content.querySelectorAll(recordSelector)] : [];
      records = records.filter((record) => visible(record) || profile.editorMode === 'section-editor');
      if (!records.length && !closed) records = [content];
      const section = {
        sectionIndex: sections.length,
        title,
        sectionKind,
        closed,
        recordCount: recordSelector ? records.length : (closed ? 0 : 1),
        dynamicSection: Boolean(rule.addAction || profile.addAction),
        addAction: rule.addAction || profile.addAction || null,
        editorAction: rule.editorAction || profile.editorAction || null,
        locator: { selector: sectionSelector, index: sectionIndex },
      };
      sections.push(section);
      if (closed) continue;

      records.forEach((record, recordIndex) => {
        const fieldSelector = rule.fieldSelector || profile.fieldSelector || '.form-item, .el-form-item, .brick-field';
        let items = [...record.querySelectorAll(fieldSelector)];
        items = items.filter((item) => !items.some((candidate) => candidate !== item && candidate.contains(item)));
        if (!items.length && record.matches(fieldSelector)) items = [record];
        items.forEach((item, fieldIndex) => {
          const controlSelector = rule.controlSelector || profile.controlSelector || DEFAULT_CONTROL_SELECTOR;
          let controls = [...item.querySelectorAll(controlSelector)];
          controls = controls.filter((control) => {
            if (!visible(control)) return false;
            return !controls.some((candidate) => candidate !== control && candidate.contains(control));
          });
          controls.forEach((control, controlIndex) => {
            const label = labelText(item, control);
            const controlKind = classifyControl(control, item, label);
            const field = {
              fieldId: `${sectionKind}:${recordIndex}:${fieldIndex}:${controlIndex}`,
              label,
              controlText: optionText(control),
              sectionTitle: title,
              sectionKind,
              sectionIndex: section.sectionIndex,
              recordIndex,
              fieldIndex,
              controlIndex,
              tag: control.tagName.toLowerCase(),
              type: control.getAttribute('type') || null,
              name: control.getAttribute('name') || null,
              id: control.id || null,
              placeholder: control.getAttribute('placeholder') || null,
              controlKind,
              disabled: Boolean(control.disabled || control.getAttribute('aria-disabled') === 'true'),
              readonly: Boolean(control.readOnly || control.getAttribute('aria-readonly') === 'true'),
              required: Boolean(control.required || item.matches('.is-required') || control.getAttribute('aria-required') === 'true'),
              maxLength: control.maxLength > 0 ? control.maxLength : null,
              checked: Boolean(control.checked || control.getAttribute('aria-checked') === 'true'),
              hasValue: hasControlValue(control, controlKind, item),
              locator: {
                strategy: 'semantic-field',
                section: { selector: sectionSelector, index: sectionIndex },
                scopeSelector: editorSelector || contentSelector,
                record: recordSelector ? { selector: recordSelector, index: recordIndex } : null,
                field: { selector: fieldSelector, index: fieldIndex },
                control: { selector: controlSelector, index: controlIndex },
              },
            };
            if (exposeValues && controlKind !== 'file' && controlKind !== 'password') {
              field.value = 'value' in control ? control.value : control.textContent || '';
            }
            fields.push(field);
          });
        });
      });
    }

    return {
      url: location.href,
      title: document.title,
      pageType: formSignature,
      framework,
      fields,
      sections,
      visibleButtons: unique([...document.querySelectorAll('button, [role="button"]')]
        .filter(visible)
        .map((button) => normalize(button.textContent)))
        .filter((text) => /保存|取消|上传|添加|新增|删除/.test(text)),
    };
  }, {
    profile: adapter.reader || {},
    exposeValues: includeValues,
    formSignature: adapter.formSignature,
    framework: adapter.framework || 'unknown',
  });

  return { ...form, adapter: { domain: adapter.domain, formSignature: adapter.formSignature } };
}

export async function openSemanticSection(page, adapter, sectionKind) {
  const rule = (adapter.reader?.sections || []).find((section) => section.kind === sectionKind);
  const editorAction = rule?.editorAction || adapter.reader?.editorAction;
  if (!rule || !editorAction) throw new Error(`分区 ${sectionKind} 没有可用的编辑入口`);
  const section = await locateRuleSection(page, adapter, rule);
  const action = editorAction.selector
    ? section.locator(editorAction.selector).first()
    : section.getByText(editorAction.text, { exact: true }).first();
  if (!(await action.isVisible().catch(() => false))) throw new Error(`分区 ${sectionKind} 的编辑入口不可见`);
  await action.click();
  await page.waitForTimeout(editorAction.waitMs || 250);
  return readSemanticForm(page, adapter);
}

export async function closeSemanticSection(page, adapter, sectionKind) {
  const rule = (adapter.reader?.sections || []).find((section) => section.kind === sectionKind);
  if (!rule) return false;
  const section = await locateRuleSection(page, adapter, rule);
  const editorSelector = rule.editorSelector || adapter.reader?.editorSelector;
  const editor = editorSelector ? section.locator(editorSelector).first() : section;
  const cancel = editor.getByRole('button', { name: '取消', exact: true }).first();
  if (!(await cancel.isVisible().catch(() => false))) return false;
  await cancel.click();
  await page.waitForTimeout(150);
  return true;
}

export async function expandSemanticSections(page, form, adapter, requiredCounts) {
  let current = form;
  for (const section of current.sections || []) {
    const target = requiredCounts[section.sectionKind] || 0;
    if (!section.dynamicSection || target <= section.recordCount) continue;
    const rule = (adapter.reader?.sections || []).find((candidate) => candidate.kind === section.sectionKind);
    const addAction = rule?.addAction || adapter.reader?.addAction;
    if (!addAction) continue;
    for (let count = section.recordCount; count < target; count += 1) {
      const scope = await locateRuleSection(page, adapter, rule);
      const action = addAction.selector
        ? scope.locator(addAction.selector).first()
        : scope.getByText(addAction.text, { exact: true }).first();
      if (!(await action.isVisible().catch(() => false))) throw new Error(`${section.title} 的添加入口不可见`);
      await action.click();
      await page.waitForTimeout(addAction.waitMs || 200);
    }
    current = await readSemanticForm(page, adapter);
  }
  return current;
}

async function locateRuleSection(page, adapter, rule) {
  const candidates = await page.locator(rule.selector).all();
  if (!rule.titleMatches) return candidates[0] || page.locator(rule.selector).first();
  const selector = rule.titleSelector || adapter.reader?.sectionTitleSelector;
  for (const candidate of candidates) {
    const title = selector
      ? await candidate.locator(selector).first().innerText().catch(() => '')
      : await candidate.innerText().catch(() => '');
    const normalized = String(title || '').replace(/\s+/g, ' ').replace(/[＊*]+/g, '').replace(/必填$/g, '').trim();
    const expected = Array.isArray(rule.titleMatches) ? rule.titleMatches : [rule.titleMatches];
    if (expected.some((value) => normalized === value)) return candidate;
  }
  throw new Error(`找不到分区: ${rule.title || rule.titleMatches}`);
}
