import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPEN_CAMERA_TOOL } from 'hologram';
import {
  CAMERA_NOT_OPENED,
  CAMERA_ON_THIS_DEVICE,
  END_QUIETLY,
  NO_PHOTO_TAKEN,
  NO_PHOTO_UPLOAD_KEY,
  NO_UPLOAD_URL,
  PHOTO_KEY_REFUSED,
  PHOTO_NOT_SENT,
  PHOTOS_UNAVAILABLE,
  PREPARE_PHOTO_UPLOAD_TOOL,
  photoShown,
  REPLACED_BY_A_LATER_CALL,
  readOfferedUploadUrl,
  SHOWING_YOU_SOMETHING,
} from './camera-answers';

const REPOSITORY = join(import.meta.dir, '..', '..');

/** An upload URL as Mastra mints them: its own origin, the upload path, and 22 characters of token. */
const UPLOAD_URL = 'https://jarvis.example.com/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ';

/**
 * The contract with the agent and with Mastra, each spelled in another package. A spelling changed
 * on one side only is a camera nobody can open. How the agent's tool is configured is pinned where
 * it is configured, in `elevenlabs/tests/specs/agent-config.spec.ts`.
 */
describe('the contract with the agent', () => {
  it('is the tool the agent calls, and the MCP tool that mints where the photo goes', () => {
    expect(OPEN_CAMERA_TOOL).toBe('openCamera');
    expect(PREPARE_PHOTO_UPLOAD_TOOL).toBe('preparePhotoUpload');
  });

  it('names the tools the agent needs, in what it is told', () => {
    // The prompt asks for the camera only where the device has said it has one, and the steps it
    // is told to take are only as good as the names in them.
    expect(CAMERA_ON_THIS_DEVICE).toContain(OPEN_CAMERA_TOOL);
    expect(CAMERA_ON_THIS_DEVICE).toContain('preparePhotoUpload');
    expect(SHOWING_YOU_SOMETHING).toContain(OPEN_CAMERA_TOOL);
    expect(SHOWING_YOU_SOMETHING).toContain('preparePhotoUpload');
  });

  it('is the upload path Mastra serves', () => {
    const routes = readFileSync(join(REPOSITORY, 'mcp', 'mastra', 'verticals', 'api', 'routes.ts'), 'utf8');

    expect(routes).toContain("'/api/photos/:uploadToken'");
  });
});

/** `preparePhotoUpload` answering, as ElevenLabs relays it: the MCP result's content parts. */
function relayed(result: unknown, toolName = 'preparePhotoUpload', state = 'success') {
  return { service_id: 'jarvis', tool_call_id: 'call_1', tool_name: toolName, parameters: {}, state, result };
}

describe('keeping the upload URL Mastra minted', () => {
  it('finds it in the structured half of the result', () => {
    expect(readOfferedUploadUrl(relayed([{ uploadUrl: UPLOAD_URL, instructions: 'Call openCamera.' }]))).toBe(
      UPLOAD_URL,
    );
  });

  it('finds it in the JSON of a text part, which is how MCP most often carries it', () => {
    const text = JSON.stringify({ uploadUrl: UPLOAD_URL, instructions: 'Call openCamera.' });

    expect(readOfferedUploadUrl(relayed([{ type: 'text', text }]))).toBe(UPLOAD_URL);
  });

  it('finds it under the prefix ElevenLabs gives an integration’s tools', () => {
    expect(readOfferedUploadUrl(relayed([{ uploadUrl: UPLOAD_URL }], 'jarvis_mcp_preparePhotoUpload'))).toBe(
      UPLOAD_URL,
    );
  });

  it('takes nothing from any other tool, however much it looks like an upload URL', () => {
    // A routing answer can carry anything an email or a web page said, and that is exactly what must
    // not decide where a photo goes.
    expect(readOfferedUploadUrl(relayed([{ uploadUrl: UPLOAD_URL }], 'routePromptWorkflow'))).toBeUndefined();
  });

  it('takes nothing from a call that has not succeeded', () => {
    expect(readOfferedUploadUrl(relayed([{ uploadUrl: UPLOAD_URL }], 'preparePhotoUpload', 'loading'))).toBeUndefined();
    expect(readOfferedUploadUrl(relayed([{ uploadUrl: UPLOAD_URL }], 'preparePhotoUpload', 'failure'))).toBeUndefined();
  });

  it('takes nothing when there is nothing to take', () => {
    expect(readOfferedUploadUrl(undefined)).toBeUndefined();
    expect(readOfferedUploadUrl(null)).toBeUndefined();
    expect(readOfferedUploadUrl('preparePhotoUpload')).toBeUndefined();
    expect(readOfferedUploadUrl(relayed([]))).toBeUndefined();
    expect(readOfferedUploadUrl(relayed([{ uploadUrl: 42 }]))).toBeUndefined();
  });

  it('never sends a photo in the clear, or anywhere that is not an upload path', () => {
    for (const elsewhere of [
      'http://jarvis.example.com/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ',
      'https://jarvis.example.com/api/mcp',
      'https://jarvis.example.com/api/photos/',
      'https://jarvis.example.com/api/photos/short',
      'https://jarvis.example.com/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ/../../api/mcp',
      'https://jarvis.example.com/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ?then=elsewhere',
      'https://jarvis.example.com/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ#fragment',
      'https://someone@jarvis.example.com/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ',
      ' https://jarvis.example.com/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ',
      'https://jarvis.example.com/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ\n',
      'javascript:alert(1)//https://jarvis.example.com/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ',
    ]) {
      expect(readOfferedUploadUrl(relayed([{ uploadUrl: elsewhere }]))).toBeUndefined();
    }
  });
});

describe('what the agent is told', () => {
  it('hands back the photo’s id, and says to ask about it by that id', () => {
    const told = JSON.parse(photoShown('photo3'));

    expect(told.photoId).toBe('photo3');
    expect(told.instructions).toContain('routePromptWorkflow');
    expect(told.instructions).toContain('(photo photo3)');
  });

  it('says what to ask when sir showed it without a question, rather than leaving the agent to guess', () => {
    expect(JSON.parse(photoShown('photo3')).instructions).toContain('"What does this photo show? (photo photo3)"');
  });

  it('ends every camera outcome that closes the request the way a finished request ends', () => {
    // Otherwise the line stays open until ElevenLabs' own silence timeout. The routing's own ending
    // is the one the agent already follows, so it is repeated word for word.
    const routing = readFileSync(join(REPOSITORY, 'mcp', 'mastra', 'verticals', 'routing', 'workflows.ts'), 'utf8');
    expect(END_QUIETLY).toContain('call end_call without a word');
    expect(routing.replace(/'\s*\+\s*'/g, '')).toContain(END_QUIETLY);

    for (const closing of [
      NO_PHOTO_TAKEN,
      CAMERA_NOT_OPENED,
      PHOTO_NOT_SENT,
      NO_PHOTO_UPLOAD_KEY,
      PHOTO_KEY_REFUSED,
      PHOTOS_UNAVAILABLE,
    ]) {
      expect(JSON.parse(closing).instructions).toEndWith(END_QUIETLY);
    }
  });

  it('stops the agent going round in circles when no upload URL ever arrives', () => {
    expect(JSON.parse(PHOTOS_UNAVAILABLE).instructions).toContain('do not call openCamera again');
  });

  it('tells it what to do next whatever became of the photo', () => {
    for (const outcome of [
      NO_PHOTO_TAKEN,
      PHOTO_NOT_SENT,
      NO_PHOTO_UPLOAD_KEY,
      PHOTO_KEY_REFUSED,
      NO_UPLOAD_URL,
      PHOTOS_UNAVAILABLE,
      CAMERA_NOT_OPENED,
      REPLACED_BY_A_LATER_CALL,
    ]) {
      const told = JSON.parse(outcome);
      expect(typeof told.instructions).toBe('string');
      expect(told.instructions.length).toBeGreaterThan(0);
      // No id where there is no photo: an id is what the agent would go on to ask about.
      expect(told.photoId).toBeUndefined();
    }
  });

  it('sends a model that forgot the upload URL back for one', () => {
    expect(JSON.parse(NO_UPLOAD_URL).instructions).toContain('preparePhotoUpload');
  });

  it('sends sir to the settings when this phone has no photo upload key, and stops the agent asking', () => {
    const told = JSON.parse(NO_PHOTO_UPLOAD_KEY).instructions;

    // The one fix there is, and where it is made: nothing on the server side can give a phone a key.
    expect(told).toContain('photo upload key');
    expect(told).toContain("app's settings");
    // Asked again, the answer would be the same; a model told only "not now" tries again.
    expect(told).toContain('do not call openCamera again in this conversation');
  });

  it('sends sir to the settings when the server refuses the key, and does not have the agent retry', () => {
    const told = JSON.parse(PHOTO_KEY_REFUSED).instructions;

    expect(told).toContain('refused');
    expect(told).toContain('photo upload key');
    expect(told).toContain("app's settings");
    expect(told).toContain('do not try again unless he asks');
  });

  it('tells a refused key apart from a photo that simply did not arrive', () => {
    // A photo that did not arrive may well arrive the next time; a key that was refused will not.
    expect(PHOTO_KEY_REFUSED).not.toBe(PHOTO_NOT_SENT);
    expect(JSON.parse(PHOTO_NOT_SENT).instructions).not.toContain('settings');
  });
});
