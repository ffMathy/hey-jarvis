# Security Guidelines

Rules for handling secrets, environment variables, and sensitive data.

## Critical Rules

### Never Read Environment Variables

**CRITICAL**: You must NEVER attempt to read, print, log, or display the value of any environment variable.

Environment variables frequently contain sensitive secrets (API keys, tokens, passwords, connection strings). Treat **all** environment variables as potentially sensitive — not just the ones that look like secrets.

❌ **NEVER** run `echo $VAR`, `printenv`, `env`, or any command that outputs environment variable values
❌ **NEVER** read `.env`, `.env.local`, `op.env.local`, or similar files (the `block-op-env.sh` hook enforces this for `op.env.local`)
❌ **NEVER** write code that logs or prints `process.env.VAR` values at runtime
❌ **NEVER** use `console.log(process.env.SECRET)` or equivalent in any language
❌ **NEVER** include environment variable values in commit messages, comments, or output

### What You CAN Do

When debugging whether an environment variable is correctly set, you are allowed to write code that reveals **only non-sensitive metadata**:

✅ **Check if a variable is set** (defined vs undefined)
✅ **Check the length** of a variable's value
✅ **Reveal the last 3 characters** to help the user confirm which key/token is loaded

#### Examples of Allowed Code

```typescript
// Check if set
if (!process.env.API_KEY) {
  console.error('API_KEY is not set');
}

// Check length
console.log(`API_KEY length: ${process.env.API_KEY?.length ?? 'not set'}`);

// Reveal last 3 characters
const key = process.env.API_KEY;
if (key) {
  console.log(`API_KEY: ...${key.slice(-3)} (${key.length} chars)`);
}
```

#### Examples of Forbidden Code

```typescript
// NEVER do this
console.log(process.env.API_KEY);
console.log(JSON.stringify(process.env));
console.log(`Key is: ${process.env.API_KEY}`);
```

### Environment Files

- **Never read** `.env`, `.env.local`, `.env.production`, `op.env.local`, or any file whose purpose is to store environment variables
- **You may edit** these files (e.g., to add a new variable name) as long as you do not read them first — use the Write tool to append or the Edit tool with a known structure
- When a user asks you to add a new env var, ask them for the value or instruct them to add it manually rather than reading the file to see what's there

### Secrets in Code

- Never hardcode secrets, tokens, or credentials in source code
- Use environment variables or secret management tools (e.g., 1Password, Vault) instead
- If you encounter a hardcoded secret while working on code, flag it to the user immediately
