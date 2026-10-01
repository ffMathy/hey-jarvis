import { downloadAll } from './download';
import { configureOrtRuntime, createOrtWakeModels } from './ort-models';
import { wakeAssets } from './wake-assets';
import { createWakeWorkerCore } from './wake-worker-core';
import { toWakeWorkerRequest } from './worker-protocol';

/**
 * The wake worker's entry: `wake-worker-core.ts` on onnxruntime-web, in a module worker.
 *
 * In a worker so the three graphs never run on the page's main thread, which draws the room at
 * the headset's frame rate; onnxruntime-web's own `proxy` worker would do the same but hides the
 * download from the progress bar and needs a script URL of its own.
 */

/** Of loading, the share that is downloading; creating the three sessions is the rest. */
const DOWNLOAD_SHARE = 0.9;

async function loadModels(assetBase: string, onProgress: (fraction: number) => void) {
  const assets = wakeAssets(assetBase);
  const [runtime, melspectrogram, embedding, wakeWord] = await downloadAll(
    [assets.runtime, assets.melspectrogram, assets.embedding, assets.wakeWord],
    (url) => fetch(url),
    (fraction) => onProgress(fraction * DOWNLOAD_SHARE),
  );
  configureOrtRuntime({ wasmPaths: assets.runtimeFolder, wasmBinary: runtime });
  const models = await createOrtWakeModels({ melspectrogram, embedding, wakeWord });
  onProgress(1);
  return models;
}

const core = createWakeWorkerCore({
  loadModels,
  post: (event) => self.postMessage(event),
  now: () => performance.now(),
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (handle) => clearInterval(handle),
});

self.addEventListener('message', (event) => {
  const request = toWakeWorkerRequest(event.data);
  if (request !== undefined) core.handle(request);
});
