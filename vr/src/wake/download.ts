import type { WakeDownload } from './wake-assets';

/**
 * Several files downloaded at once, with one progress fraction for all of them.
 *
 * The wake word is 17 MB — 14 of them onnxruntime-web's wasm — and the 2D page shows it loading
 * on its primary button, so the worker fetches the files itself rather than letting
 * onnxruntime-web fetch its own wasm out of sight. Each file weighs in by its size. A response's
 * Content-Length is used when it describes the bytes the body will yield; a compressed response's
 * describes the compressed bytes instead, so there the file's known size stands in.
 */

export type Fetcher = (url: string) => Promise<Response>;

/** The file name at the end of a URL, for messages. */
function fileName(url: string) {
  return new URL(url).pathname.split('/').at(-1) ?? url;
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** How many bytes the body of `response` will yield, as far as the response can tell. */
export function bodyBytes(response: Response, fallback: number) {
  const length = Number(response.headers.get('content-length'));
  const encoded = response.headers.has('content-encoding');
  return !encoded && Number.isInteger(length) && length > 0 ? length : fallback;
}

async function readBody(response: Response, onBytes: (received: number) => void) {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onBytes(bytes.length);
    return bytes;
  }
  const parts: Uint8Array[] = [];
  let received = 0;
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    parts.push(part.value);
    received += part.value.length;
    onBytes(received);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

async function fetchOne(download: WakeDownload, fetcher: Fetcher, onFraction: (fraction: number) => void) {
  let response: Response;
  try {
    response = await fetcher(download.url);
  } catch (error) {
    throw new Error(`${fileName(download.url)} could not be downloaded: ${describe(error)}`);
  }
  if (!response.ok) {
    throw new Error(`${fileName(download.url)} could not be downloaded (HTTP ${response.status}).`);
  }
  const total = bodyBytes(response, download.expectedBytes);
  const bytes = await readBody(response, (received) => onFraction(Math.min(1, received / total)));
  onFraction(1);
  return bytes;
}

/** Downloads every file in parallel; `onProgress` gets the weighted fraction of all of them. */
export async function downloadAll(
  downloads: WakeDownload[],
  fetcher: Fetcher,
  onProgress: (fraction: number) => void,
): Promise<Uint8Array[]> {
  const totalWeight = downloads.reduce((sum, download) => sum + download.expectedBytes, 0);
  const fractions = downloads.map(() => 0);
  let reported = -1;
  function report() {
    const done = downloads.reduce((sum, download, index) => sum + download.expectedBytes * fractions[index], 0);
    const fraction = totalWeight > 0 ? done / totalWeight : 1;
    // Only forward: the page's bar never moves back, and a message per network packet that does
    // not move it by a thousandth is noise between threads.
    if (fraction - reported >= 0.001 || (fraction === 1 && reported < 1)) {
      reported = fraction;
      onProgress(fraction);
    }
  }
  return Promise.all(
    downloads.map((download, index) =>
      fetchOne(download, fetcher, (fraction) => {
        fractions[index] = fraction;
        report();
      }),
    ),
  );
}
