import type { Knowledge, KnowledgeNote } from '@mastra/core/knowledge';
import { MAX_KNOWLEDGE_PAGE_LIST_LIMIT } from '@mastra/core/knowledge';
import { CONVENTIONS_SCOPE } from './index.js';

/**
 * How the household likes one part of the house done, kept as a page under `conventions:home`.
 *
 * The page has two halves, owned by two different hands:
 *
 * - **Its body is the conventions Jarvis was built with**, here in code, where they are reviewed
 *   with every other change. It is written to the page the first time a process reads it, so the
 *   page always shows what the code says.
 * - **Its notes are what the household has said since** — "sir prefers letmælk now" — added by the
 *   vertical's agent with `knowledge_note`. Agents are contributors on the scope, so they can add
 *   a note and cannot rewrite the body.
 *
 * An agent is given both on every run, through its instructions ({@link readConventions}), so a
 * convention the household stated last week is followed today, on every path — including the
 * routed one, which runs agents with no Memory thread.
 */
export interface Conventions {
  /** The page's key under {@link CONVENTIONS_SCOPE}, e.g. `shopping`. */
  key: string;
  /** The page's name in Studio and in search, e.g. `Shopping`. */
  name: string;
  /** What the conventions are about, in a sentence: at most 100 tokens. */
  description: string;
  /** The conventions themselves, in markdown. */
  body: string;
}

/** Where a vertical's conventions are, as an agent names the page: `conventions:home#shopping`. */
export function conventionsReference(conventions: Pick<Conventions, 'key'>): string {
  return `${CONVENTIONS_SCOPE}#${conventions.key}`;
}

/** What an agent is told about keeping a vertical's conventions: when to add a note, and exactly how. */
export function conventionsNoteInstructions(conventions: Pick<Conventions, 'key'>, about: string): string {
  return `When sir states a lasting convention about ${about} — something to keep doing from now on, not just this once — add it as one note with knowledge_note: op "add", page "${conventionsReference(conventions)}", scope ["${CONVENTIONS_SCOPE}"]. Write it as the convention itself, in a sentence. A convention that replaces an earlier one is a new note; never try to rewrite the page.`;
}

/** Who the body is written as, in Knowledge's record of the page. */
const AUTHOR = 'jarvis';

/**
 * The bodies written this process, by Knowledge instance and page key: each is written once, then
 * only read. A failed write is forgotten, so the next read tries again.
 */
const writtenBodies = new WeakMap<Knowledge, Map<string, Promise<void>>>();

function writeBodyOnce(knowledge: Knowledge, conventions: Conventions): Promise<void> {
  let bodies = writtenBodies.get(knowledge);
  if (!bodies) {
    bodies = new Map();
    writtenBodies.set(knowledge, bodies);
  }

  let written = bodies.get(conventions.key);
  if (!written) {
    written = knowledge
      .upsertPage({
        scope: CONVENTIONS_SCOPE,
        path: conventions.key,
        name: conventions.name,
        description: conventions.description,
        body: conventions.body,
        author: AUTHOR,
      })
      .then(() => undefined)
      .catch((error: unknown) => {
        bodies.delete(conventions.key);
        throw new Error(`Could not write the ${conventions.key} conventions to Knowledge`, { cause: error });
      });
    bodies.set(conventions.key, written);
  }
  return written;
}

/** Every note on the page, oldest first. */
async function notesOn(knowledge: Knowledge, key: string): Promise<KnowledgeNote[]> {
  const storage = await knowledge.getStorage();
  const [scope] = await storage.getScopesByAddress([CONVENTIONS_SCOPE]);
  const page = scope && (await storage.getPageByPath({ scopeId: scope.id, path: [key], read: 'all' }));
  if (!page) {
    throw new Error(`The ${key} conventions page is missing from Knowledge after it was written`);
  }

  const notes: KnowledgeNote[] = [];
  let cursor: string | undefined;
  do {
    const listing = await storage.listNotes({
      pageId: page.id,
      read: 'all',
      cursor,
      limit: MAX_KNOWLEDGE_PAGE_LIST_LIMIT,
    });
    notes.push(...listing.notes);
    cursor = listing.nextCursor;
  } while (cursor);
  return notes;
}

/** The day a note is dated, or was written on when it has no date of its own. */
function dayOf(note: KnowledgeNote): string {
  return (note.when ?? note.createdAt).toISOString().slice(0, 10);
}

/**
 * A vertical's conventions as its agents are to follow them: the body, then every note the
 * household has added since, oldest first and each with its date, so a later note visibly wins over
 * an earlier one it replaces.
 */
export async function readConventions(knowledge: Knowledge, conventions: Conventions): Promise<string> {
  await writeBodyOnce(knowledge, conventions);
  const notes = await notesOn(knowledge, conventions.key);
  if (notes.length === 0) {
    return conventions.body;
  }

  const said = notes.map((note) => `- ${dayOf(note)}: ${note.text}`);
  return `${conventions.body}\n\nWhat the household has said since, oldest first; where two disagree, the later one wins:\n${said.join('\n')}`;
}
