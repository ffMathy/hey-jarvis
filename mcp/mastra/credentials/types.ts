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
  createClient: (clientId: string, clientSecret: string) => any;
  getAuthUrl: (client: any) => string | Promise<string>;
  exchangeCode: (client: any, code: string) => Promise<TokenResponse>;
}
