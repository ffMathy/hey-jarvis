---
paths:
  - "mcp/**"
---

# Coding Agent

> Part of [Jarvis Mastra AI Agents → Current Agents](mcp-current-agents.md). Paths in it are relative to `mcp/` unless they say otherwise.

Reads, analyses and changes code — Jarvis's own above all — and manages GitHub repositories:
- **6 agent tools** (`codingTools`): list repositories (`listUserRepositories`), list issues (`listRepositoryIssues`), search repositories (`searchRepositories`), answer questions about the code (`analyzeCodebase`), and follow and steer Claude Code sessions (`getCodingSessionStatus`, `sendCodingSessionMessage`). `tools.ts` also defines `startCodingSession` and `runCodingTask`, which `implementFeatureWorkflow` and other verticals' shortcuts run rather than the agent, and `createGitHubIssue` and `updateGitHubIssue`, which nothing registers today
- **Google Gemini model**: Uses `gemini-flash-latest` for natural language processing
- **Repository management**: Browse and search repositories for any GitHub user
- **Issue tracking**: View open, closed, or all issues for repositories
- **Codebase questions**: `analyzeCodebase` has a Claude Code session read the code and answer — how something works, a review, ideas for improvement, technical debt — without changing anything. It is `runCodingTask` with a read-only brief (`buildCodebaseQuestionTask`), and it is slow like the tool it wraps. A `context` input carries what the code cannot show, most often the reflection agent's failures, which live in Mastra's storage where a session cannot reach. Before it existed, a question about Jarvis's own code had no agent to go to, and "gather ideas to improve Jarvis and visualize them" was planned onto web research. The planned shape now is reflection → coding → visualize, one chain, each handed the previous answer
- **Workflow coordination**: Triggers requirements gathering workflow for new feature requests
- **Smart defaults**: a task with no repository named is a task on Jarvis himself, `ffMathy/hey-jarvis` (`coding/repository.ts`). Every tool, `implementFeatureWorkflow` and the agent default to it, and the implementing session is told the repository up front and never asks which one is meant
- **Reports the repository it works on**: the tools that take a repository, and `implementFeatureWorkflow` called as a tool, report it as its lower-cased `owner/repo` (`describeRepository`) for sir's headset to light up (see [What a request touches](mcp-routing-affected-entities.md#affected-entities))

**Key Capabilities:**
- List all public repositories for a GitHub user
- Search repositories by name, keywords, or topics
- View issues with filtering by state (open/closed/all)
- Follow and steer running Claude Code sessions
- Trigger requirements gathering workflow for new implementations
- Provide GitHub URLs for quick access to repositories and issues

**Architecture Pattern:**
This agent follows the **workflow delegation pattern**. When a user requests a new feature implementation, instead of gathering requirements itself, it delegates to the `implementFeatureWorkflow`, which starts a Claude Code session on the change at once — no issue is filed, and nothing is asked first. The session reads the codebase, decides whatever the code settles, and implements the change; a request the code settles is never held up by a question. The workflow returns as soon as the session has started, so it is not marked slow.

**Never a refusal.** Whether to act is never the coding agent's call, nor the session's: its own
instructions (`agent.ts`) say so outright, and `buildSessionQuestionInstructions` and
`buildUnattendedSessionInstructions` in `session-questions.ts` tell the session the same, right next
to "decide it yourself" — the only thing that can stop it is a choice that is sir's to make, never
whether the change happens at all. A request that reads as unusual, broad or risky is carried out
like any other, and an unattended session, with nobody to ask, carries it out too rather than leaving
it undone.

**Questions a coding session asks:**
Only a choice that is the user's to make stops a session, and it can come up at any point — before
the session has changed a line, or halfway through. The session is told how
(`buildSessionQuestionInstructions` in `session-questions.ts`): end the turn on a fenced block tagged
`jarvis-question` holding one short spoken question, and nothing after it. When
`ClaudeSessionWatcher` sees a turn end with `end_turn` on such a block (`readSessionQuestion`), it
publishes nothing for that turn and instead asks through `createSessionQuestionAsker`:

1. `askUserQuestion` opens the question with a `deliverAnswer` function that sends the answer to the
   session (`sendClaudeSessionMessage`), then asks it with `askQuestion` — a call in the car or away,
   the house speakers at home (see the [Notification Agent](mcp-notification-agent.md#notification-agent)).
2. The watcher reports `coding_session_question_asked` (question, id, channel) or
   `coding_session_question_failed` to Synapse.
3. The user answers on that call, on the speakers, or the next time he talks to Jarvis. His words go
   through `routePromptWorkflow`, the planner matches them to the open question, and the controller
   hands them to `deliverAnswer`, which resumes the session with everything it had done. Jarvis tells
   him the answer was passed on; the session's own reply arrives later as its events always do.

This replaced a separate analysing session and an up-front interview that suspended the workflow
once per question. That always cost minutes before anything was built, and its questions went out
through `sendNotification`, whose channels could not hear an answer.

**Claude Code Sessions:**
Implementation work is delegated to the official [Claude Code CLI](https://code.claude.com/docs/en/headless), signed
in to the user's Claude **subscription** with a token from `claude setup-token` — so it is billed there, not to an API
key. It runs inside a [Docker Sandbox](https://docs.docker.com/ai/sandboxes/) named `jarvis` on the host: a microVM
with its own filesystem, Docker daemon and egress proxy, which is what bounds a session that skips permission prompts.
A sandbox needs KVM and the `sbx` daemon on the host, so the server reaches the host over SSH and runs
`sbx exec -i jarvis …` there (`claude-code-host.ts`). The SSH key gets no shell: its forced command,
`mcp/.scripts/claude-code-ssh-command.sh`, accepts only `start <session id>`, `resume <session id>` or
`export <session id>` and fixes the sandbox, the directory and the `claude` and `git` command lines itself, so a
compromised container can start sessions in the sandbox, fetch their work, and do nothing else on the host.
`claude-code-ssh-command.spec.ts` runs it under `sh` with a fake `sbx` that goes on to run the sandbox's half against
a fake `flock` and `claude` and the real `git`, and most of what it checks is what the script refuses. The fakes
report to a log file, not stdout, because `export`'s stdout must be the bundle alone. It sets `PATH` to
`/usr/bin:/bin`, so it runs on Linux (CI) and not under Windows' own `sh` lookup. The subscription token travels on
the first line of stdin, never on a command line. Each run of a session is one `claude --print` process in
`~/jarvis-sessions/<session id>` inside the sandbox, talking stream-json both ways. The session clones the repository
anonymously over HTTPS, works unattended, commits on a `jarvis/…` branch, and pushes nothing — the server publishes
its work (below).

**The sandbox cannot write to GitHub; the server publishes.** A session started by `startCodingSession` is told
(`buildSessionWorkInstructions` in `publish-session-work.ts`) to commit on a branch named `jarvis/<description>`, not
to push or open a pull request, and to end its final message with a fenced block tagged `jarvis-pull-request`
holding `{"branch", "title", "body"}` as JSON. `readSessionWork` takes the block from the last such opening fence to
the message's last closing fence — so a description with code fences of its own survives — and validates it with
zod; a turn without it (a question, say) publishes nothing. When `ClaudeSessionWatcher` sees such a session go idle
with `end_turn`, it calls `publishSessionWork`, which:

1. refuses a branch outside `jarvis/` before anything else;
2. runs `export <session id>` over the same SSH path (`exportSessionWorkOverSsh`), capped at
   `MAXIMUM_BUNDLE_BYTES` (50 MB), past which the connection is dropped. In the sandbox that takes the session's
   lock (`flock -w 30`, exit **75** if a turn is running), locates the repository at the session's directory
   itself (`--git-dir=.git`, no discovery upwards), and writes
   `git bundle create - --branches ^refs/remotes/origin/<default>` to stdout — every local branch, less what the
   default branch had when the session last fetched. So every prerequisite of the bundle is a commit of the default
   branch, which only moves forward, and the server satisfies them by cloning the default branch before it
   unbundles. Other exits: **66** no repository, **67** nothing committed, **68** no `origin/HEAD`, **70** git
   failed;
3. in a temporary directory, removed afterwards whatever happens, makes a bare, blobless, single-branch clone of the
   default branch from GitHub and fetches the branch out of the bundle with `fetch.fsckObjects`;
4. refuses the default branch itself, a branch with no commits of its own, and a branch whose `CI_PROTECTED_PATHS` —
   `.github/workflows/`, `.github/actions/` and `.github/actions.lock`, one constant — differ at all from the default
   branch's current tip, because the repository's own branches, and pull requests from them, run its workflows with
   its secrets. The tip rather than the merge-base, since a pushed branch runs the workflows of its own head commit,
   and one based on an old commit would bring back that commit's workflows; a branch that is merely behind a change
   to CI is refused until it is rebased;
5. pushes the branch, without force, with `HEY_JARVIS_GITHUB_API_TOKEN`, handed to git as an
   `http.https://github.com/.extraheader` through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` in an
   environment with nothing of the server's in it — never on a command line;
6. opens the pull request with the vertical's Octokit client (`github-client.ts`), or finds the one already open for
   the branch, which the push has just updated.

The outcome reaches Synapse as `coding_session_pull_request_opened` (with `pullRequestUrl`) or
`coding_session_pull_request_failed` (with `error`, and `refused: true` when the work broke a rule rather than the
publishing failing). `runCodingTask` sessions are never watched, so they never publish. The container's image
carries `git` for this.

**The host decides between starting and resuming.** `start` and `resume` both mean "run this session": inside the
sandbox the forced command passes `--resume` when `~/.claude/projects/*/<session id>.jsonl` exists and is not empty,
and `--session-id` otherwise. The server still sends its guess, since a host on the older forced command goes by it,
but a wrong guess — a first run that died before Claude Code wrote anything, or one that wrote the transcript without
the server seeing a line — can no longer wedge a session into `No conversation found` or `already in use`.

**One process per session.** Before running `claude`, the sandbox takes `flock -w 120` on
`~/jarvis-sessions/<session id>.lock` (beside the session's directory, so the directory stays empty for a clone) and
exits with **75** if another process still holds it after two minutes — as one can when a dropped SSH connection
leaves the previous `claude` finishing its turn. The lock is held by the waiting shell, and `claude` runs with the
descriptor closed, so a background process the session leaves behind cannot hold it. The other exit codes a session
error can carry are **64** (request refused), **65** (no token on stdin) and **255** (SSH itself failed).

`ClaudeCodeSessions` (`claude-sessions.ts`) keeps each session's events in memory, reduced to the four that matter
— `session.status_running`, `agent.message`, `session.status_idle` (with `end_turn` or why else it stopped) and
`session.error`. A message sent while a session works is written to the same process; one sent after it went idle
resumes the session in a new process. Being in memory, sessions do not survive a restart of the server, though their
transcripts stay in the sandbox. Nothing waits on a process without a limit:

- A new process waits 30 seconds for the previous one to exit, then kills it (`ClaudeCodeProcess.kill()`, which ends
  the SSH connection) and launches anyway; the host's lock covers whatever is left in the sandbox.
- A process that goes 60 minutes without closing its turn (`MAXIMUM_TURN_DURATION_MILLISECONDS`, restarted per turn)
  is killed, with a `session.error` and a `timed_out` stop.
- Sending a message to a process that has stopped fails instead of reporting success, and a newly launched process
  that exits within 20 seconds without writing a line (refused, no token, SSH failure) makes `send()` — and so
  `create()` — throw with its exit code and the end of its stderr. The same text reaches the watcher as
  `session.error` for a process that dies later.

The SSH key is written once per server process to a `0600` file in a `0700` directory under the system temp
directory, removed when the server exits; a failed write is retried on the next launch rather than remembered.

Claude Code never runs in the server's own container, which carries the 1Password service account token for the
whole vault.

- **`startCodingSession`**: Creates the session, seeded with the request, how its work gets published and when and
  how it may ask the user something, and starts watching it with `publishTo` set, so the watcher asks its questions
  and opens the pull request once it is done. Used by `implementFeatureWorkflow`.
- **`getCodingSessionStatus`**: Reports a session's status (`running` or `idle`) and the last five messages it has
  produced.
- **`sendCodingSessionMessage`**: Sends a follow-up message to a session, to answer a question or redirect its work.
- **`runCodingTask`**: For work whose result is an answer rather than a pull request. Starts a session on a free-form
  task, waits until its turn ends (`waitForClaudeSessionTurn`, up to 15 minutes) and returns the last message it
  sent. The session is not handed to the watcher, because the caller reports the result itself. Like
  `startCodingSession` it is not one of the coding agent's own tools; the agent's own `analyzeCodebase` wraps it with a read-only brief, and other verticals reach it through shortcuts, such as the
  [Visualize Vertical](mcp-visualize-vertical-shortcuts.md#visualize-vertical-shortcuts)'s `createArtifact`. It is marked slow, and a shortcut
  onto it inherits the mark. Every task it starts ends on `FOREGROUND_WORK_NOTE`, which tells the session to work in
  the foreground: its answer is the last message of its turn, and the process is let go the moment that turn ends,
  so a subagent or command left running in the background is stopped unfinished — and a turn that ends on "waiting
  for the background agent" answers nothing.

**Feeding Back Into Synapse:**
`ClaudeSessionWatcher` follows each session's events and republishes them as Synapse state changes with the source
`coding` and a state type derived from the event type (for example `coding_session_agent_message`). The session has
already dropped what is not worth hearing — Claude Code prints every tool call and its result, and each state change
costs tokens once Synapse reasons over the batch. Events are deduplicated by id, and a failed hand-off is logged
without tearing down the watch. A finished turn is published once, when its `session.status_idle` is first seen, and
the watcher waits for it before handling the session's next event, so a session is never published twice at once.

**Following a Session in Mastra Studio:**
Each event is also recorded in the trace of whatever started the session, as an event span named
`claude session: <event type>` under the span it was started from — the `start-coding-session-tool` step of an
`implementFeatureWorkflow` run, or the `startCodingSession` tool call of an agent. Open that run's trace in Studio to
read Claude's messages, in full, as the session writes them. The run itself finishes as soon as the session starts;
event spans are exported the moment they are made, so they still reach its trace. `createToolStep` hands its step's
`tracingContext` to the tool for this, so anything a tool step traces lands under that step.

**Environment Requirements:**

| Environment variable | 1Password reference | What it is |
| --- | --- | --- |
| `HEY_JARVIS_GITHUB_API_TOKEN` | already mapped in `mcp/op.env` | GitHub token (`Jarvis → GitHub API key`) with **Contents**, **Pull requests** and **Issues** read and write on every repository Jarvis may code on — the tools read repositories and issues, and the server pushes sessions' branches and opens their pull requests with it |
| `HEY_JARVIS_CLAUDE_CODE_SSH_TARGET` | `op://Jarvis/Claude Code/SSH target` | The host with the `jarvis` sandbox: `user@host`, or `ssh://user@host:port`. With the MCP container on host networking (`--network host`), `jarvis@127.0.0.1` — there `host.docker.internal` is the `docker0` gateway, whose port 22 host firewalls commonly drop |
| `HEY_JARVIS_CLAUDE_CODE_SSH_PRIVATE_KEY` | `op://Jarvis/Claude Code/private key?ssh-format=openssh` | The key the host authorizes for that user |
| `HEY_JARVIS_CLAUDE_CODE_OAUTH_TOKEN` | `op://Jarvis/Claude Code/OAuth token` | The subscription token `claude setup-token` prints |

The host itself — 64-bit Linux with KVM and glibc 2.39 or newer, a user of its own signed in to Docker and pinned to
the forced command, and the `jarvis` sandbox, with no GitHub secret for public repositories and only a read-only
one for private ones — is set up as described in **Letting Jarvis code on your Claude subscription** in
`mcp/README.md`. The forced command has to be reinstalled whenever it changes: a copy from before `export` refuses
every export (exit 64), so no session's work is published, and a copy from before it set
`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` lets a session end its turn to wait for a background agent that is then
stopped with it.

The three `HEY_JARVIS_CLAUDE_CODE_*` references live in `mcp/op.optional.env`, not `mcp/op.env`. `op run` fails
on the first reference it cannot resolve, and when they sat in `mcp/op.env` a missing `Claude Code` item crash-looped
both supervisord programs and took all of Jarvis down. Now `.scripts/run-with-env.sh` hands `op run` only the
optional references that resolve (`.scripts/append-optional-env.sh` tests each with `op read`, printing the
reference, never the value), and they never count as missing when deciding whether to fall back to 1Password. A
missing item disables coding sessions and nothing else.

The vertical imports without any of them — `getClaudeCodeHostConfiguration()` throws only when a session is launched,
so repository and issue browsing works on the GitHub token alone and only the tools that start or follow a session
(`startCodingSession`, `runCodingTask` and the session tools) need the host. At startup `mcp-server.ts` checks
`isClaudeCodeHostConfigured()` and logs one warning naming whichever variables are missing
(`getMissingClaudeCodeHostVariables()`, names only).

To resume a session by hand on the host, run
`sbx exec -it -e CLAUDE_CODE_OAUTH_TOKEN jarvis sh -c 'cd ~/jarvis-sessions/<id> && flock -w 120 ../<id>.lock claude --resume <id>'`
as the `jarvis` user with `CLAUDE_CODE_OAUTH_TOKEN` exported first — without `-e` Claude Code in the sandbox runs
unauthenticated, and the `flock` keeps it from overlapping a process Jarvis starts. On a Pi 5, `sbx diagnose` warning about `mkfs.erofs` and 16 KB blocks means the 16 KB-page kernel;
`mcp/README.md` has the fix.

**Example Use Cases:**
- "What repositories does ffMathy have?"
- "Show me open issues in hey-jarvis"
- "Search for repositories about AI agents"
- "I want to add email notifications" _(triggers `implementFeatureWorkflow`)_
