#!/bin/sh
# The only thing the coding vertical's SSH key can run on the Claude Code host.
#
# Installed root-owned as /usr/local/bin/jarvis-claude-code, and set as the key's forced command in
# the jarvis user's authorized_keys (see "Letting Jarvis code on your Claude subscription" in
# mcp/README.md). sshd runs it whatever command the connection asked for, and hands that request
# over in SSH_ORIGINAL_COMMAND. So the MCP container gets no shell on the host: all it can choose is
# which session to run or export, and everything else is fixed here -- including that it runs in
# the jarvis Docker Sandbox, never on the host itself.
#
# The request is exactly one of:
#
#   start <session id>
#   resume <session id>
#   export <session id>
#
# `start` and `resume` both mean "run this session". The word is only the client's guess: whether
# Claude Code starts the session afresh or resumes it is decided in the sandbox, by whether its
# transcript is there, so a client that guessed wrong -- a first run that failed before Claude Code
# wrote anything, or one that wrote the transcript without the client seeing a line of it -- cannot
# wedge the session. For those two, the first line of stdin is the Claude subscription token; the
# rest is Claude Code's own stream-json input.
#
# `export` writes the session's work to stdout as a git bundle, and nothing else. The sandbox holds
# no GitHub credential that can push, so the server fetches the work this way and publishes it with
# its own. It reads no token and no input at all.
#
# The mirror of this is `claude-code-host.ts`.
set -eu

# sshd accepts LC_* from the client, so pin the locale: bracket ranges below must stay byte-based.
export LC_ALL=C

reject() {
  echo "jarvis-claude-code: refusing \"${SSH_ORIGINAL_COMMAND:-}\" -- expected \"start <session id>\", \"resume <session id>\" or \"export <session id>\"" >&2
  exit 64
}

request=${SSH_ORIGINAL_COMMAND:-}
mode=${request%% *}
session_id=${request#* }

case "$mode" in
  start | resume | export) ;;
  *) reject ;;
esac

# The id is interpolated into the command the sandbox runs, so it has to be a UUID and nothing
# more: no character outside [0-9a-f-] -- which rules out spaces, quotes and newlines -- and the
# shape of one on top.
case "$session_id" in
  *[!0-9a-f-]* | '') reject ;;
esac
printf '%s\n' "$session_id" | grep -Eqx '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' || reject

# What `export` runs in the sandbox, step by step. As below, `$HOME` and the sandbox's own variables
# are escaped so the sandbox expands them; the session id is the only thing interpolated here.
#
# 1. The session's repository is its directory itself, because sessions clone into `.`. Git is
#    pointed at `.git` there explicitly rather than left to look for one, so a session that never
#    cloned cannot have some other repository further up exported in its place.
# 2. The same lock `start` and `resume` take, so a turn is never exported halfway through. The
#    server exports as soon as a turn ends, while the process that ran it may still be exiting, so
#    it waits briefly -- but a session that has started another turn is busy, and exits with 75.
# 3. The bundle holds every local branch, less everything the remote's default branch already had
#    when the session last fetched it (`^refs/remotes/origin/<default>`). So its prerequisites --
#    the commits it builds on without carrying -- all lie on that default branch, and the server
#    satisfies them by fetching the default branch from GitHub before it unbundles: a default branch
#    only moves forward, so what it had then it still has.
#
# Exit codes: 66 no session directory or no repository in it, 67 nothing committed beyond the
# default branch, 68 no default branch to export against (no `origin/HEAD`), 70 git itself failed,
# 75 the session is busy.
if [ "$mode" = export ]; then
  exec sbx exec jarvis sh -c "\
unset CDPATH; \
cd \"\$HOME/jarvis-sessions/$session_id\" 2>/dev/null && [ -d .git ] || { echo \"jarvis-claude-code: session $session_id has no repository in its directory\" >&2; exit 66; }; \
exec 9>>\"\$HOME/jarvis-sessions/$session_id.lock\" && \
flock -w 30 9 || { echo \"jarvis-claude-code: session $session_id is still running in another process\" >&2; exit 75; }; \
base=\$(git --git-dir=.git symbolic-ref --quiet refs/remotes/origin/HEAD) || { echo \"jarvis-claude-code: session $session_id has no origin/HEAD, so no default branch to export against\" >&2; exit 68; }; \
count=\$(git --git-dir=.git rev-list --count --branches \"^\$base\") || { echo \"jarvis-claude-code: could not count the commits of session $session_id\" >&2; exit 70; }; \
[ \"\$count\" -gt 0 ] || { echo \"jarvis-claude-code: session $session_id has committed nothing beyond \$base\" >&2; exit 67; }; \
git --git-dir=.git bundle create --quiet - --branches \"^\$base\" || { echo \"jarvis-claude-code: could not bundle session $session_id\" >&2; exit 70; }" </dev/null
fi

# The token comes in on stdin rather than in the request, so it is never part of a command line on
# either side of the SSH hop, and `sbx exec -e` hands it on into the sandbox.
reject_token() {
  echo "jarvis-claude-code: expected the Claude subscription token on the first line of input" >&2
  exit 65
}
IFS= read -r CLAUDE_CODE_OAUTH_TOKEN || reject_token
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || reject_token
export CLAUDE_CODE_OAUTH_TOKEN

# What the sandbox runs, step by step. `$HOME` and the sandbox's own variables are escaped so the
# sandbox expands them, not this shell; the session id is the only thing interpolated here.
#
# 1. Every session works in a directory of its own, and is resumed from the one it started in,
#    because Claude Code keys its transcripts by working directory.
# 2. One process per session. A dropped SSH connection can leave the previous `claude` finishing
#    its turn in the sandbox, and two processes on one transcript corrupt it, so the session's lock
#    is taken first, waiting up to two minutes for that process to let go, and exiting with 75
#    (EX_TEMPFAIL) if it does not. The lock lives beside the session's directory rather than in it,
#    so the session's working directory stays empty for a `git clone` into it. It is held by the
#    shell, which waits for `claude`: `claude` itself gets the descriptor closed (`9>&-`), so a
#    background process the session leaves behind cannot keep the lock after it exits -- and the
#    shell does not end on `claude`, because a shell may `exec` the last command it runs.
# 3. Under the lock, a transcript already written means the session is resumed; none means it is
#    started under its id.
#
# --input-format stream-json   messages arrive as JSON lines on stdin, so a follow-up can be written
#                              to a process that is still working
# --dangerously-skip-permissions   nobody is there to answer a prompt; the sandbox bounds the session
exec sbx exec -i -e CLAUDE_CODE_OAUTH_TOKEN jarvis sh -c "\
mkdir -p \"\$HOME/jarvis-sessions/$session_id\" && \
cd \"\$HOME/jarvis-sessions/$session_id\" && \
exec 9>>\"\$HOME/jarvis-sessions/$session_id.lock\" && \
{ flock -w 120 9 || { echo \"jarvis-claude-code: session $session_id is still running in another process\" >&2; exit 75; }; } && \
session_flag=--session-id && \
for transcript in \"\$HOME\"/.claude/projects/*/$session_id.jsonl; do if [ -s \"\$transcript\" ]; then session_flag=--resume; fi; done && \
claude --print --input-format stream-json --output-format stream-json --verbose \
--dangerously-skip-permissions \$session_flag $session_id 9>&-; \
exit \$?"
