import { describe, expect, it } from 'bun:test';
import {
  EDIT_BUTTON_INDEX,
  SQUEEZE_BUTTON_INDEX,
  THUMBSTICK_FORWARD_AXIS_INDEX,
  TRIGGER_BUTTON_INDEX,
} from './gamepad-buttons';
import { controllerButtonsOf, hitDistanceAlong, inputIdOf, THUMBSTICK_DEAD_ZONE } from './input-snapshots';

/** A Touch controller's gamepad with `down` pressed and the thumbstick's forward axis at `forwardAxis`. */
function gamepad(down: readonly number[], forwardAxis = 0) {
  const axes = [0, 0, 0, 0];
  axes[THUMBSTICK_FORWARD_AXIS_INDEX] = forwardAxis;
  return { buttons: Array.from({ length: 7 }, (_, index) => ({ pressed: down.includes(index) })), axes };
}

describe('controllerButtonsOf', () => {
  it('reads the trigger and the grip', () => {
    expect(controllerButtonsOf(gamepad([TRIGGER_BUTTON_INDEX]))).toEqual({
      trigger: true,
      squeeze: false,
      thumbstickForward: 0,
    });
    expect(controllerButtonsOf(gamepad([SQUEEZE_BUTTON_INDEX, EDIT_BUTTON_INDEX]))).toEqual({
      trigger: false,
      squeeze: true,
      thumbstickForward: 0,
    });
  });

  it('turns the stick pushed forward, which a gamepad reads as negative, into a positive reach', () => {
    expect(controllerButtonsOf(gamepad([], -1)).thumbstickForward).toBe(1);
    expect(controllerButtonsOf(gamepad([], 0.6)).thumbstickForward).toBe(-0.6);
  });

  it('ignores a stick resting a little off centre', () => {
    expect(controllerButtonsOf(gamepad([], THUMBSTICK_DEAD_ZONE / 2)).thumbstickForward).toBe(0);
  });

  it('reads nothing pressed from no gamepad, or one without axes', () => {
    expect(controllerButtonsOf(undefined)).toEqual({ trigger: false, squeeze: false, thumbstickForward: 0 });
    expect(controllerButtonsOf({ buttons: [{ pressed: true }] }).thumbstickForward).toBe(0);
  });
});

describe('hitDistanceAlong', () => {
  const ray = { origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } };

  it('is the distance from where the ray starts to the hit', () => {
    expect(hitDistanceAlong(ray, { x: 0, y: 1, z: -2.5 })).toBeCloseTo(2.5, 6);
  });

  it('has no hit behind the ray', () => {
    expect(hitDistanceAlong(ray, { x: 0, y: 1, z: 1 })).toBeUndefined();
  });
});

describe('inputIdOf', () => {
  it('names a source by its hand and kind', () => {
    expect(inputIdOf('left', 'hand')).toBe('left-hand');
    expect(inputIdOf('right', 'controller')).toBe('right-controller');
  });
});
