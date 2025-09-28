import { z } from 'zod';
import { createTool } from '../../utils/tool-factory';
import { jwtAuth } from '../../utils';

/**
 * JWT Authentication Tools
 * Provides JWT token generation and validation for secure API access
 */

export const generateJWTTokenTool = createTool({
  id: 'generate-jwt-token',
  description: 'Generate a JWT token for user authentication',
  inputSchema: z.object({
    userId: z.string().describe('User ID to generate token for'),
    additionalClaims: z.record(z.any()).optional().describe('Additional claims to include in the token'),
  }),
  outputSchema: z.object({
    token: z.string().describe('Generated JWT token'),
    expiresAt: z.string().describe('Token expiration time (ISO string)'),
    userId: z.string().describe('User ID the token was generated for'),
  }),
  execute: async ({ context }) => {
    if (!jwtAuth) {
      throw new Error('JWT authentication not configured. Please set JWT_SECRET environment variable.');
    }

    const { userId, additionalClaims = {} } = context;
    
    try {
      const token = jwtAuth.generateToken(userId, additionalClaims);
      const payload = jwtAuth.verifyToken(token);
      
      return {
        token,
        expiresAt: new Date(payload.exp * 1000).toISOString(),
        userId: payload.sub,
      };
    } catch (error) {
      throw new Error(`Failed to generate JWT token: ${error.message}`);
    }
  },
});

export const verifyJWTTokenTool = createTool({
  id: 'verify-jwt-token',
  description: 'Verify and decode a JWT token',
  inputSchema: z.object({
    token: z.string().describe('JWT token to verify'),
  }),
  outputSchema: z.object({
    valid: z.boolean().describe('Whether the token is valid'),
    userId: z.string().optional().describe('User ID from the token (if valid)'),
    payload: z.record(z.any()).optional().describe('Full token payload (if valid)'),
    error: z.string().optional().describe('Error message (if invalid)'),
  }),
  execute: async ({ context }) => {
    if (!jwtAuth) {
      return {
        valid: false,
        error: 'JWT authentication not configured. Please set JWT_SECRET environment variable.',
      };
    }

    const { token } = context;
    
    try {
      const payload = jwtAuth.verifyToken(token);
      return {
        valid: true,
        userId: payload.sub,
        payload,
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message,
      };
    }
  },
});

export const validateAuthHeaderTool = createTool({
  id: 'validate-auth-header',
  description: 'Extract and validate JWT token from Authorization header',
  inputSchema: z.object({
    authHeader: z.string().describe('Authorization header value (e.g., "Bearer <token>")'),
  }),
  outputSchema: z.object({
    valid: z.boolean().describe('Whether the authorization is valid'),
    userId: z.string().optional().describe('User ID from the token (if valid)'),
    authContext: z.record(z.any()).optional().describe('Full authentication context (if valid)'),
    error: z.string().optional().describe('Error message (if invalid)'),
  }),
  execute: async ({ context }) => {
    if (!jwtAuth) {
      return {
        valid: false,
        error: 'JWT authentication not configured. Please set JWT_SECRET environment variable.',
      };
    }

    const { authHeader } = context;
    
    try {
      const authContext = jwtAuth.extractAuthContext({ authorization: authHeader });
      
      if (!authContext) {
        return {
          valid: false,
          error: 'No valid JWT token found in authorization header',
        };
      }

      return {
        valid: true,
        userId: authContext.userId,
        authContext: {
          userId: authContext.userId,
          payload: authContext.payload,
          token: authContext.token,
        },
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message,
      };
    }
  },
});

// Export all JWT tools as a group
export const jwtTools = {
  generateJWTTokenTool,
  verifyJWTTokenTool,
  validateAuthHeaderTool,
};