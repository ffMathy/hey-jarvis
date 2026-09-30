import {
  answerTokens,
  collectProblems,
  countGreetings,
  debugState,
  effectsSince,
  enterRoom,
  frames,
  greetingPlays,
  insideLivingRoom,
  roomReport,
  SAVED_SETTINGS,
  scene,
  untilListening,
  withSavedSettings,
} from './app-driver';
import { expect, photograph, test } from './fixtures';

/**
 * "Hey Jarvis", said to the whole app in the emulated living room.
 *
 * Chromium's fake microphone plays a spoken "hey jarvis" on a loop (the project this spec runs in,
 * in `playwright.config.ts`), and everything from there is the app's own: the wake engine's worker
 * and worklet hear it, the room model places him, the greeting plays while the token is fetched,
 * and the session dials — into LiveKit's socket, which the fixture closes, so the summon fails as
 * it would on a network that blocks it. Then the failure is shown, he leaves, and the wake word,
 * armed again, hears the clip come round and summons him a second time.
 */

/** `CONNECTION_PROBLEM` in `src/conversation/failure-text.ts`: LiveKit's room refusing to open, in words about the network. */
const NETWORK_PROBLEM = 'The connection to ElevenLabs could not be opened. The network may be blocking it.';

test('"Hey Jarvis" summons him into the room, and after a failed call it is listened for again', async ({
  page,
}, testInfo) => {
  test.setTimeout(300000);
  const problems = collectProblems(page);
  const requests = await answerTokens(page, {
    status: 200,
    body: { token: 'conversation-token-from-the-test', conversation_id: 'conversation-from-the-test' },
  });
  await countGreetings(page);
  await withSavedSettings(page);
  await enterRoom(page);
  await untilListening(page);

  // The clip says it every five seconds or so.
  await expect.poll(async () => (await debugState(page)).wakes, { timeout: 60000 }).toBeGreaterThan(0);
  await expect.poll(() => scene(page), { timeout: 60000 }).toMatch(/^present:/);
  const placed = await debugState(page);
  const spot = placed.hologramPosition;
  const head = placed.headPositionAtPlacement;
  if (spot === null || head === null || placed.placement === null) throw new Error('He was never placed.');
  // Full size, with room around him, inside the living room and ahead of the head, which looks north.
  expect(placed.placement.level).toBe('full');
  expect(placed.placement.clearance).toBeGreaterThanOrEqual(0.5);
  expect(insideLivingRoom(spot)).toBe(true);
  expect(spot.z).toBeLessThan(head.z - 0.8);

  await expect.poll(() => greetingPlays(page), { timeout: 30000 }).toBe(1);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url.searchParams.get('participant_name')).toBe('jarvis-horizon');
  expect(requests[0]?.url.searchParams.get('agent_id')).toBe(SAVED_SETTINGS.agentId);
  expect(requests[0]?.apiKey).toBe(SAVED_SETTINGS.apiKey);

  // Dialled after the greeting, into a socket that is closed on it.
  await expect.poll(() => scene(page), { timeout: 60000 }).toBe('failed');
  expect((await roomReport(page)).view.panels.error).toEqual([NETWORK_PROBLEM]);
  const wakesBefore = (await debugState(page)).wakes;
  // At once: the panel is up for six seconds, and a picture of him takes the emulator a few.
  await frames(page, 1);
  await photograph(page, testInfo, 'app-error-network.png');

  // Once it has been read he leaves, and the wake word is armed again — while he is still fading,
  // if his voice has been quiet long enough — and hears the clip come round: a new summons, which
  // cancels the fade if it comes before he has gone.
  await expect.poll(() => scene(page), { timeout: 60000 }).not.toBe('failed');
  await expect
    .poll(async () => effectsSince((await roomReport(page)).recentEffects, 'remember-problem'), { timeout: 60000 })
    .toContain('arm-wake');
  // The engine passes a detection on only while it is armed, so a new one is the room listening again.
  await expect.poll(async () => (await debugState(page)).wakes, { timeout: 60000 }).toBeGreaterThan(wakesBefore);
  await expect.poll(() => scene(page), { timeout: 60000 }).toMatch(/^(placing|present:)/);
  expect(problems).toEqual([]);
});
