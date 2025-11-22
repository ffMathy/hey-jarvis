import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';

// Interface for Microsoft Graph API responses
interface GraphEmailMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body: {
    contentType: string;
    content: string;
  };
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
  toRecipients: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  receivedDateTime: string;
  hasAttachments: boolean;
  isRead: boolean;
  isDraft: boolean;
}

interface GraphEmailListResponse {
  value: GraphEmailMessage[];
}

// Get Microsoft Graph API token from environment
const getAccessToken = () => {
  const token = process.env.HEY_JARVIS_MICROSOFT_GRAPH_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'Microsoft Graph access token not found. Please set HEY_JARVIS_MICROSOFT_GRAPH_ACCESS_TOKEN environment variable.',
    );
  }
  return token;
};

// Base URL for Microsoft Graph API
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

// Tool to find/search emails
export const findEmails = createTool({
  id: 'findEmails',
  description:
    'Find and search emails by various filters. When searching for text content, try different variations of the same text.',
  inputSchema: z.object({
    searchQuery: z
      .string()
      .optional()
      .describe('Search query to find specific emails (searches subject and body content)'),
    folder: z
      .string()
      .optional()
      .default('inbox')
      .describe('Email folder to search in (inbox, drafts, sent, etc.)'),
    limit: z.number().optional().default(10).describe('Maximum number of emails to return (default: 10)'),
    isRead: z.boolean().optional().describe('Filter by read status'),
    hasAttachment: z.boolean().optional().describe('Filter emails with attachments'),
  }),
  outputSchema: z.object({
    emails: z.array(
      z.object({
        id: z.string(),
        subject: z.string(),
        bodyPreview: z.string(),
        from: z.object({
          name: z.string(),
          address: z.string(),
        }),
        receivedDateTime: z.string(),
        isRead: z.boolean(),
        hasAttachments: z.boolean(),
        isDraft: z.boolean(),
      }),
    ),
    totalCount: z.number(),
  }),
  execute: async (inputData) => {
    const accessToken = getAccessToken();
    const { searchQuery, folder, limit, isRead, hasAttachment } = inputData;

    // Build the filter query
    const filters: string[] = [];
    if (isRead !== undefined) {
      filters.push(`isRead eq ${isRead}`);
    }
    if (hasAttachment !== undefined) {
      filters.push(`hasAttachments eq ${hasAttachment}`);
    }

    let url = `${GRAPH_API_BASE}/me/mailFolders/${folder}/messages?$top=${limit}&$orderby=receivedDateTime desc`;

    if (filters.length > 0) {
      url += `&$filter=${filters.join(' and ')}`;
    }

    if (searchQuery) {
      url += `&$search="${searchQuery}"`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch emails: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as GraphEmailListResponse;

    return {
      emails: data.value.map((email) => ({
        id: email.id,
        subject: email.subject,
        bodyPreview: email.bodyPreview,
        from: {
          name: email.from.emailAddress.name,
          address: email.from.emailAddress.address,
        },
        receivedDateTime: email.receivedDateTime,
        isRead: email.isRead,
        hasAttachments: email.hasAttachments,
        isDraft: email.isDraft,
      })),
      totalCount: data.value.length,
    };
  },
});

// Tool to create an email draft
export const draftEmail = createTool({
  id: 'draftEmail',
  description: 'Create a new email draft. Content should be in HTML format.',
  inputSchema: z.object({
    subject: z.string().describe('Email subject'),
    bodyContent: z.string().describe('Email body content in HTML format'),
    toRecipients: z
      .array(z.string())
      .describe('Array of recipient email addresses (e.g., ["user@example.com"])'),
    ccRecipients: z.array(z.string()).optional().describe('Array of CC recipient email addresses'),
    bccRecipients: z.array(z.string()).optional().describe('Array of BCC recipient email addresses'),
  }),
  outputSchema: z.object({
    draftId: z.string(),
    subject: z.string(),
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const accessToken = getAccessToken();
    const { subject, bodyContent, toRecipients, ccRecipients, bccRecipients } = inputData;

    const draftMessage = {
      subject,
      body: {
        contentType: 'HTML',
        content: bodyContent,
      },
      toRecipients: toRecipients.map((email) => ({
        emailAddress: {
          address: email,
        },
      })),
      ...(ccRecipients && {
        ccRecipients: ccRecipients.map((email) => ({
          emailAddress: {
            address: email,
          },
        })),
      }),
      ...(bccRecipients && {
        bccRecipients: bccRecipients.map((email) => ({
          emailAddress: {
            address: email,
          },
        })),
      }),
    };

    const response = await fetch(`${GRAPH_API_BASE}/me/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(draftMessage),
    });

    if (!response.ok) {
      throw new Error(`Failed to create draft: ${response.status} ${response.statusText}`);
    }

    const draft = (await response.json()) as GraphEmailMessage;

    return {
      draftId: draft.id,
      subject: draft.subject,
      success: true,
      message: 'Draft created successfully',
    };
  },
});

// Tool to create a reply draft
export const draftReply = createTool({
  id: 'draftReply',
  description: 'Create a reply draft to an existing email',
  inputSchema: z.object({
    messageId: z.string().describe('ID of the message to reply to'),
    replyMessage: z.string().describe('Reply message content in HTML format'),
    replyAll: z.boolean().optional().default(false).describe('Whether to reply to all recipients (default: false)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    draftId: z.string().optional(),
  }),
  execute: async (inputData) => {
    const accessToken = getAccessToken();
    const { messageId, replyMessage, replyAll } = inputData;

    const endpoint = replyAll ? 'replyAll' : 'reply';

    // Create reply draft
    const response = await fetch(`${GRAPH_API_BASE}/me/messages/${messageId}/createReply`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to create reply draft: ${response.status} ${response.statusText}`);
    }

    const draft = (await response.json()) as GraphEmailMessage;

    // Update the draft with our message
    const updateResponse = await fetch(`${GRAPH_API_BASE}/me/messages/${draft.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: {
          contentType: 'HTML',
          content: replyMessage,
        },
      }),
    });

    if (!updateResponse.ok) {
      throw new Error(`Failed to update reply draft: ${updateResponse.status} ${updateResponse.statusText}`);
    }

    return {
      success: true,
      message: `Reply draft created successfully (${replyAll ? 'reply all' : 'reply to sender'})`,
      draftId: draft.id,
    };
  },
});

// Tool to update an email draft
export const updateDraft = createTool({
  id: 'updateDraft',
  description: 'Update an existing email draft by its ID',
  inputSchema: z.object({
    draftId: z.string().describe('ID of the draft to update'),
    subject: z.string().optional().describe('New subject (optional)'),
    bodyContent: z.string().optional().describe('New body content in HTML format (optional)'),
    toRecipients: z.array(z.string()).optional().describe('New array of recipient email addresses (optional)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    draftId: z.string(),
  }),
  execute: async (inputData) => {
    const accessToken = getAccessToken();
    const { draftId, subject, bodyContent, toRecipients } = inputData;

    const updateData: any = {};

    if (subject) {
      updateData.subject = subject;
    }

    if (bodyContent) {
      updateData.body = {
        contentType: 'HTML',
        content: bodyContent,
      };
    }

    if (toRecipients) {
      updateData.toRecipients = toRecipients.map((email) => ({
        emailAddress: {
          address: email,
        },
      }));
    }

    const response = await fetch(`${GRAPH_API_BASE}/me/messages/${draftId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    if (!response.ok) {
      throw new Error(`Failed to update draft: ${response.status} ${response.statusText}`);
    }

    return {
      success: true,
      message: 'Draft updated successfully',
      draftId,
    };
  },
});

// Tool to delete an email
export const deleteEmail = createTool({
  id: 'deleteEmail',
  description: 'Delete a particular email or draft by its ID',
  inputSchema: z.object({
    messageId: z.string().describe('ID of the email or draft to delete'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const accessToken = getAccessToken();
    const { messageId } = inputData;

    const response = await fetch(`${GRAPH_API_BASE}/me/messages/${messageId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to delete email: ${response.status} ${response.statusText}`);
    }

    return {
      success: true,
      message: 'Email deleted successfully',
    };
  },
});

// Export all tools together for convenience
export const emailTools = {
  findEmails,
  draftEmail,
  draftReply,
  updateDraft,
  deleteEmail,
};
