const NATIVE_SELECTOR = [
  'input:not([type="hidden"]):not([type="file"])',
  'input[type="file"]',
  'select',
  'textarea',
  '[role="combobox"]',
  '[contenteditable="true"]',
].join(',');

/**
 * Read form metadata without exposing field values unless explicitly asked.
 * The reader understands the label/control layout used by Beisen Phoenix.
 */
export async function readPageForm(page, { includeValues = false } = {}) {
  return page.evaluate(({ includeValues: exposeValues, nativeSelector }) => {
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };

    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const unique = (values) => [...new Set(values.filter(Boolean))];
    const formItems = [...document.querySelectorAll('.form-item')];
    const formParts = [...document.querySelectorAll('.form-part')];
    const formItemIndex = new Map(formItems.map((item, index) => [item, index]));
    const formPartIndex = new Map(formParts.map((part, index) => [part, index]));

    const itemLabel = (item) => {
      if (!item) return null;
      const label = item.querySelector('.form-item__label, label, [class*="label"]');
      return normalize(label?.textContent);
    };

    const partLabels = (part) => unique([
      ...part.querySelectorAll('.form-item__label, label, [class*="label"]'),
    ].map((element) => normalize(element.textContent)));

    const classifyPart = (labels) => {
      const has = (...terms) => terms.every((term) => labels.includes(term));
      if (labels.includes('姓名') || labels.includes('手机号码') || labels.includes('邮箱')) return 'basic';
      if (labels.includes('有无内部亲属')) return 'family';
      if (has('学校名称', '专业名称') || labels.includes('培养方式')) return 'education';
      if (labels.includes('公司名称') || labels.includes('工作性质') || labels.includes('工作描述')) return 'work';
      if (labels.includes('项目名称') || labels.includes('项目职责') || labels.includes('项目描述')) return 'project';
      if (labels.includes('获奖项') || labels.includes('获奖级别') || labels.includes('获奖描述')) return 'awards';
      if (labels.includes('语言类别') || labels.includes('听说能力') || labels.includes('读写能力')) return 'language';
      if (labels.includes('编程语言') || labels.includes('掌握程度')) return 'skills';
      if (labels.includes('证书名称') || labels.includes('证书描述')) return 'certificates';
      if (labels.includes('评价内容')) return 'evaluation';
      if (labels.includes('附件')) return 'attachment';
      return 'unknown';
    };

    const partInfo = formParts.map((part, index) => {
      const labels = partLabels(part);
      return { index, labels, kind: classifyPart(labels) };
    });

    // Date-only Phoenix parts inherit the kind of the nearest anchored part.
    for (const part of partInfo) {
      if (part.kind !== 'unknown' || !part.labels.some((label) => ['开始时间', '结束时间', '毕业时间'].includes(label))) continue;
      const next = partInfo.slice(part.index + 1).find((candidate) => candidate.kind !== 'unknown');
      const previous = [...partInfo].slice(0, part.index).reverse().find((candidate) => candidate.kind !== 'unknown');
      part.kind = next?.kind || previous?.kind || 'unknown';
    }

    const customRadioSelector = '.phoenix-radio-group__radioItem, [role="radio"]';
    const controls = [];
    const seen = new Set();

    const addControl = (element, controlKind = 'native', controlIndexOverride = null) => {
      if (!element || seen.has(element)) return;
      const isFile = element.matches('input[type="file"]');
      if (!isFile && !visible(element)) return;
      seen.add(element);

      const item = element.closest('.form-item');
      const part = element.closest('.form-part');
      const itemControls = item
        ? [...item.querySelectorAll(nativeSelector)].filter((candidate) => candidate.type !== 'file' && visible(candidate))
        : [];
      const customControls = item
        ? [...item.querySelectorAll(customRadioSelector)].filter(visible)
        : [];
      const controlIndex = controlIndexOverride ?? (
        controlKind === 'custom-radio'
          ? customControls.indexOf(element)
          : itemControls.indexOf(element)
      );
      const labels = part ? partInfo[formPartIndex.get(part)]?.labels || [] : [];
      const kind = part ? partInfo[formPartIndex.get(part)]?.kind || 'unknown' : 'unknown';

      const field = {
        fieldId: `field-${controls.length}`,
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute('type') || null,
        controlKind,
        label: itemLabel(item),
        controlText: controlKind === 'custom-radio' ? normalize(element.textContent) : null,
        name: element.getAttribute('name') || null,
        id: element.id || null,
        placeholder: element.getAttribute('placeholder') || null,
        className: typeof element.className === 'string' ? element.className : null,
        disabled: Boolean(element.disabled),
        readonly: Boolean(element.readOnly),
        required: Boolean(element.required || element.getAttribute('aria-required') === 'true'),
        visible: visible(element),
        // Radio option text is not the selected value. Selection state is kept
        // unknown so the mapper never overwrites it silently.
        hasValue: isFile || controlKind === 'custom-radio' ? false : Boolean(element.value || element.textContent),
        formItemIndex: item ? formItemIndex.get(item) : null,
        formPartIndex: part ? formPartIndex.get(part) : null,
        partLabels: labels,
        sectionKind: kind,
        controlIndex,
        locator: item
          ? { strategy: 'form-item', formItemIndex: formItemIndex.get(item), controlIndex, controlKind }
          : null,
      };

      if (exposeValues && !isFile) field.value = element.value || element.textContent || '';
      controls.push(field);
    };

    for (const element of document.querySelectorAll(nativeSelector)) {
      addControl(element, element.matches('input[type="file"]') ? 'file' : 'native');
    }

    // Phoenix radios are rendered as divs without a native input element.
    for (const item of formItems) {
      if ([...item.querySelectorAll(NATIVE_SELECTOR)].some((element) => visible(element))) continue;
      for (const radio of item.querySelectorAll(customRadioSelector)) addControl(radio, 'custom-radio');
    }

    // Keep navigation/search controls visible to the mapper so it can skip them.
    for (const element of document.querySelectorAll('input:not([type="hidden"]):not([type="file"]), textarea, select')) {
      if (!visible(element) || seen.has(element)) continue;
      addControl(element, 'native');
    }

    return {
      url: location.href,
      title: document.title,
      pageType: location.hostname === 'hr-campus.vivo.com' ? 'beisen-phoenix' : 'generic',
      fields: controls,
      visibleButtons: [...document.querySelectorAll('button, [role="button"]')]
        .filter(visible)
        .map((button) => normalize(button.textContent))
        .filter(Boolean)
        .filter((text) => ['保存', '取消', '上传附件', '上传', '删除', '更新'].includes(text)),
    };
  }, { includeValues, nativeSelector: NATIVE_SELECTOR });
}
