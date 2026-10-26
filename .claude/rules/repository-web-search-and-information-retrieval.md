# Web Search and Information Retrieval

> Part of [Hey Jarvis Repository](repository.md).

**Always use general web search** when you need to find information online — current best practices, library versions, documentation, examples, or real-time data.

## Playwright MCP Tools

**Use Playwright tools** when you need to fetch content from a specific URL or interact with web pages:

The Playwright MCP server provides browser automation capabilities for:

- Fetching the content of a single URL
- Extracting data from web pages
- Taking screenshots of web pages
- Interacting with dynamic web content

**Available Tools:**

- All Playwright MCP tools including navigation, content extraction, and browser automation

**Example Usage:**

```typescript
// Navigate to a URL and get its content
const content = await playwright_browser_navigate({
  url: 'https://example.com',
});
```
