import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { Server } from 'node:http';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import { MCPClient, MCPServer } from '@mastra/mcp';
import express from 'express';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { createAgent } from '../../utils/agent-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import { PHOTO_READER_AGENT_ID } from './agents.js';
import {
  claimUploadSlot,
  findPhoto,
  forgetPhotos,
  keepPhoto,
  MAX_OPEN_SLOTS,
  openUploadSlot,
  photosWaiting,
} from './photos.js';
import {
  lookAtPhoto,
  NO_PHOTO_TO_LOOK_AT,
  OPEN_CAMERA_TOOL,
  PHOTO_UPLOAD_READY,
  PHOTO_UPLOAD_UNAVAILABLE,
  PHOTO_UPLOADS_SWITCHED_OFF,
  preparePhotoUpload,
  publicOrigin,
} from './tools.js';
import { PHOTO_UPLOAD_KEY_VARIABLE } from './upload-key.js';

/**
 * The upload URL the phone will send a photo to, as `camera-answers.ts` in `mobile` checks it.
 * Repeated here because this package cannot import that one; a URL this server mints that the
 * phone would refuse is a photo that never arrives.
 */
const WHAT_THE_PHONE_ACCEPTS = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/api\/photos\/[A-Za-z0-9_-]{16,64}$/;

/** An MCP tool call's context as far as the HTTP request it arrived on goes. */
function arrivedWith(headers: Record<string, string>) {
  return { http: { req: new Request('http://0.0.0.0:4112/api/mcp', { headers }) } };
}

/** A key long enough to count, for the tests that need uploads switched on. */
const PHOTO_UPLOAD_KEY = 'a-photo-upload-key-for-tests';

const environmentKeys = [PHOTO_UPLOAD_KEY_VARIABLE] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  forgetPhotos();
  for (const key of environmentKeys) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("this server's own address, as the caller reached it", () => {
  it('is the host and scheme the tunnel says the client asked for', () => {
    expect(publicOrigin(arrivedWith({ host: 'jarvis.example.com', 'x-forwarded-proto': 'https' }))).toBe(
      'https://jarvis.example.com',
    );
  });

  it('prefers the forwarded host, and the first hop of a list', () => {
    const extra = arrivedWith({
      host: 'localhost:4112',
      'x-forwarded-host': 'jarvis.example.com, proxy.internal',
      'x-forwarded-proto': 'https, http',
    });

    expect(publicOrigin(extra)).toBe('https://jarvis.example.com');
  });

  it('is plain HTTP when nothing says the client spoke HTTPS', () => {
    expect(publicOrigin(arrivedWith({ host: 'localhost:4112' }))).toBe('http://localhost:4112');
  });

  it('is nothing when there was no HTTP request, or its host is not a host', () => {
    expect(publicOrigin(undefined)).toBeUndefined();
    expect(publicOrigin({})).toBeUndefined();
    expect(publicOrigin({ http: {} })).toBeUndefined();
    expect(publicOrigin(arrivedWith({ host: 'evil.example/api/mcp?' }))).toBeUndefined();
  });
});

/**
 * `preparePhotoUpload` as ElevenLabs calls it: over MCP, through an HTTP request whose headers are
 * the only place this server learns its own address. An in-process server on a free port, with
 * only this tool on it.
 */
describe('making somewhere for a photo to go', () => {
  let server: Server;
  let client: MCPClient;
  let callTool: (headers: Record<string, string>) => Promise<unknown>;

  beforeAll(async () => {
    const mcpServer = new MCPServer({ id: 'photos', name: 'photos', version: '1.0.0', tools: { preparePhotoUpload } });
    const app = express();
    app.all('/api/mcp', (request, response) => {
      const url = new URL(request.url || '', 'http://127.0.0.1');
      void mcpServer.startHTTP({ url, httpPath: '/api/mcp', req: request, res: response });
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected the MCP server to be listening on a TCP port');
    }

    callTool = async (headers) => {
      client = new MCPClient({
        id: `photos-${Object.values(headers).join('-')}`,
        servers: { photos: { url: new URL(`http://127.0.0.1:${address.port}/api/mcp`), requestInit: { headers } } },
      });
      const tools = await client.listTools();
      const tool = tools.photos_preparePhotoUpload;
      if (!tool) {
        throw new Error('preparePhotoUpload was not published');
      }
      const result = await executeTool(tool, {});
      await client.disconnect();
      return result;
    };
  });

  afterAll(async () => {
    await client?.disconnect();
    server.close();
  });

  it('hands back an upload URL on the host ElevenLabs called, which the phone will send to', async () => {
    process.env[PHOTO_UPLOAD_KEY_VARIABLE] = PHOTO_UPLOAD_KEY;

    const result = await callTool({ 'x-forwarded-host': 'jarvis.example.com', 'x-forwarded-proto': 'https' });

    expect(result).toMatchObject({ instructions: PHOTO_UPLOAD_READY });
    const uploadUrl = Reflect.get(Object(result), 'uploadUrl');
    expect(uploadUrl).toMatch(WHAT_THE_PHONE_ACCEPTS);
    expect(uploadUrl).toStartWith('https://jarvis.example.com/api/photos/');
  }, 15_000);

  it('opens the slot the URL names, for one photo', async () => {
    process.env[PHOTO_UPLOAD_KEY_VARIABLE] = PHOTO_UPLOAD_KEY;

    const result = await callTool({ 'x-forwarded-host': 'jarvis.example.com', 'x-forwarded-proto': 'https' });

    const uploadUrlParts = String(Reflect.get(Object(result), 'uploadUrl')).split('/');
    const uploadToken = uploadUrlParts[uploadUrlParts.length - 1] ?? '';
    expect(claimUploadSlot(uploadToken)).toBe(true);
    expect(claimUploadSlot(uploadToken)).toBe(false);
  }, 15_000);

  it('says photos are switched off, and opens no slot, when this server has no photo upload key', async () => {
    // Every slot there is room for, opened first: a slot opened now would let go of the oldest to
    // make room, so the oldest still being there is what says none was.
    const alreadyOpen = Array.from({ length: MAX_OPEN_SLOTS }, () => openUploadSlot().uploadToken);

    const result = await callTool({ 'x-forwarded-host': 'jarvis.example.com', 'x-forwarded-proto': 'https' });

    expect(result).toMatchObject({ instructions: PHOTO_UPLOADS_SWITCHED_OFF });
    expect(Reflect.get(Object(result), 'uploadUrl')).toBeUndefined();
    expect(claimUploadSlot(alreadyOpen[0] ?? '')).toBe(true);
  }, 15_000);
});

describe('asking about the key before the host', () => {
  it('says photos are switched off even when it cannot tell where it is, since no slot could be filled', async () => {
    expect(await executeTool(preparePhotoUpload, {})).toEqual({ instructions: PHOTO_UPLOADS_SWITCHED_OFF });
  });

  it('counts a key that is too short as none', async () => {
    process.env[PHOTO_UPLOAD_KEY_VARIABLE] = 'too-short';

    expect(await executeTool(preparePhotoUpload, {})).toEqual({ instructions: PHOTO_UPLOADS_SWITCHED_OFF });
  });

  it('asks where it is only once there is a key', async () => {
    process.env[PHOTO_UPLOAD_KEY_VARIABLE] = PHOTO_UPLOAD_KEY;

    expect(await executeTool(preparePhotoUpload, {})).toEqual({ instructions: PHOTO_UPLOAD_UNAVAILABLE });
  });
});

describe('what the voice agent is told', () => {
  it('names the camera tool, and says it takes nothing: the phone reads the URL itself', () => {
    expect(OPEN_CAMERA_TOOL).toBe('openCamera');
    expect(PHOTO_UPLOAD_READY).toContain(`call ${OPEN_CAMERA_TOOL}, with no parameters`);
    expect(PHOTO_UPLOAD_READY).toContain('routePromptWorkflow');
  });

  it('says so when this server cannot tell where it is', () => {
    expect(PHOTO_UPLOAD_UNAVAILABLE).not.toContain(OPEN_CAMERA_TOOL);
  });

  it('says so when this server takes no photos, without sending the agent on to the camera', () => {
    expect(PHOTO_UPLOADS_SWITCHED_OFF).toBe(
      'Photos cannot be sent to Jarvis: this server has no photo upload key. Tell sir in one short sentence.',
    );
    expect(PHOTO_UPLOADS_SWITCHED_OFF).not.toContain(OPEN_CAMERA_TOOL);
  });
});

describe('looking at a photo', () => {
  /** The photo reader on a scripted model, registered where `lookAtPhoto` looks for it. */
  async function readerAnswering(text: string) {
    return readerPlaying(() => ({ text }));
  }

  /** The photo reader playing whatever script it is given, which may be to fail. */
  async function readerPlaying(respond: Parameters<typeof createScriptedModel>[0]) {
    const scripted = createScriptedModel(respond);
    const mastra = new Mastra({
      storage: new InMemoryStore(),
      logger: false,
      agents: {
        [PHOTO_READER_AGENT_ID]: await createAgent({
          id: PHOTO_READER_AGENT_ID,
          name: PHOTO_READER_AGENT_ID,
          instructions: 'You read photos.',
          model: scripted.model,
          memory: undefined,
        }),
      },
    });
    return { mastra, calls: scripted.calls };
  }

  it('shows the photo itself to the reader, beside the question', async () => {
    const { mastra, calls } = await readerAnswering('The total is 243.50 DKK.');
    keepPhoto(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg');

    await executeTool(lookAtPhoto, { photoId: 'photo1', question: 'What is the total on this receipt?' }, { mastra });

    expect(calls).toHaveLength(1);
    // Each role's message holds its own kinds of part; all that matters here is whether one is the photo.
    const parts = (calls[0]?.options.prompt ?? []).flatMap((message): unknown[] =>
      typeof message.content === 'string' ? [] : message.content,
    );
    expect(parts).toContainEqual(expect.objectContaining({ type: 'file', mediaType: 'image/jpeg' }));
    expect(calls[0]?.transcript).toContain('What is the total on this receipt?');
  });

  it("hands back what the reader saw, quoted as the photo's content", async () => {
    const { mastra } = await readerAnswering('The total is 243.50 DKK.');
    keepPhoto(Buffer.from([0xff, 0xd8]), 'image/jpeg');

    const { answer } = await executeTool(lookAtPhoto, { question: 'What is the total?' }, { mastra });

    expect(answer).toBe('Photo photo1, taken just now, shows: «The total is 243.50 DKK.»');
  });

  it('says there is nothing to look at, without asking the reader, when no photo is kept', async () => {
    const { mastra, calls } = await readerAnswering('Anything.');

    const { answer } = await executeTool(lookAtPhoto, { photoId: 'photo1', question: 'What is it?' }, { mastra });

    expect(answer).toBe(NO_PHOTO_TO_LOOK_AT);
    expect(calls).toHaveLength(0);
    expect(findPhoto(undefined)).toBeUndefined();
  });

  /**
   * A photo nobody has looked at is brought up in a later conversation (`routing/waiting-photos.ts`),
   * so what counts as looking at it decides whether sir is asked about a photo he already had read.
   */
  it('stops the photo waiting once the reader has answered', async () => {
    const { mastra } = await readerAnswering('The total is 243.50 DKK.');
    keepPhoto(Buffer.from([0xff, 0xd8]), 'image/jpeg');
    keepPhoto(Buffer.from([0xff, 0xd8]), 'image/jpeg');

    await executeTool(lookAtPhoto, { photoId: 'Photo 1', question: 'What is the total?' }, { mastra });

    expect(photosWaiting().map((photo) => photo.photoId)).toEqual(['photo2']);
    expect(findPhoto('photo1')?.lookedAt).toBeNumber();
  });

  it('leaves the photo waiting when the reader failed, since sir has been told nothing about it', async () => {
    const { mastra, calls } = await readerPlaying(() => {
      throw new Error('The photo reader could not be reached.');
    });
    keepPhoto(Buffer.from([0xff, 0xd8]), 'image/jpeg');

    await expect(
      executeTool(lookAtPhoto, { photoId: 'photo1', question: 'What is it?' }, { mastra }),
    ).rejects.toThrow();

    expect(calls.length).toBeGreaterThan(0);
    expect(photosWaiting().map((photo) => photo.photoId)).toEqual(['photo1']);
  });

  it('marks nothing when there was no such photo to look at', async () => {
    const { mastra } = await readerAnswering('Anything.');
    keepPhoto(Buffer.from([0xff, 0xd8]), 'image/jpeg');

    const { answer } = await executeTool(lookAtPhoto, { photoId: 'photo9', question: 'What is it?' }, { mastra });

    expect(answer).toBe(NO_PHOTO_TO_LOOK_AT);
    expect(photosWaiting().map((photo) => photo.photoId)).toEqual(['photo1']);
  });
});
