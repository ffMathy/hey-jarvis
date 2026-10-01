/**
 * The files the wake word needs at runtime, and where they are.
 *
 * All from the site itself, relative to the page: the app is served under /hey-jarvis/vr/
 * on GitHub Pages, so a URL built from the domain root would 404 there (the phone's first
 * published page drew everything but Jarvis for exactly that reason). `vendor/` is filled by
 * `turbo initialize` from the locked onnxruntime-web; `models/` is committed.
 */

export interface WakeDownload {
  /** Absolute URL. */
  url: string;
  /** The file's size, which weights it in the progress bar when the response does not say. */
  expectedBytes: number;
}

export interface WakeAssets {
  /** Absolute URL of `vendor/`, which holds onnxruntime-web's Emscripten glue. */
  runtimeFolder: string;
  runtime: WakeDownload;
  melspectrogram: WakeDownload;
  embedding: WakeDownload;
  wakeWord: WakeDownload;
}

/** The folder, under the site, that holds onnxruntime-web's runtime. */
export const RUNTIME_FOLDER = 'vendor/';

/**
 * Each file's path under the site and its size in bytes. The models' sizes are the committed
 * files' (their hashes are pinned by `models.spec.ts`); the runtime's is onnxruntime-web
 * 1.30.0's `ort-wasm-simd-threaded.wasm`, and only ever weights the progress bar, so a new
 * version with a different size costs nothing but a slightly uneven bar until it is updated
 * (`wake-assets.spec.ts` says when).
 */
export const WAKE_FILES = {
  runtime: { path: `${RUNTIME_FOLDER}ort-wasm-simd-threaded.wasm`, bytes: 14239897 },
  melspectrogram: { path: 'models/melspectrogram.onnx', bytes: 1087958 },
  embedding: { path: 'models/embedding_model.onnx', bytes: 1326578 },
  wakeWord: { path: 'models/hey_jarvis_v0.1.onnx', bytes: 1271370 },
} as const;

function download(file: { path: string; bytes: number }, assetBase: string): WakeDownload {
  return { url: new URL(file.path, assetBase).href, expectedBytes: file.bytes };
}

/** Every file's absolute URL under `assetBase`, the folder the page is served from. */
export function wakeAssets(assetBase: string): WakeAssets {
  return {
    runtimeFolder: new URL(RUNTIME_FOLDER, assetBase).href,
    runtime: download(WAKE_FILES.runtime, assetBase),
    melspectrogram: download(WAKE_FILES.melspectrogram, assetBase),
    embedding: download(WAKE_FILES.embedding, assetBase),
    wakeWord: download(WAKE_FILES.wakeWord, assetBase),
  };
}
