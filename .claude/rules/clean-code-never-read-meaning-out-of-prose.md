---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# Never Read Meaning Out of Prose

> Part of [Clean Code](clean-code.md).

**NEVER decide state or meaning by regex- or substring-matching human-readable text** — instructions,
model or agent output, tool result text, transcripts, log lines, error messages, descriptions. That
includes test helpers that classify what came back. Prose is written for a reader and gets reworded:
the match breaks silently, or needs anchors and exclusions to dodge its own negations ("not all tasks
have completed yet").

**ALWAYS read a structured field instead** — a status, a list, an error code or class, a typed result.
If the producer does not emit one, add one to it; never parse its wording as a stand-in.

❌ **BAD** — whether a report is the last one, from its wording:

```typescript
const finished = /^\s*all tasks have completed/i.test(report.instructions);
if (error.message.includes('not found')) { ... }
```

✅ **GOOD** — from what the producer states outright:

```typescript
const finished = report.taskIdsInProgress?.length === 0;
if (error instanceof NotFoundError) { ... }
```

Not covered: parsing text that *is* a structured format (URLs, entity ids, paths, JSON), and asserting on
output in a test (`expect(text).toContain(...)`). Deciding what free text *means* is a classifier's job
(see [`jev-classifiers`](jev-classifiers.md)), never a regex's.
