// JWT Authentication utilities for Hey Jarvis
// Simple JWT implementation without external dependencies

export interface JWTConfig {
  secret: string;
  expiresInHours?: number;
  issuer?: string;
  audience?: string;
}

export interface JWTPayload {
  sub: string;
  iat: number;
  exp: number;
  iss?: string;
  aud?: string;
  [key: string]: any;
}

export interface JWTAuthContext {
  userId: string;
  payload: JWTPayload;
  token: string;
}

/**
 * Simple JWT implementation without external dependencies
 * Follows standard JWT structure with header.payload.signature
 */
export class JWTAuth {
  private config: Required<JWTConfig>;

  constructor(config: JWTConfig) {
    this.config = {
      secret: config.secret,
      expiresInHours: config.expiresInHours || 24,
      issuer: config.issuer || 'hey-jarvis',
      audience: config.audience || 'jarvis-mcp',
    };
  }

  /**
   * Generate a JWT token for a user
   */
  generateToken(userId: string, additionalClaims: Record<string, any> = {}): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: JWTPayload = {
      sub: userId,
      iat: now,
      exp: now + (this.config.expiresInHours * 3600),
      iss: this.config.issuer,
      aud: this.config.audience,
      ...additionalClaims,
    };

    const header = {
      alg: 'HS256',
      typ: 'JWT',
    };

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    const signature = this.createSignature(`${encodedHeader}.${encodedPayload}`);

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  /**
   * Verify and decode a JWT token
   */
  verifyToken(token: string): JWTPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    
    // Verify signature
    const expectedSignature = this.createSignature(`${encodedHeader}.${encodedPayload}`);
    if (signature !== expectedSignature) {
      throw new Error('Invalid JWT signature');
    }

    // Decode payload
    const payload: JWTPayload = JSON.parse(this.base64UrlDecode(encodedPayload));

    // Verify expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new Error('JWT token has expired');
    }

    // Verify issuer and audience if configured
    if (this.config.issuer && payload.iss !== this.config.issuer) {
      throw new Error('Invalid JWT issuer');
    }
    if (this.config.audience && payload.aud !== this.config.audience) {
      throw new Error('Invalid JWT audience');
    }

    return payload;
  }

  /**
   * Extract authentication context from request headers
   */
  extractAuthContext(headers: Record<string, string | string[] | undefined>): JWTAuthContext | null {
    const authHeader = headers['authorization'] || headers['Authorization'];
    if (!authHeader) {
      return null;
    }

    const token = typeof authHeader === 'string' 
      ? authHeader.replace(/^Bearer\s+/i, '')
      : authHeader[0]?.replace(/^Bearer\s+/i, '');

    if (!token) {
      return null;
    }

    try {
      const payload = this.verifyToken(token);
      return {
        userId: payload.sub,
        payload,
        token,
      };
    } catch (error) {
      console.warn('JWT verification failed:', error.message);
      return null;
    }
  }

  /**
   * Create middleware function for JWT authentication
   */
  createMiddleware() {
    return (req: any, res?: any, next?: () => void) => {
      try {
        const authContext = this.extractAuthContext(req.headers || {});
        if (authContext) {
          req.auth = authContext;
        }
        if (next) next();
      } catch (error) {
        console.error('JWT middleware error:', error);
        if (next) next();
      }
    };
  }

  private base64UrlEncode(str: string): string {
    return (global as any).Buffer.from(str)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  private base64UrlDecode(str: string): string {
    str += new Array(5 - (str.length % 4)).join('=');
    return (global as any).Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
  }

  private createSignature(data: string): string {
    const crypto = (global as any).require('crypto');
    return crypto
      .createHmac('sha256', this.config.secret)
      .update(data)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }
}

/**
 * Default JWT authentication instance
 * Uses environment variables for configuration
 */
export const createJWTAuth = (config?: Partial<JWTConfig>): JWTAuth => {
  const env = (global as any).process?.env || {};
  const jwtSecret = env.JWT_SECRET || env.JARVIS_JWT_SECRET;
  
  if (!jwtSecret) {
    throw new Error(
      'JWT secret not configured. Please set JWT_SECRET or JARVIS_JWT_SECRET environment variable.'
    );
  }

  return new JWTAuth({
    secret: jwtSecret,
    expiresInHours: config?.expiresInHours || parseInt(env.JWT_EXPIRES_HOURS || '24'),
    issuer: config?.issuer || env.JWT_ISSUER || 'hey-jarvis',
    audience: config?.audience || env.JWT_AUDIENCE || 'jarvis-mcp',
    ...config,
  });
};

// Export singleton instance for easy use
export const jwtAuth = (() => {
  try {
    return createJWTAuth();
  } catch (error) {
    console.warn('JWT Auth not initialized:', error.message);
    return null;
  }
})();