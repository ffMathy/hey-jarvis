import { describe, expect, it } from 'bun:test';
import { mergeClientTools } from './client-tools';

/**
 * Two hooks each answering a client tool of their own, and a spread that would quietly keep only
 * one of them — the tool that went missing then fails at the end of every request.
 */
describe('handing the session every hook’s client tools', () => {
  it('keeps every tool from every hook', () => {
    const hangUp = () => undefined;
    const camera = () => 'a photo';

    const tools = mergeClientTools({ hangUpWhenQuiet: hangUp }, { openCamera: camera });

    expect(tools).toEqual({ hangUpWhenQuiet: hangUp, openCamera: camera });
  });

  it('refuses two hooks answering the same tool, rather than keeping one of them', () => {
    expect(() => mergeClientTools({ openCamera: () => 'here' }, { openCamera: () => 'there' })).toThrow('openCamera');
  });

  it('leaves the sets it was given alone', () => {
    const first = { hangUpWhenQuiet: () => undefined };
    const second = { openCamera: () => 'a photo' };

    mergeClientTools(first, second);

    expect(Object.keys(first)).toEqual(['hangUpWhenQuiet']);
    expect(Object.keys(second)).toEqual(['openCamera']);
  });
});
