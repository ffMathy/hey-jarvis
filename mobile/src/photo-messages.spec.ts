import { describe, expect, it } from 'bun:test';
import {
  CAMERA_BUTTON_HERE,
  CAMERA_CLOSED,
  CAMERA_OPENED,
  PHOTO_PROBLEMS,
  photoNotSent,
  photoSent,
} from './photo-messages';

/**
 * The words the phone puts into the conversation, word for word. They are what the agent's prompt
 * quotes and reasons about, so a change to one is a change to what Jarvis does — made here, on
 * purpose, or not at all.
 */
describe('what the phone tells Jarvis about the camera', () => {
  it('says there is a camera button here, and that photos come from it', () => {
    expect(CAMERA_BUTTON_HERE).toBe(
      "This device is sir's phone, and it has a camera button beside you: he can send you photos with it.",
    );
  });

  it('says the camera is open, and that it was closed without a photo', () => {
    expect(CAMERA_OPENED).toBe('Sir has opened the camera on his phone to send you a photo.');
    expect(CAMERA_CLOSED).toBe('Sir closed the camera without sending a photo.');
  });

  it('names a photo that arrived the way the routing names one', () => {
    expect(photoSent('photo3')).toBe("I've sent you a photo (photo photo3).");
  });

  it('says a photo did not arrive, and why', () => {
    expect(photoNotSent(PHOTO_PROBLEMS.unreachable)).toBe(
      "The photo I took didn't reach you: the Jarvis server could not be reached.",
    );
  });

  it('has a short fixed reason for every way a photo can fail to arrive', () => {
    expect(PHOTO_PROBLEMS).toEqual({
      notLive: 'this conversation could not be confirmed as live',
      switchedOff: 'photo uploads are switched off on the Jarvis server',
      tooLarge: 'it was larger than a photo can be',
      unreachable: 'the Jarvis server could not be reached',
    });
  });

  it('never names a tool, since the agent is told what happened and its prompt says what to do', () => {
    for (const told of [
      CAMERA_BUTTON_HERE,
      CAMERA_OPENED,
      CAMERA_CLOSED,
      photoSent('photo3'),
      ...Object.values(PHOTO_PROBLEMS).map(photoNotSent),
    ]) {
      expect(told).not.toMatch(/routePromptWorkflow|skip_turn|end_call|lookAtPhoto/);
    }
  });
});
