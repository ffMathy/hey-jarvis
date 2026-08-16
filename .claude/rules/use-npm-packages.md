---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/package.json"
---

# Use npm Packages (Don't Reinvent the Wheel)

**ALWAYS prefer well-maintained npm packages** over custom implementations.

## Process

Before writing custom code:

1. **Search npm first** — look for an existing package
2. **Check maintenance** — active development and healthy download stats
3. **Check TypeScript support** — built-in types or an `@types` package
4. **Prefer official libraries** by recognized maintainers

## Selection Criteria

✅ **Good package indicators:**

- Downloads/week: >100k (wide adoption)
- Last publish: within the last few months
- TypeScript support: built-in types or `@types` available
- Cross-platform: Linux, macOS, Windows
- Reputable author (e.g. sindresorhus, vercel)

❌ **Red flags:**

- No updates in >1 year
- Many open issues, few closed
- <10k downloads/week (unless very niche)
- No TypeScript support, poor documentation, or no tests

## Common Patterns

This project uses `lodash-es` for common utility functions:

```typescript
import { find, uniqueId, truncate, chain, groupBy, sumBy } from 'lodash-es';

const taskId = uniqueId('task-');
const description = truncate(longText, { length: 100 });
const task = find(tasks, task => task.status === 'running');

const result = chain(items)
  .filter(item => item.active)
  .sortBy('priority')
  .take(5)
  .value();
```

## Don't Implement These Yourself

- File system watchers → `chokidar`
- Process management → `fkill`, `cross-spawn`
- HTTP clients → `axios`, `node-fetch`, `got`
- Date/time handling → `date-fns`, `dayjs`
- Path manipulation → Node.js `path`
- Validation → `zod`
- Array/object utilities → `lodash-es`

## When Custom Code Is OK

- ✅ It's truly domain-specific business logic
- ✅ No suitable package exists
- ✅ The package is unmaintained or abandoned
- ✅ The package is far too heavy for a simple use case
- ✅ You need behavior the package doesn't provide
