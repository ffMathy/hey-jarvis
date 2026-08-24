import { google, type people_v1 } from 'googleapis';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { deburr } from 'lodash-es';
import { z } from 'zod';
import { getGoogleAuth } from '../../credentials/google-auth.js';
import { extractErrorMessage } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { createTool } from '../../utils/tool-factory.js';

/**
 * Fields requested from the People API.
 *
 * `personFields` is mandatory on every read, and anything omitted here comes
 * back absent rather than empty, so this list is the upper bound of what
 * `toContact` can ever populate.
 */
const PERSON_FIELDS = 'names,nicknames,phoneNumbers,emailAddresses,organizations';

/** Largest page the People API will serve for `connections.list`. */
const MAXIMUM_PAGE_SIZE = 1000;

/**
 * Upper bound on pages walked in one fetch.
 *
 * The loop already stops on a missing `nextPageToken`; this only bounds the
 * damage if the API ever keeps handing one back, and 20 pages covers an address
 * book of 20,000 contacts.
 */
const MAXIMUM_PAGES = 20;

/** How long a fetched address book stays usable before it is re-fetched. */
const CACHE_TIME_TO_LIVE_MILLISECONDS = 5 * 60 * 1000;

const phoneNumberSchema = z.object({
  value: z.string().describe('The phone number in E.164 format where Google could canonicalize it'),
  type: z.string().optional().describe('The label Google stores for this number (e.g. "mobile", "home", "work")'),
  isE164: z.boolean().describe('Whether `value` is in E.164 format and can be passed to calling or texting tools'),
});

const contactSchema = z.object({
  resourceName: z.string().describe('Stable People API identifier (e.g. "people/c123")'),
  displayName: z.string().describe("The contact's display name"),
  nicknames: z.array(z.string()).describe('Nicknames stored for the contact'),
  organization: z.string().optional().describe("The contact's organization, when one is stored"),
  phoneNumbers: z.array(phoneNumberSchema).describe('Phone numbers stored for the contact'),
  emailAddresses: z.array(z.string()).describe('Email addresses stored for the contact'),
});

export type Contact = z.infer<typeof contactSchema>;
export type ContactPhoneNumber = z.infer<typeof phoneNumberSchema>;

/**
 * Converts a stored phone number into E.164 where possible.
 *
 * Google supplies `canonicalForm` whenever it could resolve a number against
 * the contact's own region, and that value is already E.164 — so it is tried
 * first, and the number as the user typed it only serves as a fallback.
 *
 * Parsing happens without a default country, which is deliberate: the only
 * numbers still needing normalization at this point are ones Google could not
 * place, and guessing a region for those would produce confidently wrong
 * numbers. Such a number is returned unchanged with `isE164: false` — still
 * worth showing the user, but not safe to hand to the calling or texting tools,
 * which both require E.164.
 *
 * The bar is `isPossible` rather than `isValid`: these numbers are ones the user
 * already saved and presumably dials, so rejecting one because the bundled
 * metadata does not list its prefix as assigned would quietly make a working
 * contact uncallable. `isPossible` still rejects the failure that matters here —
 * a number of the wrong length, or with no country code at all — and the carrier
 * rejects anything unassigned that slips through.
 */
export function normalizePhoneNumber(rawValue: string, canonicalForm?: string | null) {
  for (const candidate of [canonicalForm, rawValue]) {
    if (!candidate) {
      continue;
    }

    // `00` is the international prefix across most of Europe, but which digits
    // play that role is region-specific (`011` in NANP), so the library will not
    // infer it without a country. Rewriting it here keeps "0045 12 34 56 78"
    // parseable while leaving a genuine national number alone.
    const withInternationalPrefix = /^00\d/.test(candidate.trim()) ? `+${candidate.trim().slice(2)}` : candidate.trim();
    const parsed = parsePhoneNumberFromString(withInternationalPrefix);

    if (parsed?.isPossible()) {
      return { value: parsed.number, isE164: true };
    }
  }

  return { value: rawValue.trim(), isE164: false };
}

/**
 * Projects a People API person onto the flat shape the tools return.
 *
 * Every field is optional in the API's own type, including ones the caller
 * asked for, so a contact with no name at all still has to map to something.
 */
export function toContact(person: people_v1.Schema$Person): Contact {
  const displayName =
    person.names?.find((name) => name.displayName)?.displayName ??
    person.emailAddresses?.find((email) => email.value)?.value ??
    'Unknown';

  return {
    resourceName: person.resourceName ?? '',
    displayName,
    nicknames: person.nicknames?.flatMap((nickname) => (nickname.value ? [nickname.value] : [])) ?? [],
    organization: person.organizations?.find((organization) => organization.name)?.name ?? undefined,
    phoneNumbers:
      person.phoneNumbers?.flatMap((phoneNumber) => {
        if (!phoneNumber.value) {
          return [];
        }

        const normalized = normalizePhoneNumber(phoneNumber.value, phoneNumber.canonicalForm);

        return normalized.value ? [{ ...normalized, type: phoneNumber.type ?? undefined }] : [];
      }) ?? [],
    emailAddresses: person.emailAddresses?.flatMap((email) => (email.value ? [email.value] : [])) ?? [],
  };
}

/**
 * Folds case, accents and punctuation away so that "Bjørn O'Neill" and
 * "bjorn oneill" compare equal.
 *
 * Contacts are typed by hand on a phone keyboard and spoken into a voice
 * assistant, so the two spellings of a name rarely agree exactly. Apostrophes
 * are dropped rather than spaced out, since nobody pauses in the middle of
 * "O'Neill", while a hyphen becomes a space because "Anne-Marie" is spoken as
 * two words.
 */
function foldForMatching(value: string) {
  return deburr(value)
    .replace(/['’`]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Scores how well a contact answers to a spoken name, from 0 (no match) to 100.
 *
 * The ordering encodes how a person refers to a contact out loud: a full name
 * or a nickname is unambiguous, a first name is the common case, and a bare
 * substring is the weakest signal and only useful as a fallback.
 */
export function scoreContactMatch(contact: Contact, query: string): number {
  const foldedQuery = foldForMatching(query);

  if (!foldedQuery) {
    return 0;
  }

  const foldedName = foldForMatching(contact.displayName);
  const foldedNicknames = contact.nicknames.map(foldForMatching);

  if (foldedName === foldedQuery) {
    return 100;
  }

  if (foldedNicknames.includes(foldedQuery)) {
    return 95;
  }

  const nameTokens = foldedName.split(' ').filter(Boolean);
  const queryTokens = foldedQuery.split(' ').filter(Boolean);

  // "Anne Marie" against "Anne-Marie Jensen": the whole spoken name opens the
  // stored one, which is a stronger signal than the same tokens scattered
  // through it, so this is checked first.
  if (foldedName.startsWith(`${foldedQuery} `)) {
    return 90;
  }

  // "sarah connor" against "Sarah Jane Connor": every spoken token is a name
  // token, just not contiguously.
  if (queryTokens.length > 1 && queryTokens.every((token) => nameTokens.includes(token))) {
    return 85;
  }

  if (nameTokens.includes(foldedQuery)) {
    return 70;
  }

  if (foldedNicknames.some((nickname) => nickname.startsWith(foldedQuery))) {
    return 60;
  }

  if (nameTokens.some((token) => token.startsWith(foldedQuery))) {
    return 50;
  }

  if (foldedName.includes(foldedQuery)) {
    return 30;
  }

  return 0;
}

/**
 * Ranks contacts against a spoken name, best match first.
 *
 * Non-matches are dropped rather than ranked last: handing an agent a contact
 * that does not answer to the name invites it to call the wrong person.
 * Contacts scoring equally are ordered by name so the result is stable across
 * calls, and a contact with a dialable number outranks one without at the same
 * score, since only the former can be acted on.
 */
export function rankContacts(contacts: Contact[], query: string, limit: number): Contact[] {
  return contacts
    .map((contact) => ({ contact, score: scoreContactMatch(contact, query) }))
    .filter(({ score }) => score > 0)
    .sort((first, second) => {
      if (first.score !== second.score) {
        return second.score - first.score;
      }

      const firstIsDialable = first.contact.phoneNumbers.some((phoneNumber) => phoneNumber.isE164);
      const secondIsDialable = second.contact.phoneNumbers.some((phoneNumber) => phoneNumber.isE164);

      if (firstIsDialable !== secondIsDialable) {
        return firstIsDialable ? -1 : 1;
      }

      return first.contact.displayName.localeCompare(second.contact.displayName);
    })
    .slice(0, limit)
    .map(({ contact }) => contact);
}

/**
 * Turns the two first-run setup failures into errors that say what to do.
 *
 * The contacts scope is newer than the Google credentials most installs already
 * hold, so the first call after this vertical ships fails on a refresh token
 * that predates it — and Google reports that as a generic authorization error
 * several layers down. Anything else is passed through untouched.
 */
function describeContactsFailure(error: unknown): unknown {
  const message = extractErrorMessage(error) ?? '';

  // Checked before the scope case: Google reports a disabled API as a 403 too,
  // and its message can carry both sets of keywords. This one is the more
  // specific diagnosis, so it wins when both match.
  if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(message)) {
    return new Error(
      `The Google People API is not enabled for this project: ${message}\n` +
        '\n' +
        'Enable it at https://console.cloud.google.com (APIs & Services → Library → Google People API).',
      { cause: error },
    );
  }

  if (/insufficient|scope|forbidden|PERMISSION_DENIED|invalid_grant/i.test(message)) {
    return new Error(
      `Google rejected the contacts request: ${message}\n` +
        '\n' +
        'The refresh token most likely predates the contacts scope. To fix:\n' +
        '  1. Enable the People API at https://console.cloud.google.com (APIs & Services → Library)\n' +
        '  2. Drop the stored token: sqlite3 mcp/mastra.sql.db "DELETE FROM oauth_credentials WHERE provider=\'google\';"\n' +
        '  3. Re-run: bun run --cwd mcp generate-tokens',
      { cause: error },
    );
  }

  return error;
}

interface ContactsCacheEntry {
  contacts: Contact[];
  fetchedAtMilliseconds: number;
}

let contactsCache: ContactsCacheEntry | undefined;

/**
 * Drops the cached address book.
 *
 * Exported for tests, which would otherwise see one spec's fetch answer the
 * next spec's lookup.
 */
export function clearContactsCache(): void {
  contactsCache = undefined;
}

/**
 * Fetches every contact in the user's Google address book.
 *
 * Results are cached briefly: resolving a name means ranking the whole address
 * book locally, and a voice interaction ("text Sarah that I'm late") would
 * otherwise re-download it on every turn.
 */
async function fetchAllContacts(forceRefresh: boolean): Promise<Contact[]> {
  if (
    !forceRefresh &&
    contactsCache &&
    Date.now() - contactsCache.fetchedAtMilliseconds < CACHE_TIME_TO_LIVE_MILLISECONDS
  ) {
    return contactsCache.contacts;
  }

  const auth = await getGoogleAuth();
  const people = google.people({ version: 'v1', auth });

  const contacts: Contact[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;

  do {
    const response = await people.people.connections
      .list({
        resourceName: 'people/me',
        personFields: PERSON_FIELDS,
        pageSize: MAXIMUM_PAGE_SIZE,
        // Only matters when `maxResults` truncates the result: the contacts the
        // user touched most recently are the ones they are most likely asking about.
        sortOrder: 'LAST_MODIFIED_DESCENDING',
        pageToken,
      })
      .catch((error: unknown) => {
        throw describeContactsFailure(error);
      });

    contacts.push(...(response.data.connections ?? []).map(toContact));
    pageToken = response.data.nextPageToken ?? undefined;
    pageCount += 1;
  } while (pageToken && pageCount < MAXIMUM_PAGES);

  if (pageToken) {
    logger.warn('Stopped reading Google contacts at the page limit; the address book is incomplete', {
      pageCount,
      contactCount: contacts.length,
    });
  }

  contactsCache = { contacts, fetchedAtMilliseconds: Date.now() };

  return contacts;
}

/**
 * Tool to list the user's Google contacts.
 *
 * Reads the address book that syncs to the user's phone via the Google People
 * API. Requires the `https://www.googleapis.com/auth/contacts.readonly` scope,
 * so a refresh token minted before that scope was added has to be regenerated
 * with `bun run --cwd mcp generate-tokens`.
 *
 * Required environment variables:
 * - HEY_JARVIS_GOOGLE_CLIENT_ID: Your Google OAuth2 client ID
 * - HEY_JARVIS_GOOGLE_CLIENT_SECRET: Your Google OAuth2 client secret
 * - HEY_JARVIS_GOOGLE_REFRESH_TOKEN: A refresh token carrying the contacts scope
 */
export const getContacts = createTool({
  id: 'getContacts',
  description:
    "List the contacts in the user's Google address book (the same contacts that sync to their phone), including phone numbers and email addresses. Use lookupContact instead when resolving a specific name to a phone number.",
  inputSchema: z.object({
    maxResults: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum number of contacts to return. Omit to return the entire address book.'),
    forceRefresh: z
      .boolean()
      .default(false)
      .describe('Bypass the short-lived cache and re-fetch from Google. Use after the user says they added a contact.'),
  }),
  outputSchema: z.object({
    contacts: z.array(contactSchema),
    totalCount: z.number().describe('Total contacts in the address book, before maxResults was applied'),
  }),
  execute: async (inputData) => {
    const allContacts = await fetchAllContacts(inputData.forceRefresh);

    return {
      contacts: inputData.maxResults ? allContacts.slice(0, inputData.maxResults) : allContacts,
      totalCount: allContacts.length,
    };
  },
});

/**
 * Tool to resolve a spoken name to contacts and their phone numbers.
 *
 * This is the bridge between how a user refers to somebody ("call mom") and
 * what `initiatePhoneCall` and `sendTextMessage` require (an E.164 number).
 * Matching is done locally over the whole address book rather than through the
 * People API's own search, which needs a warm-up request before it returns
 * anything.
 */
export const lookupContact = createTool({
  id: 'lookupContact',
  description:
    'Find contacts in the user\'s Google address book by name or nickname, and return their phone numbers in E.164 format. Use this to resolve a name the user spoke (e.g. "mom", "Sarah") into a number for initiatePhoneCall or sendTextMessage. Returns several matches when the name is ambiguous — ask the user which one they meant rather than guessing.',
  inputSchema: z.object({
    name: z.string().min(1).describe('The name or nickname to search for (e.g. "Sarah", "mom", "Sarah Connor")'),
    limit: z.number().int().positive().default(5).describe('Maximum number of matching contacts to return'),
    requirePhoneNumber: z
      .boolean()
      .default(true)
      .describe(
        'Only return contacts that have at least one phone number. Set false when looking up an email address.',
      ),
  }),
  outputSchema: z.object({
    matches: z.array(contactSchema),
    /**
     * Present so an agent can distinguish "the address book has no such
     * contact" from "several people answer to that name", which need different
     * responses to the user.
     */
    isAmbiguous: z.boolean().describe('Whether more than one contact matched the name'),
  }),
  execute: async (inputData) => {
    const allContacts = await fetchAllContacts(false);
    const candidates = inputData.requirePhoneNumber
      ? allContacts.filter((contact) => contact.phoneNumbers.length > 0)
      : allContacts;
    const matches = rankContacts(candidates, inputData.name, inputData.limit);

    return { matches, isAmbiguous: matches.length > 1 };
  },
});

export const contactTools = {
  getContacts,
  lookupContact,
};
