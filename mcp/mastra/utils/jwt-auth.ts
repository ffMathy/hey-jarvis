import { verify } from 'hono/jwt';
import type { IncomingMessage, ServerResponse } from 'node:http';

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

  const authHeader = req.headers.authorization || req.headers.Authorization;
  
  if (!authHeader) {
    return false;
  }

  // Extract token from "Bearer <token>" format
  const token = typeof authHeader === 'string' 
    ? authHeader.replace(/^Bearer\s+/i, '')
    : Array.isArray(authHeader) 
      ? authHeader[0].replace(/^Bearer\s+/i, '')
      : '';

  if (!token) {
    return false;
  }

  try {
    // Verify the JWT token
    await verify(token, jwtSecret);
    return true;
  } catch (error) {
    console.error('JWT verification failed:', error);
    return false;
  }
}

/**
 * Send an unauthorized response
 */
export function sendUnauthorizedResponse(res: ServerResponse): void {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    error: 'Unauthorized', 
    message: 'Valid JWT token required in Authorization header' 
  }));
}
