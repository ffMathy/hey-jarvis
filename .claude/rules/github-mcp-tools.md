# GitHub MCP Tools

**CRITICAL: Always use the GitHub MCP tools** for every GitHub operation. Never use `curl`, the `gh` CLI, or hand-built API calls.

## Tool Naming

GitHub MCP tools are exposed as `mcp__github__<operation>`, for example:

| Task | Tool |
| --- | --- |
| List releases | `mcp__github__list_releases` |
| Get a release by tag | `mcp__github__get_release_by_tag` |
| Get the latest release | `mcp__github__get_latest_release` |
| List tags | `mcp__github__list_tags` |
| List branches | `mcp__github__list_branches` |
| Create a branch | `mcp__github__create_branch` |
| Create or update a file | `mcp__github__create_or_update_file` |
| Push several files at once | `mcp__github__push_files` |
| Open a pull request | `mcp__github__create_pull_request` |
| Read a pull request | `mcp__github__pull_request_read` |
| Comment on an issue or PR | `mcp__github__add_issue_comment` |

Not every tool schema is loaded up front. If a tool you need isn't available yet, find it with `ToolSearch` (e.g. `select:mcp__github__list_releases`) before calling it.

## Examples

✅ **CORRECT — use the MCP tool**

```typescript
const release = await mcp__github__get_release_by_tag({
  owner: 'ffmathy',
  repo: 'hey-jarvis',
  tag: 'mcp-v1.0.0',
});
```

❌ **INCORRECT — don't shell out**

```bash
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/ffmathy/hey-jarvis/releases/tags/mcp-v1.0.0
```

## Why

- **Authentication** is handled for you — no token ever touches a command line
- **Rate limiting** and retries are built in
- **Typed** requests and responses, with self-documenting schemas
- **Consistent error handling** instead of parsing raw HTTP output

## GitHub Container Registry (GHCR)

When working with Docker images:

1. Verify the release exists before updating any image reference
2. Check deployment logs in GitHub Actions
3. Use semantic versioning
4. Ensure images are multi-arch for Home Assistant compatibility

## What NOT to Do

❌ Never use `curl` for GitHub API calls
❌ Never use `gh` CLI commands
❌ Never construct API URLs manually
❌ Never handle authentication yourself
