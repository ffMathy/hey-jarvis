// Authentication and session management
export interface AuthTokens {
    sessionInfo: {
        cookieValue: string;
        cookieName: string;
    };
    jwtToken: string;
}

let cachedTokens: {
    tokens: AuthTokens | undefined;
    refreshTime: Date;
};

/**
 * Authenticates with Bilka's API and returns session tokens
 */
export async function authenticateWithBilka(): Promise<AuthTokens> {
    const cacheDurationInMinutes = 5;
    if (cachedTokens && cachedTokens.refreshTime.getTime() + cacheDurationInMinutes * 60 * 1000 > new Date().getTime()) {
        if (!cachedTokens.tokens) {
            throw new Error('Could not sign in.');
        }

        return cachedTokens.tokens;
    }

    const newCachedTokens: typeof cachedTokens = {
        tokens: undefined,
        refreshTime: new Date(),
    }
    cachedTokens = newCachedTokens;

    // Step 1: Login with credentials to get login token
    const loginResponse = await fetch('https://accounts.eu1.gigya.com/accounts.login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            loginID: process.env.BILKA_EMAIL!,
            password: process.env.BILKA_PASSWORD!,
            apiKey: process.env.BILKA_API_KEY!,
        }),
    });

    const loginData = await loginResponse.json();

    if (!loginData.sessionInfo?.cookieValue) {
        throw new Error('Failed to get login token');
    }

    const authTokens: AuthTokens = {
        sessionInfo: loginData.sessionInfo,
        jwtToken: undefined!,
    };

    // Step 2: Exchange login token for JWT token
    const jwtResponse = await fetch(`https://accounts.eu1.gigya.com/accounts.getJWT?login_token=${authTokens.sessionInfo.cookieValue}&apiKey=${process.env.BILKA_API_KEY}`, {
        method: 'POST',
    });

    const jwtData = await jwtResponse.json();
    if (!jwtData.id_token) {
        throw new Error('Failed to get JWT token');
    }

    authTokens.jwtToken = jwtData.id_token;

    newCachedTokens.tokens = authTokens;
    newCachedTokens.refreshTime = new Date();

    return authTokens;
}