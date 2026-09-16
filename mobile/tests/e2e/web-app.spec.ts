import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * The app running in a real browser, driven end to end.
 *
 * Everything here is the production web export — the same bundle `expo export`
 * produces for deployment — served over HTTP and clicked through with Chromium.
 * What it cannot cover is the ElevenLabs session itself, which needs a real API
 * key and real quota; the token request is where the browser is stopped, and the
 * assertions are about what the app sends to ElevenLabs rather than what
 * ElevenLabs does with it.
 */

const CONVERSATION_TOKEN_URL = 'https://api.elevenlabs.io/v1/convai/conversation/token**';

declare global {
  interface Window {
    /** Every microphone stream the page opened, kept by `watchMicrophone`. */
    microphoneStreams?: MediaStream[];
    /** The loudest spectrum value any analyser has handed the page, kept by `watchMicrophone`. */
    loudestSpectrumValue?: number;
  }
}

const API_KEY = 'sk_not-a-real-key';
const AGENT_ID = 'agent_01jz0123456789';

/**
 * Stops the page reaching anything but the app under test.
 *
 * Registered first, so any route a test adds afterwards — Playwright tries the
 * most recently added match first — answers before this one aborts. Without it a
 * session that got as far as a token would go on to dial ElevenLabs for real,
 * which is slow, flaky and, with a made-up key, pointless.
 *
 * WebSockets are closed separately, because `page.route` never sees them: the
 * conversation itself opens one to ElevenLabs once it has a token.
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

  await page.routeWebSocket(/^wss?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (webSocket) => webSocket.close());
}

/**
 * Answers a request to the token endpoint the way ElevenLabs would.
 *
 * The API key travels in a custom header, which in a real browser makes the
 * request cross-origin with a preflight. Playwright answers preflights for routed
 * requests itself, so this suite cannot tell whether ElevenLabs' own CORS policy
 * allows the app's origin; what it can check is that the request carries no
 * header beyond the key, which is what that preflight would have to allow.
 */
async function answerTokenRequest(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

/** Whether a header is one a browser adds on its own, rather than one the app chose to send. */
function isBrowserHeader(name: string): boolean {
  return (
    name.startsWith('sec-') ||
    [
      'accept',
      'accept-encoding',
      'accept-language',
      'cache-control',
      'connection',
      'host',
      'origin',
      'pragma',
      'referer',
      'user-agent',
    ].includes(name)
  );
}

/** Fills in the settings screen and saves, leaving the app on the conversation screen. */
async function configureElevenLabs(page: Page): Promise<void> {
  await page.getByTestId('api-key').fill(API_KEY);
  await page.getByTestId('agent-id').fill(AGENT_ID);
  await page.getByTestId('save-settings').click();
  await expect(page.getByTestId('talk')).toBeVisible();
}

/**
 * Waits for the hologram to be drawn and to keep moving: each look differs from
 * the one before. Twice, because the first change could be the first draw landing
 * on an empty canvas; a picture drawn once and never again fails the second.
 */
async function expectHologramToKeepMoving(page: Page): Promise<void> {
  const hologram = page.getByTestId('hologram');
  await expect(hologram.locator('canvas')).toBeVisible();

  for (let change = 0; change < 2; change++) {
    const previousLook = await hologram.screenshot();
    await expect.poll(async () => (await hologram.screenshot()).equals(previousLook), { timeout: 10000 }).toBe(false);
  }
}

/**
 * Keeps, in the page, every microphone stream it opens and the loudest spectrum
 * value any analyser gives it — so a test can tell the microphone's audio really
 * reached the readings, and that the stream was closed afterwards.
 */
async function watchMicrophone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.microphoneStreams = [];
    window.loudestSpectrumValue = 0;

    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints);
      window.microphoneStreams?.push(stream);
      return stream;
    };

    const getByteFrequencyData = AnalyserNode.prototype.getByteFrequencyData;
    AnalyserNode.prototype.getByteFrequencyData = function (array) {
      getByteFrequencyData.call(this, array);
      window.loudestSpectrumValue = Math.max(window.loudestSpectrumValue ?? 0, ...array);
    };
  });
}

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
});

test('opens on the settings screen, because nothing is configured yet', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('api-key')).toBeVisible();
  await expect(page.getByTestId('agent-id')).toBeVisible();

  // The web build keeps the key somewhere materially less safe than the phone
  // does, and the screen has to say so rather than imply a keystore.
  await expect(page.getByTestId('storage-note')).toContainText('local storage');
});

test('refuses to save without an agent ID', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('api-key').fill(API_KEY);
  await page.getByTestId('save-settings').click();

  await expect(page.getByTestId('settings-problem')).toContainText('agent');
  // Still on the settings screen: a refused save must not fall through.
  await expect(page.getByTestId('talk')).toHaveCount(0);
});

test('saves valid settings, shows the conversation, and remembers across a reload', async ({ page }) => {
  await page.goto('/');
  await configureElevenLabs(page);

  await expect(page.getByTestId('conversation-status')).toHaveText('Standing by.');

  // The assistant role is Android's. On web the app says so instead of offering
  // a setup step that cannot lead anywhere.
  await expect(page.getByTestId('assistant-card-heading')).toHaveText('Talking to Jarvis in a browser');

  await page.reload();

  // Straight back to the conversation, which is only possible if the settings
  // survived in localStorage — the native keystore path throws on web.
  await expect(page.getByTestId('talk')).toBeVisible();
  await expect(page.getByTestId('api-key')).toHaveCount(0);
});

test('draws the hologram and keeps it moving, from a CanvasKit the site serves itself', async ({ page }) => {
  const canvasKitResponses: Array<{ hostname: string; status: number }> = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.endsWith('canvaskit.wasm')) {
      canvasKitResponses.push({ hostname: url.hostname, status: response.status() });
    }
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await configureElevenLabs(page);

  // Nothing Skia-backed renders until CanvasKit has loaded, so a canvas at all
  // means the WebAssembly arrived. Every other host is aborted, so it can only
  // have come from the export's own `public/` — which `turbo initialize` fills.
  await expect(page.getByTestId('hologram').locator('canvas')).toBeVisible();
  expect(canvasKitResponses).toEqual([{ hostname: 'localhost', status: 200 }]);

  // It turns on its own, with no conversation open.
  await expectHologramToKeepMoving(page);

  expect(pageErrors).toEqual([]);
});

test('offers sample mode before setup, listening to the microphone, and comes back from it', async ({ page }) => {
  await watchMicrophone(page);
  await page.goto('/');
  await page.getByTestId('try-sample').click();

  // Sample mode is Jarvis and nothing else — no title, no status line, no way out but tapping
  // beside him — so what says the microphone opened is the readings reaching the hologram rather
  // than a line of text. The browser here has a fake microphone, granted up front (see
  // playwright.config.ts).
  await expect(page.getByTestId('hologram')).toBeVisible();

  // Chromium's fake microphone beeps. The beep has to reach the readings the
  // hologram is drawn from — a hologram that merely turns proves nothing, since
  // it turns with no audio at all.
  await expect.poll(() => page.evaluate(() => window.loudestSpectrumValue ?? 0), { timeout: 10000 }).toBeGreaterThan(0);
  await expectHologramToKeepMoving(page);

  // Tapping Jarvis himself walks through what he does — hearing you, speaking, working, at rest —
  // because there is no text on this screen to hang buttons off. The one that matters to check is
  // that the next mood still draws: it comes from the clock rather than the microphone, and a
  // mood that renders nothing would look exactly like a hologram that had stopped.
  await page.getByTestId('hologram').click();
  await expectHologramToKeepMoving(page);

  // Beside him, not on him: a tap on the hologram itself must not be a way out.
  await page.mouse.click(20, 20);
  await expect(page.getByTestId('api-key')).toBeVisible();

  // And leaving hands the microphone back.
  const trackStates = await page.evaluate(() =>
    (window.microphoneStreams ?? []).flatMap((stream) => stream.getTracks().map((track) => track.readyState)),
  );
  expect(trackStates.length).toBeGreaterThan(0);
  expect(trackStates.every((state) => state === 'ended')).toBe(true);
});

test('keeps the conversation screen working when CanvasKit cannot load', async ({ page }) => {
  await page.route('**/canvaskit.wasm', async (route: Route) => {
    await route.fulfill({ status: 404, body: 'Not found' });
  });

  await page.goto('/');
  await configureElevenLabs(page);

  // The hologram is decoration. Waiting for its placeholder means the failed load
  // has already happened, so the rest of the screen — the part that talks to
  // Jarvis — is checked after it, not before it had the chance to break.
  await expect(page.getByTestId('hologram-unavailable')).toBeVisible();
  await expect(page.getByTestId('hologram').locator('canvas')).toHaveCount(0);
  await expect(page.getByTestId('talk')).toBeEnabled();
  await expect(page.getByTestId('conversation-status')).toHaveText('Standing by.');
});

test('asks ElevenLabs for a conversation token for the agent, with the API key', async ({ page }) => {
  const tokenRequests: Array<{ url: URL; method: string; headers: Record<string, string> }> = [];

  await page.route(CONVERSATION_TOKEN_URL, async (route: Route) => {
    tokenRequests.push({
      url: new URL(route.request().url()),
      method: route.request().method(),
      headers: route.request().headers(),
    });

    await answerTokenRequest(route, 200, { token: 'a-webrtc-token', conversation_id: 'conv_1' });
  });

  await page.goto('/');
  await configureElevenLabs(page);
  await page.getByTestId('talk').click();

  await expect.poll(() => tokenRequests.length).toBe(1);
  const [request] = tokenRequests;
  expect(request?.method).toBe('GET');
  expect(request?.headers['xi-api-key']).toBe(API_KEY);
  expect(request?.url.searchParams.get('agent_id')).toBe(AGENT_ID);
  expect(request?.url.searchParams.get('participant_name')).toBe('jarvis-android');
  expect(request?.url.toString()).not.toContain(API_KEY);
  // Nothing but the key, so the cross-origin preflight has only that to allow.
  const chosenHeaders = Object.keys(request?.headers ?? {}).filter((name) => !isBrowserHeader(name));
  expect(chosenHeaders).toEqual(['xi-api-key']);
});

test('explains a rejected API key in terms of the setting to fix', async ({ page }) => {
  await page.route(CONVERSATION_TOKEN_URL, async (route: Route) => {
    await answerTokenRequest(route, 401, { detail: { status: 'invalid_api_key' } });
  });

  await page.goto('/');
  await configureElevenLabs(page);
  await page.getByTestId('talk').click();

  await expect(page.getByTestId('conversation-problem')).toContainText('rejected the API key');
});

test('explains an agent ID the account does not have', async ({ page }) => {
  await page.route(CONVERSATION_TOKEN_URL, async (route: Route) => {
    await answerTokenRequest(route, 404, { detail: 'Not found' });
  });

  await page.goto('/');
  await configureElevenLabs(page);
  await page.getByTestId('talk').click();

  await expect(page.getByTestId('conversation-problem')).toContainText('no agent with that ID');
});

test('lets the settings be reopened and corrected, and uses the correction', async ({ page }) => {
  const agentIds: Array<string | null> = [];
  await page.route(CONVERSATION_TOKEN_URL, async (route: Route) => {
    agentIds.push(new URL(route.request().url()).searchParams.get('agent_id'));
    await answerTokenRequest(route, 404, { detail: 'Not found' });
  });

  await page.goto('/');
  await configureElevenLabs(page);

  await page.getByTestId('open-settings').click();
  // Sample mode is for before there is a Jarvis to talk to, not after.
  await expect(page.getByTestId('try-sample')).toHaveCount(0);
  // Both values come back, so fixing one does not mean pasting the key again.
  await expect(page.getByTestId('api-key')).toHaveValue(API_KEY);
  await expect(page.getByTestId('agent-id')).toHaveValue(AGENT_ID);

  await page.getByTestId('agent-id').fill('agent_corrected');
  await page.getByTestId('save-settings').click();
  await expect(page.getByTestId('talk')).toBeVisible();
  await page.getByTestId('talk').click();

  await expect.poll(() => agentIds).toEqual(['agent_corrected']);
});
