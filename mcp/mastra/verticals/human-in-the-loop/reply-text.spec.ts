import { describe, expect, it } from 'bun:test';
import { ownReplyText } from './reply-text.js';

describe('ownReplyText', () => {
  it('keeps a plain reply as it was written', () => {
    expect(ownReplyText('Yes, go ahead.\n\nThanks')).toBe('Yes, go ahead.\n\nThanks');
  });

  it('strips the markup and decodes the entities', () => {
    expect(
      ownReplyText('<html><body><p>No &mdash; too expensive</p><p>Sorry &amp; thanks&#33;</p></body></html>'),
    ).toBe('No — too expensive\nSorry & thanks!');
  });

  it('turns line breaks into lines and drops styles', () => {
    expect(ownReplyText('<style>p { color: red; }</style>Approved<br>Keep it under budget')).toBe(
      'Approved\nKeep it under budget',
    );
  });

  it('drops a quoted blockquote', () => {
    expect(ownReplyText('<div>Yes</div><blockquote><p>Please approve the budget?</p></blockquote>')).toBe('Yes');
  });

  it('drops the history Outlook appends under a rule', () => {
    const body =
      '<div>Looks good</div><div id="appendonsend"></div><hr style="display:inline-block"><div id="divRplyFwdMsg"><b>From:</b> Jarvis</div><div>Please approve?</div>';

    expect(ownReplyText(body)).toBe('Looks good');
  });

  it('drops the history Gmail quotes', () => {
    expect(ownReplyText('<div>No thanks</div><div class="gmail_quote">On Monday, Jarvis wrote: ...</div>')).toBe(
      'No thanks',
    );
  });

  it('drops plain-text quoted history in its common forms', () => {
    expect(ownReplyText('Yes\n\nOn Mon, 1 Jan 2026, Jarvis <jarvis@example.com> wrote:\n> Approve?')).toBe('Yes');
    expect(ownReplyText('Yes\n-----Original Message-----\nFrom: Jarvis')).toBe('Yes');
    expect(ownReplyText('Yes\n________________________________\nFrom: Jarvis')).toBe('Yes');
    expect(ownReplyText('Ja tak\nFra: Jarvis\nEmne: Godkend?')).toBe('Ja tak');
    expect(ownReplyText('Yes\n> Approve the budget?')).toBe('Yes');
  });

  it('is empty when nothing of the person is left', () => {
    expect(ownReplyText('<blockquote>Approve?</blockquote>')).toBe('');
  });
});
