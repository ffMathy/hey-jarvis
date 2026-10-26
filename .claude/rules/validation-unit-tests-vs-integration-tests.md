# Unit Tests vs Integration Tests

> Part of [Testing Guidelines](validation.md).

The suite is split in two by file name:

- `*.spec.ts` / `*.test.ts` — mocked, offline, no credentials. Run by `turbo test`.
- `*.integration.spec.ts` — real credentials, real APIs, real quota. Run by `turbo test:integration`.

| | `*.spec.ts` / `*.test.ts` | `*.integration.spec.ts` |
| --- | --- | --- |
| Target | `turbo test` | `turbo test:integration` |
| Secrets | none — the job runs with an empty environment | the full `Jarvis` vault, via `run-with-env.sh` |
| Talks to | nothing outside the process | real APIs, a real Home Assistant, a real ElevenLabs agent |
| Runs in CI | every push | never — only when run by hand |

Only `test:integration` goes through `run-with-env.sh`, so only it resolves
secrets from 1Password. `turbo test` runs with none of them, on purpose.

In CI, `turbo test` runs on every push. `turbo test:integration` never runs on
GitHub Actions — only when someone runs the target explicitly — so a green CI
run says nothing about it.

A new test belongs in `test:integration` when it needs a credential, reaches the
network, or starts the MCP server. Give it the `*.integration.spec.ts` suffix and
the runner picks it up — there is no list to maintain.

Never reach for a real credential from a `*.spec.ts` file to make it pass. Either
mock the dependency, or rename the file so it runs where the credentials live.
