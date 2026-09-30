/**
 * The photo filter on the trace pipeline.
 *
 * The end-to-end case is the one that matters: without the filter, the span of a model call that is
 * shown a photo records it as a `data:image/jpeg;base64,...` string of up to 128 KB, and traces are
 * written to disk. It runs a real Mastra with real observability, a model that plays a script, and an
 * exporter that keeps what it is handed, so it holds the filter to the span shapes Mastra actually
 * produces rather than to the ones this file guesses at.
 */

import { describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import type { ObservabilityExporter, TracingEvent } from '@mastra/core/observability';
import { Observability, SamplingStrategyType } from '@mastra/observability';
import { createScriptedModel } from '../../tests/utils/scripted-model.js';
import { PHOTO_LEFT_OUT, PhotoSpanFilter, withoutPhotoData } from './photo-span-filter.js';

describe('withoutPhotoData', () => {
  it("replaces an image's data URL wherever it is", () => {
    expect(
      withoutPhotoData({ messages: [{ role: 'user', content: ['data:image/jpeg;base64,/9j/4AAQ', 'What is it?'] }] }),
    ).toEqual({ messages: [{ role: 'user', content: [PHOTO_LEFT_OUT, 'What is it?'] }] });
  });

  it("replaces the data of a part whose media type is an image, and keeps the part's other fields", () => {
    expect(withoutPhotoData({ type: 'file', mediaType: 'image/jpeg', data: '/9j/4AAQSkZJRg' })).toEqual({
      type: 'file',
      mediaType: 'image/jpeg',
      data: PHOTO_LEFT_OUT,
    });
    expect(withoutPhotoData({ type: 'image', mediaType: 'image/png', image: 'iVBORw0KGgo' })).toEqual({
      type: 'image',
      mediaType: 'image/png',
      image: PHOTO_LEFT_OUT,
    });
  });

  it('leaves the data of anything that is not an image', () => {
    const pdf = { type: 'file', mediaType: 'application/pdf', data: 'JVBERi0xLjQ' };
    expect(withoutPhotoData(pdf)).toBe(pdf);
  });

  it('hands back a value with no photo in it untouched, not a copy', () => {
    const input = { messages: [{ role: 'user', content: 'What is the weather?' }], at: new Date(0) };
    expect(withoutPhotoData(input)).toBe(input);
  });

  it('leaves bytes to the trace serializer, which never keeps them', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(withoutPhotoData({ type: 'image', mediaType: 'image/jpeg', image: bytes })).toEqual({
      type: 'image',
      mediaType: 'image/jpeg',
      image: bytes,
    });
  });
});

describe('PhotoSpanFilter on a real trace', () => {
  /** Runs one model call that is shown a photo, and returns every ended span's input as JSON. */
  async function spanInputsOfLookingAtAPhoto(spanOutputProcessors: PhotoSpanFilter[]): Promise<string[]> {
    const inputs: string[] = [];
    const exporter: ObservabilityExporter = {
      name: 'keeps-what-it-is-handed',
      init: () => {},
      exportTracingEvent: async (event: TracingEvent) => {
        if (event.type === 'span_ended') {
          inputs.push(JSON.stringify(event.exportedSpan.input ?? null));
        }
      },
      shutdown: async () => {},
    };
    const reader = new Agent({
      id: 'photo-reader',
      name: 'photo-reader',
      instructions: 'Read the photo.',
      model: createScriptedModel(() => ({ text: 'A receipt.' })).model,
    });
    const mastra = new Mastra({
      agents: { reader },
      observability: new Observability({
        configs: {
          default: {
            serviceName: 'photo-span-filter-spec',
            sampling: { type: SamplingStrategyType.ALWAYS },
            exporters: [exporter],
            spanOutputProcessors,
          },
        },
      }),
    });

    await mastra.getAgentById('photo-reader').generate([
      {
        role: 'user',
        content: [
          { type: 'image', image: Buffer.alloc(20_000, 7), mediaType: 'image/jpeg' },
          { type: 'text', text: 'What is the total on this receipt?' },
        ],
      },
    ]);
    await mastra.shutdown();
    return inputs;
  }

  /** A run of base64 long enough to be a photo rather than a word. */
  const PHOTO_BYTES = /[A-Za-z0-9+/]{1000,}/;

  it('would keep the photo without the filter, so the case below is not passing for nothing', async () => {
    const inputs = await spanInputsOfLookingAtAPhoto([]);
    expect(inputs.some((input) => PHOTO_BYTES.test(input))).toBe(true);
  });

  it('keeps the photo out of every span, and the question in', async () => {
    const inputs = await spanInputsOfLookingAtAPhoto([new PhotoSpanFilter()]);

    expect(inputs.filter((input) => PHOTO_BYTES.test(input))).toEqual([]);
    expect(inputs.some((input) => input.includes(PHOTO_LEFT_OUT))).toBe(true);
    expect(inputs.some((input) => input.includes('What is the total on this receipt?'))).toBe(true);
  });
});
