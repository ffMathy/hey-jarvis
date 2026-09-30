/**
 * The person's own words in an email reply, without the markup or the message it answers.
 *
 * A reply arrives off Microsoft Graph as HTML, with the request it answers quoted underneath, so
 * the text the person actually wrote is usually the first few lines of a much longer body. The
 * language model that parses replies is told to look past all of that; anything that takes the
 * reply as it is -- a classifier question, or a comment field filled in with what they wrote --
 * needs it done first.
 *
 * Nothing installed turns HTML into text, and pulling in a parser for this would be a dependency
 * for a handful of lines. Mail clients mark quoted history in a few well-known ways, and those are
 * what is cut at: a miss leaves some quoted text behind, which is what every reader saw before.
 */

/** Where HTML mail clients start the quoted message: Gmail, Outlook, Apple Mail and plain `blockquote`s. */
const QUOTED_HTML_MARKERS = [
  /<blockquote\b/i,
  /<div[^>]*\bclass="[^"]*\bgmail_quote\b/i,
  /<div[^>]*\bid="appendonsend"/i,
  /<div[^>]*\bid="divRplyFwdMsg"/i,
  /<hr\b/i,
];

/** Lines that start the quoted message in a plain-text reply. */
const QUOTED_TEXT_MARKERS = [
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^_{10,}$/,
  /^On .+ wrote:$/i,
  /^(From|Fra):\s/i,
  /^>/,
];

/** The named entities that turn up in replies; anything else numeric is decoded by its code point. */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

function cutAtFirstMatch(text: string, markers: RegExp[]): string {
  const cutAt = markers.reduce((earliest, marker) => {
    const index = text.search(marker);
    return index === -1 ? earliest : Math.min(earliest, index);
  }, text.length);

  return text.slice(0, cutAt);
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#')) {
      const codePoint = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  );
}

/**
 * Reads what the person wrote into a reply: the markup stripped, and everything from the quoted
 * message onwards dropped.
 *
 * @returns Their words, one line per line they wrote, or an empty string when nothing of theirs is left
 */
export function ownReplyText(replyBody: string): string {
  const text = htmlToText(cutAtFirstMatch(replyBody, QUOTED_HTML_MARKERS));

  const ownLines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.replace(/\s+/g, ' ').trim();
    if (QUOTED_TEXT_MARKERS.some((marker) => marker.test(trimmed))) {
      break;
    }
    ownLines.push(trimmed);
  }

  return ownLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
