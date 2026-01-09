---
name: use-npm-packages
description: Always prefer well-maintained npm packages over custom implementations. Use this when considering implementing utility functions or common functionality.
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

// Generate unique IDs
const taskId = uniqueId('task-');

// Truncate long strings
const description = truncate(longText, { length: 100 });

// Find items
const task = find(tasks, task => task.status === 'running');

// Chain operations
const result = chain(items)
  .filter(item => item.active)
  .sortBy('priority')
  .take(5)
  .value();
```

### Process Killing Example

❌ **BAD - Custom Shell Commands:**
```typescript
// Platform-specific, reinventing the wheel, ~60 lines
export function killProcessOnPort(port: number): void {
  try {
    const lsofCmd = `lsof -ti:${port}`;
    const pids = execSync(lsofCmd, { encoding: 'utf-8' }).trim().split('\n');
    pids.forEach(pid => execSync(`kill -9 ${pid}`));
  } catch (error) {
    // Complex error handling...
  }
}
```

✅ **GOOD - Use Existing Package:**
```typescript
// Cross-platform, maintained (182k downloads/week), ~15 lines
import fkill from 'fkill';

export async function killProcessOnPort(port: number): Promise<void> {
  try {
    await fkill(`:${port}`, { force: true, silent: true });
    console.log(`🧹 Killed process(es) on port ${port}`);
  } catch (error) {
    // Silent failure - port may already be free
  }
}
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

## Why Use Packages?

**Benefits:**
- **Tested**: Packages have comprehensive test suites
- **Maintained**: Bug fixes and improvements by community
- **Cross-platform**: Handle OS differences for you
- **Edge cases**: Handle scenarios you haven't thought of
- **Documentation**: Clear docs and examples
- **TypeScript**: Type definitions included or available

**Costs of Custom Implementation:**
- Must write and maintain code
- Must handle all edge cases
- Must test thoroughly
- Must support multiple platforms
- Must update for new Node versions

## When Custom Code is OK

Write custom code when:
- ✅ It's truly domain-specific business logic
- ✅ No suitable package exists
- ✅ The package is unmaintained/abandoned
- ✅ The package is too heavy for simple use case
- ✅ You need specific behavior package doesn't provide

## Search Strategy

1. **npm search**: `npm search <functionality>`
2. **Google**: "best npm package for <use case> 2024"
3. **GitHub**: Look at stars, issues, recent activity
4. **npm trends**: Compare packages at npmtrends.com

## Red Flags

Watch for packages with:
- ❌ No updates in >1 year
- ❌ Many open issues, few closed
- ❌ <10k downloads/week (unless very niche)
- ❌ No TypeScript support
- ❌ Poor documentation
- ❌ No tests
