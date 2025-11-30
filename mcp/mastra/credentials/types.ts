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
 */
export interface OAuthProvider {
  name: string;
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
  refreshTokenEnvVar: string;
  scopes: string[];
  setupInstructions: string[];
  storageInstructions: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createClient: (clientId: string, clientSecret: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAuthUrl: (client: any) => string | Promise<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exchangeCode: (client: any, code: string) => Promise<TokenResponse>;
}
