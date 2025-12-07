import { ConfidentialClientApplication } from '@azure/msal-node';
import { z } from 'zod';
import { getCredentialsStorage, getEmailStateStorage } from '../../storage/index.js';
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

/**
 * Creates and configures a Microsoft OAuth2 client for Graph API access.
 *
 * The client automatically refreshes access tokens using the stored refresh token.
 * Refresh tokens are long-lived and only need to be obtained once using the
 * `nx generate-tokens mcp` command.
 *
 * Credentials are loaded in this order:
 * 1. Environment variables (HEY_JARVIS_MICROSOFT_*)
 * 2. Mastra storage (oauth_credentials table)
 *
 * @throws {Error} If credentials are not found in either location
 */
const getMicrosoftAuth = async (): Promise<string> => {
  const clientId = process.env.HEY_JARVIS_MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.HEY_JARVIS_MICROSOFT_CLIENT_SECRET;
  let refreshToken = process.env.HEY_JARVIS_MICROSOFT_REFRESH_TOKEN;

  // Fallback to Mastra storage for refresh token only
  if (!refreshToken) {
    try {
      const credentialsStorage = await getCredentialsStorage();
      refreshToken = (await credentialsStorage.getRefreshToken('microsoft')) ?? undefined;
    } catch (_error) {
      // Storage error - continue to show helpful error message below
    }
  }

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing required Microsoft OAuth2 credentials.\n' +
        '\n' +
        'Option 1: Set environment variables:\n' +
        '  - HEY_JARVIS_MICROSOFT_CLIENT_ID\n' +
        '  - HEY_JARVIS_MICROSOFT_CLIENT_SECRET\n' +
        '  - HEY_JARVIS_MICROSOFT_REFRESH_TOKEN\n' +
        '\n' +
        'Option 2: Store refresh token in Mastra (client ID/secret still required in env):\n' +
        '  Run `nx generate-tokens mcp`',
    );
  }

  const msalClient = new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: 'https://login.microsoftonline.com/consumers',
    },
  });

  // Exchange refresh token for access token
  const tokenRequest = {
    refreshToken,
    scopes: ['https://graph.microsoft.com/Mail.ReadWrite', 'https://graph.microsoft.com/Mail.Send'],
  };

  try {
    const response = await msalClient.acquireTokenByRefreshToken(tokenRequest);

    // Note: MSAL v3+ automatically manages refresh token rotation internally.
    // The refresh token is stored in MSAL's token cache and is not exposed in the response.
    // Token renewal happens automatically on subsequent acquireTokenByRefreshToken calls.

    if (!response) {
      throw new Error('No response received from Microsoft token endpoint');
    }

    return response.accessToken;
  } catch (error) {
    throw new Error(
      `Failed to acquire access token from Microsoft: ${error instanceof Error ? error.message : String(error)}\n` +
        'Your refresh token may have expired. Run `nx generate-tokens mcp` to get a new one.',
    );
  }
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
    folder: z.string().optional().default('inbox').describe('Email folder to search in (inbox, drafts, sent, etc.)'),
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
    const accessToken = await getMicrosoftAuth();
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
      // URL encode the filter expression to handle special characters
      const filterExpression = filters.join(' and ');
      url += `&$filter=${encodeURIComponent(filterExpression)}`;
    }

    if (searchQuery) {
      url += `&$search="${encodeURIComponent(searchQuery)}"`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to fetch emails: ${response.status} ${response.statusText}. URL: ${url}. Response: ${errorBody}`,
      );
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
    toRecipients: z.array(z.string()).describe('Array of recipient email addresses (e.g., ["user@example.com"])'),
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
    const accessToken = await getMicrosoftAuth();
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
    const accessToken = await getMicrosoftAuth();
    const { messageId, replyMessage, replyAll } = inputData;

    const _endpoint = replyAll ? 'replyAll' : 'reply';

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
    const accessToken = await getMicrosoftAuth();
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
    const accessToken = await getMicrosoftAuth();
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

// Tool to send an email directly
export const sendEmail = createTool({
  id: 'sendEmail',
  description: 'Send an email directly without creating a draft first. Content should be in HTML format.',
  inputSchema: z.object({
    subject: z.string().describe('Email subject'),
    bodyContent: z.string().describe('Email body content in HTML format'),
    toRecipients: z.array(z.string()).describe('Array of recipient email addresses (e.g., ["user@example.com"])'),
    ccRecipients: z.array(z.string()).optional().describe('Array of CC recipient email addresses'),
    bccRecipients: z.array(z.string()).optional().describe('Array of BCC recipient email addresses'),
  }),
  outputSchema: z.object({
    messageId: z.string(),
    subject: z.string(),
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const accessToken = await getMicrosoftAuth();
    const { subject, bodyContent, toRecipients, ccRecipients, bccRecipients } = inputData;

    const emailMessage = {
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

    const response = await fetch(`${GRAPH_API_BASE}/me/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: emailMessage }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send email: ${response.status} ${response.statusText}`);
    }

    return {
      messageId: 'sent',
      subject,
      success: true,
      message: 'Email sent successfully',
    };
  },
});

// Email state types
export interface EmailMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body: {
    contentType: string;
    content: string;
  };
  from: {
    name: string;
    address: string;
  };
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  isDraft: boolean;
}

export interface FindNewEmailsResult {
  emails: EmailMessage[];
  totalCount: number;
  isFirstCheck: boolean;
  lastCheckTimestamp?: string;
}

/**
 * Find emails received since the last check.
 * Uses persistent storage to track the last seen email.
 * First call returns recent emails; subsequent calls return only new emails.
 */
export async function findNewEmailsSinceLastCheck(folder = 'inbox', limit = 50): Promise<FindNewEmailsResult> {
  const accessToken = await getMicrosoftAuth();

  const emailStateStorage = await getEmailStateStorage();
  const lastSeenState = await emailStateStorage.getLastSeenEmail(folder);

  let url = `${GRAPH_API_BASE}/me/mailFolders/${folder}/messages?$top=${limit}&$orderby=receivedDateTime desc`;

  // If we have a last seen timestamp, filter for emails received after that time
  if (lastSeenState) {
    const filterDate = lastSeenState.lastEmailReceivedDateTime;
    // URL encode the entire filter expression to handle special characters
    const filterExpression = `receivedDateTime gt ${filterDate}`;
    const encodedFilter = encodeURIComponent(filterExpression);
    url += `&$filter=${encodedFilter}`;
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Failed to fetch emails: ${response.status} ${response.statusText}. URL: ${url}. Response: ${errorBody}`,
    );
  }

  const data = (await response.json()) as GraphEmailListResponse;

  // Filter out the last seen email itself (since we used 'gt', not 'ge', this shouldn't be needed, but just in case)
  const filteredEmails = lastSeenState
    ? data.value.filter((email) => email.id !== lastSeenState.lastEmailId)
    : data.value;

  const emails = filteredEmails.map((email) => ({
    id: email.id,
    subject: email.subject,
    bodyPreview: email.bodyPreview,
    body: {
      contentType: email.body.contentType,
      content: email.body.content,
    },
    from: {
      name: email.from.emailAddress.name,
      address: email.from.emailAddress.address,
    },
    receivedDateTime: email.receivedDateTime,
    isRead: email.isRead,
    hasAttachments: email.hasAttachments,
    isDraft: email.isDraft,
  }));

  return {
    emails,
    totalCount: emails.length,
    isFirstCheck: !lastSeenState,
    lastCheckTimestamp: lastSeenState?.lastEmailReceivedDateTime,
  };
}

export interface UpdateLastSeenEmailResult {
  success: boolean;
  message: string;
  folder: string;
  previousLastSeenId?: string;
  newLastSeenId: string;
}

/**
 * Update the last seen email state after processing emails.
 * Call this after successfully processing emails from findNewEmailsSinceLastCheck to mark them as seen.
 */
export async function updateLastSeenEmail(
  folder: string,
  emailId: string,
  receivedDateTime: string,
): Promise<UpdateLastSeenEmailResult> {
  const emailStateStorage = await getEmailStateStorage();
  const previousState = await emailStateStorage.getLastSeenEmail(folder);

  await emailStateStorage.setLastSeenEmail(folder, emailId, receivedDateTime);

  return {
    success: true,
    message: `Updated last seen email for folder "${folder}"`,
    folder,
    previousLastSeenId: previousState?.lastEmailId,
    newLastSeenId: emailId,
  };
}

export interface LastSeenEmailStateResult {
  hasState: boolean;
  folder: string;
  lastEmailId?: string;
  lastEmailReceivedDateTime?: string;
  updatedAt?: string;
}

/**
 * Get the current last seen email state for a folder without fetching any emails.
 */
export async function getLastSeenEmailState(folder = 'inbox'): Promise<LastSeenEmailStateResult> {
  const emailStateStorage = await getEmailStateStorage();
  const state = await emailStateStorage.getLastSeenEmail(folder);

  if (!state) {
    return {
      hasState: false,
      folder,
    };
  }

  return {
    hasState: true,
    folder: state.folder,
    lastEmailId: state.lastEmailId,
    lastEmailReceivedDateTime: state.lastEmailReceivedDateTime,
    updatedAt: state.updatedAt,
  };
}

export interface ClearLastSeenEmailStateResult {
  success: boolean;
  message: string;
}

/**
 * Clear the last seen email state for a folder.
 * Next call to findNewEmailsSinceLastCheck will return recent emails as if it were the first check.
 */
export async function clearLastSeenEmailState(folder?: string): Promise<ClearLastSeenEmailStateResult> {
  const emailStateStorage = await getEmailStateStorage();

  if (folder) {
    await emailStateStorage.clearLastSeenEmail(folder);
    return {
      success: true,
      message: `Cleared last seen email state for folder "${folder}"`,
    };
  }

  await emailStateStorage.clearAllLastSeenEmails();
  return {
    success: true,
    message: 'Cleared last seen email state for all folders',
  };
}

// Export all tools together for convenience (email state functions are NOT tools)
export const emailTools = {
  findEmails,
  draftEmail,
  draftReply,
  updateDraft,
  deleteEmail,
  sendEmail,
};
