---
paths:
  - "mcp/**"
---

# Processors

> Part of [Jarvis Mastra AI Agents](mcp.md). Paths in it are relative to `mcp/` unless they say otherwise.

## 🔍 **Output Processors**
This project implements custom output processors that run after agent responses are generated. Processors enable post-processing logic without blocking the main agent flow.

## **Error Reporting Processor**
Automatically captures errors from agent responses and creates GitHub issues with sanitized information.

**Features:**
- **Asynchronous execution**: Runs in background without blocking agent responses
- **Error detection**: Scans agent output for error indicators (keywords: "error", "failed", "exception", "stack trace")
- **PII sanitization**: Uses Mastra's built-in PIIDetector to remove sensitive information before creating issues
- **GitHub integration**: Creates issues using the `createGitHubIssue` tool
- **Automatic integration**: Added to ALL agents by default via agent factory
- **Configurable**: Labels, repository, and enable/disable options

**Automatic Integration:**
The error reporting processor is automatically added to all agents created with `createAgent()`. No manual configuration needed - every agent gets error reporting by default.

```typescript
// Error reporting is automatically included
export async function getMyAgent() {
  return createAgent({
    name: 'MyAgent',
    instructions: '...',
    tools: myTools,
    // Error reporting processor is automatically added
  });
}
```

**Configuration:**
- `owner` (optional): Repository owner, defaults to "ffMathy"
- `repo` (required): Repository name where issues will be created
- `labels` (optional): Issue labels, defaults to `["automated-error", "bug"]`
- `enabled` (optional): Enable/disable processor, defaults to `true`

**Environment Requirements:**
- `HEY_JARVIS_GITHUB_API_TOKEN`: GitHub Personal Access Token with `repo` scope

**How It Works:**
1. After agent generates response, processor scans messages for error indicators
2. If error detected, Mastra's PIIDetector sanitizes the error message (removes PII)
3. GitHub issue is created with sanitized error using `createGitHubIssue` tool
4. All processing happens asynchronously - agent response returns immediately

**Testing:**
```bash
# Start MCP server
bunx turbo serve --filter=mcp

# Access playground at http://localhost:4111/agents
# Select any agent (all have error reporting)
# Send message containing error keywords: "error", "failed", "exception", "stack trace"
# Verify agent responds immediately (non-blocking)
# Check GitHub repository for created issue with sanitized error
```

**PII Redaction Examples:**
Mastra's PIIDetector automatically redacts:
- Email: `user@example.com` → `[EMAIL]`
- API Key: `sk_live_abc123` → `[API-KEY]`
- IP Address: `192.168.1.1` → `[IP-ADDRESS]`
- Phone: `555-1234` → `[PHONE]`
- Credit Card: `4111-1111-1111-1111` → `[CREDIT-CARD]`

**Architecture Notes:**
- **Async execution**: Processor doesn't block agent responses (~2-3s background processing)
- **Error detection**: Simple keyword matching (very fast)
- **PII sanitization**: Uses Mastra's PIIDetector with Google Gemini (~1-2 seconds)
- **Issue creation**: GitHub API call (~0.5-1 second)
- **Failure handling**: Processor errors are logged but don't fail the main agent flow
