import { describe, expect, it } from 'bun:test';
import { encodeArguments, filterGraph, greetingClips } from './demo-encode';

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
  it('delays every clip to its start and pads them all to the full length before mixing', () => {
    const graph = filterGraph(
      [
        { start: 1.25, duration: 2 },
        { start: 4.5, duration: 1 },
      ],
      TIMING,
    );
    expect(graph).toContain('asplit=2[greeting0][greeting1]');
    expect(graph).toContain('[greeting0]atrim=duration=2.000,adelay=1250|1250,apad=whole_dur=20.000[clip0]');
    expect(graph).toContain('[greeting1]atrim=duration=1.000,adelay=4500|4500,apad=whole_dur=20.000[clip1]');
    expect(graph).toContain('[clip0][clip1]amix=inputs=2:dropout_transition=0,volume=2,');
    expect(graph).toContain('fade=t=out:st=19.000:d=1.000');
    expect(graph.endsWith('[audio]')).toBe(true);
  });

  it('lays a silent track when he never speaks', () => {
    const graph = filterGraph([], TIMING);
    expect(graph).toContain('aevalsrc=0|0:c=stereo:s=48000:d=20.000');
    expect(graph).not.toContain('[1:a]');
  });
});

describe('encodeArguments', () => {
  it('encodes VP9 and Opus at the frame rate, from the frames and the recording', () => {
    const args = encodeArguments('frames/frame-%05d.png', 'greeting.mp3', 'out.webm', [], TIMING);
    expect(args.slice(args.indexOf('-framerate'), args.indexOf('-framerate') + 4)).toEqual([
      '-framerate',
      '30',
      '-i',
      'frames/frame-%05d.png',
    ]);
    expect(args[args.indexOf('-c:v') + 1]).toBe('libvpx-vp9');
    expect(args[args.indexOf('-c:a') + 1]).toBe('libopus');
    expect(args.at(-1)).toBe('out.webm');
  });
});
