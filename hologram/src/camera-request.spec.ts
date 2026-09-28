import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CAMERA_NOT_OPENED,
  CAMERA_ON_THIS_DEVICE,
  NO_CAMERA_HERE,
  NO_PHOTO_TAKEN,
  NO_UPLOAD_URL,
  OPEN_CAMERA_TOOL,
  PHOTO_NOT_SENT,
  PREPARE_PHOTO_UPLOAD_TOOL,
  photoShown,
  REPLACED_BY_A_LATER_CALL,
  readOfferedUploadUrl,
  SHOWING_YOU_SOMETHING,
} from './camera-request';

const REPOSITORY = join(import.meta.dir, '..', '..');

/** An upload URL as Mastra mints them: its own origin, the upload path, and 22 characters of token. */
const UPLOAD_URL = 'https://jarvis.example.com/api/photos/Q2hhbmdlIG1lIHBsZWFzZQ';

/** One value out of parsed JSON, followed key by key, or `undefined` wherever the path breaks. */
function readPath(value: unknown, keys: readonly string[]): unknown {
  return keys.reduce<unknown>(
    (current, key) => (typeof current === 'object' && current !== null ? Reflect.get(current, key) : undefined),
    value,
  );
}

/** The agent's client tool of this name, as the configuration deployed to ElevenLabs declares it. */
function configuredTool(name: string): unknown {
  const agent: unknown = JSON.parse(
    readFileSync(join(REPOSITORY, 'elevenlabs', 'src', 'assets', 'agent-config.json'), 'utf8'),
  );
  const tools = readPath(agent, ['conversationConfig', 'agent', 'prompt', 'tools']);
  if (!Array.isArray(tools)) {
    return undefined;
  }
  return tools.find((tool) => readPath(tool, ['type']) === 'client' && readPath(tool, ['name']) === name);
}

/**
 * The contract with the agent, which calls the tool by name, with a parameter by name, and is
 * configured in another package. A spelling changed on one side only is a camera nobody can open.
 */
describe('the contract with the agent', () => {
  it('is the tool the agent calls, and the MCP tool that mints where the photo goes', () => {
    expect(OPEN_CAMERA_TOOL).toBe('openCamera');
    expect(PREPARE_PHOTO_UPLOAD_TOOL).toBe('preparePhotoUpload');
  });

  it('is configured to wait for the photo, for as long as ElevenLabs allows', () => {
    const tool = configuredTool(OPEN_CAMERA_TOOL);

    expect(readPath(tool, ['expectsResponse'])).toBe(true);
    // Framing a shot, taking it and sending it all happen inside this: 120 is the ceiling.
    expect(readPath(tool, ['responseTimeoutSecs'])).toBe(120);
  });

  it('asks the model for nothing, so there is nothing it can be talked into sending', () => {
    expect(readPath(configuredTool(OPEN_CAMERA_TOOL), ['parameters', 'properties'])).toEqual({});
  });

  it('is sent the MCP results the upload URL arrives in', () => {
    const agent: unknown = JSON.parse(
      readFileSync(join(REPOSITORY, 'elevenlabs', 'src', 'assets', 'agent-config.json'), 'utf8'),
    );

    expect(readPath(agent, ['conversationConfig', 'conversation', 'clientEvents'])).toContain('mcp_tool_call');
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

  it('tells it what to do next whatever became of the photo', () => {
    for (const outcome of [
      NO_PHOTO_TAKEN,
      PHOTO_NOT_SENT,
      NO_UPLOAD_URL,
      NO_CAMERA_HERE,
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
});
