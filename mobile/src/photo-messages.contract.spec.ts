import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAMERA_BUTTON_HERE, CAMERA_OPENED, photoSent } from './photo-messages';

/**
 * The photo messages held to the two things in other packages that read them.
 *
 * Nothing compiles these against each other. The agent's prompt (`elevenlabs/`) is told what each
 * message means by quoting it, and the routing on the Mastra server (`mcp/`) finds a photo in a request
 * by the way the phone names it — "(photo photo3)" — which the agent copies from the message into what
 * it routes. A spelling changed on one side only builds, deploys, and then leaves every photo unlooked
 * at: the agent routes a name the routing does not recognise, or never learns that a note or a message
 * was about a photo at all. So the other sides are read as text, as `take-photo.contract.spec.ts` reads
 * the Kotlin.
 */

const REPOSITORY = join(import.meta.dir, '..', '..');

function readSource(...relativePath: string[]): string {
  return readFileSync(join(REPOSITORY, ...relativePath), 'utf8');
}

describe('the photo the phone names, and the routing that looks for it', () => {
  it('is named the way the routing planner names a photo in a request', () => {
    const planner = readSource('mcp', 'mastra', 'verticals', 'routing', 'planner.ts');

    expect(planner).toContain('(photo photo3)');
    expect(photoSent('photo3')).toContain('(photo photo3)');
  });
});

describe('the messages, and the prompt that says what to do with them', () => {
  const prompt = readSource('elevenlabs', 'src', 'assets', 'agent-prompt.md');

  it('quotes the message a photo arrives in, word for word', () => {
    // Quoted without the full stop that ends the message, as a sentence of the prompt's own.
    expect(prompt).toContain(photoSent('photo3').replace(/\.$/, ''));
  });

  it('knows a device with a camera button by the note that says so', () => {
    // The prompt counts photos as possible only where it has heard this, and sends sir to his phone
    // otherwise — so it has to recognise the note as that.
    expect(CAMERA_BUTTON_HERE).toContain('camera button');
    expect(prompt).toMatch(/camera button/i);
  });

  it('knows an open camera by the note that says so, and waits on it rather than hanging up', () => {
    expect(CAMERA_OPENED).toContain('opened the camera');
    expect(prompt).toMatch(/opened it|opened the camera/);
    expect(prompt).toContain('never `end_call`');
  });
});
