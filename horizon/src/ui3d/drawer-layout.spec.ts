import { describe, expect, it } from 'bun:test';
import { isOnDrawer } from '../entities/grab';
import { distanceBetween } from '../xr/ray';
import {
  buttonAlong,
  buttonPoint,
  buttonTouched,
  clampPage,
  DRAWER_AHEAD_METRES,
  DRAWER_BELOW_EYES_METRES,
  DRAWER_BUTTONS,
  DRAWER_HEIGHT_METRES,
  DRAWER_WIDTH_METRES,
  type DrawerButton,
  drawerPoseFacing,
  drawerSurfaceOf,
  drawerToRoom,
  entriesOnPage,
  pageCount,
  roomToDrawer,
  SLOTS_PER_PAGE,
  slotCentre,
  tokenPoint,
} from './drawer-layout';

const EYE = { x: 0, y: 1.6, z: 1.2 };
const AHEAD = { x: 0, y: 0, z: -1 };
const POSE = drawerPoseFacing(EYE, AHEAD);
const ALL_BUTTONS: ReadonlySet<DrawerButton> = new Set(DRAWER_BUTTONS);

describe('drawerPoseFacing', () => {
  it('opens ahead of the eyes, below them, within reach', () => {
    expect(POSE.centre.x).toBeCloseTo(0, 6);
    expect(POSE.centre.y).toBeCloseTo(EYE.y - DRAWER_BELOW_EYES_METRES, 6);
    expect(POSE.centre.z).toBeCloseTo(EYE.z - DRAWER_AHEAD_METRES, 6);
    expect(distanceBetween(POSE.centre, EYE)).toBeLessThan(0.6);
  });

  it('faces the eyes squarely, level from side to side, tilted back like a lectern', () => {
    const toEye = { x: EYE.x - POSE.centre.x, y: EYE.y - POSE.centre.y, z: EYE.z - POSE.centre.z };
    const length = Math.hypot(toEye.x, toEye.y, toEye.z);
    expect(POSE.normal.x * toEye.x + POSE.normal.y * toEye.y + POSE.normal.z * toEye.z).toBeCloseTo(length, 6);
    expect(POSE.right).toEqual({ x: 1, y: 0, z: 0 });
    // Its top edge leans away from sir.
    expect(POSE.up.y).toBeGreaterThan(0.7);
    expect(POSE.up.z).toBeLessThan(0);
  });

  it('opens ahead whichever way he faces', () => {
    const turned = drawerPoseFacing(EYE, { x: 1, y: -0.4, z: 0 });
    expect(turned.centre.x).toBeCloseTo(DRAWER_AHEAD_METRES, 6);
    expect(turned.centre.z).toBeCloseTo(EYE.z, 6);
    expect(turned.right.z).toBeCloseTo(1, 6);
  });
});

describe('pages', () => {
  it('has one page at least, and as many more as the entries fill', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(SLOTS_PER_PAGE)).toBe(1);
    expect(pageCount(SLOTS_PER_PAGE + 1)).toBe(2);
  });

  it('keeps the page to the pages there are', () => {
    expect(clampPage(-1, 30)).toBe(0);
    expect(clampPage(7, 30)).toBe(2);
    expect(clampPage(5, 0)).toBe(0);
  });

  it('shows each entry on exactly one page', () => {
    const entries = Array.from({ length: 30 }, (_, index) => index);
    const shown = [0, 1, 2].flatMap((page) => entriesOnPage(entries, page));
    expect(shown).toEqual(entries);
    expect(entriesOnPage(entries, 2)).toHaveLength(30 - 2 * SLOTS_PER_PAGE);
  });
});

describe('slots', () => {
  it('keeps every slot and its token on the board, and tokens far enough apart to pinch one', () => {
    const tokens = Array.from({ length: SLOTS_PER_PAGE }, (_, index) => tokenPoint(index));
    for (const [index, token] of tokens.entries()) {
      expect(Math.abs(token.x)).toBeLessThan(DRAWER_WIDTH_METRES / 2);
      expect(Math.abs(token.y)).toBeLessThan(DRAWER_HEIGHT_METRES / 2);
      expect(token.z).toBeGreaterThan(0);
      expect(token.y).toBeGreaterThan(slotCentre(index).y);
      for (const other of tokens.slice(index + 1)) {
        expect(Math.hypot(token.x - other.x, token.y - other.y)).toBeGreaterThanOrEqual(0.05);
      }
    }
  });

  it('keeps the footer buttons clear of the slots', () => {
    const lowest = slotCentre(SLOTS_PER_PAGE - 1);
    for (const button of DRAWER_BUTTONS) expect(buttonPoint(button).y).toBeLessThan(lowest.y - 0.04);
  });
});

describe('the board in the room', () => {
  it('goes to the room and back', () => {
    const point = { x: 0.1, y: -0.05, z: 0.02 };
    const back = roomToDrawer(POSE, drawerToRoom(POSE, point));
    expect(back.x).toBeCloseTo(point.x, 6);
    expect(back.y).toBeCloseTo(point.y, 6);
    expect(back.z).toBeCloseTo(point.z, 6);
  });

  it('counts a token let go over a slot as let go on the drawer', () => {
    const surface = drawerSurfaceOf(POSE);
    expect(isOnDrawer(surface, drawerToRoom(POSE, tokenPoint(5)))).toBe(true);
    expect(isOnDrawer(surface, { x: 0, y: 1, z: -1 })).toBe(false);
  });
});

describe('the buttons', () => {
  it('are pressed along a ray from the front', () => {
    for (const button of DRAWER_BUTTONS) {
      const target = drawerToRoom(POSE, buttonPoint(button));
      const origin = { x: 0.25, y: 1.3, z: 1 };
      const length = distanceBetween(origin, target);
      const ray = {
        origin,
        direction: {
          x: (target.x - origin.x) / length,
          y: (target.y - origin.y) / length,
          z: (target.z - origin.z) / length,
        },
      };
      expect(buttonAlong(POSE, ray, ALL_BUTTONS)).toBe(button);
      // From behind the board, the same line presses nothing.
      const behind = { origin: drawerToRoom(POSE, { ...buttonPoint(button), z: -0.3 }), direction: POSE.normal };
      expect(buttonAlong(POSE, behind, ALL_BUTTONS)).toBeUndefined();
    }
  });

  it('are pressed by a fingertip on the board, and not by one hovering above it', () => {
    const done = buttonPoint('done');
    expect(buttonTouched(POSE, drawerToRoom(POSE, { ...done, z: 0.01 }), ALL_BUTTONS)).toBe('done');
    expect(buttonTouched(POSE, drawerToRoom(POSE, { ...done, z: 0.08 }), ALL_BUTTONS)).toBeUndefined();
    expect(buttonTouched(POSE, drawerToRoom(POSE, tokenPoint(0)), ALL_BUTTONS)).toBeUndefined();
  });

  it('press nothing that is not there: no page buttons on a drawer of one page', () => {
    const onlyDone: ReadonlySet<DrawerButton> = new Set(['done']);
    const next = drawerToRoom(POSE, buttonPoint('next'));
    expect(buttonTouched(POSE, next, onlyDone)).toBeUndefined();
    expect(buttonTouched(POSE, next, ALL_BUTTONS)).toBe('next');
  });
});
