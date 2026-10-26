# Rules, Not AGENTS.md

**CRITICAL: NEVER create an `AGENTS.md` or `CLAUDE.md` file, anywhere in the repository, and never write to one.** Everything an agent needs to know lives in [`.claude/`](..):

- **[`.claude/rules/`](.)** — guidelines. A rule with a `paths` frontmatter glob loads only when matching files are in play; a rule without one applies to every session.
- **[`.claude/skills/`](../skills/)** — optional, situational workflows that are loaded on demand.

## Where what would have been an AGENTS.md goes

**ALWAYS write it as rules whose `paths` frontmatter scopes them to that directory**, the way an `AGENTS.md` applied to its own folder: a project's notes are scoped to `<project>/**`. What the root `AGENTS.md` held applies everywhere, so those rules have no `paths`.

✅ **GOOD** — `.claude/rules/vr-the-wake-word-src-wake.md`:

```markdown
---
paths:
  - "vr/**"
---

# The wake word (`src/wake/`)
...
```

❌ **BAD** — `vr/AGENTS.md`, or a `## The wake word` section appended to it.

## One topic per rule

**ALWAYS give each topic its own rule, even when several share the same `paths`.** A rule is one thing: the wake word, where he stands, the release process. Never a project's whole manual.

- A project's rules are named `<project>-<topic>.md`.
- `<project>.md` is the project's overview: what it is, and an index linking every one of its rules.
- When a topic outgrows one rule, split it again into `<project>-<topic>-<subtopic>.md`, and link the pieces from the rule they came out of.
- Link a section in another rule as `[Its heading](other-rule.md#its-heading)`, so a link survives a section moving to a rule of its own.

Why: a monolithic rule is loaded whole whenever any file under its path is touched. It is read less carefully, and two people changing different topics in it conflict. Small rules are found by name, loaded only when their path is in play, and changed without touching the rest.

Prefer a rule over a skill. Use the [`remember`](../skills/remember/SKILL.md) skill to capture a new convention into the right place.
