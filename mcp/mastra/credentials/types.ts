export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  scope: string;
  token_type: string;
  expiry_date: number;
}

export interface OAuthProvider {
  name: string;
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
  refreshTokenEnvVar: string;
  scopes: string[];
  setupInstructions: string[];
  storageInstructions: string[];
  createClient: (clientId: string, clientSecret: string) => unknown;
  getAuthUrl: (client: unknown) => string | Promise<string>;
  exchangeCode: (client: unknown, code: string) => Promise<TokenResponse>;
}
