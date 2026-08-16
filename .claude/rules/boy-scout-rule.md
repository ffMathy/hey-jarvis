# Boy Scout Rule

**CRITICAL: Always fix issues you encounter, even if unrelated to your current task.**

Leave the codebase cleaner than you found it.

## What to Fix

✅ **Always fix:**

- ALL lint errors in any file you encounter
- ALL failing tests you discover
- Formatting issues in files you touch
- Dead code and unused imports
- Stale references in documentation (links to moved or deleted files)
- Code quality issues you notice

## Process

1. **Encounter issue** during your work
2. **Fix it immediately** as part of your current changes
3. **Include in your commit** with a note
4. **Test that fix** doesn't break anything

## Commit Message Format

When fixing unrelated issues:

```
feat(feature-a): add new capability

Also fixes:
- Lint errors in file-b.ts
- Failing test in file-c.spec.ts
- Removes unused imports from file-d.ts
```

## What NOT to Do

❌ Don't create separate "cleanup" PRs unless the changes are substantial
❌ Don't skip fixing issues because "it's not my code"
❌ Don't leave broken tests or lint errors

The best time to fix a small issue is **when you first see it**.
