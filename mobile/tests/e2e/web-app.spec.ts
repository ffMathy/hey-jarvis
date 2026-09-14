import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * The app running in a real browser, driven end to end.
 *
 * Everything here is the production web export — the same bundle `expo export`
 * produces for deployment — served over HTTP and clicked through with Chromium.
 * What it cannot cover is the ElevenLabs session itself, which needs a real
 * conversation token and real quota; that boundary is where the requests are
 * intercepted, and the assertions are about what the app sends to its own server
 * rather than what ElevenLabs does with it.
 */

const CONVERSATION_TOKEN_PATH = '**/api/voice/conversation-token';

const SERVER_URL = 'https://jarvis.example.com';
const ACCESS_TOKEN = 'a-shared-secret-the-phone-holds';

/**
 * Stops the page reaching anything but the server under test.
 *
 * Without this a session that gets as far as a token would go on to dial
 * ElevenLabs for real, which is slow, flaky and — with a made-up token —
 * pointless. Blocking it makes the failure immediate and local.
 */
async function blockExternalRequests(page: Page): Promise<void> {
  await page.route('**/*', async (route: Route) => {
    const { hostname } = new URL(route.request().url());
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      await route.continue();
      return;
    }

    await route.abort();
  });
}

/** Fills in the settings screen and saves, leaving the app on the conversation screen. */
async function configureServer(page: Page): Promise<void> {
  await page.getByTestId('server-url').fill(SERVER_URL);
  await page.getByTestId('access-token').fill(ACCESS_TOKEN);
  await page.getByTestId('save-settings').click();
  await expect(page.getByTestId('talk')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
});

test('opens on the settings screen, because nothing is configured yet', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('server-url')).toBeVisible();
  await expect(page.getByTestId('access-token')).toBeVisible();

  // The web build keeps the token somewhere materially less safe than the phone
  // does, and the screen has to say so rather than imply a keystore.
  await expect(page.getByTestId('storage-note')).toContainText('local storage');
});

test('refuses a plain-http server address, which would put the token on the wire in clear', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('server-url').fill('http://jarvis.example.com');
  await page.getByTestId('access-token').fill(ACCESS_TOKEN);
  await page.getByTestId('save-settings').click();

  await expect(page.getByTestId('settings-problem')).toContainText('https');
  // Still on the settings screen: a refused save must not fall through.
  await expect(page.getByTestId('talk')).toHaveCount(0);
});

test('saves valid settings, shows the conversation, and remembers across a reload', async ({ page }) => {
  await page.goto('/');
  await configureServer(page);

  await expect(page.getByTestId('conversation-status')).toHaveText('Standing by.');

  // The assistant role is Android's. On web the app says so instead of offering
  // a setup step that cannot lead anywhere.
  await expect(page.getByTestId('assistant-card-heading')).toHaveText('Talking to Jarvis in a browser');

  await page.reload();

  // Straight back to the conversation, which is only possible if the settings
  // survived in localStorage — the native keystore path throws on web.
  await expect(page.getByTestId('talk')).toBeVisible();
  await expect(page.getByTestId('server-url')).toHaveCount(0);
});

test('asks its own server for a conversation token, presenting the access token as a bearer', async ({ page }) => {
  const tokenRequests: Array<{ authorization: string | undefined; body: string | undefined }> = [];

  await page.route(CONVERSATION_TOKEN_PATH, async (route: Route) => {
    tokenRequests.push({
      authorization: route.request().headers().authorization,
      body: route.request().postData() ?? undefined,
    });

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { token: 'a-webrtc-token', conversationId: 'conv_1' } }),
    });
  });

  await page.goto('/');
  await configureServer(page);
  await page.getByTestId('talk').click();

  await expect.poll(() => tokenRequests.length).toBe(1);
  expect(tokenRequests[0]?.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  expect(JSON.parse(tokenRequests[0]?.body ?? '{}')).toEqual({ participantName: 'jarvis-android' });
});

test('explains a rejected access token in terms of the setting to fix', async ({ page }) => {
  await page.route(CONVERSATION_TOKEN_PATH, async (route: Route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'A valid bearer token is required.' }),
    });
  });

  await page.goto('/');
  await configureServer(page);
  await page.getByTestId('talk').click();

  await expect(page.getByTestId('conversation-problem')).toContainText('HEY_JARVIS_MOBILE_APP_ACCESS_TOKEN');
});

test('explains a server that has not been given an access token at all', async ({ page }) => {
  await page.route(CONVERSATION_TOKEN_PATH, async (route: Route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ success: false }),
    });
  });

  await page.goto('/');
  await configureServer(page);
  await page.getByTestId('talk').click();

  await expect(page.getByTestId('conversation-problem')).toContainText('not configured');
});

test('lets the settings be reopened and corrected', async ({ page }) => {
  await page.goto('/');
  await configureServer(page);

  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('server-url')).toHaveValue(SERVER_URL);
});
