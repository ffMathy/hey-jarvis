import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { createAgent } from '../../utils/agent-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import { PHOTO_READER_AGENT_ID } from './agents.js';
import { findPhoto, forgetPhotos, keepPhoto, photosWaiting } from './photos.js';
import { lookAtPhoto, NO_PHOTO_TO_LOOK_AT } from './tools.js';

beforeEach(() => {
  forgetPhotos();
});

afterEach(() => {
  // The store is the process's: a photo left waiting would be brought up by another file's requests.
  forgetPhotos();
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

  /**
   * A look is stopped with the request that asked for it: one still in flight when sir talks over that
   * request is working for a reply nobody will hear. So the reader is handed the request's own abort
   * signal, which a provider gives up on when it fires — and nothing else in the suite would notice
   * were that signal dropped, since the scripted readers never look at it.
   */
  it('hands the reader the signal the request that asked is stopped with', async () => {
    const handedSignals: (AbortSignal | undefined)[] = [];
    const { mastra } = await readerPlaying(({ options }) => {
      handedSignals.push(options.abortSignal);
      return { text: 'The total is 243.50 DKK.' };
    });
    keepPhoto(Buffer.from([0xff, 0xd8]), 'image/jpeg');
    const request = new AbortController();

    await executeTool(
      lookAtPhoto,
      { photoId: 'photo1', question: 'What is the total?' },
      { mastra, abortSignal: request.signal },
    );

    expect(handedSignals).toHaveLength(1);
    expect(handedSignals[0]?.aborted).toBe(false);
    request.abort();
    expect(handedSignals[0]?.aborted).toBe(true);
  });

  it('marks nothing when there was no such photo to look at', async () => {
    const { mastra } = await readerAnswering('Anything.');
    keepPhoto(Buffer.from([0xff, 0xd8]), 'image/jpeg');

    const { answer } = await executeTool(lookAtPhoto, { photoId: 'photo9', question: 'What is it?' }, { mastra });

    expect(answer).toBe(NO_PHOTO_TO_LOOK_AT);
    expect(photosWaiting().map((photo) => photo.photoId)).toEqual(['photo1']);
  });
});
