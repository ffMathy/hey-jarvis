import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { Server } from 'node:http';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import { MCPClient, MCPServer } from '@mastra/mcp';
import express from 'express';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { createAgent } from '../../utils/agent-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import { PHOTO_READER_AGENT_ID } from './agents.js';
import { claimUploadSlot, findPhoto, forgetPhotos, keepPhoto } from './photos.js';
import {
  lookAtPhoto,
  NO_PHOTO_TO_LOOK_AT,
  OPEN_CAMERA_TOOL,
  PHOTO_UPLOAD_READY,
  PHOTO_UPLOAD_UNAVAILABLE,
  preparePhotoUpload,
  publicOrigin,
} from './tools.js';

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

beforeEach(() => {
  forgetPhotos();
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
    const result = await callTool({ 'x-forwarded-host': 'jarvis.example.com', 'x-forwarded-proto': 'https' });

    expect(result).toMatchObject({ instructions: PHOTO_UPLOAD_READY });
    const uploadUrl = Reflect.get(Object(result), 'uploadUrl');
    expect(uploadUrl).toMatch(WHAT_THE_PHONE_ACCEPTS);
    expect(uploadUrl).toStartWith('https://jarvis.example.com/api/photos/');
  }, 15_000);

  it('opens the slot the URL names, for one photo', async () => {
    const result = await callTool({ 'x-forwarded-host': 'jarvis.example.com', 'x-forwarded-proto': 'https' });

    const uploadUrlParts = String(Reflect.get(Object(result), 'uploadUrl')).split('/');
    const uploadToken = uploadUrlParts[uploadUrlParts.length - 1] ?? '';
    expect(claimUploadSlot(uploadToken)).toBe(true);
    expect(claimUploadSlot(uploadToken)).toBe(false);
  }, 15_000);
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
});

describe('looking at a photo', () => {
  /** The photo reader on a scripted model, registered where `lookAtPhoto` looks for it. */
  async function readerAnswering(text: string) {
    const scripted = createScriptedModel(() => ({ text }));
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
});
