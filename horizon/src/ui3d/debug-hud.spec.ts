import { describe, expect, it } from 'bun:test';
import { describeDiagnostics, extensionsOfInterest } from './debug-hud';

describe('describeDiagnostics', () => {
  it('says nothing about parts that have nothing to report', () => {
    expect(describeDiagnostics({})).toEqual([]);
  });

  it('puts everything a headset needs looking at on short lines', () => {
    expect(
      describeDiagnostics({
        scene: 'present:live',
        xrVisibility: 'visible',
        documentVisibility: 'visible',
        audioContext: 'running',
        microphonePermission: 'granted',
        microphoneTrack: 'live',
        wake: {
          state: 'listening',
          level: 0.0123,
          score: 0.04,
          chunksPerSecond: 12.5,
          millisecondsPerChunk: 6.2,
          armed: true,
        },
        conversation: {
          phase: 'live',
          status: 'connected',
          mode: 'speaking',
          interruptions: 2,
          halfDuplex: true,
          vadScore: 0.31,
        },
        room: {
          planes: 17,
          meshes: 9,
          labels: { table: 4, wall: 6, '': 1 },
          triangles: 62102,
          placement: 'full 1.6 m',
        },
        frameRates: { supported: [72, 80, 90, 120], requested: 90, measured: 89.6 },
        frameMilliseconds: 11.1,
        hologram: { cpuMilliseconds: 1.84, density: 1, canvasKitMilliseconds: 3.2, surface: 'webgl' },
        webglExtensions: ['OCULUS_multiview'],
      }),
    ).toEqual([
      'scene present:live',
      'xr visible  page visible  audio running',
      'mic granted  track live',
      'wake listening armed  score 0.04  rms 0.012',
      'wake 12.5 chunks/s  6.2 ms/chunk',
      'call live  sdk connected/speaking  interruptions 2  half-duplex  vad 0.31',
      'room 17 planes  9 meshes  62102 triangles',
      'labels wall 6, table 4, (none) 1',
      'placed full 1.6 m',
      'rates 72/80/90/120  asked 90  got 90  frame 11.1 ms',
      'hologram cpu 1.8 ms  skia 3.2 ms webgl  density 1.00',
      'gl OCULUS_multiview',
    ]);
  });

  it('says why the wake word, the call or the room is in trouble, and what the session was granted', () => {
    expect(
      describeDiagnostics({
        wake: {
          state: 'broken',
          level: 0,
          score: 0,
          chunksPerSecond: 0,
          millisecondsPerChunk: 0,
          armed: false,
          problem: 'The microphone stopped — pinch to wake me',
          needsGesture: true,
        },
        wakeAudio: {
          contextState: 'running',
          sampleRate: 16000,
          droppedChunks: 3,
          recoveries: 1,
          profile: 'processed',
        },
        conversation: { phase: 'live', lastError: 'A server message could not be read.' },
        room: { planes: 3, meshes: 0, labels: {}, triangles: 0, voxels: 1200, problem: 'No floor was found.' },
        xrFeatures: ['local-floor', 'plane-detection'],
      }),
    ).toEqual([
      'wake broken  score 0.00  rms 0.000',
      'wake 0.0 chunks/s  0.0 ms/chunk',
      'wake: The microphone stopped — pinch to wake me (needs a select)',
      'wake audio running 16000 Hz  processed  dropped 3  recoveries 1',
      'call live',
      'call error: A server message could not be read.',
      'room 3 planes  0 meshes  0 triangles  1200 voxels',
      'labels no labels',
      'room: No floor was found.',
      'xr local-floor plane-detection',
    ]);
  });

  it('copes with a headset that offers no frame rates, a room with no labels and no numbers yet', () => {
    expect(
      describeDiagnostics({
        room: { planes: 0, meshes: 0, labels: {}, triangles: 0 },
        frameRates: { supported: [] },
        conversation: { phase: 'idle' },
        wake: {
          state: 'loading',
          level: Number.NaN,
          score: 0,
          chunksPerSecond: 0,
          millisecondsPerChunk: 0,
          armed: false,
        },
        webglExtensions: [],
      }),
    ).toEqual([
      'wake loading  score 0.00  rms –',
      'wake 0.0 chunks/s  0.0 ms/chunk',
      'call idle',
      'room 0 planes  0 meshes  0 triangles',
      'labels no labels',
      'rates fixed',
      'gl none of interest',
    ]);
  });

  it('says which tier his voice is on, why, and what the microphone said about echo', () => {
    const spatial = {
      route: 'spatial',
      reason: 'the headset cancels echo',
      echoCanceller: 'platform',
      elements: 1,
      elementVolume: 0,
    };
    expect(describeDiagnostics({ voice: spatial, conversation: { phase: 'live' } })).toEqual([
      'call live',
      'voice spatial (the headset cancels echo)  echo canceller platform  1 sdk element at volume 0',
    ]);

    const demoted = { ...spatial, route: 'element', reason: 'echo: he heard himself', elementVolume: 1 };
    expect(describeDiagnostics({ voice: demoted })).toEqual([
      'voice element (echo: he heard himself)  echo canceller platform  1 sdk element at volume 1',
    ]);
    // The third tier: the session muting the microphone while he speaks, on top of the element.
    expect(
      describeDiagnostics({ voice: { ...demoted, elements: 2 }, conversation: { phase: 'live', halfDuplex: true } }),
    ).toEqual([
      'call live  half-duplex',
      'voice element + half-duplex (echo: he heard himself)  echo canceller platform  2 sdk elements at volume 1',
    ]);
  });
});

describe('extensionsOfInterest', () => {
  it('keeps only the ones that matter, in a fixed order', () => {
    expect(extensionsOfInterest(['WEBGL_lose_context', 'EXT_color_buffer_float', 'OCULUS_multiview'])).toEqual([
      'OCULUS_multiview',
      'EXT_color_buffer_float',
    ]);
    expect(extensionsOfInterest(null)).toEqual([]);
  });
});
