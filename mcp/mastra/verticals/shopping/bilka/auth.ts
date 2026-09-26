// Authentication and session management
export interface AuthTokens {
  sessionInfo: {
    cookieValue: string;
    cookieName: string;
  };
  jwtToken: string;
}

/**
 * How long a sign-in is reused, counted from when it started.
 *
 * Counted from the start rather than from when it finished, because that is when the JWT's own
 * clock started. A failed sign-in is kept for as long, so a wrong password is not retried
 * against Gigya on every request.
 */
const SIGN_IN_REUSE_MS = 5 * 60 * 1000;

let currentSignIn: { tokens: Promise<AuthTokens>; startedAt: number } | undefined;

/**
 * Authenticates with Bilka's API and returns session tokens.
 *
 * Callers that arrive while a sign-in is under way wait for that one rather than starting their
 * own. The cart and a basket change are often asked for at the same moment, and the second
 * caller used to find a half-finished sign-in in the cache and fail with "Could not sign in."
 */
export async function authenticateWithBilka(): Promise<AuthTokens> {
  if (!currentSignIn || Date.now() - currentSignIn.startedAt >= SIGN_IN_REUSE_MS) {
    currentSignIn = { tokens: signIn(), startedAt: Date.now() };
  }

  return await currentSignIn.tokens;
}

/** Forgets the current sign-in, so each test starts signed out. */
export function resetBilkaSignInForTest(): void {
  currentSignIn = undefined;
}

async function signIn(): Promise<AuthTokens> {
  // Step 1: Login with credentials to get login token
  const loginResponse = await fetch('https://accounts.eu1.gigya.com/accounts.login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      loginID: process.env.HEY_JARVIS_BILKA_EMAIL ?? '',
      password: process.env.HEY_JARVIS_BILKA_PASSWORD ?? '',
      apiKey: process.env.HEY_JARVIS_BILKA_API_KEY ?? '',
    }),
  });

  const loginData = await loginResponse.json();

  if (!loginData.sessionInfo?.cookieValue) {
    throw new Error('Failed to get login token');
  }

  const sessionInfo: AuthTokens['sessionInfo'] = loginData.sessionInfo;

  // Step 2: Exchange login token for JWT token
  const jwtResponse = await fetch(
    `https://accounts.eu1.gigya.com/accounts.getJWT?login_token=${sessionInfo.cookieValue}&apiKey=${process.env.HEY_JARVIS_BILKA_API_KEY}`,
    {
      method: 'POST',
    },
  );

  const jwtData = await jwtResponse.json();
  if (!jwtData.id_token) {
    throw new Error('Failed to get JWT token');
  }

  return { sessionInfo, jwtToken: jwtData.id_token };
}
