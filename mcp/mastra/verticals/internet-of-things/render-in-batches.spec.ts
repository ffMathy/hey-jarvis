import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { z } from 'zod';
import { callHomeAssistantApi, renderInBatches, TemplateOutputTooLargeError } from './tools';

/**
 * What Home Assistant answers a template that renders too much output with: a 400 whose JSON body
 * carries the `TemplateError` the way `HomeAssistantView.json_message` writes it, with no code.
 */
const OVERFLOW_BODY = {
  message: 'Error rendering template: Template output exceeded maximum size of 262144 characters',
};

const HOME_ASSISTANT_ENV = ['HEY_JARVIS_HOME_ASSISTANT_URL', 'HEY_JARVIS_HOME_ASSISTANT_TOKEN'] as const;

const templateRequestSchema = z.object({ template: z.string() });
const batchSchema = z.array(z.number());

/** A refusal from Home Assistant's template endpoint, shaped as it sends one. */
function templateRefusal(body: { message: string }): Response {
  return new Response(JSON.stringify(body), {
    status: 400,
    statusText: 'Bad Request',
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Fakes Home Assistant's `template` endpoint at `fetch`, overflowing on any template that renders
 * more than `largestBatchThatFits` items. Each template is its batch as JSON, so it renders to itself.
 */
function fakeTemplateEndpoint(largestBatchThatFits: number) {
  return spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const { template } = templateRequestSchema.parse(JSON.parse(String(init?.body)));
        if (batchSchema.parse(JSON.parse(template)).length > largestBatchThatFits) {
          return templateRefusal(OVERFLOW_BODY);
        }
        return new Response(template, { headers: { 'content-type': 'text/plain' } });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
}

/** Renders a batch through the real Home Assistant client, the way the device tools do. */
async function renderThroughHomeAssistant(batch: number[]): Promise<number[]> {
  return batchSchema.parse(await callHomeAssistantApi('template', 'POST', { template: JSON.stringify(batch) }));
}

const saved = new Map<string, string | undefined>();
let restoreFetch: (() => void) | undefined;

beforeEach(() => {
  for (const name of HOME_ASSISTANT_ENV) {
    saved.set(name, process.env[name]);
  }
  process.env.HEY_JARVIS_HOME_ASSISTANT_URL = 'http://home-assistant.test';
  process.env.HEY_JARVIS_HOME_ASSISTANT_TOKEN = 'test-token';
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  for (const name of HOME_ASSISTANT_ENV) {
    const value = saved.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('callHomeAssistantApi on a refused template', () => {
  it('throws a TemplateOutputTooLargeError when the output was too large', async () => {
    const fetchSpy = fakeTemplateEndpoint(2);
    restoreFetch = () => fetchSpy.mockRestore();

    await expect(renderThroughHomeAssistant([0, 1, 2])).rejects.toBeInstanceOf(TemplateOutputTooLargeError);
  });

  it('throws a plain error when the template failed for any other reason', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async () => templateRefusal({ message: "Error rendering template: UndefinedError: 'x' is undefined" }),
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    restoreFetch = () => fetchSpy.mockRestore();

    const failure = await renderThroughHomeAssistant([0]).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(TemplateOutputTooLargeError);
  });
});

describe('renderInBatches', () => {
  it('returns an empty result for no items without calling render', async () => {
    let calls = 0;
    const result = await renderInBatches([], 25, async (batch) => {
      calls++;
      return batch;
    });

    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it('splits items into batches of the requested size and preserves order', async () => {
    const sizes: number[] = [];
    const items = Array.from({ length: 7 }, (_, i) => i);

    const result = await renderInBatches(items, 3, async (batch) => {
      sizes.push(batch.length);
      return batch;
    });

    expect(sizes).toEqual([3, 3, 1]);
    expect(result).toEqual(items);
  });

  it('renders several batches at once, but never more than asked, and keeps their order', async () => {
    let inFlight = 0;
    let mostInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    const result = await renderInBatches(
      items,
      2,
      async (batch) => {
        inFlight++;
        mostInFlight = Math.max(mostInFlight, inFlight);
        // Later batches finish first, so an order kept by accident would show.
        await Bun.sleep(10 - batch[0]);
        inFlight--;
        return batch;
      },
      3,
    );

    expect(result).toEqual(items);
    expect(mostInFlight).toBe(3);
  });

  it('halves a batch that overflows and still returns every item in order', async () => {
    const fetchSpy = fakeTemplateEndpoint(2);
    restoreFetch = () => fetchSpy.mockRestore();
    const attempted: number[][] = [];
    const items = Array.from({ length: 4 }, (_, i) => i);

    const result = await renderInBatches(items, 4, async (batch) => {
      attempted.push([...batch]);
      return await renderThroughHomeAssistant(batch);
    });

    expect(result).toEqual(items);
    expect(attempted).toEqual([
      [0, 1, 2, 3],
      [0, 1],
      [2, 3],
    ]);
  });

  it('keeps halving until each batch fits', async () => {
    const fetchSpy = fakeTemplateEndpoint(1);
    restoreFetch = () => fetchSpy.mockRestore();
    const items = Array.from({ length: 8 }, (_, i) => i);

    const result = await renderInBatches(items, 8, renderThroughHomeAssistant);

    expect(result).toEqual(items);
    // 8, then 4 + 4, then four 2s, then eight 1s.
    expect(fetchSpy).toHaveBeenCalledTimes(15);
  });

  it('rethrows an overflow that a single item cannot escape', async () => {
    const fetchSpy = fakeTemplateEndpoint(0);
    restoreFetch = () => fetchSpy.mockRestore();

    await expect(renderInBatches([1, 2], 2, renderThroughHomeAssistant)).rejects.toBeInstanceOf(
      TemplateOutputTooLargeError,
    );
  });

  it('splits on the error class, not on what the message says', async () => {
    let calls = 0;

    await expect(
      renderInBatches([1, 2, 3, 4], 4, async () => {
        calls++;
        throw new Error(OVERFLOW_BODY.message);
      }),
    ).rejects.toThrow(OVERFLOW_BODY.message);

    expect(calls).toBe(1);
  });

  it('does not split on unrelated errors', async () => {
    let calls = 0;

    await expect(
      renderInBatches([1, 2, 3, 4], 4, async () => {
        calls++;
        throw new Error('Home Assistant API error: Unauthorized');
      }),
    ).rejects.toThrow('Unauthorized');

    expect(calls).toBe(1);
  });
});
