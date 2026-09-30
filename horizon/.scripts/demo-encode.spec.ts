import { describe, expect, it } from 'bun:test';
import { decodeArguments, encodeArguments, filterGraph, greetingClips } from './demo-encode';

const TIMING = { seconds: 20, framesPerSecond: 30, fadeInSeconds: 0.5, fadeOutSeconds: 1 };

describe('greetingClips', () => {
  it('repeats the recording on sample mode’s beat for as long as he speaks, cut where he stops', () => {
    const clips = greetingClips([{ start: 1, end: 8 }], 2, 3);
    expect(clips).toEqual([
      { start: 1, duration: 2 },
      { start: 4, duration: 2 },
      { start: 7, duration: 1 },
    ]);
  });

  it('starts no repeat in the fade out, but lets one already playing run on into it', () => {
    expect(greetingClips([{ start: 1, end: 12 }], 2, 3, 9.5)).toEqual([
      { start: 1, duration: 2 },
      { start: 4, duration: 2 },
      { start: 7, duration: 2 },
    ]);
  });

  it('starts again from the beginning at every span, and drops slivers too short to be words', () => {
    const clips = greetingClips(
      [
        { start: 0, end: 3.02 },
        { start: 10, end: 11 },
      ],
      2,
      3,
    );
    expect(clips).toEqual([
      { start: 0, duration: 2 },
      { start: 10, duration: 1 },
    ]);
  });
});

describe('filterGraph', () => {
  it('fades the frames in and out, and the soundtrack out with them, cut to the film’s length', () => {
    const graph = filterGraph(TIMING);
    expect(graph).toContain('[0:v]fade=t=in:st=0:d=0.500,fade=t=out:st=19.000:d=1.000,format=yuv420p[video]');
    expect(graph).toContain('[1:a]atrim=duration=20.000,afade=t=out:st=19.000:d=1.000[audio]');
  });
});

describe('encodeArguments', () => {
  it('encodes VP9 and Opus at the frame rate, from the frames and the soundtrack', () => {
    const args = encodeArguments('frames/frame-%05d.png', 'frames/soundtrack.wav', 'out.webm', TIMING);
    expect(args.slice(args.indexOf('-framerate'), args.indexOf('-framerate') + 6)).toEqual([
      '-framerate',
      '30',
      '-i',
      'frames/frame-%05d.png',
      '-i',
      'frames/soundtrack.wav',
    ]);
    expect(args[args.indexOf('-c:v') + 1]).toBe('libvpx-vp9');
    expect(args[args.indexOf('-c:a') + 1]).toBe('libopus');
    expect(args.at(-1)).toBe('out.webm');
  });
});

describe('decodeArguments', () => {
  it('decodes the recording to one channel of raw floats at the soundtrack’s rate, on standard output', () => {
    const args = decodeArguments('greeting.mp3', 48000);
    expect(args.slice(args.indexOf('-i'), args.indexOf('-i') + 2)).toEqual(['-i', 'greeting.mp3']);
    expect(args[args.indexOf('-ac') + 1]).toBe('1');
    expect(args[args.indexOf('-ar') + 1]).toBe('48000');
    expect(args[args.indexOf('-f') + 1]).toBe('f32le');
    expect(args.at(-1)).toBe('pipe:1');
  });
});
