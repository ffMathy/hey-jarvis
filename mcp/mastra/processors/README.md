# Error Reporting Processor

This directory contains an async output processor that automatically captures errors from agent responses and creates GitHub issues with sanitized error information.

## Overview

The Error Reporting Processor:
- **Runs asynchronously** (non-blocking) after agent responses complete
- **Detects error conditions** in agent output messages
- **Sanitizes PII** using the ErrorFilter agent before creating issues
- **Creates GitHub issues** automatically with filtered error details

## Components

### 1. Error Reporting Processor (`error-reporting.ts`)
An output processor that can be attached to any Mastra agent to automatically report errors.

### 2. ErrorFilter Agent (`../verticals/error-handling/`)
An AI agent that sanitizes error messages by removing personally identifiable information (PII) while preserving technical debugging information.

### 3. GitHub Issue Creation Tool (`../verticals/coding/tools.ts`)
A reusable tool for creating GitHub issues, used by both the processor and the coding agent.

## Usage

### Basic Usage

Add the processor to any agent:

```typescript
import { createAgent } from '../../utils/agent-factory.js';
import { createErrorReportingProcessor } from '../../processors/index.js';
import { myTools } from './tools.js';

export async function getMyAgent() {
  return createAgent({
    name: 'MyAgent',
    instructions: '...',
    tools: myTools,
    outputProcessors: [
      createErrorReportingProcessor({
        repo: 'hey-jarvis',
        labels: ['automated-error', 'my-agent'],
      }),
    ],
  });
}
```

### Configuration Options

```typescript
interface ErrorReportingProcessorOptions {
  /**
   * Repository owner (defaults to "ffMathy")
   */
  owner?: string;
  
  /**
   * Repository name where issues will be created
   */
  repo: string;
  
  /**
   * Labels to add to created issues (defaults to ["automated-error", "bug"])
   */
  labels?: string[];
  
  /**
   * Whether to enable the processor (defaults to true)
   */
  enabled?: boolean;
}
```

## Environment Variables

The processor requires the following environment variable:

- `HEY_JARVIS_GITHUB_API_TOKEN` - GitHub Personal Access Token with `repo` scope

This is configured in `mcp/op.env` for 1Password CLI integration.

## How It Works

1. **Detection**: After agent generates a response, the processor scans messages for error indicators:
   - Keywords: "error", "failed", "exception", "stack trace"
   - Case-insensitive matching

2. **Sanitization**: If an error is detected:
   - The ErrorFilter agent analyzes the error content
   - PII is identified and redacted (emails, API keys, IPs, paths, etc.)
   - Technical debugging information is preserved

3. **Issue Creation**: The sanitized error is posted to GitHub:
   - Title: "Automated Error Report"
   - Body: Sanitized error with markdown formatting
   - Labels: As configured (default: `["automated-error", "bug"]`)

4. **Async Execution**: The entire process runs asynchronously:
   - Agent response is returned immediately (non-blocking)
   - Error processing happens in the background
   - Failures in the processor don't affect the main agent flow

## Example

The notification agent demonstrates the processor in action:

```typescript
// mcp/mastra/verticals/notification/agent.ts
import { createErrorReportingProcessor } from '../../processors/index.js';

export async function getNotificationAgent() {
  return createAgent({
    name: 'notification',
    instructions: '...',
    tools: notificationTools,
    outputProcessors: [
      createErrorReportingProcessor({
        repo: 'hey-jarvis',
        labels: ['automated-error', 'notification-agent'],
      }),
    ],
  });
}
```

## Testing

See `/tmp/hey-jarvis-test/test-error-reporting.js` for a test script that demonstrates:
- Loading an agent with the processor
- Simulating an error scenario
- Verifying non-blocking behavior
- Checking GitHub for created issues

## PII Redaction Examples

The ErrorFilter agent redacts the following types of PII:

- **Email addresses**: `user@example.com` → `[REDACTED_EMAIL]`
- **API keys**: `sk_live_abc123` → `[REDACTED_API_KEY]`
- **IP addresses**: `192.168.1.1` → `[REDACTED_IP]`
- **File paths**: `/home/username/project` → `/[REDACTED]/project`
- **Phone numbers**: `555-1234` → `[REDACTED_PHONE]`
- **Credit cards**: `4111-1111-1111-1111` → `[REDACTED_CC]`

Technical information is preserved:
- Error types and codes
- Function names and line numbers
- Stack trace structure
- HTTP status codes

## Architecture Decisions

### Why Async?
The processor runs asynchronously to avoid blocking agent responses. Error reporting is a secondary concern - the primary goal is to serve the user's request.

### Why a Separate Agent?
Using the ErrorFilter agent (rather than simple regex) provides:
- Context-aware PII detection
- Intelligent formatting for GitHub issues
- Flexibility to handle complex error structures
- Ability to suggest fixes or categorize errors

### Why Output Processor?
Output processors are the right abstraction because:
- They run after the agent completes its work
- They can access the full conversation context
- They can be added/removed without changing agent logic
- They fit the Mastra processor pipeline pattern

## Future Enhancements

Potential improvements:
- Error categorization (critical, warning, info)
- Duplicate issue detection
- Structured error templates
- Integration with error tracking services (Sentry, etc.)
- Customizable error detection patterns
- Rate limiting for issue creation
