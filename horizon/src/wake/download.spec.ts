import { describe, expect, it } from 'bun:test';
import { statSync } from 'node:fs';
import path from 'node:path';
import { bodyBytes, downloadAll } from './download';
import { WAKE_FILES, wakeAssets } from './wake-assets';

/** A response whose body arrives in `parts` pieces of `size` bytes each. */
function streamedResponse(size: number, parts: number, headers: Record<string, string> = {}) {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === parts) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(size).fill(sent + 1));
      sent++;
    },
  });
  return new Response(body, { headers });
}

describe('the wake assets', () => {
  it('are found relative to the page, under the Pages sub-path', () => {
    const assets = wakeAssets('https://ffmathy.github.io/hey-jarvis/horizon/');
    expect(assets.runtimeFolder).toBe('https://ffmathy.github.io/hey-jarvis/horizon/vendor/');
    expect(assets.runtime.url).toBe('https://ffmathy.github.io/hey-jarvis/horizon/vendor/ort-wasm-simd-threaded.wasm');
    expect(assets.melspectrogram.url).toBe('https://ffmathy.github.io/hey-jarvis/horizon/models/melspectrogram.onnx');
    expect(assets.embedding.url).toBe('https://ffmathy.github.io/hey-jarvis/horizon/models/embedding_model.onnx');
    expect(assets.wakeWord.url).toBe('https://ffmathy.github.io/hey-jarvis/horizon/models/hey_jarvis_v0.1.onnx');
  });

  it('have the sizes of the committed models', () => {
    const models = path.join(import.meta.dir, '../../public');
    for (const file of [WAKE_FILES.melspectrogram, WAKE_FILES.embedding, WAKE_FILES.wakeWord]) {
      expect(statSync(path.join(models, file.path)).size).toBe(file.bytes);
    }
  });

  it('have the size of the locked onnxruntime-web’s wasm (update it with onnxruntime-web)', () => {
    const wasm = Bun.resolveSync('onnxruntime-web/ort-wasm-simd-threaded.wasm', import.meta.dir);
    expect(statSync(wasm).size).toBe(WAKE_FILES.runtime.bytes);
  });
});

describe('the size of a body', () => {
  it('is the Content-Length when the body is not compressed', () => {
    expect(bodyBytes(new Response('', { headers: { 'content-length': '1234' } }), 99)).toBe(1234);
  });

  it('is the known size when the response is compressed or does not say', () => {
    const compressed = new Response('', { headers: { 'content-length': '12', 'content-encoding': 'gzip' } });
    expect(bodyBytes(compressed, 99)).toBe(99);
    expect(bodyBytes(new Response(''), 99)).toBe(99);
  });
});

describe('downloading the wake assets', () => {
  it('returns every file’s bytes, in order', async () => {
    const bodies: Record<string, Response> = {
      'http://localhost/a': streamedResponse(3, 2),
      'http://localhost/b': new Response(new Uint8Array([9, 9])),
    };
    const files = await downloadAll(
      [
        { url: 'http://localhost/a', expectedBytes: 6 },
        { url: 'http://localhost/b', expectedBytes: 2 },
      ],
      async (url) => bodies[url],
      () => undefined,
    );
    expect(files.map((file) => Array.from(file))).toEqual([
      [1, 1, 1, 2, 2, 2],
      [9, 9],
    ]);
  });

  it('reports one fraction for all files, weighted by size, only ever forward, ending at 1', async () => {
    const fractions: number[] = [];
    // The small file answers only once the big one has arrived, so the steps are predictable.
    let bigArrived: () => void = () => undefined;
    const big = new Promise<void>((resolve) => {
      bigArrived = resolve;
    });
    await downloadAll(
      [
        { url: 'http://localhost/big', expectedBytes: 300 },
        { url: 'http://localhost/small', expectedBytes: 100 },
      ],
      async (url) => {
        if (url.endsWith('big')) return streamedResponse(100, 3);
        await big;
        return streamedResponse(50, 2);
      },
      (fraction) => {
        fractions.push(fraction);
        if (fraction >= 0.75) bigArrived();
      },
    );
    // Each third of the big file is a quarter of everything; each half of the small one an eighth.
    expect(fractions).toEqual([0.25, 0.5, 0.75, 0.875, 1]);
  });

  it('says which file failed and why', async () => {
    const missing = downloadAll(
      [{ url: 'http://localhost/hey-jarvis/horizon/models/melspectrogram.onnx', expectedBytes: 10 }],
      async () => new Response('Not found', { status: 404 }),
      () => undefined,
    );
    await expect(missing).rejects.toThrow('melspectrogram.onnx could not be downloaded (HTTP 404).');
    const offline = downloadAll(
      [{ url: 'http://localhost/vendor/ort-wasm-simd-threaded.wasm', expectedBytes: 10 }],
      async () => {
        throw new TypeError('Failed to fetch');
      },
      () => undefined,
    );
    await expect(offline).rejects.toThrow('ort-wasm-simd-threaded.wasm could not be downloaded: Failed to fetch');
  });
});
