# Site Adapter Schema

Adapters describe how a recruitment form exposes semantic structure. They are thin framework/site profiles, not a data store and not a second resume mapper.

```json
{
  "domain": "hr-campus.vivo.com",
  "formSignature": "beisen-phoenix-v1",
  "framework": "beisen-phoenix",
  "mappedAt": "2026-08-28",
  "fingerprints": [
    { "selector": ".form-part", "minCount": 3 },
    { "selector": "[class*='phoenix']", "minCount": 5 }
  ],
  "reader": {
    "sectionContainer": ".form-part",
    "fieldSelector": ".form-item",
    "labelSelector": [".form-item__label", "label"],
    "controlSelector": "input:not([type='hidden']), textarea, select, [role='combobox']"
  }
}
```

Rules:

- Keep `domain`, `formSignature`, `framework`, at least one useful fingerprint, and a `reader` profile.
- The common reader supports `sectionContainer`, `sectionTitleSelector`, `sectionContentSelector`, `fieldSelector`, `labelSelector`, `controlSelector`, `recordSelector`, and framework component selectors for select/date/date-range controls.
- Use `reader.sections[]` only when section kinds or record/add behavior cannot be inferred. Each rule may provide `kind`, `title`, `titleMatches`, `selector`, `recordSelector`, `addAction`, or `editorAction`.
- `editorMode: "section-editor"` is for pages such as OPPO that expose one section only after an edit control opens. Add `handoff.savePolicy: "user-only"` when the Agent must leave saving to the user.
- Do not store current control values, phone numbers, IDs, email addresses, uploaded file paths, cookies, or tokens.
- Prefer semantic labels and the nearest stable container. Generated class names and absolute XPath are last resorts.
- Keep general Chinese label aliases and resume paths in the shared mapper. Add a site-specific alias only when its meaning is demonstrably unique to that employer.
- Custom radio/select/date controls remain confirmation/manual fields until verified on the live form.
- Revalidate an adapter when the page signature or visible labels change; fail closed and return to read-only mapping.

Do not store a selector merely because it worked once. A useful selector describes a framework concept such as a field, section, record, or editor action. If only an absolute position or generated hash is available, pair it with a stronger visible-title fingerprint and fail closed when either changes.
