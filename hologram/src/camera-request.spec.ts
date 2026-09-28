import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NO_CAMERA_HERE, OPEN_CAMERA_TOOL } from './camera-request';

const REPOSITORY = join(import.meta.dir, '..', '..');

/** The agent calls the tool by name, and is configured in another package. */
describe('the contract with the agent', () => {
  it('is the tool the agent calls to see something', () => {
    expect(OPEN_CAMERA_TOOL).toBe('openCamera');
  });

  it('tells the agent what to do when there is no camera, rather than failing', () => {
    const told = JSON.parse(NO_CAMERA_HERE);

    expect(told.instructions).toContain('no camera');
    // No id: an id is what the agent would go on to ask about.
    expect(told.photoId).toBeUndefined();
  });

  it('is the answer the voice firmware gives too', () => {
    // The speaker has no camera either, and answers in its own language; if the two drift, one of
    // them is telling the agent something the other is not.
    const firmware = readFileSync(
      join(REPOSITORY, 'home-assistant-voice-firmware', 'components', 'elevenlabs_stream', 'elevenlabs_stream.cpp'),
      'utf8',
    );
    expect(firmware).toContain(JSON.parse(NO_CAMERA_HERE).instructions);
  });
});
