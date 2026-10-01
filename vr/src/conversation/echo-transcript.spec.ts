import { describe, expect, it } from 'bun:test';
import { createTranscriptEchoWatch, ECHO_WINDOW_MS, soundsLikeEcho, wordsOf } from './echo-transcript';

const HIS_LINE =
  'The forecast for tomorrow is light rain in the morning, clearing by the afternoon, sir. Shall I set a reminder?';

describe('wordsOf', () => {
  it('reads words the way speech recognition writes them: lower case, no accents, no punctuation', () => {
    expect(wordsOf('Café au lait, SIR — at 7:30?')).toEqual(['cafe', 'au', 'lait', 'sir', 'at', '7', '30']);
    expect(wordsOf('   ')).toEqual([]);
  });
});

describe('soundsLikeEcho', () => {
  it('hears his line coming back, whole or in part, however it was punctuated', () => {
    expect(soundsLikeEcho('the forecast for tomorrow is light rain', HIS_LINE)).toBe(true);
    expect(soundsLikeEcho('Clearing by the afternoon sir', HIS_LINE)).toBe(true);
    expect(soundsLikeEcho('shall I set a reminder', HIS_LINE)).toBe(true);
  });

  it('forgives a word or two misheard, when most of what was heard is his', () => {
    expect(soundsLikeEcho('shall eye set a reminder', 'Shall I set a reminder?')).toBe(true);
  });

  it('does not mistake an answer to him for his own words', () => {
    expect(soundsLikeEcho('yes please remind me at eight', HIS_LINE)).toBe(false);
    expect(soundsLikeEcho('what about the weekend then', HIS_LINE)).toBe(false);
  });

  it('never judges a transcript too short to tell, since people do say his words back to him', () => {
    expect(soundsLikeEcho('yes sir', 'Yes, sir.')).toBe(false);
    expect(soundsLikeEcho('okay', 'Okay.')).toBe(false);
  });

  it('matches nothing against an empty line', () => {
    expect(soundsLikeEcho('the forecast for tomorrow', '')).toBe(false);
  });
});

describe('the transcript echo watch', () => {
  function clock() {
    let time = 0;
    return {
      now: () => time,
      advance: (milliseconds: number) => {
        time += milliseconds;
      },
    };
  }

  it('catches his line coming back while it is recent', () => {
    const time = clock();
    const watch = createTranscriptEchoWatch(time.now);
    watch.agentSaid(HIS_LINE);
    time.advance(2_000);
    expect(watch.userSaid('light rain in the morning')).toBe(true);
    expect(watch.userSaid('yes please')).toBe(false);
  });

  it('forgets a line nobody has heard for longer than the window', () => {
    const time = clock();
    const watch = createTranscriptEchoWatch(time.now);
    watch.agentSaid(HIS_LINE);
    time.advance(ECHO_WINDOW_MS + 1);
    expect(watch.userSaid('light rain in the morning')).toBe(false);
  });

  it('keeps the latest line for as long as he is still heard saying it', () => {
    const time = clock();
    const watch = createTranscriptEchoWatch(time.now);
    watch.agentSaid(HIS_LINE);
    for (let second = 0; second < 15; second++) {
      time.advance(1_000);
      watch.agentHeard();
    }
    time.advance(ECHO_WINDOW_MS - 1);
    expect(watch.userSaid('shall I set a reminder')).toBe(true);
  });

  it('starts every conversation with nothing said', () => {
    const watch = createTranscriptEchoWatch(clock().now);
    watch.agentSaid(HIS_LINE);
    watch.reset();
    expect(watch.userSaid('light rain in the morning')).toBe(false);
  });

  it('ignores a line with nothing in it', () => {
    const watch = createTranscriptEchoWatch(clock().now);
    watch.agentSaid('   ');
    watch.agentHeard();
    expect(watch.userSaid('anything at all here')).toBe(false);
  });
});
