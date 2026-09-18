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
    /** How many times anything asked for a microphone, counted by `countMicrophones`. */
    microphonesOpened?: number;
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

/**
 * Walks the first-run tour as far as the step that asks for the two values.
 *
 * A new install no longer opens on a form. It opens on what an ElevenLabs agent is, because the
 * form is unanswerable until you know — see `onboarding.ts`. In a browser that tour is two steps
 * rather than three: there is no assistant role here to hand Jarvis.
 */
async function walkToCredentials(page: Page): Promise<void> {
  await expect(page.getByTestId('onboarding-agent')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('api-key')).toBeVisible();
}

/**
 * Walks the tour, fills in the two values and saves, leaving the app on the conversation screen.
 *
 * What says it arrived is the hologram, because that is all the conversation screen is now: no
 * title, no status line, no button. It opens the conversation by itself, so there is nothing to
 * press and nothing to read — see `conversation-screen.tsx`.
 */
async function configureElevenLabs(page: Page): Promise<void> {
  await walkToCredentials(page);
  await page.getByTestId('api-key').fill(API_KEY);
  await page.getByTestId('agent-id').fill(AGENT_ID);
  await page.getByTestId('save-settings').click();
  await expect(page.getByTestId('hologram')).toBeVisible();
  await expect(page.getByTestId('api-key')).toHaveCount(0);
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
 * Counts, in the page, how many times anything asked for a microphone.
 *
 * It used to keep the streams themselves and the loudest spectrum value any analyser had seen,
 * because sample mode listened to you and the test had to prove the readings reached the sphere.
 * That mood is gone. What is left worth checking is the opposite: that sample mode opens no
 * microphone at all, which is a thing only the page can answer.
 */
async function countMicrophones(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.microphonesOpened = 0;

    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.microphonesOpened = (window.microphonesOpened ?? 0) + 1;
      return getUserMedia(constraints);
    };
  });
}

/**
 * Refuses the microphone, the way a browser does when the permission is denied.
 *
 * `getUserMedia` rejecting with `NotAllowedError` is the whole of that answer — there is no
 * permission API the app consults, so this is exactly what a real refusal looks like to it. Added
 * after `countMicrophones`, and so replacing its wrapper: a refused microphone is never opened, and
 * counting the asking is not what these tests are about.
 */
async function refuseMicrophone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
}

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
  await countMicrophones(page);
});

test('opens on the tour, which explains what an agent is before asking for one', async ({ page }) => {
  await page.goto('/');

  // The first screen of a new install used to be two empty fields, which is a fair question to
  // ask somebody who already has an API key and an unanswerable one for everybody else.
  await expect(page.getByTestId('onboarding-agent')).toBeVisible();
  await expect(page.getByTestId('api-key')).toHaveCount(0);
  // Including the link that is the point of the step: an agent is worth having because it can be
  // wired to your own services, and that wiring is done on their site rather than in this app.
  await expect(page.getByTestId('link-sign-up')).toBeVisible();
  await expect(page.getByTestId('link-agent-tools')).toBeVisible();
  // Nowhere to go back to from the first step, so nothing offers it.
  await expect(page.getByTestId('onboarding-back')).toHaveCount(0);

  await page.getByTestId('onboarding-next').click();

  const credentials = page.getByTestId('onboarding-credentials');
  await expect(credentials).toBeVisible();
  await expect(page.getByTestId('api-key')).toBeVisible();
  await expect(page.getByTestId('agent-id')).toBeVisible();
  // Two steps in a browser, not three. A count promising a step nobody here can reach would be
  // worse than no count at all.
  await expect(credentials).toContainText('Step 2 of 2');
  // Both links to where the two values are found, since neither is somewhere this app can look.
  await expect(page.getByTestId('link-agent-id')).toBeVisible();
  await expect(page.getByTestId('link-api-key')).toBeVisible();

  // The web build keeps the key somewhere materially less safe than the phone
  // does, and the screen has to say so rather than imply a keystore.
  await expect(page.getByTestId('storage-note')).toContainText('local storage');

  // And back out again, without losing the tour.
  await page.getByTestId('onboarding-back').click();
  await expect(page.getByTestId('onboarding-agent')).toBeVisible();
});

test('refuses to save without an agent ID', async ({ page }) => {
  await page.goto('/');
  await walkToCredentials(page);

  await page.getByTestId('api-key').fill(API_KEY);
  await page.getByTestId('save-settings').click();

  await expect(page.getByTestId('settings-problem')).toContainText('agent');
  // Still on the same step: a refused save must not fall through, and must not move the tour on.
  await expect(page.getByTestId('onboarding-credentials')).toBeVisible();
  await expect(page.getByTestId('hologram')).toHaveCount(0);
});

test('saves valid settings, shows the conversation, and remembers across a reload', async ({ page }) => {
  await page.goto('/');
  await configureElevenLabs(page);

  // The instrument in the corner, which the browser gets and a phone does not. It is deliberately
  // almost the colour of the background, so what is checked is that it is there and counting —
  // being hard to read is the point and not something a test can have an opinion about.
  await expect(page.getByTestId('frame-rate')).toBeVisible();
  await expect(page.getByTestId('frame-rate')).toContainText('fps');

  await page.reload();

  // Straight back to the conversation, which is only possible if the settings
  // survived in localStorage — the native keystore path throws on web.
  await expect(page.getByTestId('hologram')).toBeVisible();
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

test('offers sample mode from the tour, walks its moods on a tap, and comes back from it', async ({ page }) => {
  await page.goto('/');
  // Offered on every step of the tour: somebody who has just installed this wants to know whether
  // it is worth signing up for anything, and the honest answer to that is the sphere rather than
  // another paragraph.
  await page.getByTestId('try-sample').click();

  // Sample mode is Jarvis and nothing else — no title, no status line, no way out but tapping
  // beside him — so there is nothing to assert on but the sphere.
  await expect(page.getByTestId('hologram')).toBeVisible();
  await expectHologramToKeepMoving(page);

  // Tapping him walks through what he does — speaking, working, at rest — because there is no text
  // on this screen to hang buttons off, and a tap is now the only thing that changes any of it.
  // What matters is that each mood still draws: they all come from the clock, and one that rendered
  // nothing would look exactly like a hologram that had stopped.
  for (const _mood of ['thinking', 'idle']) {
    await page.getByTestId('hologram').click();
    await expectHologramToKeepMoving(page);
  }

  // And round again, so the last mood leads back to the first rather than to a dead end.
  await page.getByTestId('hologram').click();
  await expectHologramToKeepMoving(page);

  // Nothing here ever opens a microphone. Sample mode used to have a fourth mood that listened to
  // you; it is gone, and so is the permission prompt and the recording indicator that came with it.
  expect(await page.evaluate(() => window.microphonesOpened ?? 0)).toBe(0);

  // Beside him, not on him: a tap on the hologram itself must not be a way out.
  await page.mouse.click(20, 20);
  // And back to the tour rather than past it. Sample mode is a side trip taken from setup and
  // returned to, which is why the tour is not marked as walked on the way out to it.
  await expect(page.getByTestId('onboarding-agent')).toBeVisible();
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
  // And the screen is still the conversation rather than having fallen back to setup: the drawing
  // failing must not take the thing it decorates with it.
  await expect(page.getByTestId('api-key')).toHaveCount(0);
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

  await expect(page.getByTestId('conversation-problem')).toContainText('rejected the API key');
});

test('explains an agent ID the account does not have', async ({ page }) => {
  await page.route(CONVERSATION_TOKEN_URL, async (route: Route) => {
    await answerTokenRequest(route, 404, { detail: 'Not found' });
  });

  await page.goto('/');
  await configureElevenLabs(page);

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

  // A link, because this is a browser. On a phone the same screen has nothing on it and settings
  // are a long press; see `conversation-screen.tsx` for why the two differ.
  await page.getByTestId('open-settings').click();
  // Sample mode is for before there is a Jarvis to talk to, not after.
  await expect(page.getByTestId('try-sample')).toHaveCount(0);
  // Both values come back, so fixing one does not mean pasting the key again.
  await expect(page.getByTestId('api-key')).toHaveValue(API_KEY);
  await expect(page.getByTestId('agent-id')).toHaveValue(AGENT_ID);

  await page.getByTestId('agent-id').fill('agent_corrected');
  await page.getByTestId('save-settings').click();
  await expect(page.getByTestId('hologram')).toBeVisible();

  // Two requests, and the first one is the point of the screen: it opens the conversation itself,
  // so the original agent ID was tried the moment the settings were saved, failed with a 404, and
  // is what sent the user back to correct it. Then the corrected one. A single request here would
  // mean the screen had gone back to waiting to be asked.
  await expect.poll(() => agentIds).toEqual([AGENT_ID, 'agent_corrected']);
});

test('offers a field to type into when the browser refuses the microphone', async ({ page }) => {
  await refuseMicrophone(page);
  await page.route(CONVERSATION_TOKEN_URL, async (route: Route) => {
    await answerTokenRequest(route, 200, { token: 'a-webrtc-token', conversation_id: 'conv_1' });
  });

  await page.goto('/');
  await configureElevenLabs(page);

  // The conversation still opens — ElevenLabs runs it as text on both sides — so this is a fallback
  // rather than the failure a phone reports.
  await expect(page.getByTestId('typed-message')).toBeVisible();

  // It gets no further than opening, because this suite closes every socket to ElevenLabs, so there
  // *is* a connection error on screen and there is supposed to be. What matters is which error: a
  // refused microphone must no longer be one of them in a browser, or the fallback never happened.
  await expect(page.getByTestId('conversation-problem')).not.toContainText('microphone');

  // The sphere is still the screen. A field appearing under it must not cost the drawing.
  await expect(page.getByTestId('hologram')).toBeVisible();
});

test('keeps the screen bare when the microphone is there to be used', async ({ page }) => {
  await page.route(CONVERSATION_TOKEN_URL, async (route: Route) => {
    await answerTokenRequest(route, 200, { token: 'a-webrtc-token', conversation_id: 'conv_1' });
  });

  await page.goto('/');
  await configureElevenLabs(page);

  // Typing is what you get instead of talking, never as well as it: the whole argument of this
  // screen is that there is nothing on it, and a field nobody needs is something on it.
  await expect(page.getByTestId('hologram')).toBeVisible();
  await expect(page.getByTestId('typed-message')).toHaveCount(0);
});
