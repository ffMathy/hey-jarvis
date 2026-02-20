---
name: github-mcp-tools-usage
description: Use GitHub MCP tools for all repository operations instead of CLI or API calls
---

# GitHub MCP Tools Usage

**CRITICAL: Always use GitHub MCP tools** for all GitHub repository operations. Never use curl, gh CLI, or manual API calls.

## Available Tools

The GitHub MCP server provides these tools:

- `mcp_github_github_list_releases` - List all releases in repository
- `mcp_github_github_get_release_by_tag` - Get specific release by tag name
- `mcp_github_github_get_latest_release` - Get the latest published release
- `mcp_github_github_list_tags` - List all tags in repository
- `mcp_github_github_list_branches` - List all branches
- `mcp_github_github_create_branch` - Create a new branch
- `mcp_github_github_create_or_update_file` - Create or update files
- `mcp_github_github_push_files` - Push multiple files in single commit

## Common Use Cases

### Checking Docker Image Availability

✅ **CORRECT: Use MCP tools**
```typescript
const release = await mcp_github_github_get_release_by_tag({
  owner: 'ffmathy',
  repo: 'hey-jarvis',
  tag: 'mcp-v1.0.0'
});
```

❌ **INCORRECT: Don't use curl or manual API calls**
```bash
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/ffmathy/hey-jarvis/releases/tags/mcp-v1.0.0
```

### Listing Available Versions

```typescript
const releases = await mcp_github_github_list_releases({
  owner: 'ffmathy',
  repo: 'hey-jarvis',
  perPage: 20
});
```

### Creating Release Branches

```typescript
await mcp_github_github_create_branch({
  owner: 'ffmathy',
  repo: 'hey-jarvis',
  branch: 'release/v0.3.0',
  from_branch: 'main'
});
```

### Updating Files

```typescript
await mcp_github_github_create_or_update_file({
  owner: 'ffmathy',
  repo: 'hey-jarvis',
  path: 'config.json',
  content: JSON.stringify(config, null, 2),
  message: 'chore: update configuration',
  branch: 'main'
});
```

## Why Use MCP Tools?

- **Type Safety**: Full TypeScript types for requests/responses
- **Error Handling**: Consistent error handling
- **Authentication**: Automatic token management
- **Rate Limiting**: Built-in rate limit handling
- **Documentation**: Self-documenting with schemas

## GitHub Container Registry (GHCR)

When working with Docker images:
1. Always verify release exists before updating image references
2. Check deployment logs in GitHub Actions
3. Use semantic versioning
4. Ensure multi-arch images for Home Assistant compatibility

## What NOT to Do

❌ Never use `curl` for GitHub API calls
❌ Never use `gh` CLI commands
❌ Never construct API URLs manually
❌ Never handle authentication manually
