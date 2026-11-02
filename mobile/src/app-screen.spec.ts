import { describe, expect, it } from 'bun:test';
import { glanceOf } from 'hologram';
import { chooseScreen, GLANCE_SHOWN_FOR_MS, glanceToShow, type ScreenState } from './app-screen';

const glance = glanceOf({
  id: 'glance-1',
  url: 'https://jarvis.example.com/artifacts/1',
  title: 'A parcel is coming today',
  generatedAt: '2026-11-01T07:30:00.000Z',
  actions: [],
});

const OPENED: ScreenState = {
  isLoaded: true,
  isGlanceRead: true,
  hasSettings: true,
  isEditingSettings: false,
  isSampling: false,
  isTouring: false,
  wasSummoned: false,
  glance,
  wantsToTalk: false,
  conversationUnderWay: false,
};

describe('which screen', () => {
  it('is the glance when the app is opened, set up, with one to show', () => {
    expect(chooseScreen(OPENED)).toBe('glance');
  });

  it('is the conversation, exactly as before, with no glance to show', () => {
    expect(chooseScreen({ ...OPENED, glance: undefined })).toBe('conversation');
  });

  it('is always Jarvis when he was summoned', () => {
    expect(chooseScreen({ ...OPENED, wasSummoned: true })).toBe('conversation');
  });

  it('is the conversation sir asked for from the glance, until it has ended', () => {
    expect(chooseScreen({ ...OPENED, wantsToTalk: true })).toBe('conversation');
  });

  it('never takes a conversation under way away for a glance that arrives meanwhile', () => {
    expect(chooseScreen({ ...OPENED, conversationUnderWay: true })).toBe('conversation');
  });

  it('keeps everything that came before glances ahead of one', () => {
    expect(chooseScreen({ ...OPENED, isLoaded: false })).toBe('loading');
    expect(chooseScreen({ ...OPENED, isGlanceRead: false })).toBe('loading');
    expect(chooseScreen({ ...OPENED, isSampling: true })).toBe('sample');
    expect(chooseScreen({ ...OPENED, isTouring: true })).toBe('onboarding');
    expect(chooseScreen({ ...OPENED, hasSettings: false })).toBe('settings');
    expect(chooseScreen({ ...OPENED, isEditingSettings: true })).toBe('settings');
  });
});

describe('the glance to show', () => {
  const made = Date.parse('2026-11-01T07:30:00.000Z');
  const newer = glanceOf({ ...glance, id: 'glance-2', generatedAt: '2026-11-01T09:00:00.000Z' });

  it('is the line’s, then the kept one, while there is a server', () => {
    expect(glanceToShow({ live: newer, kept: glance, hasServer: true, now: made })).toBe(newer);
    expect(glanceToShow({ live: undefined, kept: glance, hasServer: true, now: made })).toBe(glance);
    expect(glanceToShow({ live: newer, kept: glance, hasServer: false, now: made })).toBeUndefined();
  });

  it('is still shown while the server is rebuilding one that has grown three hours old', () => {
    // The server only starts a rebuild once a glance is three hours old, checks every quarter of an
    // hour, and the build takes minutes: a glance a little over three hours old is its current one.
    const whileRebuilding = made + 3 * 60 * 60 * 1000 + 20 * 60 * 1000;
    expect(glanceToShow({ live: glance, kept: glance, hasServer: true, now: whileRebuilding })).toBe(glance);
    expect(glanceToShow({ live: undefined, kept: glance, hasServer: true, now: whileRebuilding })).toBe(glance);
  });

  it('is still shown in the morning, after the quiet hours in which the server rebuilds none', () => {
    const lastBuiltAt = Date.parse('2026-11-01T21:50:00.000Z');
    const nextMorning = Date.parse('2026-11-02T05:10:00.000Z');
    const lastOfTheEvening = glanceOf({ ...glance, generatedAt: '2026-11-01T21:50:00.000Z' });
    expect(nextMorning - lastBuiltAt).toBeGreaterThan(7 * 60 * 60 * 1000);
    expect(glanceToShow({ live: lastOfTheEvening, kept: undefined, hasServer: true, now: nextMorning })).toBe(
      lastOfTheEvening,
    );
  });

  it('is none once its page is no longer hosted', () => {
    expect(glanceToShow({ live: undefined, kept: glance, hasServer: true, now: made + GLANCE_SHOWN_FOR_MS })).toBe(
      glance,
    );
    expect(
      glanceToShow({ live: undefined, kept: glance, hasServer: true, now: made + GLANCE_SHOWN_FOR_MS + 1 }),
    ).toBeUndefined();
  });
});
