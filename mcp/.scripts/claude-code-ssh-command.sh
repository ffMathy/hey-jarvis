#!/bin/sh
# The only thing the coding vertical's SSH key can run on the Claude Code host.
#
# Installed root-owned as /usr/local/bin/jarvis-claude-code, and set as the key's forced command in
# the jarvis user's authorized_keys (see "Letting Jarvis code on your Claude subscription" in
# mcp/README.md). sshd runs it whatever command the connection asked for, and hands that request
# over in SSH_ORIGINAL_COMMAND. So the MCP container gets no shell on the host: all it can choose is
# which session to run, and everything else is fixed here -- including that it runs in the jarvis
# Docker Sandbox, never on the host itself.
#
# The request is exactly one of:
#
#   start <session id>
#   resume <session id>
#
# Both mean "run this session". The word is only the client's guess: whether Claude Code starts the
# session afresh or resumes it is decided in the sandbox, by whether its transcript is there, so a
# client that guessed wrong -- a first run that failed before Claude Code wrote anything, or one
# that wrote the transcript without the client seeing a line of it -- cannot wedge the session.
#
# The first line of stdin is the Claude subscription token; the rest is Claude Code's own
# stream-json input. The mirror of this is `claude-code-host.ts`.
set -eu

# sshd accepts LC_* from the client, so pin the locale: bracket ranges below must stay byte-based.
export LC_ALL=C

reject() {
  echo "jarvis-claude-code: refusing \"${SSH_ORIGINAL_COMMAND:-}\" -- expected \"start <session id>\" or \"resume <session id>\"" >&2
  exit 64
}

request=${SSH_ORIGINAL_COMMAND:-}
mode=${request%% *}
session_id=${request#* }

case "$mode" in
  start | resume) ;;
  *) reject ;;
esac

# The id is interpolated into the command the sandbox runs, so it has to be a UUID and nothing
# more: no character outside [0-9a-f-] -- which rules out spaces, quotes and newlines -- and the
# shape of one on top.
case "$session_id" in
  *[!0-9a-f-]* | '') reject ;;
esac
printf '%s\n' "$session_id" | grep -Eqx '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' || reject

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
