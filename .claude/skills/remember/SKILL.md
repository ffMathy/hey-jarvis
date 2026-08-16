---
name: remember
description: Capture a durable instruction, preference, or correction into a project rule (or, rarely, a skill or hook). Use whenever the user says "remember this", "remember that", "always do X", "never do Y", "from now on", "going forward", "make this a rule", "don't forget", "stop doing X", or corrects the same mistake twice — anything that should still hold in a future session.
---

# Remember

Turn a durable instruction from the user into a checked-in artifact under `.claude/`, so it survives the session.

**Default to a rule.** Reach for a skill only when the guidance is optional, situational, and cannot be tied to a path glob.

## 1. Confirm it's worth remembering

Capture it when the instruction:

- Generalizes beyond the current file or task ("always", "never", "from now on", "we prefer…")
- Is a correction you'd otherwise repeat next session
- States a project convention, tool preference, or forbidden pattern

Do **not** capture it when it's a one-off ("rename this variable"), when it only restates something already covered by an existing rule, or when it's a fact about the *current* task rather than about how work should be done. If it's genuinely ambiguous, ask the user before writing anything.

**Never write a secret into a rule or skill.** If the instruction contains an API key, token, or password, capture the *behavior* and reference the variable name only — never the value.

## 2. Pick the artifact

Decide in this order:

### Hook — when the harness must *enforce* it

If the instruction is "every time you do X, run Y" or "block me from doing Z", a rule alone won't hold — it needs a hook in `.claude/settings.json`. Signals: "each time", "before/after every", "prevent", "block", "automatically run".

Use the `update-config` skill for hooks. Existing examples live in `.claude/hooks/`. A hook usually deserves a companion rule so the reasoning is visible, not just the enforcement.

### Rule — the default

A rule is a markdown file in `.claude/rules/`. Two flavors:

**Path-scoped** (preferred whenever possible) — frontmatter with `paths` globs, loaded only when matching files are in play:

```markdown
---
paths:
  - "mcp/mastra/verticals/**/tools.ts"
---

# Mastra Tools
...
```

**Always-on** — no frontmatter, loaded into every session. Reserve this for guidance with no meaningful file scope (commit format, command runner, security posture).

Prefer the narrowest glob that still catches every case. Broad-but-real (`**/*.ts`) beats always-on for anything code-specific.

### Skill — only when a rule genuinely won't fit

Choose a skill only if **all** of these hold:

- The guidance is **optional and situational** — needed for a specific kind of task, not for a file type
- It **cannot be targeted by a path glob** — no set of file patterns identifies when it applies
- It's substantial enough that loading it unconditionally would be wasteful, or it bundles scripts/reference files

A skill is a directory `.claude/skills/<name>/SKILL.md` with `name` and `description` frontmatter, where the description carries the trigger phrases. Use the `skill-creator` skill to build it.

**If you're torn between a rule and a skill, write the rule.**

## 3. Prefer editing over creating

Search `.claude/rules/` before writing a new file. Adding a bullet or a section to an existing rule is almost always better than a new near-duplicate — overlapping rules drift apart and contradict each other.

Only create a new rule when the topic has no existing home, or when the new guidance needs a *different* path scope than any existing rule.

## 4. Write it

Match the style of the existing rules:

- Imperative and specific — "Never use `any`", not "try to avoid `any` where possible"
- Mark the non-negotiable parts with **CRITICAL** / **NEVER** / **ALWAYS**
- Show a ❌ BAD and a ✅ GOOD example when the rule is about code
- Explain *why* in a line or two — a rule whose reason is clear survives edge cases
- Keep it short; a rule nobody finishes reading isn't a rule

Name the file after the topic, kebab-case: `.claude/rules/error-handling.md`.

## 5. Close the loop

1. Tell the user exactly what you wrote and where, in one or two lines
2. If it changes how existing code should look, apply it to the code in front of you now
3. Commit it with a `chore(rules):` or `docs(rules):` conventional commit

## Quick reference

| The user says | Capture as |
| --- | --- |
| "Never use `any` in TypeScript" | Path-scoped rule (`**/*.ts`) |
| "Always use Turborepo commands" | Always-on rule |
| "Tool IDs must match the variable name" | Path-scoped rule (`**/tools.ts`) |
| "Never commit without running tests" | Always-on rule (+ hook if it must be enforced) |
| "Every time you edit a file, run the linter" | Hook + rule |
| "When I ask for a release, follow these 8 steps" | Skill (situational workflow, no path scope) |
| "Rename this to `userName`" | Nothing — one-off edit |
