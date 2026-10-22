import type { Page, Route } from '@playwright/test';

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
export async function blockExternalRequests(page: Page): Promise<void> {
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
