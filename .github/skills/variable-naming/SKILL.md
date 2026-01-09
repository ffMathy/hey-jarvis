---
name: variable-naming
description: Variable naming conventions for the Hey Jarvis project. Use this when naming any variables, functions, or identifiers in code.
---

# Variable Naming Conventions

**CRITICAL: Never shorten variable names** - clarity is more important than brevity.

## Rules

Variable names should be:
- Self-documenting and immediately understandable
- Longer descriptive names over short abbreviated ones
- Clear about what they represent

## Examples

✅ **GOOD - Full descriptive names:**
```typescript
const requirements = [...];
const acceptanceCriteria = [...];
const implementation = {...};
const dependencies = [...];
```

❌ **BAD - Shortened abbreviations:**
```typescript
const req = [...];      // ❌ NEVER
const ac = [...];       // ❌ NEVER
const impl = {...};     // ❌ NEVER
const deps = [...];     // ❌ NEVER
```

## Rationale

- **Readability**: Code is read far more often than written
- **Maintainability**: Future developers (including you) will understand the code
- **Self-Documentation**: Good names reduce the need for comments
- **IDE Support**: Modern IDEs have autocomplete - typing long names is not a burden

## Special Cases

The only acceptable abbreviations are industry-standard terms:
- `id` (identifier)
- `url` (Uniform Resource Locator)
- `api` (Application Programming Interface)
- `html`, `css`, `json` (well-known formats)
- `i`, `j`, `k` (only in short loop contexts)

## Apply Consistently

This applies to:
- Variable names
- Function names
- Parameter names
- Class/interface names
- File names
