import { expect, type Page, type Route, test } from '@playwright/test';
import { blockExternalRequests } from './external-requests';

/**
 * The app running in a real browser, driven end to end.
 *
 * Everything here is the production web export — the same bundle `expo export`
 * produces for deployment — served over HTTP and clicked through with Chromium.
 * Sir's Jarvis server is played by the test: it pairs the browser
 * (`POST /api/devices`) and starts each conversation (`POST /api/paired/conversation`),
 * as the real one does with ElevenLabs behind it. What this cannot cover is the
 * ElevenLabs session itself, which needs real quota; the conversation request is
 * where the browser is stopped, and the assertions are about what the app sends
 * the server rather than what ElevenLabs does with what it is handed.
 */

declare global {
  interface Window {
    /** How many times anything asked for a microphone, counted by `countMicrophones`. */
    microphonesOpened?: number;
    /** Every microphone stream handed to the page, in order, kept by `countMicrophones`. */
    microphoneStreams?: MediaStream[];
    /** The source of every sound the page started playing, in order, kept by `listenForSounds`. */
    soundsPlayed?: string[];
    /** The source of every sound the browser refused to play, kept by `listenForSounds`. */
    soundsRefused?: string[];
  }
}

/** Sir's Jarvis server, as he would type it. Answered by `page.route` below, and nowhere else. */
const JARVIS_SERVER = 'https://jarvis.example.test';

/** Where the browser is paired: `DEVICE_PAIRING_PATH` in `hologram`. */
const PAIRING_URL = `${JARVIS_SERVER}/api/devices`;

/** Where a paired browser asks for each conversation: `PAIRED_CONVERSATION_PATH` in `hologram`. */
const CONVERSATION_URL = `${JARVIS_SERVER}/api/paired/conversation`;

/** The token the server pairs this browser with: base64url, as the server mints them. */
const DEVICE_TOKEN = 'cGFpcmVkLWJyb3dzZXItdG9rZW4tMDEyMzQ1Njc4OQ';

/** A signed URL as ElevenLabs makes one, handed on by the server for a typed conversation. */
const SIGNED_URL = 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=x&conversation_signature=y';

/** An answer from the Jarvis server, in its JSON envelope. */
interface ServerAnswer {
  status: number;
  body: unknown;
}

/** The server pairing the browser, and handing it its token. */
function pairedWith(token: string): ServerAnswer {
  return { status: 201, body: { success: true, message: 'Device paired', data: { token } } };
}

/**
 * The headers a credentialed request needs back before the browser shows the page the answer: the
 * page's own origin, never `*`, and leave to read it with the cookie it was sent with. The server's
 * real CORS is `allowWebAppsWithCredentials` in `mcp`; Playwright does not apply it for a routed
 * request, so the test answers as it does.
 */
function credentialedCors(route: Route): Record<string, string> {
  return {
    'access-control-allow-origin': route.request().headers().origin ?? '',
    'access-control-allow-credentials': 'true',
  };
}

/** A pairing request, as far as these tests read it. */
interface PairingRequest {
  method: string;
  contentType: string | undefined;
  body: string | null;
}

/**
 * Plays the server's pairing route: every request is kept, and answered with `answer`, or — for
 * `'unreachable'` — not answered at all, which is how Cloudflare Access's login looks to a page,
 * since it answers without the CORS headers the browser needs to show it anything. Registered after
 * whatever came before, so it wins: Playwright tries the most recently added route first.
 */
async function answerPairing(page: Page, answer: ServerAnswer | 'unreachable'): Promise<PairingRequest[]> {
  const requests: PairingRequest[] = [];
  await page.route(PAIRING_URL, async (route: Route) => {
    const request = route.request();
    requests.push({
      method: request.method(),
      contentType: request.headers()['content-type'],
      body: request.postData(),
    });
    if (answer === 'unreachable') {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: answer.status,
      contentType: 'application/json',
      headers: credentialedCors(route),
      body: JSON.stringify(answer.body),
    });
  });
  return requests;
}

/** A conversation request the server was sent, as far as these tests read it. */
interface ConversationRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: { transport?: string; participantName?: string };
}

/** What the server answers a conversation request with: a credential for its transport. */
function aCredentialFor(request: ConversationRequest): ServerAnswer {
  return {
    status: 200,
    body: {
      success: true,
      data: request.body.transport === 'websocket' ? { signedUrl: SIGNED_URL } : { token: 'a-webrtc-token' },
    },
  };
}

/**
 * Plays the server's conversation route: every request is kept, and answered by `answer` — a
 * credential for the transport asked for, unless the test says otherwise.
 */
async function answerConversations(
  page: Page,
  answer: (request: ConversationRequest) => ServerAnswer = aCredentialFor,
): Promise<ConversationRequest[]> {
  const requests: ConversationRequest[] = [];
  await page.route(CONVERSATION_URL, async (route: Route) => {
    const request = route.request();
    const asked = {
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      body: JSON.parse(request.postData() ?? '{}'),
    };
    requests.push(asked);
    const { status, body } = answer(asked);
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
  return requests;
}

/**
 * Leaves the room's connection open and unanswered, so the conversation is still being dialled for
 * as long as a test looks.
 *
 * The session dials the moment the token is in, behind the greeting. A room closed at once, as
 * `blockExternalRequests` closes it, fails the summoning while he greets, and a failed summoning
 * stops the greeting.
 */
async function keepDialling(page: Page): Promise<void> {
  await page.routeWebSocket(/^wss?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, () => undefined);
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
 * Pairs the browser on the tour, leaving the app on the conversation screen.
 *
 * A new install opens on the tour's one step in a browser — what the Jarvis server is, and pairing
 * with it (`onboarding.ts`) — and pairing is what finishes it. What says the app arrived is the
 * hologram, because that is all the conversation screen is: no title and no status line. It opens
 * the conversation by itself, so there is nothing to press — see `conversation-screen.tsx`.
 */
async function pairWithJarvis(page: Page, typed = JARVIS_SERVER): Promise<void> {
  await expect(page.getByTestId('onboarding-server')).toBeVisible();
  await page.getByTestId('jarvis-server').fill(typed);
  await page.getByTestId('pair-with-server').click();
  await expect(page.getByTestId('hologram')).toBeVisible();
  await expect(page.getByTestId('jarvis-server')).toHaveCount(0);
}

/** What the page keeps in `localStorage` under a key, read by name, which goes through no wrapper. */
async function storedValue(page: Page, key: string): Promise<string | null> {
  return page.evaluate((name) => {
    const value: unknown = window.localStorage[name];
    return typeof value === 'string' ? value : null;
  }, key);
}

/**
 * Waits for the hologram to be drawn and to keep moving: each look differs from
 * the one before. Twice, because the first change could be the first draw landing
 * on an empty canvas; a picture drawn once and never again fails the second.
 *
 * The look is the whole of him, drawn on the GPU into the one canvas (`hologram-canvas`).
 */
async function expectHologramToKeepMoving(page: Page): Promise<void> {
  const hologram = page.getByTestId('hologram');
  await expect(page.getByTestId('hologram-canvas')).toBeVisible();

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
    window.microphoneStreams = [];

    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.microphonesOpened = (window.microphonesOpened ?? 0) + 1;
      const stream = await getUserMedia(constraints);
      window.microphoneStreams?.push(stream);
      return stream;
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

/**
 * Keeps the source of every sound the page starts playing.
 *
 * Playing rather than fetching, because the greeting's player loads the recording the moment the
 * conversation screen mounts, whether or not it will ever be played — a request for the file
 * proves nothing. `play()` on a media element is the one thing that says a sound was meant to be
 * heard, and expo-audio's web player goes through it.
 */
async function listenForSounds(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.soundsPlayed = [];
    window.soundsRefused = [];

    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const source = this.currentSrc || this.src;
      window.soundsPlayed?.push(source);
      const playing = play.call(this);
      playing.catch(() => window.soundsRefused?.push(source));
      return playing;
    };
  });
}

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
  await countMicrophones(page);
  await listenForSounds(page);
  // The server pairs whoever asks, unless a test says otherwise by answering after this.
  await answerPairing(page, pairedWith(DEVICE_TOKEN));
});

test('opens on the tour, which says what the Jarvis server is and asks for nothing but pairing', async ({ page }) => {
  await page.goto('/');

  const server = page.getByTestId('onboarding-server');
  await expect(server).toBeVisible();
  await expect(server).toContainText('Jarvis server');
  await expect(page.getByTestId('jarvis-server')).toBeVisible();
  await expect(page.getByTestId('pair-with-server')).toBeVisible();
  // No ElevenLabs key, no agent ID and no service token: the server holds every one of them.
  for (const removed of ['api-key', 'agent-id', 'jarvis-server-client-id', 'jarvis-server-client-secret']) {
    await expect(page.getByTestId(removed)).toHaveCount(0);
  }
  // One step in a browser, which has no assistant role to offer him: no count promising more, and
  // nowhere to go back to, or on to before pairing.
  await expect(page.getByTestId('onboarding-progress')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-back')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-next')).toHaveCount(0);

  // The web build keeps the token somewhere materially less safe than the phone does, and the
  // screen has to say so rather than imply a keystore.
  await expect(page.getByTestId('storage-note')).toContainText('local storage');
});

test('pairs through Access’s cookie, opens the conversation, and remembers it across a reload', async ({ page }) => {
  const pairings = await answerPairing(page, pairedWith(DEVICE_TOKEN));

  await page.goto('/');
  await pairWithJarvis(page);

  // One request, as a browser sends without a preflight — which would carry no cookie, and be
  // answered by Access's login — naming this browser for the server's list of devices.
  expect(pairings).toEqual([{ method: 'POST', contentType: 'text/plain', body: 'Phone web app' }]);

  // No readout: the frame-rate and particle count are sample mode's alone.
  await expect(page.getByTestId('frame-rate')).toHaveCount(0);

  // Kept under `hologram`'s keys, which the headset's page on the same origin reads too, and the
  // tour remembered as walked.
  expect(await storedValue(page, 'jarvis.server-address')).toBe(JARVIS_SERVER);
  expect(await storedValue(page, 'jarvis.device-token')).toBe(DEVICE_TOKEN);
  expect(await storedValue(page, 'jarvis.onboarding-walked')).not.toBeNull();

  await page.reload();

  // Straight back to the conversation, which is only possible if the pairing survived in
  // localStorage — the native keystore path throws on web.
  await expect(page.getByTestId('hologram')).toBeVisible();
  await expect(page.getByTestId('jarvis-server')).toHaveCount(0);
});

test('refuses anything but a Jarvis server’s own https address, and asks nothing of it', async ({ page }) => {
  const pairings = await answerPairing(page, pairedWith(DEVICE_TOKEN));
  await page.goto('/');

  for (const { typed, problem } of [
    { typed: '', problem: 'Enter your Jarvis server' },
    { typed: 'http://jarvis.example.test', problem: 'has to start with https://' },
    { typed: 'https://jarvis.example.test/api/photos', problem: 'with no path after it' },
    { typed: 'https://sir:secret@jarvis.example.test', problem: 'no user name or password' },
  ]) {
    await page.getByTestId('jarvis-server').fill(typed);
    await page.getByTestId('pair-with-server').click();
    await expect(page.getByTestId('pairing-problem')).toContainText(problem);
  }

  // Still on the tour: a refused address must not fall through, and nothing reached the server.
  await expect(page.getByTestId('onboarding-server')).toBeVisible();
  await expect(page.getByTestId('hologram')).toHaveCount(0);
  expect(pairings).toEqual([]);
  expect(await storedValue(page, 'jarvis.device-token')).toBeNull();
});

test('keeps a bare host as the https origin it names', async ({ page }) => {
  await page.goto('/');
  await pairWithJarvis(page, 'jarvis.example.test/');

  await page.reload();
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('jarvis-server')).toHaveValue(JARVIS_SERVER);
});

test('offers the server’s sign-in when it did not answer, and pairs once asked again', async ({ page }) => {
  await answerPairing(page, 'unreachable');
  await page.goto('/');

  await page.getByTestId('jarvis-server').fill(JARVIS_SERVER);
  await page.getByTestId('pair-with-server').click();

  // What Access's login looks like from a page: no answer it can read. So the way on is to sign in
  // to the server in this browser, and then pair again — and the tour stays where it is.
  await expect(page.getByTestId('pairing-problem')).toContainText('did not answer');
  await expect(page.getByTestId('pairing-sign-in')).toBeVisible();
  await expect(page.getByTestId('onboarding-server')).toBeVisible();
  expect(await storedValue(page, 'jarvis.device-token')).toBeNull();

  // Signed in: the server answers now.
  await answerPairing(page, pairedWith(DEVICE_TOKEN));
  await page.getByTestId('pair-with-server').click();
  await expect(page.getByTestId('hologram')).toBeVisible();
  expect(await storedValue(page, 'jarvis.device-token')).toBe(DEVICE_TOKEN);
});

test('says why the server would not pair this browser, and offers no sign-in for a refusal', async ({ page }) => {
  await answerPairing(page, { status: 403, body: { success: false, message: 'Forbidden' } });
  await page.goto('/');

  await page.getByTestId('jarvis-server').fill(JARVIS_SERVER);
  await page.getByTestId('pair-with-server').click();

  await expect(page.getByTestId('pairing-problem')).toContainText('would not pair this browser (HTTP 403)');
  await expect(page.getByTestId('pairing-sign-in')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-server')).toBeVisible();
});

test('pairs with nothing when the server answers without a token', async ({ page }) => {
  await answerPairing(page, { status: 201, body: { success: true, data: {} } });
  await page.goto('/');

  await page.getByTestId('jarvis-server').fill(JARVIS_SERVER);
  await page.getByTestId('pair-with-server').click();

  await expect(page.getByTestId('pairing-problem')).toContainText('without a token');
  await expect(page.getByTestId('hologram')).toHaveCount(0);
  expect(await storedValue(page, 'jarvis.device-token')).toBeNull();
});

test('draws the hologram on WebGL 2 and keeps it moving, with nothing to fetch first', async ({ page }) => {
  const webAssemblyRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('.wasm')) {
      webAssemblyRequests.push(request.url());
    }
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await pairWithJarvis(page);

  // All of him is one canvas holding a WebGL 2 context: there is no second canvas for the rest of
  // him, and no WebAssembly to wait for before he can be drawn.
  const canvas = page.getByTestId('hologram-canvas').locator('canvas');
  await expect(canvas).toHaveCount(1);
  await expect(page.getByTestId('hologram').locator('canvas')).toHaveCount(1);
  expect(
    await canvas.evaluate(
      (element) =>
        element instanceof HTMLCanvasElement && element.getContext('webgl2') instanceof WebGL2RenderingContext,
    ),
  ).toBe(true);

  // It turns on its own, with no conversation open.
  await expectHologramToKeepMoving(page);

  expect(webAssemblyRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('offers sample mode from the tour, walks its moods on a tap, and comes back from it', async ({ page }) => {
  await page.goto('/');
  // Offered on the tour: somebody who has just installed this wants to know whether it is worth
  // setting anything up, and the honest answer to that is the sphere rather than another paragraph.
  await page.getByTestId('try-sample').click();

  // Sample mode is Jarvis and nothing else — no title, no status line, no way out but tapping
  // beside him — so there is nothing to assert on but the sphere.
  await expect(page.getByTestId('hologram')).toBeVisible();
  await expectHologramToKeepMoving(page);

  // The one thing on this screen besides him: how fast he is being drawn, and with how many
  // particles. Sample mode is where the drawing is shown off, so it is where it is measured.
  await expect(page.getByTestId('frame-rate')).toContainText('fps');
  await expect(page.getByTestId('frame-rate')).toContainText('sparks');

  // Tapping him walks through what he does — speaking, listening, working, at rest — because there is no text
  // on this screen to hang buttons off, and a tap is now the only thing that changes any of it.
  // What matters is that each mood still draws: they all come from the clock, and one that rendered
  // nothing would look exactly like a hologram that had stopped.
  for (const _mood of ['listening', 'thinking', 'idle']) {
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
  await expect(page.getByTestId('onboarding-server')).toBeVisible();
});

test('keeps the conversation screen working in a browser without WebGL 2', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'WebGL2RenderingContext');
    const getContext = HTMLCanvasElement.prototype.getContext;
    Reflect.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
        return kind === 'webgl2' ? null : Reflect.apply(getContext, this, [kind, ...rest]);
      },
    });
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await pairWithJarvis(page);

  // The hologram is decoration. With nothing to draw him with there is no GL view at all, and his
  // square is held empty rather than letting the screen jump.
  const hologram = page.getByTestId('hologram');
  await expect(page.getByTestId('hologram-canvas')).toHaveCount(0);
  await expect(hologram.locator('canvas')).toHaveCount(0);
  expect((await hologram.boundingBox())?.width ?? 0).toBeGreaterThan(0);
  // And the screen is still the conversation rather than having fallen back to setup: the drawing
  // failing must not take the thing it decorates with it.
  await expect(page.getByTestId('jarvis-server')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('asks the paired server for each conversation, with this browser’s token and the phone’s name', async ({
  page,
}) => {
  const asked = await answerConversations(page);

  await page.goto('/');
  await pairWithJarvis(page);

  await expect.poll(() => asked.length).toBe(1);
  const [request] = asked;
  expect(request?.method).toBe('POST');
  expect(request?.url).toBe(CONVERSATION_URL);
  expect(request?.headers.authorization).toBe(`Bearer ${DEVICE_TOKEN}`);
  expect(request?.headers['content-type']).toBe('application/json');
  // A spoken conversation, under the name the phone goes by in the history.
  expect(request?.body).toEqual({ transport: 'webrtc', participantName: 'jarvis-android' });
  // The token travels in its header and nowhere else, and no ElevenLabs key goes anywhere at all.
  expect(request?.url).not.toContain(DEVICE_TOKEN);
  const chosenHeaders = Object.keys(request?.headers ?? {}).filter((name) => !isBrowserHeader(name));
  expect(chosenHeaders.toSorted()).toEqual(['authorization', 'content-type']);
});

test('greets you from the recording while the conversation is still being dialled', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const asked = await answerConversations(page);
  await keepDialling(page);

  await page.goto('/');
  await pairWithJarvis(page);

  // "Hello sir, how can I help?" — the firmware's recording, bundled into the export and played
  // the moment he is summoned, while the session is dialled behind it rather than after it. That the
  // session is then asked for no first message of its own travels over LiveKit's data channel,
  // which this suite never answers;
  // `greeting-handover.spec.ts` in `hologram` pins the override itself.
  await expect.poll(() => page.evaluate(() => window.soundsPlayed)).toHaveLength(1);
  const [greeting] = (await page.evaluate(() => window.soundsPlayed)) ?? [];
  expect(new URL(greeting ?? '').hostname).toBe('localhost');
  expect(greeting).toMatch(/greeting.*\.mp3/);
  await expect.poll(() => asked.length).toBe(1);

  expect(pageErrors).toEqual([]);
});

test('greets from the recording in a browser nobody has touched since it loaded', async ({ page }) => {
  let conversationRequests = 0;
  const answer = (request: ConversationRequest) => {
    conversationRequests++;
    return aCredentialFor(request);
  };
  await answerConversations(page, answer);
  await keepDialling(page);

  await page.goto('/');
  await pairWithJarvis(page);
  await expect.poll(() => conversationRequests).toBe(1);

  // A second tab onto the saved pairing lands straight on the conversation with no click behind
  // it, and a browser will not start a sound then — unless the page is using the microphone. So
  // the microphone asked for before the session is held open until the greeting has started, and
  // he greets from the recording here too, rather than leaving it to the agent's own voice.
  //
  // A new tab rather than a reload of this one, and deliberately: a reload is not a guaranteed
  // clean slate in Chromium, which about one run in five under load still reported the reloaded
  // page as interacted with and let it play. A tab nobody has touched is exactly the case.
  const untouched = await page.context().newPage();
  const pageErrors: string[] = [];
  untouched.on('pageerror', (error) => pageErrors.push(error.message));
  await blockExternalRequests(untouched);
  await countMicrophones(untouched);
  await listenForSounds(untouched);
  await answerConversations(untouched, answer);
  await keepDialling(untouched);
  await untouched.goto('/');
  await expect.poll(() => conversationRequests).toBe(2);

  await expect.poll(() => untouched.evaluate(() => window.soundsPlayed)).toHaveLength(1);
  const [greeting] = (await untouched.evaluate(() => window.soundsPlayed)) ?? [];
  expect(greeting).toMatch(/greeting.*\.mp3/);
  // Asked for is not heard: a refusal arrives on the promise `play()` returned.
  await untouched.waitForTimeout(500);
  expect(await untouched.evaluate(() => window.soundsRefused)).toEqual([]);

  // And the microphone held for it is let go once he has started, rather than lighting the
  // browser's recording indicator for as long as the tab stays open.
  await expect
    .poll(() =>
      untouched.evaluate(() =>
        window.microphoneStreams?.[0]?.getTracks().every((track) => track.readyState === 'ended'),
      ),
    )
    .toBe(true);

  expect(pageErrors).toEqual([]);
});

test('says so when the server no longer knows this browser', async ({ page }) => {
  await answerConversations(page, () => ({ status: 401, body: { success: false, message: 'Unauthorized' } }));

  await page.goto('/');
  await pairWithJarvis(page);

  // Unpaired on the server, or the server lost its pairings: the way on is to pair again.
  await expect(page.getByTestId('conversation-problem')).toContainText('no longer paired');
});

test('passes on what the server says when it cannot start a conversation', async ({ page }) => {
  const NO_KEY = 'Your Jarvis server has no ElevenLabs key or agent to start a conversation with.';
  await answerConversations(page, () => ({ status: 503, body: { success: false, message: NO_KEY } }));

  await page.goto('/');
  await pairWithJarvis(page);

  await expect(page.getByTestId('conversation-problem')).toContainText(NO_KEY);
});

test('says the server could not be reached when it does not answer for a conversation', async ({ page }) => {
  // No route for the conversation: `blockExternalRequests` aborts it, as a server that is down does.
  await page.goto('/');
  await pairWithJarvis(page);

  await expect(page.getByTestId('conversation-problem')).toContainText('could not be reached');
});

test('lets the browser be paired again from the settings, and uses the new token', async ({ page }) => {
  const asked = await answerConversations(page);

  await page.goto('/');
  await pairWithJarvis(page);
  await expect.poll(() => asked.length).toBe(1);

  // A link, because this is a browser. On a phone the same screen has nothing on it and settings
  // are a long press; see `conversation-screen.tsx` for why the two differ.
  await page.getByTestId('open-settings').click();
  // Sample mode is for before there is a Jarvis to talk to, not after.
  await expect(page.getByTestId('try-sample')).toHaveCount(0);
  // The server comes back, so pairing again does not mean typing it again.
  await expect(page.getByTestId('jarvis-server')).toHaveValue(JARVIS_SERVER);
  await expect(page.getByTestId('pair-with-server')).toHaveText('Pair again');

  const NEW_TOKEN = 'cGFpcmVkLWFnYWluLXdpdGgtYS1uZXctdG9rZW4';
  await answerPairing(page, pairedWith(NEW_TOKEN));
  await page.getByTestId('pair-with-server').click();
  await expect(page.getByTestId('hologram')).toBeVisible();

  // Two requests: the first opened the conversation the tour landed on, the second the one the new
  // pairing opened, with the token it brought.
  await expect
    .poll(() => asked.map((request) => request.headers.authorization))
    .toEqual([`Bearer ${DEVICE_TOKEN}`, `Bearer ${NEW_TOKEN}`]);
  expect(await storedValue(page, 'jarvis.device-token')).toBe(NEW_TOKEN);
});

test('forgets the server, and with it the pairing and the conversation', async ({ page }) => {
  const asked = await answerConversations(page);
  await page.goto('/');
  await pairWithJarvis(page);
  await expect.poll(() => asked.length).toBe(1);

  await page.getByTestId('open-settings').click();
  await page.getByTestId('forget-server').click();

  // Not set up any more: the settings screen with nothing to cancel back to, and sample mode offered.
  await expect(page.getByTestId('forget-server')).toHaveCount(0);
  await expect(page.getByTestId('cancel-settings')).toHaveCount(0);
  await expect(page.getByTestId('try-sample')).toBeVisible();
  await expect(page.getByTestId('hologram')).toHaveCount(0);
  expect(await storedValue(page, 'jarvis.server-address')).toBe('');
  expect(await storedValue(page, 'jarvis.device-token')).toBe('');

  // And across a reload, where the walked tour leaves the settings screen rather than the tour.
  await page.reload();
  await expect(page.getByTestId('jarvis-server')).toHaveValue('');
  await expect(page.getByTestId('onboarding-server')).toHaveCount(0);
  expect(asked).toHaveLength(1);
});

test('reads a pairing that could not be read again, rather than taking it for none', async ({ page }) => {
  await answerConversations(page);
  await page.goto('/');
  await pairWithJarvis(page);

  // The store refusing to give the token up once, as a keystore can in a window still coming up: it
  // is there, and the first read of it throws.
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    let refused = false;
    Storage.prototype.getItem = function (this: Storage, key: string) {
      if (key === 'jarvis.device-token' && !refused) {
        refused = true;
        throw new DOMException('The token cannot be read just now', 'SecurityError');
      }
      return getItem.call(this, key);
    };
  });
  await page.reload();

  // Still paired: the conversation, not the settings screen a phone never set up would open on.
  await expect(page.getByTestId('hologram')).toBeVisible();
  await expect(page.getByTestId('jarvis-server')).toHaveCount(0);
});

test('offers a field to type into when the browser refuses the microphone', async ({ page }) => {
  await refuseMicrophone(page);
  const asked = await answerConversations(page);

  await page.goto('/');
  await pairWithJarvis(page);

  // The conversation still opens — ElevenLabs runs it as text on both sides — so this is a fallback
  // rather than the failure a phone reports.
  await expect(page.getByTestId('typed-message')).toBeVisible();

  // And it is dialled over a socket rather than over WebRTC, which is the whole of the fix for a
  // browser that sat on "Connecting…" for ever: a WebRTC room nobody publishes audio into never
  // finishes coming up, and a conversation token can only be spent on one. So a typed conversation
  // asks the server for a signed URL and never for a token at all.
  await expect.poll(() => asked.map((request) => request.body.transport)).toEqual(['websocket']);

  // It gets no further than opening, because this suite closes every socket to ElevenLabs, so there
  // *is* a connection error on screen and there is supposed to be. What matters is which error: a
  // refused microphone must no longer be one of them in a browser, or the fallback never happened.
  await expect(page.getByTestId('conversation-problem')).not.toContainText('microphone');

  // And once there is no conversation coming, the field says so rather than going on promising one.
  // "Connecting…" that never stops is what the user was actually shown.
  await expect(page.getByTestId('typed-message')).toHaveAttribute('placeholder', 'Not connected');

  // The sphere is still the screen. A field appearing under it must not cost the drawing.
  await expect(page.getByTestId('hologram')).toBeVisible();
});

test('offers the same field beside a microphone that works', async ({ page }) => {
  const asked = await answerConversations(page);

  await page.goto('/');
  await pairWithJarvis(page);

  // Typing used to be what you got *instead* of talking, and only in a browser that had refused the
  // microphone — which is the one session ElevenLabs is asked not to speak in, so Jarvis answered
  // it in writing. He does not have to: `sendUserMessage` takes the same turn a spoken line would
  // in an ordinary session, and comes back spoken. So the field is here as well as the microphone.
  await expect(page.getByTestId('typed-message')).toBeVisible();

  // And this is still an ordinary voice conversation, which is the whole point of the field being
  // here: a token for a WebRTC room, never the signed URL a text-only session runs on. Asking for
  // the latter would mean the screen had quietly made this a written conversation after all.
  await expect.poll(() => asked.map((request) => request.body.transport)).toEqual(['webrtc']);

  // The sphere is still the screen. A field appearing under it must not cost the drawing.
  await expect(page.getByTestId('hologram')).toBeVisible();
});

/**
 * Plays ElevenLabs' side of a text-only conversation, so a reply can be seen arriving.
 *
 * **Every other test in this file closes the socket**, which is right for them — they are about
 * what the app sends, and a real session needs a real agent and real quota. It is also why nothing
 * here ever saw an *answer*, and why the fallback could ship unable to show one: the field was
 * asserted visible, the conversation was asserted dialled correctly, and the half where Jarvis
 * says something back had no coverage at all.
 *
 * Two frames are the whole protocol needed. The SDK opens the socket, sends its overrides, and
 * waits for `conversation_initiation_metadata` before it reports `connected`; after that an
 * `agent_response` is what a written reply looks like on the wire. Registered after
 * `blockExternalRequests`, so it wins — Playwright tries the most recently added route first.
 */
async function answerAsJarvis(page: Page, replies: string[]): Promise<{ heard: string[]; initiations: unknown[] }> {
  const heard: string[] = [];
  const initiations: unknown[] = [];

  await page.routeWebSocket(/convai\/conversation/, (webSocket) => {
    webSocket.onMessage((frame: string | Buffer) => {
      const event = JSON.parse(String(frame));

      if (event.type === 'conversation_initiation_client_data') {
        initiations.push(event);
        webSocket.send(
          JSON.stringify({
            type: 'conversation_initiation_metadata',
            conversation_initiation_metadata_event: {
              conversation_id: 'conv_1',
              agent_output_audio_format: 'pcm_16000',
              user_input_audio_format: 'pcm_16000',
            },
          }),
        );
        return;
      }

      if (event.type !== 'user_message') {
        return;
      }

      // One answer per line, in order, and silence once they run out — which is what lets a test
      // watch the screen clear on a question Jarvis has not answered yet. An agent that replied to
      // everything would put the next answer up before the assertion could see it gone.
      const reply = replies[heard.length];
      heard.push(event.text);
      if (reply === undefined) {
        return;
      }

      webSocket.send(
        JSON.stringify({
          type: 'agent_response',
          agent_response_event: { agent_response: reply, event_id: heard.length },
        }),
      );
    });
  });

  return { heard, initiations };
}

test('shows what Jarvis writes back when there is no voice to say it in', async ({ page }) => {
  await refuseMicrophone(page);
  await answerConversations(page);
  // One answer, so the second question below is one he has not answered yet.
  const { heard, initiations } = await answerAsJarvis(page, ['Good evening.']);

  await page.goto('/');
  await pairWithJarvis(page);

  // The field only takes input once the session is up, so this is the handshake above having
  // worked. `toBeEditable` rather than `toBeEnabled`: react-native-web turns `editable={false}`
  // into `readOnly`, which leaves the element enabled and would make the check vacuous.
  const field = page.getByTestId('typed-message');
  await expect(field).toBeEditable();

  // **No recorded greeting in the one conversation held in writing**, and so the agent keeps its
  // own first message: he greets in writing, like everything else he says here. Whoever refused the
  // microphone did it to keep this conversation quiet.
  expect(initiations).toHaveLength(1);
  expect(initiations[0]).not.toHaveProperty('conversation_config_override.agent.first_message');
  expect(await page.evaluate(() => window.soundsPlayed)).toEqual([]);

  await field.fill('Are the lights on?');
  await field.press('Enter');

  // It really left the app — which no test checked before, and is the half that Enter has to do.
  await expect.poll(() => heard).toEqual(['Are the lights on?']);

  // **And his answer is on the screen.** Until this existed, the reply arrived over the socket and
  // nothing rendered it: you could type into this conversation for ever and never see a word back.
  await expect(page.getByTestId('written-reply')).toContainText('Good evening.');

  // The field keeps focus, so the next line is typed rather than clicked-then-typed. On web that
  // takes `blurOnSubmit`, since react-native-web 0.21.2 does not know `submitBehavior` at all.
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('');

  // Asking again clears the old answer rather than leaving it under the new question, where it
  // would read as a reply to it. Done when the line is sent rather than when a message comes back,
  // because a text-only session runs no ASR and may never echo one.
  await field.fill('And the kitchen?');
  await field.press('Enter');
  await expect.poll(() => heard).toEqual(['Are the lights on?', 'And the kitchen?']);
  await expect(page.getByTestId('written-reply')).toHaveCount(0);
});

test('says nothing to type into when no conversation was opened at all', async ({ page }) => {
  await answerConversations(page, () => ({ status: 401, body: { success: false, message: 'Unauthorized' } }));

  await page.goto('/');
  await pairWithJarvis(page);

  // A field is somewhere to write to Jarvis, so it belongs to a conversation rather than to the
  // screen: a `start` that never got as far as a session has none to offer, and the line saying
  // why is the whole answer. This is also the phone's refused microphone, which stops in the same
  // place — a browser is simply the only surface these tests can press it on.
  await expect(page.getByTestId('conversation-problem')).toBeVisible();
  await expect(page.getByTestId('typed-message')).toHaveCount(0);
});

/** Where the server says to send a photo: its upload route, and a slot's 22-character token. */
const UPLOAD_PATH = '/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ';

/** The server opening a slot for the conversation, and saying where to send the photo. */
const SLOT_OPENED: ServerAnswer = {
  status: 201,
  body: {
    success: true,
    message: 'Photo slot opened',
    data: { uploadToken: 'Q2hhbmdlIG1lIHBsZWFzZQ', uploadPath: UPLOAD_PATH, expiresAt: '2026-09-30T12:05:00.000Z' },
  },
};

/** The server refusing a slot: ElevenLabs does not know the conversation as one in progress on Jarvis's agent. */
const NOT_LIVE: ServerAnswer = {
  status: 403,
  body: { success: false, message: 'That is not a conversation in progress with Jarvis.' },
};

/** The server taking the photo, and saying what it filed it as. */
const PHOTO_RECEIVED: ServerAnswer = {
  status: 201,
  body: {
    success: true,
    message: 'Photo received',
    data: { photoId: 'photo7', expiresAt: '2026-09-30T12:30:00.000Z' },
  },
};

/** What the phone tells the agent once connected, when it can send photos. See `photo-messages.ts`. */
const CAMERA_BUTTON_HERE =
  "This device is sir's phone, and it has a camera button beside you: he can send you photos with it.";
const CAMERA_OPENED = 'Sir has opened the camera on his phone to send you a photo.';
const CAMERA_CLOSED = 'Sir closed the camera without sending a photo.';

/**
 * Ends the conversation on screen and opens another, the way sir would: the settings, which end the
 * screen's session, and straight back out of them, to a screen that opens a new one.
 */
async function reopenTheConversation(page: Page): Promise<void> {
  await page.getByTestId('open-settings').click();
  await page.getByTestId('cancel-settings').click();
  await expect(page.getByTestId('hologram')).toBeVisible();
  await expect(page.getByTestId('jarvis-server')).toHaveCount(0);
}

/** A one-pixel PNG: something the browser can decode, draw and re-encode as a JPEG like any photo. */
const ONE_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Plays ElevenLabs' side of a text-only conversation, and keeps everything the page says on it.
 *
 * `answerAsJarvis` above answers what is typed; this one answers nothing past the handshake, and
 * hands the test every frame the page sent instead — the notes it keeps the agent up to date with,
 * the turns it takes for sir, and the activity it reports while he frames a shot. That is the whole
 * of the camera's conversation with the agent, and none of it needs a real one. The handshake gives
 * the conversation its id, `conv_1`, which is the id the phone hands the Jarvis server for a slot.
 */
async function listenAsTheAgent(page: Page): Promise<unknown[]> {
  const heard: unknown[] = [];

  await page.routeWebSocket(/convai\/conversation/, (webSocket) => {
    webSocket.onMessage((frame: string | Buffer) => {
      const event = JSON.parse(String(frame));
      heard.push(event);
      if (event.type === 'conversation_initiation_client_data') {
        webSocket.send(
          JSON.stringify({
            type: 'conversation_initiation_metadata',
            conversation_initiation_metadata_event: {
              conversation_id: 'conv_1',
              agent_output_audio_format: 'pcm_16000',
              user_input_audio_format: 'pcm_16000',
            },
          }),
        );
      }
    });
  });

  return heard;
}

/** Whether a frame the page sent is of the given type. */
function isOfType(event: unknown, type: string): boolean {
  return typeof event === 'object' && event !== null && 'type' in event && event.type === type;
}

/** What the page said in frames of one type — its contextual updates, or the turns it took for sir. */
function textsOf(heard: unknown[], type: 'contextual_update' | 'user_message'): string[] {
  return heard.flatMap((event) =>
    isOfType(event, type) &&
    typeof event === 'object' &&
    event !== null &&
    'text' in event &&
    typeof event.text === 'string'
      ? [event.text]
      : [],
  );
}

/** How many conversations the page has opened on the socket the test listens to. */
function conversationsOpened(heard: unknown[]): number {
  return heard.filter((event) => isOfType(event, 'conversation_initiation_client_data')).length;
}

/** What the page has said since it last opened a conversation: what the conversation now open heard. */
function sinceTheLastConversationOpened(heard: unknown[]): unknown[] {
  const opened = heard.findLastIndex((event) => isOfType(event, 'conversation_initiation_client_data'));
  return heard.slice(opened + 1);
}

/** A request the Jarvis server was sent, as far as these tests read it. */
interface ServerRequest {
  method: string;
  contentType: string | undefined;
  authorization: string | undefined;
  body: Buffer | null;
}

/** Answers every request to `url` with `answer`, and keeps what was sent. */
async function answerForTheServer(page: Page, url: string, answer: ServerAnswer): Promise<ServerRequest[]> {
  const requests: ServerRequest[] = [];
  await page.route(url, async (route: Route) => {
    const request = route.request();
    requests.push({
      method: request.method(),
      contentType: request.headers()['content-type'],
      authorization: request.headers().authorization,
      body: request.postDataBuffer(),
    });
    await route.fulfill({
      status: answer.status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(answer.body),
    });
  });
  return requests;
}

/**
 * Opens a text-only conversation with a socket the test listens on as the agent, and sir's Jarvis
 * server answering a slot request with `slotAnswer` and a photo with `uploadAnswer`.
 *
 * Every conversation has a camera now: pairing with the server is the only way to have one, and the
 * server is where the photo goes. So the conversation the tour lands on is the one to show things to.
 */
async function openAConversationToShowThingsTo(
  page: Page,
  {
    slotAnswer = SLOT_OPENED,
    uploadAnswer = PHOTO_RECEIVED,
  }: { slotAnswer?: ServerAnswer; uploadAnswer?: ServerAnswer } = {},
) {
  await refuseMicrophone(page);
  await answerConversations(page);
  const heard = await listenAsTheAgent(page);
  const slotRequests = await answerForTheServer(page, `${JARVIS_SERVER}/api/photos/slots`, slotAnswer);
  const uploads = await answerForTheServer(page, `${JARVIS_SERVER}${UPLOAD_PATH}`, uploadAnswer);

  await page.goto('/');
  await pairWithJarvis(page);
  await expect(page.getByTestId('typed-message')).toBeEditable();

  return { heard, slotRequests, uploads };
}

/** Taps the camera button, and waits for the browser's file chooser it opens. */
async function openTheCamera(page: Page) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-camera').click();
  return chooser;
}

/** Taps the camera button and picks the photo in the browser's file chooser, as a phone's browser would take one. */
async function showAPhoto(page: Page): Promise<void> {
  await (await openTheCamera(page)).setFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: ONE_PIXEL });
}

test('tells Jarvis once there is a camera button, and puts one beside him', async ({ page }) => {
  const { heard } = await openAConversationToShowThingsTo(page);

  // Told once — which is what lets the agent suggest the button, and nowhere else.
  await expect.poll(() => textsOf(heard, 'contextual_update')).toEqual([CAMERA_BUTTON_HERE]);

  // Faint, and there: the one thing on the screen besides him.
  await expect(page.getByTestId('open-camera')).toBeVisible();
  await expect(page.getByTestId('hologram')).toBeVisible();
});

test('sends a photo to the Jarvis server when the camera button is tapped, and tells Jarvis its name', async ({
  page,
}) => {
  const { heard, slotRequests, uploads } = await openAConversationToShowThingsTo(page);

  await showAPhoto(page);

  // The agent is told the camera is open, in the background, so it waits for the photo.
  await expect.poll(() => textsOf(heard, 'contextual_update')).toContain(CAMERA_OPENED);

  // A slot is asked for at the server this browser is paired with, for this conversation — its id,
  // and nothing else: not the device token, which the photo routes do not ask for.
  await expect.poll(() => slotRequests.length).toBe(1);
  expect(slotRequests[0]?.method).toBe('POST');
  expect(slotRequests[0]?.contentType).toBe('application/json');
  expect(slotRequests[0]?.authorization).toBeUndefined();
  expect(JSON.parse(String(slotRequests[0]?.body))).toEqual({ conversationId: 'conv_1', kind: 'photo' });

  // The photo goes once, as a JPEG, to the slot's path on that same server — with no key of any kind.
  await expect.poll(() => uploads.length).toBe(1);
  expect(uploads[0]?.method).toBe('PUT');
  expect(uploads[0]?.contentType).toBe('image/jpeg');
  expect(uploads[0]?.authorization).toBeUndefined();
  expect(uploads[0]?.body?.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

  // And the agent is told what it was filed as, as sir's turn, after the note that the camera was open.
  await expect.poll(() => textsOf(heard, 'user_message')).toEqual(["I've sent you a photo (photo photo7)."]);
  const opened = heard.findIndex((event) => textsOf([event], 'contextual_update').includes(CAMERA_OPENED));
  const sent = heard.findIndex((event) => isOfType(event, 'user_message'));
  expect(opened).toBeLessThan(sent);
});

test('keeps the call alive while the camera is open, and says so when sir backs out', async ({ page }) => {
  const { heard, slotRequests, uploads } = await openAConversationToShowThingsTo(page);

  const chooser = await openTheCamera(page);
  await expect.poll(() => textsOf(heard, 'contextual_update')).toContain(CAMERA_OPENED);
  // Someone framing a shot says nothing, and ElevenLabs ends a silent call: the page says he is there
  // in the tap itself, beside the note, rather than first when the heartbeat comes round in five seconds.
  await expect.poll(() => heard.some((event) => isOfType(event, 'user_activity')), { timeout: 2_000 }).toBe(true);

  // Backing out of the chooser, which a browser reports as `cancel`.
  await chooser.element().dispatchEvent('cancel');

  await expect.poll(() => textsOf(heard, 'contextual_update')).toContain(CAMERA_CLOSED);
  // The slot was asked for at the tap, while the conversation was certainly live, and simply goes unused.
  expect(slotRequests).toHaveLength(1);
  expect(uploads).toHaveLength(0);
  expect(textsOf(heard, 'user_message')).toEqual([]);
  // And the button is back, for another go.
  await expect(page.getByTestId('open-camera')).toBeVisible();
});

test('tells Jarvis the photo did not reach him when the server will not confirm the conversation', async ({ page }) => {
  const { heard, slotRequests, uploads } = await openAConversationToShowThingsTo(page, { slotAnswer: NOT_LIVE });

  await showAPhoto(page);

  // Said as sir's turn, so Jarvis tells him out loud — with the phone's reason, not the server's words.
  await expect
    .poll(() => textsOf(heard, 'user_message'))
    .toEqual(["The photo I took didn't reach you: this conversation could not be confirmed as live."]);
  expect(slotRequests).toHaveLength(1);
  expect(uploads).toHaveLength(0);
});

test('tells Jarvis a picked file that will not draw could not be read, not that the camera was closed', async ({
  page,
}) => {
  const { heard, uploads } = await openAConversationToShowThingsTo(page);

  // An image the picker lets through and the browser cannot decode, as a desktop meets an iPhone's HEIC.
  await (await openTheCamera(page)).setFiles({
    name: 'receipt.heic',
    mimeType: 'image/heic',
    buffer: Buffer.from('not a photo a browser can draw'),
  });

  // Sir picked something and is waiting to hear about it, so it takes his turn, like any photo that
  // did not arrive — and nothing was sent anywhere.
  await expect
    .poll(() => textsOf(heard, 'user_message'))
    .toEqual(["The photo I took didn't reach you: it could not be read as a photo."]);
  expect(textsOf(heard, 'contextual_update')).not.toContain(CAMERA_CLOSED);
  expect(uploads).toHaveLength(0);
});

test('still sends a photo whose conversation ended while the camera was open, and tells the next one nothing', async ({
  page,
}) => {
  const { heard, uploads } = await openAConversationToShowThingsTo(page);

  const chooser = await openTheCamera(page);
  await expect.poll(() => textsOf(heard, 'contextual_update')).toContain(CAMERA_OPENED);

  // The conversation ends while sir frames the shot — here by going to the settings, which ends the
  // screen's session — and the screen opens a new one on coming back.
  await reopenTheConversation(page);
  await expect.poll(() => conversationsOpened(heard)).toBe(2);
  await expect(page.getByTestId('typed-message')).toBeEditable();

  // Only now is the photo picked, so it is on its way while the new conversation is the one open.
  const uploaded = page.waitForResponse(`${JARVIS_SERVER}${UPLOAD_PATH}`);
  await chooser.setFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: ONE_PIXEL });

  // It still goes to the slot opened at the tap: the server keeps it for a later request to bring up.
  await uploaded;
  expect(uploads).toHaveLength(1);
  expect(uploads[0]?.method).toBe('PUT');

  // The page would name the photo the moment the upload was answered; give it that moment. The
  // conversation now open hears nothing of a photo taken in another — no turn naming it, and no note
  // that the camera closed — and its button is free for a photo of its own.
  await page.waitForTimeout(500);
  const heardByTheNewOne = sinceTheLastConversationOpened(heard);
  expect(textsOf(heardByTheNewOne, 'user_message')).toEqual([]);
  expect(textsOf(heardByTheNewOne, 'contextual_update')).not.toContain(CAMERA_CLOSED);
  expect(textsOf(heard, 'user_message')).not.toContain("I've sent you a photo (photo photo7).");
  await expect(page.getByTestId('open-camera')).toBeVisible();
});
/** Where the Jarvis server's glance is, as the server names it: a public artifact page on its own origin. */
const GLANCE_URL = `${JARVIS_SERVER}/artifacts/0b6f3c1e-8f5d-4a58-9a77-3c4e2f1d9b10`;

/** What the action on the glance will really run, which is what sir is asked to confirm. */
const UNLOCK_PROMPT = 'Unlock the front door for the courier.';

/** A glance as the server sends it, made just now so the phone still counts it as current. */
function aGlance() {
  return {
    id: 'glance-1',
    url: GLANCE_URL,
    title: 'A parcel is coming today',
    generatedAt: new Date().toISOString(),
    actions: [{ id: 'unlock-front-door', label: 'Unlock the front door', prompt: UNLOCK_PROMPT }],
  };
}

/**
 * The glance's page, with a bridge that speaks as the server's does in an `<iframe>`: a button calls
 * `window.jarvis.act`, which posts the action to the parent as a string, and the answer posted back
 * is re-dispatched as `jarvisactionresult` and written on the page. Its button's label says
 * something harmless on purpose — it names the action that unlocks the door — and a second button
 * names an action the glance does not list.
 */
const GLANCE_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<script>
  window.jarvis = {
    act: function (actionId) {
      window.parent.postMessage(JSON.stringify({ type: 'jarvisAction', actionId: String(actionId) }), '*');
    }
  };
  window.addEventListener('message', function (event) {
    var data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    if (data && data.type === 'jarvisActionResult') {
      window.dispatchEvent(new CustomEvent('jarvisactionresult', { detail: data }));
    }
  });
  window.addEventListener('jarvisactionresult', function (event) {
    document.getElementById('result').textContent =
      (event.detail.ok ? 'Done: ' : 'Not done: ') + event.detail.message;
  });
</script>
<style>
  body { margin: 0; padding: 24px 20px 120px; font-family: system-ui, sans-serif; background: #0b1020; color: #e2e8f0; }
  .card { background: #131b2e; border: 1px solid #1e293b; border-radius: 16px; padding: 20px; margin-bottom: 16px; }
  .eyebrow { color: #fb923c; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
  h1 { font-size: 26px; margin: 6px 0 4px; }
  p { color: #94a3b8; line-height: 1.5; }
  button { width: 100%; padding: 14px; border-radius: 12px; border: 0; font-size: 16px; font-weight: 600; margin-top: 8px; }
  #track { background: #f97316; color: #05070d; }
  #garage { background: #1e293b; color: #e2e8f0; }
  #result { color: #4ade80; min-height: 1.5em; }
</style></head>
<body>
  <div class="eyebrow">Good morning, sir</div>
  <h1>A parcel is coming today</h1>
  <p>DHL says your order from Nordic Outdoor arrives between 10:00 and 12:00. Nobody will be home.</p>
  <div class="card">
    <strong>Front door</strong>
    <p>Locked. The courier can leave it in the hall if you let them in.</p>
    <button id="track" onclick="window.jarvis.act('unlock-front-door')">Track parcel</button>
    <button id="garage" onclick="window.jarvis.act('open-the-garage')">Open the garage</button>
  </div>
  <p id="result"></p>
</body></html>`;

/** What the phone said on its line to the Jarvis server, and the line itself, played by the test. */
interface PlayedServer {
  heard: { type?: string; [key: string]: unknown }[];
}

/**
 * Plays sir's Jarvis server's side of the paired live line (`/api/paired/live`, where a paired device
 * opens it): `ready` for the hello, then
 * `glance` when there is one, and a `glanceActionResult` for every `glanceAction` — and serves the
 * glance's page. Registered after `blockExternalRequests`, so it wins.
 */
async function playTheJarvisServer(page: Page, glance: ReturnType<typeof aGlance> | undefined): Promise<PlayedServer> {
  const heard: PlayedServer['heard'] = [];
  await page.routeWebSocket(/^wss:\/\/jarvis\.example\.test\/api\/paired\/live$/, (webSocket) => {
    webSocket.onMessage((frame: string | Buffer) => {
      const message = JSON.parse(String(frame));
      heard.push(message);
      if (message.type === 'hello') {
        webSocket.send(JSON.stringify({ type: 'ready' }));
        if (glance) webSocket.send(JSON.stringify({ type: 'glance', glance }));
      }
      if (message.type === 'glanceAction') {
        webSocket.send(
          JSON.stringify({
            type: 'glanceActionResult',
            requestId: message.requestId,
            ok: true,
            message: 'The front door is unlocked.',
          }),
        );
      }
    });
  });
  await page.route(GLANCE_URL, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: GLANCE_PAGE }),
  );
  return { heard };
}

/** The glance's page, inside the app's frame. */
function glancePage(page: Page) {
  return page.frameLocator('iframe[data-testid="glance-page"]');
}

/** A browser paired with its Jarvis server, opened afresh from the start, as from the launcher. */
async function openWithAJarvisServer(page: Page): Promise<void> {
  await page.goto('/');
  await pairWithJarvis(page);
  await page.reload();
}

test('opens on the glance the Jarvis server sent, with a way to Jarvis and back', async ({ page }) => {
  const server = await playTheJarvisServer(page, aGlance());
  await openWithAJarvisServer(page);

  // The page the server made, filling the screen, from its own address — and nothing of him yet.
  const frame = page.locator('iframe[data-testid="glance-page"]');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('src', GLANCE_URL);
  await expect(glancePage(page).getByRole('heading')).toHaveText('A parcel is coming today');
  await expect(page.getByTestId('hologram')).toHaveCount(0);
  // The line says hello with the token this browser was paired with, which the server checks itself.
  expect(server.heard).toContainEqual({ type: 'hello', device: 'phone', token: DEVICE_TOKEN });

  // The one way to Jarvis on it opens the conversation, as a summoning would, and back again.
  await page.getByTestId('talk-to-jarvis').click();
  await expect(page.getByTestId('hologram')).toBeVisible();
  await expect(frame).toHaveCount(0);
  await page.getByTestId('back-to-glance').click();
  await expect(frame).toBeVisible();
});

test('runs a glance’s action only once sir confirms the prompt the server holds, and tells the page', async ({
  page,
}) => {
  const server = await playTheJarvisServer(page, aGlance());
  await openWithAJarvisServer(page);
  await expect(glancePage(page).locator('#track')).toBeVisible();

  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.accept();
  });

  // An action the glance does not list is nothing: no question, and nothing sent.
  await glancePage(page).locator('#garage').click();

  // The button says "Track parcel"; what sir is asked is what the server will run.
  await glancePage(page).locator('#track').click();
  await expect.poll(() => dialogs).toHaveLength(1);
  expect(dialogs[0]).toContain(UNLOCK_PROMPT);
  expect(dialogs[0]).not.toContain('Track parcel');

  // Accepted, the action goes to the server on the line, naming the glance and the action.
  await expect.poll(() => server.heard.filter((message) => message.type === 'glanceAction')).toHaveLength(1);
  const asked = server.heard.find((message) => message.type === 'glanceAction');
  expect(asked).toMatchObject({ glanceId: 'glance-1', actionId: 'unlock-front-door' });
  expect(typeof asked?.requestId).toBe('string');

  // The server's answer reaches the page, and sir.
  await expect(glancePage(page).locator('#result')).toHaveText('Done: The front door is unlocked.');
  await expect(page.getByTestId('glance-notice')).toHaveText('The front door is unlocked.');
  expect(dialogs).toHaveLength(1);
});

test('sends nothing when sir cancels a glance’s action, and tells the page it was cancelled', async ({ page }) => {
  const server = await playTheJarvisServer(page, aGlance());
  await openWithAJarvisServer(page);
  await expect(glancePage(page).locator('#track')).toBeVisible();

  page.on('dialog', (dialog) => void dialog.dismiss());
  await glancePage(page).locator('#track').click();

  await expect(glancePage(page).locator('#result')).toHaveText('Not done: Cancelled');
  expect(server.heard.filter((message) => message.type === 'glanceAction')).toEqual([]);
});

test('opens on the conversation, as before, when the Jarvis server has no glance', async ({ page }) => {
  const server = await playTheJarvisServer(page, undefined);
  await openWithAJarvisServer(page);

  await expect(page.getByTestId('hologram')).toBeVisible();
  await expect.poll(() => server.heard).toContainEqual({ type: 'hello', device: 'phone', token: DEVICE_TOKEN });
  await expect(page.locator('iframe[data-testid="glance-page"]')).toHaveCount(0);
  await expect(page.getByTestId('back-to-glance')).toHaveCount(0);
});
