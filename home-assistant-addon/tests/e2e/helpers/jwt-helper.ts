import { sign } from 'hono/jwt';

/**
 * Generate a test JWT token
 * @param secret - The JWT secret to use for signing
 * @param expiresIn - Expiration time in seconds (default: 1 hour)
 * @returns A signed JWT token
 */
export async function generateTestToken(secret: string, expiresIn = 3600): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  
  const payload = {
    sub: 'test-client',
    iat: now,
    exp: now + expiresIn,
  };

  return await sign(payload, secret);
}

/**
 * Generate an expired JWT token for testing
 * @param secret - The JWT secret to use for signing
 * @returns An expired JWT token
 */
export async function generateExpiredToken(secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  
  const payload = {
    sub: 'test-client',
    iat: now - 7200, // 2 hours ago
    exp: now - 3600, // 1 hour ago (expired)
  };

  return await sign(payload, secret);
}
