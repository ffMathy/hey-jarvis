# TypeScript Type Safety - Update

## NEVER Use `any` Casts

**CRITICAL**: Using `as any` casts is NEVER allowed in this codebase. Type casts hide compilation issues and mask real bugs.

### Why `any` Casts Are Harmful

1. **Hides Real Errors**: Type casts suppress TypeScript's type checking, allowing bugs to slip through
2. **Breaks Refactoring**: Changes to types don't get caught by the compiler
3. **Loses IntelliSense**: IDE autocomplete and type hints stop working
4. **Technical Debt**: Creates maintenance burden for future developers

### What To Do Instead

#### 1. Fix The Root Type Issue
If there's a type mismatch, fix it properly:
- Define proper schemas
- Use generics correctly  
- Validate runtime data with proper type guards

#### 2. Use Runtime Validation
For external data, use Zod validation:
```typescript
// WRONG - using any cast
const data = externalAPI.getData() as any;

// RIGHT - validate with Zod
const schema = z.object({ name: z.string() });
const data = schema.parse(externalAPI.getData());
```

#### 3. Use Type Narrowing
Use TypeScript's type narrowing features:
```typescript
// WRONG
const value = data.value as string;

// RIGHT
if (typeof data.value === 'string') {
  const value = data.value; // TypeScript knows it's a string
}
```

#### 4. Request Library Fixes
If a third-party library has type issues, file a bug report or contribute a fix.

### Known Mastra V1 Type System Limitations

Mastra V1 has some type system incompatibilities with `SchemaWithValidation<T>` that cannot be resolved without changes to Mastra itself. These are documented issues and should be reported to the Mastra team rather than worked around with casts.

### Enforcement

Pull requests with `as any` casts will be rejected. Use proper TypeScript patterns instead.
