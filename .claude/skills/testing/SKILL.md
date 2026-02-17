---
name: testing
description: Comprehensive testing requirements for all code changes. Use this to ensure tests are never skipped and all failures are fixed before completion.
---

# Testing Guidelines

Strict requirements for testing code changes across the Hey Jarvis project.

## Critical Rules

### Never Skip Tests

**CRITICAL**: Tests must NEVER be skipped or disabled.

❌ **NEVER** use `.skip()` to disable tests
❌ **NEVER** comment out failing tests
❌ **NEVER** disable tests in CI/CD environments
❌ **NEVER** ignore test failures

✅ **ALWAYS** let tests fail properly if requirements are not met
✅ **ALWAYS** fix the root cause of test failures

### Required After Changes

**Testing and linting are MANDATORY after making code changes:**

1. **Lint your changes**: Run `bunx nx lint <project>` or `bunx nx affected --target=lint`
2. **Test your changes**: Run `bunx nx test <project>` or `bunx nx affected --target=test`
3. **Build your changes**: Run `bunx nx build <project>` if applicable

If any of these fail, you MUST fix the issues. Do not proceed until all checks pass.

### Keep Fixing Until It Works

**When tests or linting fail, you MUST:**

1. Analyze the failure output carefully
2. Fix the root cause (not the symptom)
3. Re-run the tests/linting
4. Repeat until ALL tests and linting pass

**Do NOT:**
- Skip tests to make things "pass"
- Reduce thresholds or expectations
- Work around the issue without fixing it
- Give up and leave failures unaddressed

## Test Structure Best Practices

### Use Proper Test Frameworks
- Use Jest/Bun test for unit and integration tests
- Follow existing test patterns in the repository
- Use descriptive test names that explain what is being tested

### Test Organization
```typescript
describe('Feature/Component Name', () => {
  describe('method or function name', () => {
    it('should behave correctly when condition', () => {
      // Arrange
      const input = setupTestData();
      
      // Act
      const result = functionUnderTest(input);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.value).toBe(expectedValue);
    });
  });
});
```

### Validation and Error Handling
```typescript
// Check for validation errors
if (isValidationError(result)) {
  throw new Error(`Validation failed: ${result.message}`);
}

// Always validate structure and expected values
expect(result).toBeDefined();
expect(result.property).toBe(expectedValue);
```

### Timeouts
Set appropriate timeouts for async operations:
```typescript
it('should complete async operation', async () => {
  // test code
}, 30000); // 30 second timeout for integration tests
```

## Environment Setup

Tests may require environment variables. Use 1Password CLI to load them:
```bash
eval $(op signin)  # If not already authenticated
```

Check test files for required environment variables and ensure they are configured.

## Running Tests

### Single Project
```bash
bunx nx test <project-name>
```

### All Affected Projects
```bash
bunx nx affected --target=test
```

### With Coverage
```bash
bunx nx test <project-name> --coverage
```

## Running Linting

### Single Project
```bash
bunx nx lint <project-name>
```

### All Affected Projects
```bash
bunx nx affected --target=lint
```

### Auto-fix Issues
```bash
bunx biome check --write .
```

## Workflow

When making code changes, follow this workflow:

1. **Make your changes** - Implement the feature or fix
2. **Run linting** - `bunx nx lint <project>` and fix any issues
3. **Run tests** - `bunx nx test <project>` and fix any failures
4. **Run build** - `bunx nx build <project>` if applicable
5. **Verify manually** - Test the functionality works as expected
6. **Repeat** - If any step fails, fix and re-run all checks

Do NOT consider your work complete until:
- ✅ All linting passes without warnings or errors
- ✅ All tests pass without skipping any
- ✅ The build succeeds (if applicable)
- ✅ Manual verification confirms functionality works

## Common Issues

### Test Failures
1. Read the error message carefully
2. Check if environment variables are missing
3. Verify test data and mocks are set up correctly
4. Debug the actual code being tested
5. Fix the root cause, not the test

### Linting Failures
1. Run `bunx biome check --write .` to auto-fix formatting
2. For remaining issues, read the linting error and fix manually
3. Never disable linting rules to make code pass

### Build Failures
1. Check for TypeScript type errors
2. Ensure all imports are correct
3. Verify dependencies are installed
4. Fix compilation errors in the code

## What NOT to Do

❌ Never skip tests with `.skip()`
❌ Never reduce test expectations to make them pass
❌ Never disable linting rules without good reason
❌ Never ignore build warnings or errors
❌ Never commit code with failing tests
❌ Never commit commented-out tests
❌ Never proceed if tests fail - fix them first
❌ Never give up on fixing issues - keep iterating until resolved
