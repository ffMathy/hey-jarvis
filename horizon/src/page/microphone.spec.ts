import { describe, expect, it } from 'bun:test';
import { MICROPHONE_BLOCKED } from '../wake/microphone';
import type { MicrophonePermission } from '../wake/types';
import { createMicrophoneKeeper, type KeptStream } from './microphone';

/** A stream with one track, which records whether it was stopped. */
class FakeStream implements KeptStream {
  readyState = 'live';
  stopped = false;

  getTracks() {
    return [{ stop: () => this.stop() }];
  }

  getAudioTracks() {
    return [this];
  }

  stop() {
    this.stopped = true;
    this.readyState = 'ended';
  }
}

function keeperOpening(open: () => Promise<FakeStream>, permission: MicrophonePermission = 'prompt') {
  return createMicrophoneKeeper({ permission: async () => permission, open });
}

describe('the microphone keeper', () => {
  it('asks by opening the stream, and keeps it for the room to take once', async () => {
    const stream = new FakeStream();
    const keeper = keeperOpening(async () => stream);
    expect(await keeper.ask()).toBe('granted');
    expect(keeper.take()).toBe(stream);
    expect(keeper.take()).toBeUndefined();
    expect(stream.stopped).toBe(false);
  });

  it('has nothing to hand over when nothing was asked', () => {
    expect(keeperOpening(async () => new FakeStream()).take()).toBeUndefined();
  });

  it('stops a stream that ended while it was kept, and hands over nothing', async () => {
    const stream = new FakeStream();
    const keeper = keeperOpening(async () => stream);
    await keeper.ask();
    stream.readyState = 'ended';
    expect(keeper.take()).toBeUndefined();
    expect(stream.stopped).toBe(true);
  });

  it('keeps only the latest stream when asked twice', async () => {
    const streams = [new FakeStream(), new FakeStream()];
    let opened = 0;
    const keeper = keeperOpening(async () => streams[opened++] ?? new FakeStream());
    await keeper.ask();
    await keeper.ask();
    expect(streams[0]?.stopped).toBe(true);
    expect(keeper.take()).toBe(streams[1]);
  });

  it('answers a refusal as denied, for the page to say how to allow it again', async () => {
    const blocked = keeperOpening(async () => {
      throw new Error(MICROPHONE_BLOCKED);
    });
    expect(await blocked.ask()).toBe('denied');
    const refusedSilently = keeperOpening(async () => {
      throw new Error('The microphone could not be opened: no reason given');
    }, 'denied');
    expect(await refusedSilently.ask()).toBe('denied');
  });

  it('passes any other failure on in its own words', async () => {
    const busy = keeperOpening(async () => {
      throw new Error('The microphone is busy or unavailable.');
    });
    await expect(busy.ask()).rejects.toThrow('The microphone is busy or unavailable.');
  });

  it('asks for the permission without prompting', async () => {
    expect(await keeperOpening(async () => new FakeStream(), 'granted').permission()).toBe('granted');
  });
});
