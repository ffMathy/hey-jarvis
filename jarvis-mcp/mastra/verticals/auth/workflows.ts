import { z } from 'zod';
import { createWorkflow, createStep } from '../../utils/workflow-factory';
import { jwtAuth } from '../../utils';

/**
 * JWT Authentication Workflows
 * Demonstrates JWT token generation and validation workflows
 */

// Step: Generate JWT Token
const generateTokenStep = createStep({
  id: 'generate-jwt-token',
  description: 'Generate a JWT token for user authentication',
  inputSchema: z.object({
    userId: z.string(),
    additionalClaims: z.record(z.any()).optional(),
  }),
  outputSchema: z.object({
    token: z.string(),
    expiresAt: z.string(),
    userId: z.string(),
  }),
  execute: async ({ context }) => {
    if (!jwtAuth) {
      throw new Error('JWT authentication not configured');
    }

    const { userId, additionalClaims = {} } = context;
    const token = jwtAuth.generateToken(userId, additionalClaims);
    const payload = jwtAuth.verifyToken(token);

    return {
      token,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      userId: payload.sub,
    };
  },
});

// Step: Validate JWT Token
const validateTokenStep = createStep({
  id: 'validate-jwt-token',
  description: 'Validate a JWT token and extract user information',
  inputSchema: z.object({
    token: z.string(),
  }),
  outputSchema: z.object({
    valid: z.boolean(),
    userId: z.string().optional(),
    payload: z.record(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    if (!jwtAuth) {
      return {
        valid: false,
        error: 'JWT authentication not configured',
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

// Workflow: User Authentication Flow
export const userAuthenticationWorkflow = createWorkflow({
  id: 'user-authentication-workflow',
  inputSchema: z.object({
    userId: z.string().describe('User ID to authenticate'),
    action: z.enum(['login', 'validate']).describe('Authentication action to perform'),
    token: z.string().optional().describe('JWT token for validation (required for validate action)'),
    additionalClaims: z.record(z.any()).optional().describe('Additional claims for login'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    token: z.string().optional(),
    userId: z.string().optional(),
    expiresAt: z.string().optional(),
    error: z.string().optional(),
  }),
})
.branch({
  login: (context) => context.action === 'login',
  validate: (context) => context.action === 'validate',
})
.then({
  login: generateTokenStep.transformOutput((output, context) => ({
    success: true,
    token: output.token,
    userId: output.userId,
    expiresAt: output.expiresAt,
  })),
  validate: validateTokenStep.transformInput((context) => ({
    token: context.token!,
  })).transformOutput((output) => ({
    success: output.valid,
    userId: output.userId,
    error: output.error,
  })),
});

// Workflow: API Request Authentication
export const apiAuthenticationWorkflow = createWorkflow({
  id: 'api-authentication-workflow',
  inputSchema: z.object({
    authHeader: z.string().describe('Authorization header from API request'),
    requiredPermissions: z.array(z.string()).optional().describe('Required permissions for the request'),
  }),
  outputSchema: z.object({
    authenticated: z.boolean(),
    userId: z.string().optional(),
    permissions: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
})
.then(createStep({
  id: 'extract-and-validate-auth',
  description: 'Extract and validate JWT from authorization header',
  inputSchema: z.object({
    authHeader: z.string(),
    requiredPermissions: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({
    authenticated: z.boolean(),
    userId: z.string().optional(),
    permissions: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    if (!jwtAuth) {
      return {
        authenticated: false,
        error: 'JWT authentication not configured',
      };
    }

    const { authHeader, requiredPermissions = [] } = context;
    
    try {
      const authContext = jwtAuth.extractAuthContext({ authorization: authHeader });
      
      if (!authContext) {
        return {
          authenticated: false,
          error: 'No valid JWT token found in authorization header',
        };
      }

      // Extract permissions from token payload
      const userPermissions = authContext.payload.permissions || [];
      
      // Check required permissions
      const hasRequiredPermissions = requiredPermissions.every(permission => 
        userPermissions.includes(permission)
      );

      if (requiredPermissions.length > 0 && !hasRequiredPermissions) {
        return {
          authenticated: false,
          error: 'Insufficient permissions',
        };
      }

      return {
        authenticated: true,
        userId: authContext.userId,
        permissions: userPermissions,
      };
    } catch (error) {
      return {
        authenticated: false,
        error: error.message,
      };
    }
  },
}));