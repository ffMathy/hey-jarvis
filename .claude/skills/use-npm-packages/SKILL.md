---
name: use-npm-packages
description: Prefer well-maintained npm packages over custom implementations
---

# Use npm Packages (Don't Reinvent the Wheel)

**ALWAYS prefer well-maintained npm packages** over custom implementations.

## Process

Before writing custom code:

1. **Search npm first**: Look for existing packages
2. **Check maintenance**: Verify active development and download stats
3. **Check TypeScript support**: Look for built-in types or @types packages
4. **Use official libraries**: Prefer packages by recognized maintainers

## Package Selection Criteria

✅ **Good Package Indicators:**
- Downloads/week: >100k (indicates wide adoption)
- Last publish: Within last few months (actively maintained)
- TypeScript support: Built-in types or @types available
- Cross-platform: Works on Linux, macOS, Windows
- Reputable author: Known maintainer (e.g., sindresorhus, vercel)

## Common Patterns

### Use lodash-es for Utilities

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

## Common Anti-Patterns to Avoid

❌ **Don't implement these yourself:**
- Custom file system watchers → Use `chokidar`
- Custom process management → Use `fkill`, `cross-spawn`
- Custom HTTP clients → Use `axios`, `node-fetch`, `got`
- Custom date/time handling → Use `date-fns`, `dayjs`
- Custom path manipulation → Use Node.js `path` module
- Custom validation → Use `zod`, `joi`, `yup`
- Custom array/object utilities → Use `lodash-es`

## When Custom Code is OK

Write custom code when:
- ✅ It's truly domain-specific business logic
- ✅ No suitable package exists
- ✅ The package is unmaintained/abandoned
- ✅ The package is too heavy for simple use case
- ✅ You need specific behavior package doesn't provide

## Red Flags

Watch for packages with:
- ❌ No updates in >1 year
- ❌ Many open issues, few closed
- ❌ <10k downloads/week (unless very niche)
- ❌ No TypeScript support
- ❌ Poor documentation
- ❌ No tests
