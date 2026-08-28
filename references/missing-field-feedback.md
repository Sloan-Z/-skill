# Missing-Field Feedback

Use this workflow after a read-only mapping or the first approved fill pass.

## Classify Before Asking

For each blank page control, first inspect its mapped canonical path:

1. **Value exists in JSON:** this is a reader, locator, option, length-limit, or write-verification defect. Retry with the correct section and record locator or report the failure. Do not ask the user for the same content again. Internship descriptions come from `workExperience[i].achievements`; project descriptions combine `projectExperience[i].description` and `achievements` without inventing new claims.
2. **Canonical fact is absent:** ask for the exact fact and store the normalized answer in a new draft. Examples include city, education type, rank, project dates, and a missing work/project description.
3. **Application-only field:** collect it only for the current employer form. Referral source, employer-specific declarations, and role-specific answers do not belong in the reusable resume JSON unless the user explicitly chooses a stable canonical field.
4. **Restricted/sensitive field:** government ID, passport, bank, family member, and emergency-contact data stays manual and is not written to the generic resume JSON.

## Ask Proactively

Group questions by section and ask the fields required by the current page first. Include the JSON path and expected format. Accept these explicit outcomes:

- a value to normalize and persist;
- `无` / not applicable, recorded under `review.notApplicableFields` so it is not repeatedly requested;
- `跳过`, which leaves it unresolved;
- `仅本次`, which keeps the answer outside canonical JSON.

Never infer a missing value. In particular, do not infer gender, cities, ranking, graduation date, or project dates. A complete `basic.birthDate` may be used to calculate age at fill time; never derive a birth date from age.

## Persist Safely

Represent collected canonical answers as an answers document:

```json
{
  "answers": [
    { "path": "basic.currentCity", "value": "城市" },
    { "path": "basic.preferredCities", "value": ["城市 A", "城市 B"] },
    { "path": "projectExperience[0].link", "action": "not-applicable" }
  ]
}
```

Run `scripts/resume-feedback.mjs apply` with an explicit output path. The script refuses to overwrite the source, refuses to replace an existing non-empty value unless the answer includes `override: true`, normalizes arrays and dates, records user-provided/not-applicable paths, and outputs `status: "draft"`.

Validate the new draft. Show the user a value-conscious summary and obtain confirmation before promoting it to the canonical confirmed file. Confirmation of local JSON does not authorize sending newly collected values to a website; request action-time transmission approval again.
