import type { Page } from '@playwright/test';
import type { EntitiesReport, RoomPoint } from '../../src/debug-hook';
import { debugState, frames } from './app-driver';
import { expect } from './fixtures';

/**
 * Placing things in the emulated room: the registry seeded before the page loads, the room's space
 * moved with `?origin`, and the emulated head, controllers and hands held and posed from the test.
 *
 * The emulator's controllers and hands are placed in its own space, which is the room's `local-floor`
 * only when there is no `?origin`; everything the app reports is in the room's space. So every point
 * that crosses between the two goes through {@link toEmulator} or {@link toRoom}.
 *
 * Where a hand pinches, where its index tip is and which way its finger points all depend on the
 * emulator's hand poses, which this does not copy: each is measured from the app's own report for
 * one pose of the hand, and the hand is then moved by the difference.
 */

/** `hologram`'s registry key and shape, spelled out: Playwright cannot import the app's TypeScript at run time. */
export const REGISTRY_KEY = 'jarvis.horizon.entities';

/** Where the emulator keeps the persistent anchors it hands out. */
export const EMULATED_ANCHORS_KEY = '@immersive-web-emulation-runtime/persistent-anchors';

/** The room's space moved from the emulator's: `?origin=x,z,yawDegrees`. */
export interface Origin {
  x: number;
  z: number;
  yawDegrees: number;
}

export const NO_ORIGIN: Origin = { x: 0, z: 0, yawDegrees: 0 };

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** A turn of `degrees` about the unit axis `axis`. */
export function turn(axis: RoomPoint, degrees: number): Quaternion {
  const half = (degrees * Math.PI) / 360;
  return { x: axis.x * Math.sin(half), y: axis.y * Math.sin(half), z: axis.z * Math.sin(half), w: Math.cos(half) };
}

/** `second` after `first`, as one turn. */
export function then(first: Quaternion, second: Quaternion): Quaternion {
  return {
    w: second.w * first.w - second.x * first.x - second.y * first.y - second.z * first.z,
    x: second.w * first.x + second.x * first.w + second.y * first.z - second.z * first.y,
    y: second.w * first.y - second.x * first.z + second.y * first.w + second.z * first.x,
    z: second.w * first.z + second.x * first.y - second.y * first.x + second.z * first.w,
  };
}

/** `vector` turned by `rotation`. */
export function rotate(vector: RoomPoint, rotation: Quaternion): RoomPoint {
  const { x, y, z, w } = rotation;
  const tx = 2 * (y * vector.z - z * vector.y);
  const ty = 2 * (z * vector.x - x * vector.z);
  const tz = 2 * (x * vector.y - y * vector.x);
  return {
    x: vector.x + w * tx + (y * tz - z * ty),
    y: vector.y + w * ty + (z * tx - x * tz),
    z: vector.z + w * tz + (x * ty - y * tx),
  };
}

/** The turn that takes the unit direction `from` onto the unit direction `to`. */
export function turnBetween(from: RoomPoint, to: RoomPoint): Quaternion {
  const axis = { x: from.y * to.z - from.z * to.y, y: from.z * to.x - from.x * to.z, z: from.x * to.y - from.y * to.x };
  const length = Math.hypot(axis.x, axis.y, axis.z);
  const cosine = Math.max(-1, Math.min(1, from.x * to.x + from.y * to.y + from.z * to.z));
  if (length < 1e-9) return { x: 0, y: 0, z: 0, w: 1 };
  return turn({ x: axis.x / length, y: axis.y / length, z: axis.z / length }, (Math.acos(cosine) * 180) / Math.PI);
}

function yaw(origin: Origin): Quaternion {
  return turn({ x: 0, y: 1, z: 0 }, origin.yawDegrees);
}

/** A point in the room's space, in the emulator's: turned by the origin's yaw, then moved to it. */
export function toEmulator(point: RoomPoint, origin: Origin): RoomPoint {
  const turned = rotate(point, yaw(origin));
  return { x: turned.x + origin.x, y: turned.y, z: turned.z + origin.z };
}

/** A direction in the room's space, in the emulator's. */
export function directionToEmulator(direction: RoomPoint, origin: Origin): RoomPoint {
  return rotate(direction, yaw(origin));
}

/** A point in the emulator's space, in the room's. */
export function toRoom(point: RoomPoint, origin: Origin): RoomPoint {
  const back = yaw(origin);
  return rotate({ x: point.x - origin.x, y: point.y, z: point.z - origin.z }, { ...back, y: -back.y });
}

export function distance(first: RoomPoint, second: RoomPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}

function difference(from: RoomPoint, to: RoomPoint): RoomPoint {
  return { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
}

function normalised(vector: RoomPoint): RoomPoint {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

/** Stores `registry` before the page loads, unless a registry is there already: a reload keeps what was placed. */
export async function seedRegistry(page: Page, registry: unknown) {
  await page.addInitScript(
    ({ key, value }) => {
      if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, value);
    },
    { key: REGISTRY_KEY, value: JSON.stringify(registry) },
  );
}

/** What the page has kept in `localStorage` under `key`, parsed. */
export async function stored(page: Page, key: string): Promise<unknown> {
  const text = await page.evaluate((wanted) => window.localStorage.getItem(wanted), key);
  return text === null ? null : JSON.parse(text);
}

export async function entities(page: Page): Promise<EntitiesReport> {
  const report = (await debugState(page)).entities;
  if (report === null) throw new Error('No room has reported its entities.');
  return report;
}

/** Turns the emulated head, where it stands, to look at `target` (in the emulator's space). */
export async function lookAt(page: Page, target: RoomPoint) {
  await page.evaluate((point) => {
    const device = window.__xrHarness?.device;
    if (device === undefined) throw new Error('No emulated headset.');
    const x = point.x - device.position.x;
    const y = point.y - device.position.y;
    const z = point.z - device.position.z;
    const heading = Math.atan2(-x, -z);
    const pitch = Math.atan2(y, Math.hypot(x, z));
    // Heading about the vertical, then pitch about the head's own x.
    const headingHalf = heading / 2;
    const pitchHalf = pitch / 2;
    const cy = Math.cos(headingHalf);
    const sy = Math.sin(headingHalf);
    const cx = Math.cos(pitchHalf);
    const sx = Math.sin(pitchHalf);
    device.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
  }, target);
}

/** Holds a controller at `position` turned by `rotation`, both in the emulator's space. */
export async function holdController(page: Page, hand: 'left' | 'right', position: RoomPoint, rotation: Quaternion) {
  await page.evaluate(
    ({ hand, position, rotation }) => {
      const controller = window.__xrHarness?.device.controllers[hand];
      if (controller === undefined) throw new Error(`No ${hand} controller.`);
      controller.position.set(position.x, position.y, position.z);
      controller.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    },
    { hand, position, rotation },
  );
}

/** Presses a controller's button (`trigger`, `squeeze`, `a-button`…), or lets it go. */
export async function controllerButton(page: Page, hand: 'left' | 'right', button: string, value: 0 | 1) {
  await page.evaluate(
    ({ hand, button, value }) => window.__xrHarness?.device.controllers[hand]?.updateButtonValue(button, value),
    { hand, button, value },
  );
}

/** Presses a controller's button and lets it go, a few frames apart, so the room reads the press. */
export async function pressControllerButton(page: Page, hand: 'left' | 'right', button: string) {
  await controllerButton(page, hand, button, 1);
  await frames(page, 2);
  await controllerButton(page, hand, button, 0);
  await frames(page, 2);
}

/** Switches the emulated headset to its hands, or back to its controllers. */
export async function useInput(page: Page, mode: 'hand' | 'controller') {
  await page.evaluate((wanted) => {
    const device = window.__xrHarness?.device;
    if (device !== undefined) device.primaryInputMode = wanted;
  }, mode);
  await frames(page, 3);
}

export interface HandPose {
  position: RoomPoint;
  rotation: Quaternion;
  /** The emulator's `default` (relaxed), `point` or `pinch`. */
  pose?: 'default' | 'point' | 'pinch';
  /** 0 open to 1 pinched. */
  pinch?: number;
}

/** Holds a hand at a pose, in the emulator's space. */
export async function holdHand(page: Page, hand: 'left' | 'right', pose: HandPose) {
  await page.evaluate(
    ({ hand, pose }) => {
      const input = window.__xrHarness?.device.hands[hand];
      if (input === undefined) throw new Error(`No ${hand} hand.`);
      input.position.set(pose.position.x, pose.position.y, pose.position.z);
      input.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
      if (pose.pose !== undefined) input.poseId = pose.pose;
      if (pose.pinch !== undefined) input.updatePinchValue(pose.pinch);
    },
    { hand, pose },
  );
}

/** The app's report on one input source — `right-hand`, `left-controller` — once it has one. */
export async function inputReport(page: Page, id: string) {
  let found: EntitiesReport['inputs'][number] | undefined;
  await expect
    .poll(async () => {
      found = (await entities(page)).inputs.find((input) => input.id === id);
      return found !== undefined;
    })
    .toBe(true);
  if (found === undefined) throw new Error(`No input ${id}.`);
  return found;
}

/**
 * How far the point `measure` picks out of the app's report on `id` — a pinch point, a grip, an
 * index tip — is from where the hand or controller is held, for one rotation of it: held at `start`
 * with `hold`, and measured once the app has seen it there. Holding it at `target` minus this puts
 * that point on `target`, as long as its rotation stays the same.
 */
export async function measureOffset(
  page: Page,
  options: {
    id: string;
    origin: Origin;
    start: RoomPoint;
    hold: (position: RoomPoint) => Promise<void>;
    measure: (input: EntitiesReport['inputs'][number]) => RoomPoint | null;
  },
): Promise<RoomPoint> {
  await options.hold(options.start);
  let measured: RoomPoint | null = null;
  await expect
    .poll(async () => {
      measured = options.measure(await inputReport(page, options.id));
      return measured === null
        ? Number.POSITIVE_INFINITY
        : distance(toEmulator(measured, options.origin), options.start);
    })
    .toBeLessThan(0.3);
  await frames(page, 2);
  measured = options.measure(await inputReport(page, options.id));
  if (measured === null) throw new Error(`${options.id} reported nothing to measure.`);
  return difference(options.start, toEmulator(measured, options.origin));
}

/** `point` less `offset`: where to hold something whose measured point is `offset` from it, to put that point at `point`. */
export function heldFor(point: RoomPoint, offset: RoomPoint): RoomPoint {
  return { x: point.x - offset.x, y: point.y - offset.y, z: point.z - offset.z };
}

/**
 * Turns a hand in a point pose so its index finger points at `target` (the emulator's space): the
 * finger's direction measured and the hand turned by the difference, twice, since turning the hand
 * moves the fingertip too.
 */
export async function pointHandAt(
  page: Page,
  hand: 'left' | 'right',
  position: RoomPoint,
  target: RoomPoint,
  origin: Origin,
) {
  let rotation: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
  for (let attempt = 0; attempt < 3; attempt++) {
    await holdHand(page, hand, { position, rotation, pose: 'point', pinch: 0 });
    await frames(page, 3);
    const finger = (await inputReport(page, `${hand}-hand`)).fingerRay;
    if (finger === null) throw new Error(`The ${hand} hand is not pointing.`);
    const from = directionToEmulator(finger.direction, origin);
    const to = normalised(difference(toEmulator(finger.origin, origin), target));
    rotation = then(rotation, turnBetween(normalised(from), to));
  }
  await holdHand(page, hand, { position, rotation, pose: 'point', pinch: 0 });
  await frames(page, 3);
}
