import type { AnySpan, SpanOutputProcessor } from '@mastra/core/observability';

/** What a photo's bytes are replaced with in a trace. */
export const PHOTO_LEFT_OUT = '[photo left out of the trace]';

/** An image written into a string whole, as the model call's span records one. */
const IMAGE_DATA_URL = /^data:image\//i;

/** An object whose fields can be walked: not an array, and not bytes, which traces never keep anyway. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value);
}

/** An image part of a message: an AI SDK `file` or `image` part whose media type is an image. */
function isImagePart(value: Record<string, unknown>): boolean {
  return typeof value.mediaType === 'string' && value.mediaType.toLowerCase().startsWith('image/');
}

/**
 * The value with every image's bytes replaced by {@link PHOTO_LEFT_OUT}, and everything else as it was.
 *
 * Copies only what it changes, so a span with no image in it is handed back untouched.
 */
export function withoutPhotoData(value: unknown): unknown {
  if (typeof value === 'string') {
    return IMAGE_DATA_URL.test(value) ? PHOTO_LEFT_OUT : value;
  }
  if (Array.isArray(value)) {
    const items = value.map(withoutPhotoData);
    return items.some((item, index) => item !== value[index]) ? items : value;
  }
  if (!isRecord(value)) {
    return value;
  }

  const entries = Object.entries(value);
  const imagePart = isImagePart(value);
  const cleaned = entries.map(([key, field]): [string, unknown] =>
    imagePart && (key === 'data' || key === 'image') && typeof field === 'string'
      ? [key, PHOTO_LEFT_OUT]
      : [key, withoutPhotoData(field)],
  );
  return cleaned.some(([, field], index) => field !== entries[index]?.[1]) ? Object.fromEntries(cleaned) : value;
}

/**
 * Keeps the photos sir sends out of every trace.
 *
 * A photo is only ever held in the photo store's memory (`vision/photos.ts`), and the privacy policy
 * says it is never written down. But the span of the photo reader's model call records its input as
 * the model was sent it, with the photo base64-encoded into a `data:image/...` string, and traces go to
 * the SQL store on disk and, where configured, to Mastra Cloud. The question asked about the photo, and
 * everything else in the span, is left in: only the photo's bytes are taken out.
 */
export class PhotoSpanFilter implements SpanOutputProcessor {
  name = 'photo-span-filter';

  process(span?: AnySpan): AnySpan | undefined {
    if (!span) {
      return undefined;
    }
    span.input = withoutPhotoData(span.input);
    span.output = withoutPhotoData(span.output);
    return span;
  }

  async shutdown(): Promise<void> {
    // Holds nothing to let go of.
  }
}
