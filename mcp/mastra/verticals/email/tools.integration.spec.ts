import { beforeAll, describe, expect, it } from 'bun:test';
import { executeTool } from '../../utils/tool-factory.js';
import { findEmails } from './tools.js';

describe('Email Tools Integration Tests', () => {
  beforeAll(() => {
    // Verify Microsoft OAuth credentials are configured
    if (
      !process.env.HEY_JARVIS_MICROSOFT_CLIENT_ID ||
      !process.env.HEY_JARVIS_MICROSOFT_CLIENT_SECRET ||
      !process.env.HEY_JARVIS_MICROSOFT_REFRESH_TOKEN
    ) {
      throw new Error(
        'Microsoft OAuth credentials are required for email tools tests. Set HEY_JARVIS_MICROSOFT_CLIENT_ID, HEY_JARVIS_MICROSOFT_CLIENT_SECRET, and HEY_JARVIS_MICROSOFT_REFRESH_TOKEN environment variables.',
      );
    }
  });

  describe('findEmails', () => {
    it('should retrieve emails', async () => {
      // `limit`, not `maxResults`. The old spelling was not a parameter of this tool at
      // all, so it was silently dropped and the tool returned its default page instead.
      const result = await executeTool(findEmails, { limit: 5, folder: 'inbox' });

      // Validate structure
      expect(result).toBeDefined();
      expect(Array.isArray(result.emails)).toBe(true);

      console.log('✅ Emails retrieved successfully');
      console.log('   - Email count:', result.emails.length);
      // CRITICAL: Do not log email subjects, senders, or any email content
      // This is sensitive private information
    }, 30000);

    it('should support filtering by search query', async () => {
      // This test used to pass `from: 'noreply@example.com'`, which findEmails does not
      // accept — it was dropped on the way in, so the test filtered nothing and asserted
      // exactly what the previous test asserted. The tool's actual filter is a search
      // query across subject and body.
      const result = await executeTool(findEmails, {
        searchQuery: 'noreply@example.com',
        limit: 5,
        folder: 'inbox',
      });

      // Validate structure
      expect(result).toBeDefined();
      expect(Array.isArray(result.emails)).toBe(true);

      console.log('✅ Email filtering by search query works');
      console.log('   - Filtered results:', result.emails.length);
      // CRITICAL: Do not log any email details
    }, 30000);
  });
});
