const FEISHU_MODULE_SELECTOR = '.applyFormModuleWrapper-windows';
const FEISHU_FIELD_SELECTOR = '.ud-formily-item[data-form-field-id][data-form-field-i18n-name]';
const FEISHU_CARD_SELECTOR = '[class*="apply-form-array-card__"]';

const SECTION_KINDS = new Map([
  ['基本信息', 'basic'],
  ['教育经历', 'education'],
  ['实习经历', 'work'],
  ['项目经历', 'project'],
  ['作品', 'portfolio'],
  ['获奖', 'awards'],
  ['语言能力', 'language'],
  ['自我评价', 'evaluation'],
]);

/**
 * Read Feishu/飞书招聘's Formily resume editor.
 * Dynamic sections start empty and render records into apply-form-array-card
 * containers after 添加 is pressed. The reader intentionally reports only
 * structural metadata unless includeValues is requested.
 */
export async function readFeishuForm(page, { includeValues = false } = {}) {
  return page.evaluate(({ exposeValues, moduleSelector, fieldSelector, cardSelector, sectionKinds }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const unique = (values) => [...new Set(values.filter(Boolean))];
    const isContentCard = (element) => {
      const className = String(element.className || '');
      return className.includes('apply-form-array-card__')
        && !className.includes('apply-form-array-card-content__')
        && !className.includes('apply-form-array-card-operate__')
        && !className.includes('apply-form-array-card-delete__');
    };
    const moduleElements = [...document.querySelectorAll(moduleSelector)];
    const controlsFor = (field) => [...field.querySelectorAll(
      'input:not([type="hidden"]), textarea, select, [role="combobox"], [contenteditable="true"]',
    )];
    const classifyControl = (control, field) => {
      if (control.matches('input[type="file"]')) return 'file';
      if (control.matches('select, [role="combobox"]')) return 'select';
      const fieldName = field.getAttribute('data-form-field-name') || '';
      const label = field.getAttribute('data-form-field-i18n-name') || '';
      if ((fieldName === 'birthday' || fieldName === 'date')
        || control.getAttribute('placeholder') === 'YYYY-MM')
        return 'date';
      if (fieldName === 'start_end_time' || label === '起止时间') return 'date-range';
      return 'text';
    };

    const modules = moduleElements.map((module, sectionIndex) => {
      const title = normalize(module.querySelector('.applyFormModuleWrapper-title')?.textContent);
      const sectionKind = sectionKinds[title] || 'unknown';
      const right = module.querySelector('.applyFormModuleWrapper-right') || module;
      const cards = [...right.querySelectorAll(cardSelector)].filter(isContentCard);
      const arraySection = ['education', 'work', 'project', 'portfolio', 'awards', 'language'].includes(sectionKind);
      const dynamicSection = arraySection || sectionKind === 'evaluation';
      const recordContainers = cards.length
        ? cards
        : dynamicSection && !right.querySelector(fieldSelector) ? [] : [right];
      const addButton = [...right.querySelectorAll('button, [role="button"]')]
        .find((button) => normalize(button.textContent) === '添加' && visible(button));
      const fields = [];

      recordContainers.forEach((recordContainer, recordIndex) => {
        const fieldElements = [...recordContainer.querySelectorAll(fieldSelector)]
          .filter((field) => visible(field));
        fieldElements.forEach((field) => {
          const fieldName = field.getAttribute('data-form-field-name') || null;
          const label = field.getAttribute('data-form-field-i18n-name') || null;
          const controls = controlsFor(field);
          controls.forEach((control, controlIndex) => {
            const controlKind = classifyControl(control, field);
            const isFile = controlKind === 'file';
            const hasValue = isFile
              ? false
              : Boolean(control.value || control.textContent || control.getAttribute('aria-valuetext'));
            const item = {
              fieldId: `${sectionKind || 'unknown'}:${recordIndex}:${fieldName || 'field'}:${controlIndex}`,
              sourceFieldId: field.getAttribute('data-form-field-id'),
              fieldName,
              fieldI18nName: label,
              label,
              sectionKind,
              sectionTitle: title,
              sectionIndex,
              recordIndex,
              controlIndex,
              controlKind,
              tag: control.tagName.toLowerCase(),
              type: control.getAttribute('type') || null,
              name: control.getAttribute('name') || null,
              id: control.id || null,
              placeholder: control.getAttribute('placeholder') || null,
              className: typeof control.className === 'string' ? control.className : null,
              disabled: Boolean(control.disabled),
              readonly: Boolean(control.readOnly),
              required: Boolean(control.required || control.getAttribute('aria-required') === 'true'),
              maxLength: control.maxLength > 0 ? control.maxLength : null,
              visible: isFile || visible(control),
              hasValue,
              locator: {
                strategy: 'feishu-field',
                sectionIndex,
                sectionKind,
                recordIndex,
                fieldName,
                controlIndex,
                controlKind,
              },
            };
            if (exposeValues && !isFile) item.value = control.value || control.textContent || '';
            fields.push(item);
          });
        });
      });

      return {
        sectionIndex,
        title,
        sectionKind,
        arraySection,
        dynamicSection,
        recordCount: recordContainers.length,
        addButtonVisible: Boolean(addButton),
        fieldLabels: unique(fields.map((field) => field.label)),
        fields,
        addButtonLocator: addButton ? {
          strategy: 'feishu-section-add',
          sectionIndex,
          sectionKind,
        } : null,
      };
    });

    return {
      url: location.href,
      title: document.title,
      pageType: 'feishu-resume',
      sections: modules,
      // Clone flattened entries so browser bridges that de-duplicate object
      // references do not turn the flat list into opaque circular markers.
      fields: modules.flatMap((module) => module.fields)
        .map((field) => ({ ...field, locator: field.locator ? { ...field.locator } : null })),
      visibleButtons: [...document.querySelectorAll('button, [role="button"]')]
        .filter(visible)
        .map((button) => normalize(button.textContent))
        .filter(Boolean)
        .filter((text) => ['完成', '保存', '取消', '删除', '添加'].includes(text)),
    };
  }, {
    exposeValues: includeValues,
    moduleSelector: FEISHU_MODULE_SELECTOR,
    fieldSelector: FEISHU_FIELD_SELECTOR,
    cardSelector: FEISHU_CARD_SELECTOR,
    sectionKinds: Object.fromEntries(SECTION_KINDS),
  });
}

export function isFeishuResumePage(form) {
  return form?.pageType === 'feishu-resume' || /\.jobs\.feishu\.cn$/i.test(new URL(form?.url || 'http://invalid').hostname);
}

export function feishuSectionRecordCounts(form) {
  return Object.fromEntries((form.sections || [])
    .filter((section) => section.dynamicSection)
    .map((section) => [section.sectionKind, section.recordCount]));
}

/**
 * Create missing array records after action-time approval. This only expands
 * blank client-side rows; it never presses 完成/保存 and never enters data.
 */
export async function expandFeishuSections(page, form, requiredCounts) {
  let current = form;
  for (const section of current.sections || []) {
    const required = Number(requiredCounts?.[section.sectionKind] || 0);
    if (!section.dynamicSection || required <= section.recordCount) continue;
    const module = page.locator(FEISHU_MODULE_SELECTOR).nth(section.sectionIndex);
    while (current.sections?.[section.sectionIndex]?.recordCount < required) {
      const before = current.sections?.[section.sectionIndex]?.recordCount || 0;
      const addButton = module.getByRole('button', { name: '添加', exact: true }).first();
      if (!(await addButton.isVisible().catch(() => false))) {
        throw new Error(`分区“${section.title}”没有可用的添加按钮`);
      }
      await addButton.click();
      await page.waitForTimeout(120);
      current = await readFeishuForm(page);
      const after = current.sections?.[section.sectionIndex]?.recordCount || 0;
      if (after <= before) throw new Error(`分区“${section.title}”点击添加后没有生成新条目`);
    }
  }
  return current;
}
