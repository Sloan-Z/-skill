const GENERIC_CONTROL_SELECTOR = [
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[contenteditable="true"]',
].join(',');

const SECTION_RULES = [
  ['attachment', /附件|上传简历|照片|证件照/],
  ['basic', /基本信息|基础信息|个人信息|联系方式/],
  ['education', /教育|学历/],
  ['family', /亲属|家属|家庭成员/],
  ['work', /工作|实习|任职|职业经历/],
  ['project', /项目经历|项目经验|项目实践/],
  ['campus', /校园经历|校内活动|学生干部|社会实践/],
  ['language', /语言能力|语言水平|英语能力|外语/],
  ['skills', /技能特长|专业技能|技能/],
  ['certificates', /证书|资格证/],
  ['portfolio', /作品|作品集|个人主页/],
  ['awards', /获奖|荣誉|竞赛/],
  ['evaluation', /自我评价|个人评价|个人介绍|自我介绍/],
  ['contact', /紧急联系人|联系人信息/],
];

const FIELD_RULES = [
  ['basic', /姓名|真实姓名|手机|电话|邮箱|性别|出生|年龄|现居|所在地|所在地点|籍贯|家乡|期望城市|期望工作地点|政治面貌/],
  ['education', /学校|院校|学院|院系|专业|学历|学位|入学|毕业|成绩排名|绩点|GPA|培养方式/],
  ['work', /公司|雇主|职位|岗位|部门|实习|任职|工作描述|工作职责/],
  ['project', /项目|项目角色|项目职责|项目描述/],
  ['campus', /校园|组织|活动|社团|学生干部/],
  ['language', /语言|英语|外语|听说|读写|成绩|分数/],
  ['certificates', /证书|资格证/],
  ['awards', /奖项|获奖|荣誉|竞赛/],
  ['portfolio', /作品|链接|个人主页/],
  ['evaluation', /评价|介绍/],
];

function escapedAttribute(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function classifyText(value, rules) {
  const text = String(value || '').replace(/[\s＊*：:]/g, '');
  return rules.find(([, expression]) => expression.test(text))?.[0] || 'unknown';
}

/**
 * Read an unknown recruitment form without a site adapter. The output uses
 * direct CSS locators valid for the current DOM and deliberately does not
 * click buttons or expose values unless requested.
 */
export async function readGenericForm(page, { includeValues = false } = {}) {
  return page.evaluate(({ controlSelector, exposeValues, sectionRules, fieldRules }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const classifyText = (value, rules) => {
      const text = String(value || '').replace(/[\s＊*：:]/g, '');
      return rules.find(([kind, expression]) => expression.test(text))?.[0] || 'unknown';
    };
    const visible = (element) => {
      if (!element) return false;
      if (element.matches('input[type="file"]')) return true;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const selectorList = (selector) => Array.isArray(selector) ? selector : [selector];
    const escapedAttribute = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const selectorFor = (element) => {
      if (!element) return 'body';
      if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1) {
        return `#${CSS.escape(element.id)}`;
      }
      const parts = [];
      let current = element;
      while (current && current.nodeType === 1 && current !== document.documentElement) {
        let part = current.tagName.toLowerCase();
        const stableAttribute = ['data-testid', 'data-test-id', 'data-field-name', 'name', 'aria-label']
          .find((attribute) => current.getAttribute(attribute));
        if (stableAttribute) {
          part += `[${stableAttribute}="${escapedAttribute(current.getAttribute(stableAttribute))}"]`;
        } else {
          let position = 1;
          let sibling = current;
          while ((sibling = sibling.previousElementSibling)) {
            if (sibling.tagName === current.tagName) position += 1;
          }
          part += `:nth-of-type(${position})`;
        }
        parts.unshift(part);
        const candidate = parts.join(' > ');
        if (document.querySelectorAll(candidate).length === 1) return candidate;
        current = current.parentElement;
      }
      return parts.join(' > ');
    };
    const clean = (value) => normalize(value).replace(/[＊*]+/g, '').replace(/必填$/g, '').trim();
    const controls = [...document.querySelectorAll(controlSelector)].filter(visible);
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,[role="heading"]')]
      .filter(visible);
    const sectionElements = new Map();
    const sectionRecords = new Map();
    const recordContainers = new WeakMap();
    const fieldIndices = new Map();

    const nearestFieldItem = (control) => {
      if (control.labels?.length && control.labels[0].parentElement) return control.labels[0].parentElement;
      let current = control.parentElement;
      for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
        const className = String(current.className || '');
        if (current.matches('[data-field], [data-form-field], fieldset, .form-item, .field-item, [class*="form-item"], [class*="field-item"]')
          || /(^|[-_])(form|field|input|select|textarea)([-_]|$)/i.test(className)) return current;
      }
      return control.parentElement || control;
    };

    const labelText = (candidate) => {
      if (!candidate) return '';
      const clone = candidate.cloneNode(true);
      clone.querySelectorAll('input,select,textarea,button,[role="combobox"],[role="textbox"],[contenteditable="true"]')
        .forEach((control) => control.remove());
      return clean(clone.textContent);
    };
    const labelFor = (item, control) => {
      const option = control.matches('[role="radio"], [role="checkbox"], input[type="radio"], input[type="checkbox"]');
      const candidates = option
        ? [...item.querySelectorAll('[data-label], .field-label, .form-label, label, legend, [class*="label"]')]
        : [control.labels?.[0], ...item.querySelectorAll('[data-label], .field-label, .form-label, label, legend, [class*="label"]')];
      const label = candidates.find((candidate) => labelText(candidate));
      if (label) return { value: labelText(label), source: 'label' };
      for (const attribute of ['aria-label', 'placeholder', 'name']) {
        const value = clean(control.getAttribute(attribute));
        if (value) return { value, source: attribute === 'placeholder' ? 'placeholder' : 'attribute' };
      }
      return { value: '', source: 'unknown' };
    };

    const headingFor = (control, item) => {
      let current = item;
      for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
        const heading = [...current.children]
          .filter((child) => child.matches('h1,h2,h3,h4,h5,h6,legend,[role="heading"]') && clean(child.textContent))
          .filter((child) => Boolean(child.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING))
          .at(-1);
        if (heading) return { element: heading, text: clean(heading.textContent), source: 'heading' };
      }
      const previous = headings
        .filter((candidate) => Boolean(candidate.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING))
        .at(-1);
      if (previous && clean(previous.textContent)) return { element: previous, text: clean(previous.textContent), source: 'heading' };
      return { element: null, text: '', source: 'inferred' };
    };

    const compiledSectionRules = sectionRules.map(([kind, source]) => [kind, new RegExp(source)]);
    const compiledFieldRules = fieldRules.map(([kind, source]) => [kind, new RegExp(source)]);
    const inferredSection = (title, label) => {
      const titleKind = classifyText(title, compiledSectionRules);
      if (titleKind !== 'unknown') return { kind: titleKind, confidence: 0.96 };
      const fieldKind = classifyText(label, compiledFieldRules);
      if (fieldKind !== 'unknown') return { kind: fieldKind, confidence: 0.72 };
      return { kind: 'unknown', confidence: 0.35 };
    };

    const likelyRecord = (item, sectionKind) => {
      if (!['education', 'work', 'project', 'campus', 'awards', 'certificates', 'portfolio', 'language'].includes(sectionKind)) return null;
      let current = item;
      for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
        const className = String(current.className || '');
        const parent = current.parentElement;
        if (!parent) continue;
        const siblings = [...parent.children].filter((candidate) => {
          const candidateClass = String(candidate.className || '');
          return candidate.tagName === current.tagName
            && candidateClass === className
            && candidate.querySelector(controlSelector);
        });
        const siblingHasMultipleControls = siblings.some((candidate) => candidate.querySelectorAll(controlSelector).length > 1);
        if (/(record|entry|experience|resume-item|list-item|card)/i.test(className)
          && current.querySelectorAll(controlSelector).length > 1) return current;
        if (siblings.length > 1 && siblingHasMultipleControls && current.querySelectorAll(controlSelector).length > 1) return current;
      }
      return null;
    };

    const valuePresent = (control, kind) => {
      if (kind === 'file' || kind === 'password') return false;
      if (kind === 'radio' || kind === 'checkbox') return Boolean(control.checked || control.getAttribute('aria-checked') === 'true');
      if (kind === 'custom-select') return Boolean(normalize(control.value || control.textContent || control.getAttribute('aria-valuetext')));
      return Boolean(normalize('value' in control ? control.value : control.textContent));
    };

    const controlKind = (control, label) => {
      if (control.matches('input[type="file"]')) return 'file';
      if (control.matches('input[type="password"]')) return 'password';
      if (control.matches('input[type="radio"], [role="radio"]')) return 'radio';
      if (control.matches('input[type="checkbox"], [role="checkbox"]')) return 'checkbox';
      if (control.matches('select')) return 'native-select';
      if (control.matches('textarea, [role="textbox"], [contenteditable="true"]')) return 'text';
      if (control.matches('[role="combobox"]') || /select|picker|dropdown|cascader/i.test(String(control.className || ''))) return 'custom-select';
      if (control.matches('input[type="date"], input[type="month"]') || /出生日期|毕业时间|获奖时间|开始时间|结束时间/.test(label)) return 'date';
      if (/起止时间|在校时间|在职时间|项目时间|经历时间/.test(label)) return 'date-range';
      return 'text';
    };

    const sections = [];
    const fields = [];
    const sectionIndexByKey = new Map();
    const sectionInfo = (title, kind, heading) => {
      const key = `${kind}|${title || '页面表单'}`;
      let section = sectionIndexByKey.get(key);
      if (!section) {
        section = {
          sectionIndex: sections.length,
          title: title || (kind === 'unknown' ? '页面表单' : kind),
          sectionKind: kind,
          closed: false,
          recordCount: 0,
          dynamicSection: false,
          addAction: null,
          editorAction: null,
          locator: { strategy: 'generic-section', selector: heading ? selectorFor(heading) : 'body' },
          confidence: heading ? 0.96 : 0.72,
        };
        sections.push(section);
        sectionIndexByKey.set(key, section);
        sectionRecords.set(section.sectionIndex, []);
      }
      return section;
    };

    // Preserve empty-but-visible sections so an add button can be discovered
    // even when the site renders no record controls until the user expands it.
    headings.forEach((heading) => {
      const title = clean(heading.textContent);
      const inferred = inferredSection(title, '');
      if (inferred.kind !== 'unknown') sectionInfo(title, inferred.kind, heading);
    });

    controls.forEach((control) => {
      const item = nearestFieldItem(control);
      const labelInfo = labelFor(item, control);
      const heading = headingFor(control, item);
      const inferred = inferredSection(heading.text, labelInfo.value);
      const section = sectionInfo(heading.text, inferred.kind, heading.element);
      const record = likelyRecord(item, inferred.kind);
      const records = sectionRecords.get(section.sectionIndex);
      let recordIndex = 0;
      if (record) {
        recordIndex = records.indexOf(record);
        if (recordIndex < 0) {
          records.push(record);
          recordIndex = records.length - 1;
        }
      }
      section.recordCount = Math.max(section.recordCount, recordIndex + 1);
      const fieldKey = `${section.sectionIndex}:${recordIndex}:${selectorFor(item)}`;
      const fieldIndex = fieldIndices.get(fieldKey) || 0;
      fieldIndices.set(fieldKey, fieldIndex + 1);
      const kind = controlKind(control, labelInfo.value);
      const locator = { strategy: 'generic-control', selector: selectorFor(control) };
      const field = {
        fieldId: `generic:${section.sectionIndex}:${recordIndex}:${fieldIndex}`,
        label: labelInfo.value,
        labelSource: labelInfo.source,
        controlText: ['radio', 'checkbox'].includes(kind) ? clean(control.textContent || control.getAttribute('aria-label')) : null,
        sectionTitle: section.title,
        sectionKind: section.sectionKind,
        sectionIndex: section.sectionIndex,
        recordIndex,
        fieldIndex,
        controlIndex: fieldIndex,
        tag: control.tagName.toLowerCase(),
        type: control.getAttribute('type') || null,
        name: control.getAttribute('name') || null,
        id: control.id || null,
        placeholder: control.getAttribute('placeholder') || null,
        controlKind: kind,
        disabled: Boolean(control.disabled || control.getAttribute('aria-disabled') === 'true'),
        readonly: Boolean(control.readOnly || control.getAttribute('aria-readonly') === 'true'),
        required: Boolean(control.required || control.getAttribute('aria-required') === 'true'),
        maxLength: control.maxLength > 0 ? control.maxLength : null,
        checked: Boolean(control.checked || control.getAttribute('aria-checked') === 'true'),
        hasValue: valuePresent(control, kind),
        confidence: Math.min(inferred.confidence, labelInfo.source === 'label' ? 0.96 : labelInfo.source === 'unknown' ? 0.35 : 0.68),
        locator,
      };
      if (exposeValues && kind !== 'file' && kind !== 'password') field.value = 'value' in control ? control.value : control.textContent || '';
      fields.push(field);
    });

    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(visible);
    for (const button of buttons) {
      const text = clean(button.textContent);
      if (!/^(添加|新增|添加经历|新增经历|添加教育|添加工作|添加实习|添加项目|添加证书|添加奖项)/.test(text)) continue;
      const context = headingFor(button, button.parentElement);
      const directKind = classifyText(text, compiledSectionRules);
      const inferred = directKind === 'unknown'
        ? inferredSection(context.text, text)
        : { kind: directKind, confidence: 0.9 };
      const section = sections.find((candidate) => candidate.sectionKind === inferred.kind);
      if (section && !section.addAction) {
        section.addAction = { selector: selectorFor(button), text, waitMs: 250 };
        section.dynamicSection = true;
      }
    }

    return {
      url: location.href,
      title: document.title,
      pageType: 'generic-form',
      framework: 'unknown',
      generic: true,
      fields,
      sections,
      visibleButtons: buttons.map((button) => clean(button.textContent)).filter(Boolean),
    };
  }, {
    controlSelector: GENERIC_CONTROL_SELECTOR,
    exposeValues: includeValues,
    sectionRules: SECTION_RULES.map(([kind, expression]) => [kind, expression.source]),
    fieldRules: FIELD_RULES.map(([kind, expression]) => [kind, expression.source]),
  });
}

export async function expandGenericSections(page, form, requiredCounts) {
  let current = form;
  for (const section of current.sections || []) {
    const target = requiredCounts[section.sectionKind] || 0;
    if (!section.dynamicSection || !section.addAction || target <= section.recordCount) continue;
    for (let index = section.recordCount; index < target; index += 1) {
      const action = page.locator(section.addAction.selector).first();
      if (!(await action.isVisible().catch(() => false))) throw new Error(`${section.title} 的添加入口不可见`);
      await action.click();
      await page.waitForTimeout(section.addAction.waitMs || 250);
    }
    current = await readGenericForm(page);
  }
  return current;
}

export { GENERIC_CONTROL_SELECTOR };
