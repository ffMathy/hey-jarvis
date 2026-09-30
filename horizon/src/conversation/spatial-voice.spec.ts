import { describe, expect, it } from 'bun:test';
import type { GreetingPlayer } from 'hologram';
import { createAgentElementVolume } from './agent-element-volume';
import {
  createSpatialVoice,
  DISCONNECT_AFTER_MS,
  type GainLike,
  hasSpatialAudio,
  type LevelLike,
  type ListenerLike,
  type MovableParam,
  type PannerLike,
  REFERENCE_DISTANCE_METRES,
  ROLLOFF,
  type SoundNode,
  type SpatialAudioContext,
} from './spatial-voice';
import { SETTLE_AFTER_MOVING_MS, type VoiceRouteChoice } from './voice-route';

// ─────────────────────────── a Web Audio that records what is done to it ───────────────────────────

/** An `AudioParam` that takes every value at once and remembers whether it was jumped or glided to. */
function fakeParam(initial = 0): MovableParam & { moves: string[] } {
  const param = {
    value: initial,
    moves: [] as string[],
    setValueAtTime: (value: number) => {
      param.value = value;
      param.moves.push(`jump ${value}`);
    },
    setTargetAtTime: (value: number) => {
      param.value = value;
      param.moves.push(`glide ${value}`);
    },
    cancelScheduledValues: () => undefined,
  };
  return param;
}

interface FakeNode extends SoundNode {
  kind: string;
  outputs: SoundNode[];
}

function fakeNode(kind: string): FakeNode {
  const node: FakeNode = {
    kind,
    outputs: [],
    connect: (destination) => {
      node.outputs.push(destination);
    },
    // In place, because the gains, the panner and the analyser are this node spread into another.
    disconnect: (destination) => {
      const index = node.outputs.indexOf(destination);
      if (index >= 0) node.outputs.splice(index, 1);
    },
  };
  return node;
}

function createFakeContext() {
  const made: FakeNode[] = [];
  let level = 0;
  const destination = fakeNode('destination');
  const listener: ListenerLike = {
    positionX: fakeParam(),
    positionY: fakeParam(),
    positionZ: fakeParam(),
    forwardX: fakeParam(),
    forwardY: fakeParam(),
    forwardZ: fakeParam(-1),
    upX: fakeParam(),
    upY: fakeParam(1),
    upZ: fakeParam(),
  };
  const context: SpatialAudioContext & { state: string } = {
    state: 'running',
    currentTime: 12.5,
    destination,
    listener,
    createGain: () => {
      const gain: GainLike & FakeNode = { ...fakeNode('gain'), gain: fakeParam(1) };
      made.push(gain);
      return gain;
    },
    createPanner: () => {
      const panner: PannerLike & FakeNode = {
        ...fakeNode('panner'),
        panningModel: 'equalpower',
        distanceModel: 'inverse',
        refDistance: 1,
        maxDistance: 10000,
        rolloffFactor: 1,
        positionX: fakeParam(),
        positionY: fakeParam(),
        positionZ: fakeParam(),
      };
      made.push(panner);
      return panner;
    },
    createAnalyser: () => {
      const analyser: LevelLike & FakeNode = {
        ...fakeNode('analyser'),
        fftSize: 2048,
        getFloatTimeDomainData: (array) => array.fill(level),
      };
      made.push(analyser);
      return analyser;
    },
  };
  return {
    context,
    made,
    listener,
    /** What his voice measures on its way into the panner, as a steady signal of this amplitude. */
    setLevel: (next: number) => {
      level = next;
    },
  };
}

/** Whether a signal put into `from` comes out of `to`. */
function reaches(from: SoundNode, to: SoundNode): boolean {
  if (from === to) return true;
  const outputs: unknown = Reflect.get(from, 'outputs');
  return Array.isArray(outputs) && outputs.some((output: SoundNode) => reaches(output, to));
}

// ─────────────────────────── the rest of the page ───────────────────────────

function createFakeGreeting() {
  const player: GreetingPlayer & { plays: number } = {
    plays: 0,
    playFromStart: async () => {
      player.plays++;
      return true;
    },
    stop: () => undefined,
    position: () => -1,
    duration: 3.1,
  };
  return player;
}

function stream(state = 'live') {
  const tracks = [{ readyState: state }];
  return { getAudioTracks: () => tracks };
}

const CAN_PLACE_HIM: VoiceRouteChoice = { setting: true, forced: false, echoCanceller: 'platform', webAudio: true };
const CANNOT_PLACE_HIM: VoiceRouteChoice = { ...CAN_PLACE_HIM, echoCanceller: 'browser' };

/** The head at 1.6 m, looking along −Z, and him 1.6 m ahead of it. */
const HEAD = { position: { x: 0, y: 1.6, z: 1.2 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
const HIM = { x: 0, y: 1.45, z: -0.4 };

function createVoice(choice: VoiceRouteChoice = CAN_PLACE_HIM, { captureFails = false } = {}) {
  const audio = createFakeContext();
  let time = 1_000;
  const sdkElement = { srcObject: stream(), volume: 1, muted: false, paused: false };
  const page: unknown[] = [sdkElement];
  let captures = 0;
  const greetingSource = fakeNode('greeting-source');
  const voice = createSpatialVoice({
    context: audio.context,
    captureGreeting: () => {
      captures++;
      if (captureFails) throw new DOMException('Already connected to a source.', 'InvalidStateError');
      return greetingSource;
    },
    elements: createAgentElementVolume({ onPage: () => page, watchAdded: () => () => undefined }),
    now: () => time,
    choice,
  });
  const panner = () => audio.made.find((node) => node.kind === 'panner');
  return {
    voice,
    audio,
    sdkElement,
    greetingSource,
    panner,
    get captures() {
      return captures;
    },
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
    /** Frames for `milliseconds`, 14 ms apart, with the head and him where they are. */
    frames: (milliseconds: number) => {
      for (let elapsed = 0; elapsed < milliseconds; elapsed += 14) {
        time += 14;
        voice.follow(HEAD, HIM);
      }
    },
  };
}

// ─────────────────────────── the specs ───────────────────────────

describe('on a headset whose voice stays on the element', () => {
  it('builds nothing, takes nothing into Web Audio, and leaves the SDK’s element alone', async () => {
    const { voice, audio, sdkElement, frames, ...harness } = createVoice(CANNOT_PLACE_HIM);
    const greeting = createFakeGreeting();

    frames(500);
    expect(await voice.greeting(greeting).playFromStart()).toBe(true);
    const stop = voice.playAgent(fakeNode('his-track'));
    frames(500);

    expect(audio.made).toEqual([]);
    expect(harness.captures).toBe(0);
    expect(greeting.plays).toBe(1);
    expect(sdkElement.volume).toBe(1);
    expect(voice.report).toMatchObject({ route: 'element', reason: 'browser-echo-canceller', greeting: 'element' });
    expect(voice.report.speaker).toBeNull();
    stop();
    expect(voice.halfDuplexMayJudge()).toBe(true);
  });
});

describe('his voice from where he stands', () => {
  it('greets through one HRTF panner at his centre, taking the greeting in only once', async () => {
    const harness = createVoice();
    const { voice, frames, greetingSource } = harness;
    const greeting = voice.greeting(createFakeGreeting());
    frames(100);

    expect(await greeting.playFromStart()).toBe(true);
    expect(await greeting.playFromStart()).toBe(true);

    expect(harness.captures).toBe(1);
    const panner = harness.panner();
    if (panner === undefined) throw new Error('No panner was made.');
    expect(panner).toMatchObject({
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: REFERENCE_DISTANCE_METRES,
      rolloffFactor: ROLLOFF,
    });
    expect(reaches(greetingSource, panner)).toBe(true);
    expect(reaches(panner, harness.audio.context.destination)).toBe(true);
    // Placed where he already stood when the graph was made, at once rather than from the origin.
    expect(Reflect.get(panner, 'positionZ')).toMatchObject({ value: HIM.z, moves: [`jump ${HIM.z}`] });
    expect(voice.report.greeting).toBe('spatial');
  });

  it('follows the head every frame: where it is, where it faces and which way is up', async () => {
    const { voice, audio, frames } = createVoice();
    await voice.greeting(createFakeGreeting()).playFromStart();
    frames(14);
    expect(audio.listener.positionY.value).toBe(1.6);
    expect(audio.listener.positionZ.value).toBe(1.2);

    // A quarter turn to the left: facing −X, the top of the head still up.
    const turned = {
      position: { x: 0.1, y: 1.6, z: 1.2 },
      orientation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    };
    voice.follow(turned, HIM);

    expect(audio.listener.positionX.value).toBeCloseTo(0.1);
    expect(audio.listener.forwardX.value).toBeCloseTo(-1);
    expect(audio.listener.forwardZ.value).toBeCloseTo(0);
    expect(audio.listener.upY.value).toBeCloseTo(1);
    // The first placement is jumped to, and small steps after it are glided.
    expect(Reflect.get(audio.listener.positionX, 'moves')).toEqual(['jump 0', 'glide 0.1']);
    expect(voice.report.listener).toEqual(turned.position);
  });

  it('jumps to a new spot, and glides after him as his anchor settles', async () => {
    const harness = createVoice();
    const { voice } = harness;
    await voice.greeting(createFakeGreeting()).playFromStart();
    voice.follow(HEAD, HIM);
    voice.follow(HEAD, { ...HIM, x: HIM.x + 0.01 });
    voice.follow(HEAD, undefined);
    voice.follow(HEAD, { x: 1.5, y: 1.4, z: 0 });

    const panner = harness.panner();
    expect(Reflect.get(panner ?? {}, 'positionX')).toMatchObject({ moves: ['jump 0', 'glide 0.01', 'jump 1.5'] });
    expect(voice.report.speaker).toEqual({ x: 1.5, y: 1.4, z: 0 });
  });

  it('plays his track through the panner, with the SDK’s element kept playing at volume 0', () => {
    const harness = createVoice();
    const { voice, sdkElement } = harness;
    const track = fakeNode('his-track');

    const stop = voice.playAgent(track);

    const panner = harness.panner();
    if (panner === undefined) throw new Error('No panner was made.');
    expect(reaches(track, panner)).toBe(true);
    expect(sdkElement).toMatchObject({ volume: 0, muted: false, paused: false });

    stop();
    expect(reaches(track, panner)).toBe(false);
    expect(sdkElement.volume).toBe(1);
  });

  it('keeps the half-duplex fallback from judging while he is spatial', () => {
    const { voice } = createVoice();
    expect(voice.halfDuplexMayJudge()).toBe(false);
  });
});

describe('moving him back to the headset', () => {
  async function spatialAndSpeaking() {
    const harness = createVoice();
    const greeting = voice(harness).greeting(createFakeGreeting());
    await greeting.playFromStart();
    harness.voice.conversationOpened(() => true);
    const track = fakeNode('his-track');
    harness.voice.playAgent(track);
    harness.audio.setLevel(0.05);
    harness.frames(1_000);
    return { ...harness, greeting, track };
  }

  function voice(harness: ReturnType<typeof createVoice>) {
    return harness.voice;
  }

  it('on an echo: the element back at volume 1, the panner faded out, then disconnected', async () => {
    const harness = await spatialAndSpeaking();
    const { voice: spatial, sdkElement, track } = harness;
    spatial.interrupted();
    spatial.interrupted();

    expect(spatial.report).toMatchObject({ route: 'element', reason: 'echo-unexplained-interruptions' });
    expect(sdkElement.volume).toBe(1);
    const panner = harness.panner();
    if (panner === undefined) throw new Error('No panner was made.');
    const agentGain = harness.audio.made.find(
      (node) => node.kind === 'gain' && node.outputs.includes(panner) && reaches(track, node),
    );
    expect(Reflect.get(agentGain ?? {}, 'gain')).toMatchObject({ value: 0 });
    expect(reaches(track, panner)).toBe(true);

    harness.advance(DISCONNECT_AFTER_MS);
    spatial.follow(HEAD, HIM);
    expect(reaches(track, panner)).toBe(false);
  });

  it('greets centred from then on, through the dry branch, since the greeting cannot be given back', async () => {
    const harness = await spatialAndSpeaking();
    harness.voice.heard({ role: 'agent', message: 'The suit is ready for testing, sir.' });
    harness.voice.heard({ role: 'user', message: 'the suit is ready for testing' });
    expect(harness.voice.report.reason).toBe('echo-transcript');

    expect(await harness.greeting.playFromStart()).toBe(true);
    expect(harness.voice.report.greeting).toBe('dry');
    const panner = harness.panner();
    if (panner === undefined) throw new Error('No panner was made.');
    const pannedGain = harness.audio.made.find(
      (node) => node.kind === 'gain' && node.outputs.includes(panner) && reaches(harness.greetingSource, node),
    );
    expect(Reflect.get(pannedGain ?? {}, 'gain')).toMatchObject({ value: 0 });
    expect(reaches(harness.greetingSource, harness.audio.context.destination)).toBe(true);
  });

  it('lets the half-duplex fallback judge again once the echo canceller has settled', async () => {
    const harness = await spatialAndSpeaking();
    harness.voice.heard({ role: 'agent', message: 'The suit is ready for testing, sir.' });
    harness.voice.heard({ role: 'user', message: 'the suit is ready for testing' });
    expect(harness.voice.halfDuplexMayJudge()).toBe(false);
    harness.advance(SETTLE_AFTER_MOVING_MS);
    expect(harness.voice.halfDuplexMayJudge()).toBe(true);
  });

  it('when nothing reaches the panner while LiveKit’s server hears him', async () => {
    const harness = await spatialAndSpeaking();
    harness.audio.setLevel(0);
    harness.frames(1_000);
    expect(harness.voice.report.route).toBe('spatial');
    harness.frames(700);
    expect(harness.voice.report.reason).toBe('spatial-silent');
    expect(harness.sdkElement.volume).toBe(1);
  });

  it('when the AudioContext stops: a greeting already taken in is refused rather than played in silence', async () => {
    const harness = await spatialAndSpeaking();
    harness.audio.context.state = 'suspended';

    expect(await harness.greeting.playFromStart()).toBe(false);
    expect(harness.voice.report.reason).toBe('context-not-running');
    expect(harness.sdkElement.volume).toBe(1);
  });

  it('when the AudioContext has stopped before he ever greeted: the greeting stays on its element', async () => {
    const harness = createVoice();
    harness.audio.context.state = 'suspended';
    const player = createFakeGreeting();

    expect(await harness.voice.greeting(player).playFromStart()).toBe(true);
    expect(harness.captures).toBe(0);
    expect(player.plays).toBe(1);
    expect(harness.voice.report).toMatchObject({
      route: 'element',
      reason: 'context-not-running',
      greeting: 'element',
    });
  });

  it('holds for every room after it on the page, and a new conversation starts with nothing against it', async () => {
    const harness = await spatialAndSpeaking();
    harness.voice.interrupted();
    harness.voice.interrupted();
    harness.voice.choose(CAN_PLACE_HIM);
    expect(harness.voice.report).toMatchObject({ route: 'element', reason: 'echo-unexplained-interruptions' });
    // A track played after the move goes nowhere near the panner.
    const next = fakeNode('his-next-track');
    harness.voice.playAgent(next);
    expect(reaches(next, harness.panner() ?? next)).toBe(false);
  });
});

describe('what cannot be done', () => {
  it('a greeting the page cannot take into Web Audio plays from its element, and he stays spatial', async () => {
    const harness = createVoice(CAN_PLACE_HIM, { captureFails: true });
    const player = createFakeGreeting();
    expect(await harness.voice.greeting(player).playFromStart()).toBe(true);
    expect(player.plays).toBe(1);
    expect(harness.voice.report).toMatchObject({ route: 'spatial', greeting: 'element' });
  });

  it('a browser without a positioned listener has no spatial audio', () => {
    expect(hasSpatialAudio({})).toBe(false);
    expect(
      hasSpatialAudio({ createPanner: () => undefined, createMediaElementSource: () => undefined, listener: {} }),
    ).toBe(false);
    expect(
      hasSpatialAudio({
        createPanner: () => undefined,
        createMediaElementSource: () => undefined,
        listener: { positionX: fakeParam() },
      }),
    ).toBe(true);
  });

  it('reports the tier, why and the elements for the HUD', () => {
    const { voice } = createVoice();
    expect(voice.diagnostics()).toEqual({
      route: 'spatial',
      reason: 'the headset cancels echo',
      echoCanceller: 'platform',
      elements: 1,
      elementVolume: 1,
    });
  });
});
