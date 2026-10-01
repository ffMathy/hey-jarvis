import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The 2D page, in the real build: the walk to the room, and the ElevenLabs settings.
 *
 * ElevenLabs is never reached — the fixture aborts every request that leaves the machine — so the
 * token endpoint is answered here, which is also how the tests see exactly what the page asked it.
 */

const TOKEN_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/conversation/token**';

/** hologram's `ELEVENLABS_SETTINGS_STORAGE_KEY`, spelled out: Playwright cannot import hologram's TypeScript. */
const SETTINGS_KEY = 'jarvis.elevenlabs-settings';

interface TokenAnswer {
  status: number;
  body: unknown;
}

/** Answers the token endpoint with whatever `answer` holds when asked, and records each request. */
async function answerTokens(page: Page, answer: { current: TokenAnswer }) {
  const requests: { url: URL; apiKey: string | undefined }[] = [];
  await page.route(TOKEN_ENDPOINT, async (route: Route) => {
    const request = route.request();
    requests.push({ url: new URL(request.url()), apiKey: request.headers()['xi-api-key'] });
    await route.fulfill({
      status: answer.current.status,
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

test('the page asks for an ElevenLabs key first, and checks it with ElevenLabs before keeping it', async ({ page }) => {
  const answer: { current: TokenAnswer } = {
    current: { status: 401, body: { detail: { status: 'invalid_api_key', message: 'sk_wrong' } } },
  };
  const requests = await answerTokens(page, answer);
  await openPage(page);

  const primary = page.locator('#primary');
  await expect(primary).toHaveText('Add your ElevenLabs key first');
  await expect(primary).toBeDisabled();
  // Sample mode needs no key.
  await expect(page.getByRole('button', { name: 'Try him in your room' })).toBeEnabled();

  const key = page.getByLabel('API key');
  // Masked, and kept out of autofill, autocorrect and spellcheck, like the phone's field.
  await expect(key).toHaveAttribute('type', 'password');
  await expect(key).toHaveAttribute('autocomplete', 'off');
  await expect(key).toHaveAttribute('autocapitalize', 'none');
  await expect(key).toHaveAttribute('spellcheck', 'false');
  await key.fill('sk_wrong');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(key).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(key).toHaveAttribute('type', 'password');
  await page.getByLabel('Agent ID').fill('agent_01jz');

  await page.getByRole('button', { name: 'Check and save' }).click();
  await expect(page.getByRole('alert')).toHaveText('ElevenLabs rejected the API key. Check it in the settings.');
  expect(await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), SETTINGS_KEY)).toBeNull();
  await expect(primary).toHaveText('Add your ElevenLabs key first');

  answer.current = { status: 200, body: { token: 'token', conversation_id: 'conversation' } };
  await key.fill('  sk_right  ');
  await page.getByRole('button', { name: 'Check and save' }).click();
  await expect(page.locator('#settings-saved')).toHaveText('Saved. ElevenLabs accepted the key and found the agent.');
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(primary).toHaveText('Enter your room');
  await expect(primary).toBeEnabled();

  const stored = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), SETTINGS_KEY);
  expect(JSON.parse(stored ?? 'null')).toEqual({ apiKey: 'sk_right', agentId: 'agent_01jz' });
  expect(requests.map((request) => request.url.searchParams.get('participant_name'))).toEqual([
    'jarvis-vr',
    'jarvis-vr',
  ]);
  expect(requests.map((request) => request.apiKey)).toEqual(['sk_wrong', 'sk_right']);
});

test('what cannot be a key is refused without asking anyone', async ({ page }) => {
  const requests = await answerTokens(page, { current: { status: 200, body: {} } });
  await openPage(page);
  await page.getByLabel('Agent ID').fill('agent_01jz');
  await page.getByRole('button', { name: 'Check and save' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter your ElevenLabs API key.');
  expect(requests).toEqual([]);
});

test('saved settings are found again, and fold the form away', async ({ page }) => {
  await page.addInitScript((storageKey) => {
    window.localStorage.setItem(storageKey, JSON.stringify({ apiKey: 'sk_saved', agentId: 'agent_saved' }));
  }, SETTINGS_KEY);
  await openPage(page);
  await expect(page.locator('#primary')).toHaveText('Enter your room');
  await expect(page.locator('#settings')).not.toHaveAttribute('open');
  await expect(page.getByLabel('API key')).toHaveValue('sk_saved');
  await expect(page.getByLabel('Agent ID')).toHaveValue('agent_saved');
});

test.describe('with the microphone refused', () => {
  // Headless Chromium refuses every permission the context has not granted.
  test.use({ permissions: [] });

  test('the page says how to allow it again, and still offers sample mode', async ({ page }) => {
    await page.addInitScript((storageKey) => {
      window.localStorage.setItem(storageKey, JSON.stringify({ apiKey: 'sk_saved', agentId: 'agent_saved' }));
    }, SETTINGS_KEY);
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
  await expect(page.getByRole('link', { name: 'Create an ElevenLabs account' })).toHaveAttribute(
    'href',
    'https://elevenlabs.io/app/sign-up',
  );
});

test('without CanvasKit the page says it could not get ready, and a room he cannot be drawn in is closed again', async ({
  page,
}) => {
  // CanvasKit's wasm missing from the site, as it was from the phone's first published page.
  await page.route('**/vendor/canvaskit.wasm', (route) => route.fulfill({ status: 404, body: 'Not found' }));
  await page.addInitScript((storageKey) => {
    window.localStorage.setItem(storageKey, JSON.stringify({ apiKey: 'sk_saved', agentId: 'agent_saved' }));
  }, SETTINGS_KEY);
  await openPage(page);

  const primary = page.locator('#primary');
  await expect(primary).toHaveText('Try getting ready again', { timeout: 60000 });
  await expect(page.locator('#status')).toContainText('Jarvis could not get ready: his drawing did not load.');

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
