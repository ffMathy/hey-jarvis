import type { Page, Route } from '@playwright/test';
import { corsHeaders, DEVICE_TOKEN_KEY, PAIRING, SERVER_ADDRESS_KEY, withPairing } from './app-driver';
import { expect, test } from './fixtures';

/**
 * The 2D page, in the real build: the walk to the room, and pairing the headset with sir's Jarvis
 * server, which is the only way it is set up.
 *
 * No server is ever reached — the fixture aborts every request that leaves the machine — so the
 * pairing endpoint is answered here, which is also how the tests see exactly what the page asked it.
 */

/** hologram's `DEVICE_PAIRING_PATH` on the server the tests pair with. */
const PAIRING_ENDPOINT = `${PAIRING.address}/api/devices`;

/** What the page is told once the server has paired it, before and after the reload. */
const PAIRED = 'Paired with https://jarvis.example.com. Your server starts his conversations.';

interface PairingAnswer {
  status: number;
  body: unknown;
}

/** One pairing request, as the server would have seen it. */
interface PairingRequest {
  method: string;
  contentType: string | undefined;
  body: string | null;
}

/** Answers the pairing endpoint with whatever `answer` holds when asked, and records each request. */
async function answerPairing(page: Page, answer: { current: PairingAnswer }) {
  const requests: PairingRequest[] = [];
  await page.route(PAIRING_ENDPOINT, async (route: Route) => {
    const request = route.request();
    requests.push({
      method: request.method(),
      contentType: request.headers()['content-type'],
      body: request.postData(),
    });
    await route.fulfill({
      status: answer.current.status,
      headers: corsHeaders(route),
      contentType: 'application/json',
      body: JSON.stringify(answer.current.body),
    });
  });
  return requests;
}

async function openPage(page: Page) {
  await page.goto('/hey-jarvis/vr/');
  await page.evaluate(() => window.__xrHarness?.ready);
}

function stored(page: Page, key: string) {
  return page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
}

test('the page asks for the headset to be paired first, and keeps a pairing only once the server gives one', async ({
  page,
}) => {
  const answer: { current: PairingAnswer } = { current: { status: 403, body: { success: false } } };
  const requests = await answerPairing(page, answer);
  await openPage(page);

  const primary = page.locator('#primary');
  await expect(primary).toHaveText('Pair this headset first');
  await expect(primary).toBeDisabled();
  // Pairing is the only way in, and its section is open for it.
  await expect(page.locator('#pairing')).toHaveAttribute('open');
  await expect(page.locator('#api-key')).toHaveCount(0);
  // Sample mode needs no pairing.
  await expect(page.getByRole('button', { name: 'Try him in your room' })).toBeEnabled();

  await page.getByLabel('Server address').fill('  https://jarvis.example.com/ ');
  await page.getByRole('button', { name: 'Pair this headset', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Your Jarvis server would not pair this browser (HTTP 403).');
  expect(await stored(page, DEVICE_TOKEN_KEY)).toBeNull();
  await expect(primary).toHaveText('Pair this headset first');

  answer.current = { status: 201, body: { success: true, data: { id: 'device-1', token: PAIRING.deviceToken } } };
  await page.getByRole('button', { name: 'Pair this headset', exact: true }).click();
  // Kept, and the page loaded again, so that its line to the server opens with the token.
  await expect(page.locator('#pairing-saved')).toHaveText(PAIRED, { timeout: 30000 });
  await page.evaluate(() => window.__xrHarness?.ready);
  await expect(primary).toHaveText('Enter your room', { timeout: 90000 });
  await expect(page.locator('#pairing')).not.toHaveAttribute('open');
  expect(await stored(page, SERVER_ADDRESS_KEY)).toBe(PAIRING.address);
  expect(await stored(page, DEVICE_TOKEN_KEY)).toBe(PAIRING.deviceToken);
  expect(requests).toEqual([
    { method: 'POST', contentType: 'text/plain', body: 'Meta Quest headset' },
    { method: 'POST', contentType: 'text/plain', body: 'Meta Quest headset' },
  ]);
});

test('a server that does not answer is said so, with a way to sign in to it', async ({ page }) => {
  // Not answered here, so the fixture aborts it: what Cloudflare Access's login looks like to a page.
  await openPage(page);
  await page.getByLabel('Server address').fill('jarvis.example.com');
  await page.getByRole('button', { name: 'Pair this headset', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The server did not answer. If Cloudflare Access is in front of it, sign in to it in this browser, then pair again.',
  );
  await expect(page.getByRole('link', { name: 'Sign in to your server' })).toHaveAttribute(
    'href',
    'https://jarvis.example.com/api/devices',
  );
  expect(await stored(page, DEVICE_TOKEN_KEY)).toBeNull();
  await expect(page.locator('#primary')).toHaveText('Pair this headset first');
});

test('what cannot be an address is refused without asking anyone', async ({ page }) => {
  const requests = await answerPairing(page, { current: { status: 201, body: {} } });
  await openPage(page);
  await page.getByRole('button', { name: 'Pair this headset', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText("Enter your Jarvis server's address.");
  await page.getByLabel('Server address').fill('https://jarvis.example.com/pair');
  await page.getByRole('button', { name: 'Pair this headset', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('no path after it');
  await expect(page.locator('#pairing-sign-in')).toBeHidden();
  expect(requests).toEqual([]);
});

test('a kept pairing is found again, and folds the pairing away', async ({ page }) => {
  await withPairing(page);
  await openPage(page);
  await expect(page.locator('#primary')).toHaveText('Enter your room', { timeout: 90000 });
  await expect(page.locator('#pairing')).not.toHaveAttribute('open');
  await expect(page.locator('#pairing-saved')).toHaveText(PAIRED);
  await expect(page.getByLabel('Server address')).toHaveValue(PAIRING.address);
});

test.describe('with the microphone refused', () => {
  // Headless Chromium refuses every permission the context has not granted.
  test.use({ permissions: [] });

  test('the page says how to allow it again, and still offers sample mode', async ({ page }) => {
    await withPairing(page);
    await openPage(page);
    const primary = page.locator('#primary');
    await expect(primary).toHaveText('The microphone is blocked');
    await expect(primary).toBeDisabled();
    await expect(page.locator('#microphone-help')).toContainText('lock icon beside the address');
    await expect(page.getByRole('button', { name: 'Try him in your room' })).toBeEnabled();
  });
});

test('the page credits the wake-word models and links their licence', async ({ page }) => {
  await openPage(page);
  await expect(page.getByRole('link', { name: 'their licence' })).toHaveAttribute('href', './models/LICENCE.txt');
  await expect(page.getByRole('link', { name: 'CC BY-NC-SA 4.0' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'See him on a desktop' })).toHaveAttribute('href', './preview.html');
});

test('a room he cannot be drawn in is closed again, and the page can try once more', async ({ page }) => {
  // His drawing's chunk missing from the site, as the phone's wasm once was from its first published
  // page: the room loads apart from the page, so the page gets ready, and only the room fails.
  await page.route('**/assets/hologram3d-*.js', (route) => route.fulfill({ status: 404, body: 'Not found' }));
  await openPage(page);

  // Sample mode needs no models, so it can be tried, and fails the moment he would be drawn.
  const sample = page.getByRole('button', { name: 'Try him in your room' });
  await sample.click();
  await expect.poll(() => page.evaluate(() => window.__jarvis?.phase), { timeout: 60000 }).toBe('failed');
  await expect(page.locator('#status')).toContainText('Jarvis could not join you');
  // Back on the page, able to try again, with no session left open on an empty room.
  await expect(sample).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.__xrHarness?.device.activeSession !== undefined)).toBe(false);
  expect(await page.evaluate(() => window.__jarvis?.frames)).toBe(0);
});
