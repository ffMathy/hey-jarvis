---
name: boy-scout-rule
description: Always leave code better than you found it. Use this when encountering any code quality issues, even if unrelated to your current task.
---

# Boy Scout Rule

**CRITICAL: Always fix issues you encounter, even if unrelated to your current task.**

## The Rule

Leave the codebase cleaner than you found it.

## What to Fix

✅ **Always fix:**
- ALL lint errors in any file you encounter
- ALL failing tests you discover
- Formatting issues in files you touch
- Dead code and unused imports
- Code quality issues you notice

## Examples

**While working on feature A, you notice:**
- File B has lint errors → Fix them
- Test C is failing → Fix it
- File D has unused imports → Remove them
- Function E has poor naming → Improve it

## Process

1. **Encounter issue** during your work
2. **Fix it immediately** as part of your current changes
3. **Include in your commit** with a note
4. **Test that fix** doesn't break anything

## Commit Message Format

When fixing unrelated issues:

```bash
feat(feature-a): add new capability

Also fixes:
- Lint errors in file-b.ts
- Failing test in file-c.spec.ts
- Removes unused imports from file-d.ts
```

## Benefits

- **Continuous improvement**: Code quality increases over time
- **Prevents technical debt**: Small fixes prevent larger problems
- **Team responsibility**: Everyone contributes to code quality
- **Safer refactoring**: Clean code is easier to change

## What NOT to Do

❌ Don't create separate "cleanup" PRs unless the changes are substantial
❌ Don't skip fixing issues because "it's not my code"
❌ Don't leave broken tests or lint errors

The best time to fix a small issue is **when you first see it**.
