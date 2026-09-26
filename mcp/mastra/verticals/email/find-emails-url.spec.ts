/**
 * The Graph request `findEmails` makes.
 *
 * It asks only for the fields the tool reports, since a message's full HTML body is by far the
 * largest thing Graph would otherwise send back for each hit, and it never combines `$orderby`
 * with `$search`, which Graph refuses outright.
 */

import { describe, expect, it } from 'bun:test';
import { buildFindEmailsUrl } from './tools.js';

function queryOf(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('buildFindEmailsUrl', () => {
  it('asks only for the fields the tool reports, newest first', () => {
    const query = queryOf(buildFindEmailsUrl({ folder: 'inbox', limit: 10 }));

    expect(query.get('$select')?.split(',')).toEqual([
      'id',
      'subject',
      'bodyPreview',
      'from',
      'receivedDateTime',
      'isRead',
      'hasAttachments',
      'isDraft',
    ]);
    expect(query.get('$orderby')).toBe('receivedDateTime desc');
    expect(query.get('$top')).toBe('10');
  });

  it('leaves the ordering to Graph when searching', () => {
    const query = queryOf(buildFindEmailsUrl({ folder: 'inbox', limit: 5, searchQuery: 'invoice' }));

    expect(query.get('$search')).toBe('"invoice"');
    expect(query.has('$orderby')).toBe(false);
    expect(query.has('$select')).toBe(true);
  });

  it('filters by read status and attachments together', () => {
    const query = queryOf(buildFindEmailsUrl({ folder: 'inbox', limit: 10, isRead: false, hasAttachment: true }));

    expect(query.get('$filter')).toBe('isRead eq false and hasAttachments eq true');
  });
});
