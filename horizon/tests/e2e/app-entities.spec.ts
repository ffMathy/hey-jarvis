import type { RoomPoint } from '../../src/debug-hook';
import {
  aim,
  collectProblems,
  debugState,
  effectsSince,
  enterRoom,
  frames,
  hologramPosition,
  roomReport,
  scene,
  tap,
  withSavedSettings,
} from './app-driver';
import {
  controllerButton,
  controllerButtons,
  distance,
  EMULATED_ANCHORS_KEY,
  entities,
  heldFor,
  holdController,
  holdHand,
  inputReport,
  lookAt,
  measureOffset,
  NO_ORIGIN,
  type Origin,
  pointControllerAt,
  pointHandAt,
  pressControllerButton,
  REGISTRY_KEY,
  seedRegistry,
  stored,
  then,
  toEmulator,
  turn,
  useInput,
} from './entities-driver';
import { expect, photograph, test } from './fixtures';

/**
 * The things Jarvis works on, placed in the emulated living room and found there again.
 *
 * One visit after another in the same browser, because what is being tested is what outlives a
 * visit: the registry in `localStorage`, and the persistent anchors the emulator keeps there too.
 * Each visit but the first opens the room with its space moved (`?origin`), as a new session on a
 * headset starts somewhere new — without that, the emulator's `local-floor` is the same in every
 * session and a position kept in it would come back right for the wrong reason.
 *
 * Nothing here reaches ElevenLabs: what the conversation would be told about what sir points at is
 * read from the debug hook's `pendingContext`, and the corona is lit by sample mode's thinking mood,
 * which lights every placed entity as a real mark would.
 */

const KITCHEN = { id: 'light.kitchen_ceiling', name: 'Kitchen ceiling light' };
const INBOX = { id: 'mail/folders/inbox-work', name: 'Work inbox' };
const CALENDAR = { id: 'calendar:family@group.calendar.google.com', name: 'Family calendar' };

/** Three entities the agent has marked, the kitchen light most recently. */
const SEEDED = {
  version: 1,
  entities: {
    [KITCHEN.id]: { ...KITCHEN, firstMarkedAt: 1_780_000_000_000, lastMarkedAt: 1_780_000_300_000, marks: 3 },
    [INBOX.id]: { ...INBOX, firstMarkedAt: 1_780_000_000_000, lastMarkedAt: 1_780_000_200_000, marks: 1 },
    [CALENDAR.id]: { ...CALENDAR, firstMarkedAt: 1_780_000_000_000, lastMarkedAt: 1_780_000_100_000, marks: 2 },
  },
  anchors: {},
};

/**
 * Where the two are put, in the emulated room: the head stands at (0, 1.6, 1.2) looking north (−z),
 * so the kitchen light goes a metre ahead, to the left and below the eyes, the inbox to the right.
 */
const KITCHEN_SPOT: RoomPoint = { x: -0.7, y: 1.15, z: 0.2 };
const INBOX_SPOT: RoomPoint = { x: 0.6, y: 1.0, z: 0.3 };

/** Across the room, three metres from the kitchen light's anchor: a drop here needs an anchor of its own. */
const FAR_SPOT: RoomPoint = { x: 1.9, y: 1.0, z: -1.4 };

/** `app-state.ts`'s `KEEPING_LINES`, the one line a room opened only to place things shows while it keeps a drop. */
const KEEPING = 'Keeping what you placed…';

/** The second and third visits' origins: moved along the floor and turned. */
const MOVED: Origin = { x: 0.8, z: -0.6, yawDegrees: 35 };
const MOVED_AGAIN: Origin = { x: -0.5, z: 0.4, yawDegrees: -60 };

function withOrigin(origin: Origin): string {
  return `/hey-jarvis/horizon/?origin=${origin.x},${origin.z},${origin.yawDegrees}`;
}

/** A controller tipped a little down, as one is held reaching for something at chest height. */
const REACHING_CONTROLLER = turn({ x: 1, y: 0, z: 0 }, -30);

/** A hand whose system ray points up and ahead, at nothing: a pinch with it takes only what is under it. */
const HAND_RAY_UP = turn({ x: 1, y: 0, z: 0 }, 60);

/** Pointing straight up, at nothing in the room. */
const POINTING_UP = turn({ x: 1, y: 0, z: 0 }, 90);

const NOWHERE: RoomPoint = { x: 100, y: 100, z: 100 };

/** The placement the registry kept for `id`, read with guards from what the page stored. */
function keptPlacement(registry: unknown, id: string): { anchor: string; offset: number[] } | undefined {
  if (typeof registry !== 'object' || registry === null || !('entities' in registry)) return undefined;
  const { entities: all } = registry;
  if (typeof all !== 'object' || all === null || !(id in all)) return undefined;
  const entity: unknown = Object.entries(all).find(([key]) => key === id)?.[1];
  if (typeof entity !== 'object' || entity === null || !('placement' in entity)) return undefined;
  const { placement } = entity;
  if (typeof placement !== 'object' || placement === null) return undefined;
  if (!('anchor' in placement) || !('offset' in placement)) return undefined;
  const { anchor, offset } = placement;
  if (typeof anchor !== 'string' || !Array.isArray(offset) || !offset.every((value) => typeof value === 'number')) {
    return undefined;
  }
  return { anchor, offset };
}

function keysOf(value: unknown): string[] {
  return typeof value === 'object' && value !== null ? Object.keys(value) : [];
}

function middleOf(points: readonly RoomPoint[]): RoomPoint {
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y, z: total.z + point.z }), {
    x: 0,
    y: 0,
    z: 0,
  });
  return { x: sum.x / points.length, y: sum.y / points.length, z: sum.z / points.length };
}

test('what Jarvis works on is placed in the room by hand and controller, kept, pointed at and lit', async ({
  page,
}, testInfo) => {
  // Five visits to the room, each at the emulator's pace of a few frames a second.
  test.setTimeout(1_200_000);
  const problems = collectProblems(page);
  await seedRegistry(page, SEEDED);
  await withSavedSettings(page);
  let kitchenAnchor = '';

  await test.step('the page’s Place entities opens the drawer, every entity on it by name', async () => {
    await page.goto('/hey-jarvis/horizon/');
    await page.evaluate(() => window.__xrHarness?.ready);
    // No key and no microphone asked for: straight into placing things.
    await page.getByRole('button', { name: 'Place entities' }).click();
    await expect.poll(() => scene(page), { timeout: 90000 }).toBe('editing');
    await expect.poll(async () => (await entities(page)).drawer.slots.length, { timeout: 60000 }).toBe(3);
    const report = await entities(page);
    expect(report.drawer.slots.map((slot) => slot.label)).toEqual([KITCHEN.name, INBOX.name, CALENDAR.name]);
    expect(report.drawer.slots.map((slot) => slot.state)).toEqual(['unplaced', 'unplaced', 'unplaced']);
    const room = await roomReport(page);
    expect(room.view.panels.guide).not.toBeNull();
    expect(room.view.wakeArmed).toBe(false);
    expect(room.view.frameRate).toBe('highest');
    // Looked down at: it opens below the eyes, within reach.
    await lookAt(page, middleOf(report.drawer.slots.map((slot) => slot.worldPosition)));
    await frames(page, 3);
    await photograph(page, testInfo, 'entities-drawer.png');
  });

  await test.step('a controller’s grip takes a token from the drawer and puts it in the room', async () => {
    const slot = (await entities(page)).drawer.slots[0];
    if (slot === undefined) throw new Error('The drawer is empty.');
    const hold = (position: RoomPoint) => holdController(page, 'right', position, REACHING_CONTROLLER);
    const grip = await measureOffset(page, {
      id: 'right-controller',
      origin: NO_ORIGIN,
      start: { x: 0.35, y: 1.1, z: 0.9 },
      hold,
      measure: (input) => input.grip,
    });
    await hold(heldFor(slot.worldPosition, grip));
    await frames(page, 2);
    await controllerButton(page, 'right', 'squeeze', 1);
    await expect.poll(async () => (await entities(page)).carried.map((token) => token.id)).toEqual([KITCHEN.id]);
    expect((await entities(page)).carried[0]).toMatchObject({ grabber: 'right-controller', mode: 'near' });

    await hold(heldFor(KITCHEN_SPOT, grip));
    await expect
      .poll(async () => distance((await entities(page)).carried[0]?.position ?? NOWHERE, KITCHEN_SPOT))
      .toBeLessThan(0.01);
    expect((await entities(page)).carried[0]?.over).toBe('room');
    await lookAt(page, { x: KITCHEN_SPOT.x + 0.15, y: KITCHEN_SPOT.y, z: KITCHEN_SPOT.z });
    await frames(page, 3);
    await photograph(page, testInfo, 'entities-carried.png');

    await controllerButton(page, 'right', 'squeeze', 0);
    await expect
      .poll(async () => (await entities(page)).placed.map((entity) => entity.id), { timeout: 60000 })
      .toEqual([KITCHEN.id]);
    const placed = (await entities(page)).placed[0];
    if (placed?.position === null || placed === undefined) throw new Error('Placed nowhere.');
    expect(distance(placed.position, KITCHEN_SPOT)).toBeLessThan(0.01);
    kitchenAnchor = placed.anchor;
    // Kept on a persistent anchor the headset handed out — made where it was dropped, so the offset
    // from it is next to nothing — and the anchor is remembered too.
    await expect
      .poll(async () => keptPlacement(await stored(page, REGISTRY_KEY), KITCHEN.id)?.anchor)
      .toBe(kitchenAnchor);
    const kept = keptPlacement(await stored(page, REGISTRY_KEY), KITCHEN.id);
    expect(Math.hypot(...(kept?.offset ?? [1, 1, 1]))).toBeLessThan(0.01);
    expect(keysOf(await stored(page, EMULATED_ANCHORS_KEY))).toContain(kitchenAnchor);
    expect((await entities(page)).message).toBe(`${KITCHEN.name} is kept here.`);
    // Out of the drawer's first group: what still needs a place comes first.
    expect((await entities(page)).drawer.slots.map((entry) => entry.id)).toEqual([INBOX.id, CALENDAR.id, KITCHEN.id]);
    await frames(page, 3);
    await photograph(page, testInfo, 'entities-placed.png');
  });

  await test.step('Done, selected along the controller’s ray, closes the drawer and the room', async () => {
    const done = (await entities(page)).drawer.buttons.find((button) => button.button === 'done');
    if (done === undefined) throw new Error('The drawer has no Done.');
    await aim(page, done.worldPosition);
    await frames(page, 2);
    // Held until the room has gone: the frames stop with it, so there are none to wait for.
    await controllerButton(page, 'right', 'trigger', 1);
    await expect.poll(async () => (await debugState(page)).phase, { timeout: 60000 }).toBe('ready');
    await controllerButton(page, 'right', 'trigger', 0);
    expect((await roomReport(page)).recentEffects).toEqual(expect.arrayContaining(['editing', 'exit-xr']));
  });

  await test.step('in the next session, started somewhere else, the entity is where it was put', async () => {
    await enterRoom(page, withOrigin(MOVED));
    await expect
      .poll(async () => (await entities(page)).placed.find((entity) => entity.id === KITCHEN.id)?.position ?? null, {
        timeout: 60000,
      })
      .not.toBeNull();
    const placed = (await entities(page)).placed.find((entity) => entity.id === KITCHEN.id);
    if (placed?.position === null || placed === undefined) throw new Error('Not found.');
    expect(placed.anchor).toBe(kitchenAnchor);
    // The same spot of the room, found through its anchor, although the room's space has moved.
    expect(distance(toEmulator(placed.position, MOVED), KITCHEN_SPOT)).toBeLessThan(0.01);
    expect(distance(placed.position, KITCHEN_SPOT)).toBeGreaterThan(0.5);
    expect((await entities(page)).anchors.states[kitchenAnchor]).toBe('located');
  });

  await test.step('pointing a controller at it rings it, and says it is what sir means', async () => {
    await holdController(page, 'left', { x: -0.25, y: 1.3, z: 0.95 }, POINTING_UP);
    await aim(page, KITCHEN_SPOT);
    await expect.poll(async () => (await entities(page)).pointed, { timeout: 30000 }).toBe(KITCHEN.id);
    expect((await entities(page)).pendingContext).toBe(`Sir is pointing at "${KITCHEN.name}" (${KITCHEN.id}).`);
    await lookAt(page, { x: KITCHEN_SPOT.x + 0.15, y: KITCHEN_SPOT.y, z: KITCHEN_SPOT.z });
    await frames(page, 3);
    await photograph(page, testInfo, 'entities-pointing.png');
    await aim(page, 'up');
    await expect.poll(async () => (await entities(page)).pointed, { timeout: 30000 }).toBeNull();
  });

  await test.step('a hand pointing its index finger at it rings it too', async () => {
    await useInput(page, 'hand');
    await pointHandAt(page, 'right', { x: 0.2, y: 1.3, z: 0.9 }, KITCHEN_SPOT, MOVED);
    await expect.poll(async () => (await entities(page)).pointed, { timeout: 30000 }).toBe(KITCHEN.id);
    expect((await inputReport(page, 'right-hand')).pointing).toBe(true);
    expect((await entities(page)).pendingContext).toBe(`Sir is pointing at "${KITCHEN.name}" (${KITCHEN.id}).`);
    await holdHand(page, 'right', { position: { x: 0.2, y: 1.1, z: 0.9 }, rotation: POINTING_UP, pose: 'default' });
    await expect.poll(async () => (await entities(page)).pointed, { timeout: 30000 }).toBeNull();
  });

  await test.step('A opens the drawer from the waiting room, and a pinch puts a token beside the first', async () => {
    await useInput(page, 'controller');
    await pressControllerButton(page, 'right', 'a-button');
    await expect.poll(() => scene(page), { timeout: 30000 }).toBe('editing');
    await expect.poll(async () => (await entities(page)).drawer.slots.length, { timeout: 30000 }).toBe(3);
    const slot = (await entities(page)).drawer.slots.find((entry) => entry.id === INBOX.id);
    if (slot === undefined) throw new Error('The inbox is not in the drawer.');
    const token = toEmulator(slot.worldPosition, MOVED);

    await useInput(page, 'hand');
    const pinch = await measureOffset(page, {
      id: 'right-hand',
      origin: MOVED,
      start: { x: 0.4, y: 1.5, z: 0.6 },
      hold: (position) => holdHand(page, 'right', { position, rotation: HAND_RAY_UP, pose: 'default', pinch: 1 }),
      measure: (input) => input.grip,
    });
    // Opened, brought to the token, and pinched on it.
    await holdHand(page, 'right', { position: { x: 0.4, y: 1.5, z: 0.6 }, rotation: HAND_RAY_UP, pinch: 0 });
    await frames(page, 2);
    await holdHand(page, 'right', { position: heldFor(token, pinch), rotation: HAND_RAY_UP, pinch: 0 });
    await frames(page, 2);
    await holdHand(page, 'right', { position: heldFor(token, pinch), rotation: HAND_RAY_UP, pinch: 1 });
    await expect.poll(async () => (await entities(page)).carried.map((carried) => carried.id)).toEqual([INBOX.id]);
    expect((await entities(page)).carried[0]).toMatchObject({ grabber: 'right-hand', mode: 'near' });
    // Every pinch was a select, and none of them summoned him.
    expect(await scene(page)).toBe('editing');

    await holdHand(page, 'right', { position: heldFor(INBOX_SPOT, pinch), rotation: HAND_RAY_UP, pinch: 1 });
    await expect
      .poll(async () => distance(toEmulator((await entities(page)).carried[0]?.position ?? NOWHERE, MOVED), INBOX_SPOT))
      .toBeLessThan(0.01);
    await holdHand(page, 'right', { position: heldFor(INBOX_SPOT, pinch), rotation: HAND_RAY_UP, pinch: 0 });
    await expect
      .poll(async () => (await entities(page)).placed.map((entity) => entity.id).sort(), { timeout: 60000 })
      .toEqual([INBOX.id, KITCHEN.id].sort());
    const inbox = (await entities(page)).placed.find((entity) => entity.id === INBOX.id);
    if (inbox?.position === null || inbox === undefined) throw new Error('Placed nowhere.');
    expect(distance(toEmulator(inbox.position, MOVED), INBOX_SPOT)).toBeLessThan(0.01);
    // Within reach of the kitchen light's anchor, so kept on it at an offset rather than on a new one.
    expect(inbox.anchor).toBe(kitchenAnchor);
    await expect
      .poll(async () => keptPlacement(await stored(page, REGISTRY_KEY), INBOX.id)?.anchor)
      .toBe(kitchenAnchor);
    const offset = keptPlacement(await stored(page, REGISTRY_KEY), INBOX.id)?.offset ?? [0, 0, 0];
    expect(Math.hypot(...offset)).toBeCloseTo(distance(INBOX_SPOT, KITCHEN_SPOT), 2);

    await useInput(page, 'controller');
    await pressControllerButton(page, 'right', 'b-button');
    await expect.poll(() => scene(page), { timeout: 30000 }).toBe('waiting');
    expect((await entities(page)).drawer.open).toBe(false);
  });

  await test.step('the button on the back of a raised wrist opens the drawer, and closes it again', async () => {
    await useInput(page, 'hand');
    // The left hand turned to read a watch, straight ahead of the eyes: fingers across the chest, the
    // back of the wrist to the eyes (the pose `hand-pose.spec.ts` pins as raised).
    const watch = then(turn({ x: 0, y: 1, z: 0 }, -90), turn({ x: 1, y: 0, z: 0 }, 50));
    await holdHand(page, 'left', {
      position: { x: 0, y: 1.3, z: 0.85 },
      rotation: watch,
      pose: 'default',
      pinch: 0,
    });
    await expect.poll(async () => (await entities(page)).wristButton, { timeout: 30000 }).not.toBeNull();
    const reported = (await entities(page)).wristButton;
    if (reported === null) throw new Error('No wrist button.');
    const button = toEmulator(reported, MOVED);
    const away = { x: 0.3, y: 1.2, z: 0.8 };
    const level = turn({ x: 0, y: 1, z: 0 }, 0);
    const hold = (position: RoomPoint) =>
      holdHand(page, 'right', { position, rotation: level, pose: 'point', pinch: 0 });
    const tip = await measureOffset(page, {
      id: 'right-hand',
      origin: MOVED,
      start: away,
      hold,
      measure: (input) => input.indexTip,
    });
    await hold(heldFor(button, tip));
    await expect.poll(() => scene(page), { timeout: 30000 }).toBe('editing');
    await hold(away);
    await frames(page, 3);
    await hold(heldFor(button, tip));
    await expect.poll(() => scene(page), { timeout: 30000 }).toBe('waiting');
  });

  await test.step('the trigger that pulled Done, held and let go in the waiting room, never summons him', async () => {
    await useInput(page, 'controller');
    await pressControllerButton(page, 'right', 'a-button');
    await expect.poll(() => scene(page), { timeout: 30000 }).toBe('editing');
    await expect
      .poll(async () => (await entities(page)).drawer.buttons.some((button) => button.button === 'done'), {
        timeout: 30000,
      })
      .toBe(true);
    const done = (await entities(page)).drawer.buttons.find((button) => button.button === 'done');
    if (done === undefined) throw new Error('The drawer has no Done.');
    await aim(page, toEmulator(done.worldPosition, MOVED));
    await frames(page, 2);
    await controllerButton(page, 'right', 'trigger', 1);
    await expect.poll(() => scene(page), { timeout: 30000 }).toBe('waiting');
    // Held past the 0.8 s that makes a hold — which would hang up on him, or summon him from waiting —
    // and then let go, which a Quest reports as the select itself.
    await page.waitForTimeout(1500);
    await frames(page, 3);
    expect(await scene(page)).toBe('waiting');
    await controllerButton(page, 'right', 'trigger', 0);
    await frames(page, 3);
    expect(await scene(page)).toBe('waiting');
    const effects = effectsSince((await roomReport(page)).recentEffects, 'editing');
    expect(effects).not.toContain('place');
    expect(effects).not.toContain('summon');
  });

  await test.step('sample mode’s thinking lights a corona round every placed entity', async () => {
    await page.goto(withOrigin(MOVED_AGAIN));
    await page.evaluate(() => window.__xrHarness?.ready);
    await page.getByRole('button', { name: 'Try him in your room' }).click();
    await expect.poll(() => scene(page), { timeout: 90000 }).toBe('sample:speaking');
    await aim(page, toEmulator(await hologramPosition(page), MOVED_AGAIN));
    await tap(page);
    await expect.poll(() => scene(page)).toBe('sample:listening');
    await tap(page);
    await expect.poll(() => scene(page)).toBe('sample:thinking');
    await expect
      .poll(async () => (await entities(page)).affected.sort(), { timeout: 60000 })
      .toEqual([INBOX.id, KITCHEN.id].sort());
    await expect.poll(async () => (await entities(page)).coronas.length, { timeout: 60000 }).toBe(2);
    for (const corona of (await entities(page)).coronas) {
      const spot = corona.id === KITCHEN.id ? KITCHEN_SPOT : INBOX_SPOT;
      expect(distance(toEmulator(corona.position, MOVED_AGAIN), spot)).toBeLessThan(0.01);
    }
    // Neither controller pointing at them, so no reticle rings them in the picture.
    await aim(page, 'up');
    await holdController(page, 'left', { x: -0.25, y: 1.3, z: 0.95 }, POINTING_UP);
    // Between the two, so neither is stretched at the edge of the emulator's wide view.
    await lookAt(page, middleOf([KITCHEN_SPOT, INBOX_SPOT]));
    await frames(page, 4);
    await expect
      .poll(async () => (await entities(page)).coronas.find((corona) => corona.id === KITCHEN.id)?.level)
      .toBe(1);
    await photograph(page, testInfo, 'entities-corona.png');
  });

  await test.step('Done pulled the moment a drop is let go keeps the room open until the drop is kept', async () => {
    await page.goto(withOrigin(MOVED_AGAIN));
    await page.evaluate(() => window.__xrHarness?.ready);
    await page.getByRole('button', { name: 'Place entities' }).click();
    await expect.poll(() => scene(page), { timeout: 90000 }).toBe('editing');
    await expect.poll(async () => (await entities(page)).drawer.buttons.length, { timeout: 60000 }).toBeGreaterThan(0);
    const report = await entities(page);
    const slot = report.drawer.slots.find((entry) => entry.id === CALENDAR.id);
    const done = report.drawer.buttons.find((button) => button.button === 'done');
    if (slot === undefined || done === undefined) throw new Error('The drawer has no calendar, or no Done.');
    await pointControllerAt(page, 'left', { x: -0.25, y: 1.3, z: 0.95 }, toEmulator(done.worldPosition, MOVED_AGAIN));

    const hold = (position: RoomPoint) => holdController(page, 'right', position, REACHING_CONTROLLER);
    const grip = await measureOffset(page, {
      id: 'right-controller',
      origin: MOVED_AGAIN,
      start: { x: 0.35, y: 1.1, z: 0.9 },
      hold,
      measure: (input) => input.grip,
    });
    await hold(heldFor(toEmulator(slot.worldPosition, MOVED_AGAIN), grip));
    await frames(page, 2);
    await controllerButton(page, 'right', 'squeeze', 1);
    await expect.poll(async () => (await entities(page)).carried.map((token) => token.id)).toEqual([CALENDAR.id]);
    await hold(heldFor(FAR_SPOT, grip));
    await expect
      .poll(async () =>
        distance(toEmulator((await entities(page)).carried[0]?.position ?? NOWHERE, MOVED_AGAIN), FAR_SPOT),
      )
      .toBeLessThan(0.01);

    // Let go far from the kitchen light's anchor, so it waits on a new one, and Done in the same frame.
    await controllerButtons(page, [
      { hand: 'right', button: 'squeeze', value: 0 },
      { hand: 'left', button: 'trigger', value: 1 },
    ]);
    await expect.poll(async () => (await debugState(page)).phase, { timeout: 60000 }).toBe('ready');
    await controllerButton(page, 'left', 'trigger', 0);
    expect((await roomReport(page)).recentEffects).toEqual(
      expect.arrayContaining([`show-panel guide: ${KEEPING}`, 'exit-xr']),
    );
    const kept = keptPlacement(await stored(page, REGISTRY_KEY), CALENDAR.id);
    if (kept === undefined) throw new Error('The calendar was not kept.');
    expect(kept.anchor).not.toBe(kitchenAnchor);
    expect(Math.hypot(...kept.offset)).toBeLessThan(0.01);
    expect(keysOf(await stored(page, EMULATED_ANCHORS_KEY))).toContain(kept.anchor);
  });

  expect(problems).toEqual([]);
});
