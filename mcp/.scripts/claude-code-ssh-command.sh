#!/bin/sh
# The only thing the coding vertical's SSH key can run on the Claude Code host.
#
# Installed root-owned as /usr/local/bin/jarvis-claude-code, and set as the key's forced command in
# the jarvis user's authorized_keys (see "Letting Jarvis code on your Claude subscription" in
# mcp/README.md). sshd runs it whatever command the connection asked for, and hands that request
# over in SSH_ORIGINAL_COMMAND. So the MCP container gets no shell on the host: all it can choose is
# whether to start or resume a session, and which one, and everything else is fixed here --
# including that it runs in the jarvis Docker Sandbox, never on the host itself.
#
# The request is exactly one of:
#
#   start <session id>     start a new Claude Code session under that id
#   resume <session id>    continue an existing one
#
# The first line of stdin is the Claude subscription token; the rest is Claude Code's own
# stream-json input. The mirror of this is `claude-code-host.ts`.
set -eu

reject() {
  echo "jarvis-claude-code: refusing \"${SSH_ORIGINAL_COMMAND:-}\" -- expected \"start <session id>\" or \"resume <session id>\"" >&2
  exit 64
}

request=${SSH_ORIGINAL_COMMAND:-}
mode=${request%% *}
session_id=${request#* }

case "$mode" in
  start) session_flag=--session-id ;;
  resume) session_flag=--resume ;;
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
IFS= read -r CLAUDE_CODE_OAUTH_TOKEN || reject
export CLAUDE_CODE_OAUTH_TOKEN

# Inside the sandbox, every session works in a directory of its own, and is resumed from the one it
# started in, because that is where Claude Code keeps its transcript. `$HOME` is escaped so the
# sandbox expands it, not this shell.
#
# --input-format stream-json   messages arrive as JSON lines on stdin, so a follow-up can be written
#                              to a process that is still working
# --dangerously-skip-permissions   nobody is there to answer a prompt; the sandbox bounds the session
exec sbx exec -i -e CLAUDE_CODE_OAUTH_TOKEN jarvis sh -c "\
mkdir -p \"\$HOME/jarvis-sessions/$session_id\" && \
cd \"\$HOME/jarvis-sessions/$session_id\" && \
exec claude --print --input-format stream-json --output-format stream-json --verbose \
--dangerously-skip-permissions $session_flag $session_id"
