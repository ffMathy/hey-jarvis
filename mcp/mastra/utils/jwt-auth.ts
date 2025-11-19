import { verify } from 'hono/jwt';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Extract JWT token from Authorization header
 */
function extractToken(authHeader: string | string[] | undefined): string {
  if (!authHeader) {
    return '';
  }

  const headerValue = typeof authHeader === 'string' ? authHeader : Array.isArray(authHeader) ? authHeader[0] : '';

  return headerValue.replace(/^Bearer\s+/i, '');
}

/**
 * JWT authentication middleware for MCP HTTP requests
 * Validates JWT tokens from the Authorization header
 */
export async function validateJwtToken(req: IncomingMessage): Promise<boolean> {
  const jwtSecret = process.env.HEY_JARVIS_MCP_JWT_SECRET;

  // If no JWT secret is configured, skip authentication
  if (!jwtSecret) {
    console.warn('Warning: HEY_JARVIS_MCP_JWT_SECRET not configured. JWT authentication is disabled.');
    return true;
  }

  // Node.js automatically lowercases header names
  const authHeader = req.headers.authorization;
  const token = extractToken(authHeader);

  if (!token) {
    return false;
  }

  try {
    // Verify the JWT token
    await verify(token, jwtSecret);
    return true;
  } catch (error) {
    console.error('JWT verification failed');
    return false;
  }
}

/**
 * Send an unauthorized response
 */
export function sendUnauthorizedResponse(res: ServerResponse): void {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      error: 'Unauthorized',
      message: 'Valid JWT token required in Authorization header',
    }),
  );
}
