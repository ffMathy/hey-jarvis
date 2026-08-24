/**
 * Google People API contact tests.
 *
 * The tools are exercised against the real `googleapis` People client, with only
 * the OAuth client swapped out. googleapis dispatches every call through
 * `auth.request()`, so a stand-in auth object is enough to serve canned
 * responses while the client itself still builds the URL, threads the page token
 * and parses the result — the parts most likely to break on an upgrade.
 *
 * No credentials are needed and no request leaves the machine.
 */

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { people_v1 } from 'googleapis';
import * as realGoogleAuth from '../../credentials/google-auth.js';
import { executeTool } from '../../utils/tool-factory.js';
// Type-only, so it is erased rather than loading the module before the mock below.
import type { Contact } from './contacts.js';

interface RecordedRequest {
  url?: string;
  params?: Record<string, unknown>;
}

/** Pages the fake People API serves, in order, one per request. */
let responsePages: people_v1.Schema$ListConnectionsResponse[] = [];
let recordedRequests: RecordedRequest[] = [];
/** When set, every request rejects with this instead of serving a page. */
let requestFailure: Error | undefined;

/**
 * Pages served so far.
 *
 * Tracked apart from `recordedRequests` so that a request staged to fail does
 * not consume a page, and a retry after it resumes where the caller left off.
 */
let servedPageCount = 0;

const fakeAuthClient = {
  request: async (options: RecordedRequest) => {
    recordedRequests.push(options);

    if (requestFailure) {
      throw requestFailure;
    }

    // A caller asking for more pages than the test staged gets an empty one,
    // which reads as "no more connections" rather than a crash.
    const page = responsePages[servedPageCount] ?? {};
    servedPageCount += 1;

    return { data: page };
  },
};

/**
 * Whether the stand-in auth client is in force.
 *
 * `mock.module` is process-global in Bun, so this file's substitution would
 * otherwise follow the calendar and todo-list specs — which do talk to Google —
 * into their own runs. Deferring to the real implementation whenever this file
 * is not driving keeps the mock local in effect if not in scope.
 */
let isAuthMocked = false;

mock.module('../../credentials/google-auth.js', () => ({
  ...realGoogleAuth,
  getGoogleAuth: async () => (isAuthMocked ? fakeAuthClient : realGoogleAuth.getGoogleAuth()),
}));

const {
  clearContactsCache,
  getContacts,
  lookupContact,
  normalizePhoneNumber,
  rankContacts,
  scoreContactMatch,
  toContact,
} = await import('./contacts.js');

/** Builds a contact directly, for the pure matching and ranking functions. */
function makeContact(displayName: string, overrides: Partial<Contact> = {}): Contact {
  return {
    resourceName: `people/${displayName.toLowerCase().replace(/\s+/g, '-')}`,
    displayName,
    nicknames: [],
    phoneNumbers: [{ value: '+4512345678', isE164: true }],
    emailAddresses: [],
    ...overrides,
  };
}

beforeEach(() => {
  isAuthMocked = true;
  responsePages = [];
  recordedRequests = [];
  servedPageCount = 0;
  requestFailure = undefined;
  clearContactsCache();
});

afterAll(() => {
  // Hand the real Google client back to any spec that runs after this one.
  isAuthMocked = false;
  clearContactsCache();
});

describe('normalizePhoneNumber', () => {
  it('prefers the canonical form Google resolved against the contact region', () => {
    // The raw value is a national number that could belong to any country; the
    // canonical form is the only trustworthy source of the country code.
    const normalized = normalizePhoneNumber('12 34 56 78', '+4512345678');

    expect(normalized).toEqual({ value: '+4512345678', isE164: true });
  });

  it('normalizes a raw international number when Google supplied no canonical form', () => {
    const normalized = normalizePhoneNumber('+45 12 34 56 78');

    expect(normalized).toEqual({ value: '+4512345678', isE164: true });
  });

  it('rewrites a 00 international prefix to +', () => {
    const normalized = normalizePhoneNumber('0045 12 34 56 78');

    expect(normalized).toEqual({ value: '+4512345678', isE164: true });
  });

  it('strips punctuation from a formatted number', () => {
    const normalized = normalizePhoneNumber('+1 (555) 234-5678');

    expect(normalized).toEqual({ value: '+15552345678', isE164: true });
  });

  it('flags a national number that cannot be placed, keeping it readable', () => {
    // Without a country there is no honest way to dial this, so it must not be
    // handed to the calling or texting tools — but it is still worth showing.
    const normalized = normalizePhoneNumber('12 34 56 78');

    expect(normalized).toEqual({ value: '12 34 56 78', isE164: false });
  });

  it('falls back to the raw value when the canonical form is unusable', () => {
    const normalized = normalizePhoneNumber('+4512345678', 'not-a-number');

    expect(normalized).toEqual({ value: '+4512345678', isE164: true });
  });

  it('flags a number that is too short to be dialled anywhere', () => {
    const normalized = normalizePhoneNumber('+1');

    expect(normalized.isE164).toBe(false);
  });

  it('flags a number longer than E.164 permits', () => {
    const normalized = normalizePhoneNumber('+45123456789012345678');

    expect(normalized.isE164).toBe(false);
  });

  it('accepts a well-formed number whose prefix the metadata does not list', () => {
    // Deliberate: these numbers are already in the user's address book, so a
    // stale prefix table must not be allowed to make a working contact
    // uncallable. +1 555 is the reserved fictional US exchange, and stands in
    // here for any number the bundled metadata considers unassigned.
    const normalized = normalizePhoneNumber('+1 555 234 5678');

    expect(normalized).toEqual({ value: '+15552345678', isE164: true });
  });

  it('flags text that is not a phone number at all', () => {
    const normalized = normalizePhoneNumber('call the office');

    expect(normalized).toEqual({ value: 'call the office', isE164: false });
  });
});

describe('toContact', () => {
  it('projects the fields the tools expose', () => {
    const contact = toContact({
      resourceName: 'people/c1',
      names: [{ displayName: 'Sarah Connor' }],
      nicknames: [{ value: 'Sarah' }],
      organizations: [{ name: 'Cyberdyne' }],
      phoneNumbers: [{ value: '12 34 56 78', canonicalForm: '+4512345678', type: 'mobile' }],
      emailAddresses: [{ value: 'sarah@example.com' }],
    });

    expect(contact).toEqual({
      resourceName: 'people/c1',
      displayName: 'Sarah Connor',
      nicknames: ['Sarah'],
      organization: 'Cyberdyne',
      phoneNumbers: [{ value: '+4512345678', isE164: true, type: 'mobile' }],
      emailAddresses: ['sarah@example.com'],
    });
  });

  it('falls back to an email address when the contact has no name', () => {
    const contact = toContact({
      resourceName: 'people/c2',
      emailAddresses: [{ value: 'nameless@example.com' }],
    });

    expect(contact.displayName).toBe('nameless@example.com');
  });

  it('names a contact carrying neither a name nor an email', () => {
    const contact = toContact({ resourceName: 'people/c3' });

    expect(contact.displayName).toBe('Unknown');
    expect(contact.phoneNumbers).toEqual([]);
    expect(contact.emailAddresses).toEqual([]);
  });

  it('drops phone entries that carry no number', () => {
    // Every People API field is optional, including inside a record the caller
    // asked for, so a valueless entry is a shape the API really can return.
    const contact = toContact({
      resourceName: 'people/c4',
      names: [{ displayName: 'Empty Number' }],
      phoneNumbers: [{ type: 'mobile' }, { value: '+4512345678' }],
    });

    expect(contact.phoneNumbers).toEqual([{ value: '+4512345678', isE164: true, type: undefined }]);
  });
});

describe('scoreContactMatch', () => {
  it('scores an exact full-name match highest', () => {
    expect(scoreContactMatch(makeContact('Sarah Connor'), 'Sarah Connor')).toBe(100);
  });

  it('ignores case and accents', () => {
    // A voice transcript rarely spells a Danish name the way the address book does.
    expect(scoreContactMatch(makeContact('Bjørn Åberg'), 'bjorn aberg')).toBe(100);
  });

  it('matches a nickname', () => {
    const contact = makeContact('Anne Lorenzen', { nicknames: ['Mom'] });

    expect(scoreContactMatch(contact, 'mom')).toBe(95);
  });

  it('matches a first and last name across a middle name', () => {
    expect(scoreContactMatch(makeContact('Sarah Jane Connor'), 'Sarah Connor')).toBe(85);
  });

  it('ranks a name the query opens above one it is merely scattered through', () => {
    const opensWithQuery = scoreContactMatch(makeContact('Sarah Connor Jensen'), 'Sarah Connor');
    const scatteredThrough = scoreContactMatch(makeContact('Sarah Jane Connor'), 'Sarah Connor');

    expect(opensWithQuery).toBeGreaterThan(scatteredThrough);
  });

  it('ranks a first-name match above a bare substring', () => {
    const firstNameScore = scoreContactMatch(makeContact('Sarah Connor'), 'Sarah');
    const substringScore = scoreContactMatch(makeContact('Massarah Ali'), 'sarah');

    expect(firstNameScore).toBeGreaterThan(substringScore);
    expect(substringScore).toBeGreaterThan(0);
  });

  it('matches a last name on its own', () => {
    expect(scoreContactMatch(makeContact('Sarah Connor'), 'Connor')).toBe(70);
  });

  it('matches a shortened first name', () => {
    expect(scoreContactMatch(makeContact('Mathias Lorenzen'), 'Math')).toBe(50);
  });

  it('treats a hyphenated name as two spoken words', () => {
    expect(scoreContactMatch(makeContact('Anne-Marie Jensen'), 'Anne Marie')).toBe(90);
  });

  it('ignores an apostrophe, which nobody pauses on', () => {
    expect(scoreContactMatch(makeContact("Ronan O'Neill"), 'ronan oneill')).toBe(100);
  });

  it('does not match an unrelated contact', () => {
    expect(scoreContactMatch(makeContact('Sarah Connor'), 'Mathias')).toBe(0);
  });

  it('does not match on an empty or punctuation-only query', () => {
    expect(scoreContactMatch(makeContact('Sarah Connor'), '   ')).toBe(0);
    expect(scoreContactMatch(makeContact('Sarah Connor'), '...')).toBe(0);
  });
});

describe('rankContacts', () => {
  it('orders better matches first and drops non-matches', () => {
    const contacts = [
      makeContact('Massarah Ali'),
      makeContact('Sarah Connor'),
      makeContact('Mathias Lorenzen'),
      makeContact('Sarah'),
    ];

    const ranked = rankContacts(contacts, 'Sarah', 10);

    expect(ranked.map((contact) => contact.displayName)).toEqual(['Sarah', 'Sarah Connor', 'Massarah Ali']);
  });

  it('prefers a contact that can actually be dialled when scores tie', () => {
    const withoutNumber = makeContact('Sarah Connor', {
      resourceName: 'people/no-number',
      phoneNumbers: [{ value: '12 34 56 78', isE164: false }],
    });
    const withNumber = makeContact('Sarah Connor', { resourceName: 'people/dialable' });

    const ranked = rankContacts([withoutNumber, withNumber], 'Sarah Connor', 10);

    expect(ranked[0]?.resourceName).toBe('people/dialable');
  });

  it('breaks a remaining tie by name, so repeated lookups agree', () => {
    const contacts = [makeContact('Sarah Zimmer'), makeContact('Sarah Andersen')];

    const ranked = rankContacts(contacts, 'Sarah', 10);

    expect(ranked.map((contact) => contact.displayName)).toEqual(['Sarah Andersen', 'Sarah Zimmer']);
  });

  it('honours the limit', () => {
    const contacts = [makeContact('Sarah Connor'), makeContact('Sarah Andersen'), makeContact('Sarah Zimmer')];

    expect(rankContacts(contacts, 'Sarah', 2)).toHaveLength(2);
  });

  it('returns nothing when no contact answers to the name', () => {
    expect(rankContacts([makeContact('Sarah Connor')], 'Mathias', 10)).toEqual([]);
  });
});

/** Wraps people in the response envelope the People API returns. */
function connectionsPage(
  connections: people_v1.Schema$Person[],
  nextPageToken?: string,
): people_v1.Schema$ListConnectionsResponse {
  return { connections, ...(nextPageToken ? { nextPageToken } : {}) };
}

const sarah: people_v1.Schema$Person = {
  resourceName: 'people/sarah',
  names: [{ displayName: 'Sarah Connor' }],
  phoneNumbers: [{ value: '12 34 56 78', canonicalForm: '+4512345678', type: 'mobile' }],
};

const mom: people_v1.Schema$Person = {
  resourceName: 'people/mom',
  names: [{ displayName: 'Anne Lorenzen' }],
  nicknames: [{ value: 'Mom' }],
  phoneNumbers: [{ value: '+45 87 65 43 21' }],
};

const numberless: people_v1.Schema$Person = {
  resourceName: 'people/numberless',
  names: [{ displayName: 'Sarah Paperless' }],
  emailAddresses: [{ value: 'paperless@example.com' }],
};

describe('getContacts', () => {
  it('reads the address book from the People API', async () => {
    responsePages = [connectionsPage([sarah, mom])];

    const result = await executeTool(getContacts, { forceRefresh: false });

    expect(result.totalCount).toBe(2);
    expect(result.contacts.map((contact) => contact.displayName)).toEqual(['Sarah Connor', 'Anne Lorenzen']);
    expect(result.contacts[0]?.phoneNumbers).toEqual([{ value: '+4512345678', isE164: true, type: 'mobile' }]);
  });

  it('requests the fields the contact shape is built from', async () => {
    responsePages = [connectionsPage([sarah])];

    await executeTool(getContacts, { forceRefresh: false });

    expect(recordedRequests[0]?.url).toBe('https://people.googleapis.com/v1/people/me/connections');
    // personFields is mandatory, and anything missing from it comes back absent.
    expect(recordedRequests[0]?.params?.personFields).toBe('names,nicknames,phoneNumbers,emailAddresses,organizations');
  });

  it('follows pagination until the address book is exhausted', async () => {
    responsePages = [connectionsPage([sarah], 'page-2'), connectionsPage([mom])];

    const result = await executeTool(getContacts, { forceRefresh: false });

    expect(result.totalCount).toBe(2);
    expect(recordedRequests).toHaveLength(2);
    expect(recordedRequests[0]?.params?.pageToken).toBeUndefined();
    expect(recordedRequests[1]?.params?.pageToken).toBe('page-2');
  });

  it('applies maxResults without hiding how many contacts exist', async () => {
    responsePages = [connectionsPage([sarah, mom])];

    const result = await executeTool(getContacts, { maxResults: 1, forceRefresh: false });

    expect(result.contacts).toHaveLength(1);
    expect(result.totalCount).toBe(2);
  });

  it('serves a second read from cache rather than re-downloading', async () => {
    responsePages = [connectionsPage([sarah, mom])];

    await executeTool(getContacts, { forceRefresh: false });
    const second = await executeTool(getContacts, { forceRefresh: false });

    expect(second.totalCount).toBe(2);
    expect(recordedRequests).toHaveLength(1);
  });

  it('re-fetches when the caller asks for fresh data', async () => {
    responsePages = [connectionsPage([sarah]), connectionsPage([sarah, mom])];

    await executeTool(getContacts, { forceRefresh: false });
    const refreshed = await executeTool(getContacts, { forceRefresh: true });

    expect(recordedRequests).toHaveLength(2);
    expect(refreshed.totalCount).toBe(2);
  });

  it('reports an empty address book rather than failing', async () => {
    responsePages = [connectionsPage([])];

    const result = await executeTool(getContacts, { forceRefresh: false });

    expect(result).toEqual({ contacts: [], totalCount: 0 });
  });

  it('explains a missing contacts scope instead of surfacing the raw rejection', async () => {
    // The scope is newer than the Google credentials most installs hold, so
    // this is the failure the very first call after deploying tends to hit.
    requestFailure = new Error('Request had insufficient authentication scopes.');

    await expect(executeTool(getContacts, { forceRefresh: false })).rejects.toThrow(/generate-tokens/);
  });

  it('explains that the People API is not enabled', async () => {
    // Google reports this as a 403 whose message also carries the words the
    // scope check looks for, so the more specific diagnosis has to win.
    requestFailure = new Error(
      'Forbidden: People API has not been used in project 12345 before or it is disabled. PERMISSION_DENIED',
    );

    await expect(executeTool(getContacts, { forceRefresh: false })).rejects.toThrow(/People API is not enabled/);
  });

  it('passes an unrelated failure through unchanged', async () => {
    requestFailure = new Error('socket hang up');

    await expect(executeTool(getContacts, { forceRefresh: false })).rejects.toThrow('socket hang up');
  });

  it('does not cache a failed fetch', async () => {
    requestFailure = new Error('socket hang up');
    await expect(executeTool(getContacts, { forceRefresh: false })).rejects.toThrow();

    requestFailure = undefined;
    responsePages = [connectionsPage([sarah])];
    const recovered = await executeTool(getContacts, { forceRefresh: false });

    expect(recovered.totalCount).toBe(1);
  });
});

describe('lookupContact', () => {
  it('resolves a spoken name to a dialable number', async () => {
    responsePages = [connectionsPage([sarah, mom])];

    const result = await executeTool(lookupContact, { name: 'Sarah', limit: 5, requirePhoneNumber: true });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.displayName).toBe('Sarah Connor');
    expect(result.matches[0]?.phoneNumbers[0]?.value).toBe('+4512345678');
    expect(result.isAmbiguous).toBe(false);
  });

  it('resolves a nickname', async () => {
    responsePages = [connectionsPage([sarah, mom])];

    const result = await executeTool(lookupContact, { name: 'mom', limit: 5, requirePhoneNumber: true });

    expect(result.matches[0]?.displayName).toBe('Anne Lorenzen');
    expect(result.matches[0]?.phoneNumbers[0]).toEqual({ value: '+4587654321', isE164: true, type: undefined });
  });

  it('flags an ambiguous name instead of picking one', async () => {
    const otherSarah: people_v1.Schema$Person = {
      resourceName: 'people/sarah-2',
      names: [{ displayName: 'Sarah Andersen' }],
      phoneNumbers: [{ value: '+4511112222' }],
    };
    responsePages = [connectionsPage([sarah, otherSarah])];

    const result = await executeTool(lookupContact, { name: 'Sarah', limit: 5, requirePhoneNumber: true });

    expect(result.matches).toHaveLength(2);
    expect(result.isAmbiguous).toBe(true);
  });

  it('skips contacts with no phone number when one is required', async () => {
    responsePages = [connectionsPage([sarah, numberless])];

    const result = await executeTool(lookupContact, { name: 'Sarah', limit: 5, requirePhoneNumber: true });

    expect(result.matches.map((contact) => contact.displayName)).toEqual(['Sarah Connor']);
  });

  it('includes contacts with no phone number when looking up an email address', async () => {
    responsePages = [connectionsPage([sarah, numberless])];

    const result = await executeTool(lookupContact, { name: 'Sarah', limit: 5, requirePhoneNumber: false });

    expect(result.matches.map((contact) => contact.displayName)).toEqual(['Sarah Connor', 'Sarah Paperless']);
  });

  it('honours the limit on a broad name', async () => {
    responsePages = [connectionsPage([sarah, mom, numberless])];

    const result = await executeTool(lookupContact, { name: 'Sarah', limit: 1, requirePhoneNumber: false });

    expect(result.matches).toHaveLength(1);
  });

  it('reports no match rather than guessing', async () => {
    responsePages = [connectionsPage([sarah, mom])];

    const result = await executeTool(lookupContact, { name: 'Nobody', limit: 5, requirePhoneNumber: true });

    expect(result).toEqual({ matches: [], isAmbiguous: false });
  });

  it('reuses the address book already fetched by getContacts', async () => {
    responsePages = [connectionsPage([sarah, mom])];

    await executeTool(getContacts, { forceRefresh: false });
    await executeTool(lookupContact, { name: 'Sarah', limit: 5, requirePhoneNumber: true });

    expect(recordedRequests).toHaveLength(1);
  });
});
