/**
 * Laying text out for a panel in the room: wrapping it to a width, and sizing the panel to it.
 *
 * Measured by whatever `measure` says a string's width is — a 2D canvas's `measureText` in the app,
 * a character count in the tests — so the layout is plain arithmetic that can be pinned without a
 * canvas.
 */

/** A string's drawn width, in whatever unit the widths it is compared with are in. */
export type Measure = (text: string) => number;

/** The last line of a panel cut short, ending with this. */
export const ELLIPSIS = '…';

/**
 * Breaks a word too wide for a line into pieces that each fit, as many characters as will go.
 *
 * Only ever needed for something that is not really a word — a URL, an API key's prefix, a long
 * identifier in an error — but those are exactly what error panels show.
 */
function breakWord(word: string, maxWidth: number, measure: Measure): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const character of word) {
    if (piece && measure(piece + character) > maxWidth) {
      pieces.push(piece);
      piece = '';
    }
    piece += character;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** One paragraph wrapped greedily to `maxWidth`; an empty paragraph is one empty line. */
export function wrapParagraph(text: string, maxWidth: number, measure: Measure): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (measure(word) <= maxWidth) {
      line = word;
      continue;
    }
    const pieces = breakWord(word, maxWidth, measure);
    line = pieces.pop() ?? '';
    lines.push(...pieces);
  }
  lines.push(line);
  return lines;
}

/**
 * Cuts `lines` down to `maxLines`, ending the last one kept with an ellipsis that still fits.
 * Returned as they are when they already fit.
 */
export function truncateLines(
  lines: readonly string[],
  maxLines: number,
  maxWidth: number,
  measure: Measure,
): string[] {
  if (lines.length <= maxLines) return [...lines];
  const kept = lines.slice(0, Math.max(1, maxLines));
  let last = kept.pop() ?? '';
  while (last && measure(`${last}${ELLIPSIS}`) > maxWidth) last = last.slice(0, -1);
  kept.push(`${last.trimEnd()}${ELLIPSIS}`);
  return kept;
}

export interface PanelLayoutOptions {
  /** The widest the text may be. */
  maxWidth: number;
  measure: Measure;
  /** Height of one line. */
  lineHeight: number;
  /** Space around the text on every side. */
  padding: number;
  /** The most lines shown; the rest is cut with an ellipsis. */
  maxLines?: number;
  /** Whether the panel narrows to its text (a short hint) or always spans `maxWidth` (a HUD). */
  fitToText?: boolean;
}

export interface PanelLayout {
  lines: string[];
  /** The panel's size, padding included, in the unit of `maxWidth`. */
  width: number;
  height: number;
}

/** Wraps each paragraph of `paragraphs` and sizes the panel around the result. */
export function layoutPanel(paragraphs: readonly string[], options: PanelLayoutOptions): PanelLayout {
  const { maxWidth, measure, lineHeight, padding, maxLines = Number.POSITIVE_INFINITY, fitToText = true } = options;
  const wrapped = paragraphs.flatMap((paragraph) => wrapParagraph(paragraph, maxWidth, measure));
  const lines = truncateLines(wrapped, maxLines, maxWidth, measure);
  const textWidth = fitToText ? Math.max(0, ...lines.map(measure)) : maxWidth;
  return {
    lines,
    width: Math.min(maxWidth, textWidth) + 2 * padding,
    height: lines.length * lineHeight + 2 * padding,
  };
}
