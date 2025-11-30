export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  scope: string;
  token_type: string;
  expiry_date: number;
}

/**
 * OAuth provider interface. This is a unified interface that works
 * both for typed implementations and for arrays of mixed providers.
 *
 * The 'any' type is used intentionally because different OAuth providers
 * (Google, Microsoft, etc.) have incompatible client types that cannot
 * be unified into a single generic type without losing type safety in
 * the individual provider implementations.
 */
export interface OAuthProvider {
  name: string;
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
  refreshTokenEnvVar: string;
  scopes: string[];
  setupInstructions: string[];
  storageInstructions: string[];
  // biome-ignore lint/suspicious/noExplicitAny: OAuth client types vary per provider and cannot be unified
  createClient: (clientId: string, clientSecret: string) => any;
  // biome-ignore lint/suspicious/noExplicitAny: OAuth client types vary per provider and cannot be unified
  getAuthUrl: (client: any) => string | Promise<string>;
  // biome-ignore lint/suspicious/noExplicitAny: OAuth client types vary per provider and cannot be unified
  exchangeCode: (client: any, code: string) => Promise<TokenResponse>;
}
