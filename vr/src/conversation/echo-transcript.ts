/**
 * Recognising his own words in a transcript of the user: the plainest sign of his voice coming
 * back through the microphone.
 *
 * ElevenLabs sends his line as text when he starts saying it, and the user's words as a transcript
 * once they have been heard. If the echo canceller let his voice through, the agent transcribes it
 * as the user and the two match. Speech recognition does not hand words back exactly as they were
 * written, so the comparison is on words rather than characters, and forgiving: either half or more
 * of the words the two share (Jaccard), or four words in a row that he said in that order. A
 * transcript of fewer than three words is never judged, since "yes, sir" said back to him is
 * something people really say.
 */

/** How long after he last said or was heard saying a line it can still come back. */
export const ECHO_WINDOW_MS = 10_000;

/** The share of their words a transcript and his line have in common for the one to be the other. */
export const SHARED_WORDS_FOR_ECHO = 0.5;

/** How many of his words in a row, in his order, give a transcript away whatever else it says. */
export const WORDS_IN_A_ROW_FOR_ECHO = 4;

/** Transcripts shorter than this are never judged. */
export const FEWEST_WORDS_JUDGED = 3;

/** The words of `text`, lower case, without accents or punctuation. */
export function wordsOf(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

function runsOf(words: readonly string[], length: number): Set<string> {
  const runs = new Set<string>();
  for (let start = 0; start + length <= words.length; start++) {
    runs.add(words.slice(start, start + length).join(' '));
  }
  return runs;
}

/** Whether a transcript of the user, `heard`, is his own line `said` coming back. */
export function soundsLikeEcho(heard: string, said: string): boolean {
  const heardWords = wordsOf(heard);
  const saidWords = wordsOf(said);
  if (heardWords.length < FEWEST_WORDS_JUDGED || saidWords.length === 0) return false;

  const heardSet = new Set(heardWords);
  const saidSet = new Set(saidWords);
  let shared = 0;
  for (const word of heardSet) if (saidSet.has(word)) shared++;
  const union = heardSet.size + saidSet.size - shared;
  if (union > 0 && shared / union >= SHARED_WORDS_FOR_ECHO) return true;

  const saidRuns = runsOf(saidWords, WORDS_IN_A_ROW_FOR_ECHO);
  for (const run of runsOf(heardWords, WORDS_IN_A_ROW_FOR_ECHO)) if (saidRuns.has(run)) return true;
  return false;
}

export interface TranscriptEchoWatch {
  /** One of his lines, as ElevenLabs sent it. */
  agentSaid(text: string): void;
  /**
   * His voice was heard just now. A long line takes longer to say than {@link ECHO_WINDOW_MS}, so
   * the latest one stays in the window for as long as he is still saying it.
   */
  agentHeard(): void;
  /** A transcript of the user. Says whether it is one of his lines coming back. */
  userSaid(text: string): boolean;
  /** A new conversation. */
  reset(): void;
}

export function createTranscriptEchoWatch(now: () => number): TranscriptEchoWatch {
  let lines: Array<{ text: string; lastAt: number }> = [];

  const forgetOld = (time: number) => {
    lines = lines.filter((line) => time - line.lastAt <= ECHO_WINDOW_MS);
  };

  return {
    agentSaid: (text) => {
      const time = now();
      forgetOld(time);
      if (text.trim().length > 0) lines.push({ text, lastAt: time });
    },
    agentHeard: () => {
      const latest = lines.at(-1);
      if (latest !== undefined) latest.lastAt = now();
    },
    userSaid: (text) => {
      forgetOld(now());
      return lines.some((line) => soundsLikeEcho(text, line.text));
    },
    reset: () => {
      lines = [];
    },
  };
}
