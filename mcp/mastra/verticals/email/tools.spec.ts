/**
 * What the email tools report as touched, which sir's headset lights up.
 *
 * The thing he places in the room is a mail folder -- his inbox, most of all -- so that is what is
 * reported, by the id `findEmails` takes for it: a message comes and goes, and one placed in the
 * room would never glow again.
 */

import { describe, expect, it } from 'bun:test';
import { readAffectedEntities } from '../../utils/affected-entities.js';
import {
  deleteEmail,
  describeMailFolder,
  draftEmail,
  draftReply,
  findEmails,
  sendEmail,
  updateDraft,
} from './tools.js';

const INBOX = { id: 'inbox', name: 'Inbox' };
const DRAFTS = { id: 'drafts', name: 'Drafts' };

describe('describeMailFolder', () => {
  it('names a well-known folder, in the case Graph reads it in', () => {
    expect(describeMailFolder('Inbox')).toEqual(INBOX);
    expect(describeMailFolder(' sentitems ')).toEqual({ id: 'sentitems', name: 'Sent Items' });
  });

  it('keeps any other folder’s id exactly as given, since that is what Graph takes', () => {
    expect(describeMailFolder('AAMkADk0Mm')).toEqual({ id: 'AAMkADk0Mm' });
  });
});

describe('the mail folders a request touches', () => {
  it('is the folder a search read, which is the inbox unless another was named', () => {
    expect(readAffectedEntities(findEmails.id, { searchQuery: 'invoice' }, { emails: [], totalCount: 0 })).toEqual([
      INBOX,
    ]);
    expect(readAffectedEntities(findEmails.id, { folder: 'drafts' }, { emails: [], totalCount: 0 })).toEqual([DRAFTS]);
  });

  it('is the drafts folder for a draft written, replied or changed, and sent items for a message sent', () => {
    expect(readAffectedEntities(draftEmail.id, {}, {})).toEqual([DRAFTS]);
    expect(readAffectedEntities(draftReply.id, {}, {})).toEqual([DRAFTS]);
    expect(readAffectedEntities(updateDraft.id, {}, {})).toEqual([DRAFTS]);
    expect(readAffectedEntities(sendEmail.id, {}, {})).toEqual([{ id: 'sentitems', name: 'Sent Items' }]);
  });

  it('is nothing for a deleted message, whose folder is not known without a lookup', () => {
    expect(readAffectedEntities(deleteEmail.id, { messageId: 'm1' }, { success: true, message: '' })).toEqual([]);
  });
});
