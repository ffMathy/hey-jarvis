import { describe, expect, it } from 'bun:test';
import { readingMilliseconds, SAMPLE_MODE_NAMES, SAMPLE_MODES } from 'hologram';
import type { Ray } from '../xr/ray';
import {
  type AppEffect,
  type AppEvent,
  type AppModel,
  BLURRED_CALL_LIMIT_MS,
  HINT_LINES,
  initialAppModel,
  NOT_LISTENING_LINE,
  reduceApp,
  SHORTEST_ERROR_MS,
  TOAST_MS,
  UNEXPLAINED_FAILURE,
  viewOf,
  type WakeReadiness,
} from './app-state';

const LISTENING: WakeReadiness = { kind: 'listening' };
const RAY: Ray = { origin: { x: 0.2, y: 1.2, z: 0 }, direction: { x: 0, y: 0, z: -1 } };

/** A room driven one event at a time, keeping the effects of the last one and a clock that only moves when told. */
class Room {
  model: AppModel;
  effects: AppEffect[] = [];
  now = 1000;

  constructor(wake: WakeReadiness = LISTENING) {
    this.model = initialAppModel(wake);
  }

  send(event: AppEvent): AppEffect[] {
    const step = reduceApp(this.model, event, this.now);
    this.model = step.model;
    this.effects = step.effects;
    return step.effects;
  }

  after(milliseconds: number, event: AppEvent = { type: 'tick' }): AppEffect[] {
    this.now += milliseconds;
    return this.send(event);
  }

  /** Straight into a conversation that has reached `phase`, with the effects of getting there thrown away. */
  inConversation(phase: 'greeting' | 'connecting' | 'live' = 'live', canType = true): this {
    this.send({ type: 'entered', mode: 'conversation', canType });
    this.send({ type: 'wake' });
    this.send({ type: 'placed' });
    this.send({ type: 'session-phase', phase });
    return this;
  }

  inSample(): this {
    this.send({ type: 'entered', mode: 'sample' });
    this.send({ type: 'placed' });
    return this;
  }

  get scene() {
    return this.model.scene;
  }

  get view() {
    return viewOf(this.model);
  }
}

function types(effects: AppEffect[]): string[] {
  return effects.map((effect) => effect.type);
}

describe('entering the room', () => {
  it('waits for the wake word, with the frame rate down, the wake word armed and the hint up', () => {
    const room = new Room();
    const effects = room.send({ type: 'entered', mode: 'conversation' });
    expect(room.scene).toEqual({ kind: 'waiting' });
    expect(effects).toEqual([
      { type: 'show-panel', panel: 'hint', lines: HINT_LINES },
      { type: 'set-frame-rate', target: 'lowest' },
      { type: 'arm-wake' },
    ]);
    expect(room.view.hologram).toBe('hidden');
  });

  it('shows no hint and arms nothing when there is no wake engine at all', () => {
    const room = new Room({ kind: 'absent' });
    expect(room.send({ type: 'entered', mode: 'conversation' })).toEqual([
      { type: 'set-frame-rate', target: 'lowest' },
    ]);
  });

  it('shows no hint until the wake engine is really listening', () => {
    const room = new Room({ kind: 'not-listening', problem: 'Getting ready.' });
    room.send({ type: 'entered', mode: 'conversation' });
    expect(room.view.panels.hint).toBeNull();
    expect(room.send({ type: 'wake-health', readiness: LISTENING })).toEqual([
      { type: 'show-panel', panel: 'hint', lines: HINT_LINES },
      { type: 'hide-panel', panel: 'status' },
    ]);
  });

  it('starts a fresh session, forgetting the last one but not the wake engine', () => {
    const room = new Room().inConversation();
    room.send({ type: 'session-ended' });
    room.send({ type: 'entered', mode: 'conversation' });
    expect(room.model).toEqual({ ...initialAppModel(LISTENING), scene: { kind: 'waiting' } });
  });
});

describe('summoning him', () => {
  it('finds him a spot when the wake word fires, facing the way the head does', () => {
    const room = new Room();
    room.send({ type: 'entered', mode: 'conversation' });
    const effects = room.send({ type: 'wake' });
    expect(room.scene).toEqual({ kind: 'placing', purpose: 'conversation', towards: undefined });
    expect(effects).toEqual([
      { type: 'place', towards: undefined },
      { type: 'hide-panel', panel: 'hint' },
      { type: 'set-frame-rate', target: 'highest' },
      { type: 'disarm-wake' },
    ]);
  });

  it('finds him a spot along the ray of a select', () => {
    const room = new Room();
    room.send({ type: 'entered', mode: 'conversation' });
    const effects = room.send({ type: 'select', hold: 'short', target: 'elsewhere', ray: RAY });
    expect(effects[0]).toEqual({ type: 'place', towards: RAY });
  });

  it('summons him on a held select too, when there is nobody to hang up on', () => {
    const room = new Room();
    room.send({ type: 'entered', mode: 'conversation' });
    expect(types(room.send({ type: 'select', hold: 'long', target: 'elsewhere' }))).toContain('place');
  });

  it('arrives and dials once the spot is found', () => {
    const room = new Room();
    room.send({ type: 'entered', mode: 'conversation' });
    room.send({ type: 'wake' });
    const effects = room.send({ type: 'placed' });
    expect(room.scene).toEqual({ kind: 'present', sessionPhase: 'idle' });
    expect(effects).toEqual([{ type: 'arrive' }, { type: 'summon' }, { type: 'hologram', state: 'shown' }]);
  });

  it('ignores selects and the wake word while the spot is being found', () => {
    const room = new Room();
    room.send({ type: 'entered', mode: 'conversation' });
    room.send({ type: 'wake' });
    const before = room.model;
    expect(room.send({ type: 'select', hold: 'short', target: 'elsewhere' })).toEqual([]);
    expect(room.send({ type: 'wake' })).toEqual([]);
    expect(room.send({ type: 'dismiss-button' })).toEqual([]);
    expect(room.model).toBe(before);
  });

  it('ignores a spot that arrives after the summon was abandoned', () => {
    const room = new Room();
    room.send({ type: 'entered', mode: 'conversation' });
    room.send({ type: 'wake' });
    room.send({ type: 'visibility', state: 'hidden' });
    expect(room.send({ type: 'placed' })).toEqual([]);
    expect(room.scene).toEqual({ kind: 'waiting' });
  });

  it('follows the conversation through its phases', () => {
    const room = new Room();
    room.inConversation('greeting');
    expect(room.scene).toEqual({ kind: 'present', sessionPhase: 'greeting' });
    room.send({ type: 'session-phase', phase: 'connecting' });
    expect(room.scene).toEqual({ kind: 'present', sessionPhase: 'connecting' });
    room.send({ type: 'session-phase', phase: 'live' });
    expect(room.scene).toEqual({ kind: 'present', sessionPhase: 'live' });
  });

  it('does not show the hint again once he has been summoned', () => {
    const room = new Room().inConversation();
    room.send({ type: 'session-phase', phase: 'ended' });
    room.send({ type: 'presence-gone' });
    expect(room.scene).toEqual({ kind: 'waiting' });
    expect(room.view.panels.hint).toBeNull();
  });
});

describe('dismissing him', () => {
  it('hangs up on a held select, and he leaves', () => {
    const room = new Room().inConversation();
    const effects = room.send({ type: 'select', hold: 'long', target: 'elsewhere' });
    expect(room.scene).toEqual({ kind: 'leaving', afterwards: 'wait' });
    expect(effects).toEqual([
      { type: 'hang-up' },
      { type: 'hologram', state: 'leaving' },
      { type: 'hide-panel', panel: 'keyboard' },
      { type: 'arm-wake' },
    ]);
  });

  it('hangs up on the B or Y button', () => {
    for (const phase of ['greeting', 'connecting', 'live'] as const) {
      const room = new Room().inConversation(phase, false);
      expect(types(room.send({ type: 'dismiss-button' }))).toEqual(['hang-up', 'hologram', 'arm-wake']);
    }
  });

  it('hangs up while he is still greeting', () => {
    const room = new Room().inConversation('greeting');
    expect(types(room.send({ type: 'select', hold: 'long', target: 'him' }))[0]).toBe('hang-up');
  });

  it('does nothing on a short select during a call, on him or anywhere else', () => {
    for (const target of ['him', 'elsewhere'] as const) {
      const room = new Room().inConversation();
      const before = room.model;
      expect(room.send({ type: 'select', hold: 'short', target })).toEqual([]);
      expect(room.model).toBe(before);
    }
  });

  it('leaves when the conversation ends by itself', () => {
    const room = new Room().inConversation();
    room.send({ type: 'session-phase', phase: 'ended' });
    expect(room.scene).toEqual({ kind: 'leaving', afterwards: 'wait' });
  });

  it('waits for the wake word again once he has gone, with the frame rate back down', () => {
    const room = new Room().inConversation();
    room.send({ type: 'dismiss-button' });
    expect(room.send({ type: 'presence-gone' })).toEqual([
      { type: 'hologram', state: 'hidden' },
      { type: 'set-frame-rate', target: 'lowest' },
    ]);
    expect(room.scene).toEqual({ kind: 'waiting' });
    expect(room.view.wakeArmed).toBe(true);
  });

  it('ignores the "ended" that follows its own hang-up', () => {
    const room = new Room().inConversation();
    room.send({ type: 'dismiss-button' });
    expect(room.send({ type: 'session-phase', phase: 'ended' })).toEqual([]);
    expect(room.scene).toEqual({ kind: 'leaving', afterwards: 'wait' });
  });

  it('summons him again where he stands on a select while he is leaving', () => {
    const room = new Room().inConversation();
    room.send({ type: 'dismiss-button' });
    const effects = room.send({ type: 'select', hold: 'short', target: 'elsewhere', ray: RAY });
    expect(room.scene).toEqual({ kind: 'present', sessionPhase: 'idle' });
    expect(effects).toEqual([
      { type: 'arrive' },
      { type: 'summon' },
      { type: 'hologram', state: 'shown' },
      { type: 'disarm-wake' },
    ]);
  });

  it('summons him again on the wake word while he is leaving', () => {
    const room = new Room().inConversation();
    room.send({ type: 'session-phase', phase: 'ended' });
    expect(types(room.send({ type: 'wake' })).slice(0, 2)).toEqual(['arrive', 'summon']);
  });

  it('arms the wake word only once his voice has been quiet for a while', () => {
    const room = new Room().inConversation('live', false);
    room.send({ type: 'voice-quiet', quiet: false });
    expect(types(room.send({ type: 'dismiss-button' }))).toEqual(['hang-up', 'hologram']);
    expect(room.view.wakeArmed).toBe(false);
    room.send({ type: 'presence-gone' });
    expect(room.view.wakeArmed).toBe(false);
    expect(room.send({ type: 'voice-quiet', quiet: true })).toEqual([{ type: 'arm-wake' }]);
    expect(room.scene).toEqual({ kind: 'waiting' });
  });

  it('disarms the wake word again if he is heard before he has gone', () => {
    const room = new Room().inConversation();
    room.send({ type: 'session-phase', phase: 'ended' });
    expect(room.view.wakeArmed).toBe(true);
    expect(room.send({ type: 'voice-quiet', quiet: false })).toEqual([{ type: 'disarm-wake' }]);
    expect(room.send({ type: 'voice-quiet', quiet: false })).toEqual([]);
  });

  it('does not summon him again on a held select while he is leaving: that is someone still hanging up', () => {
    const room = new Room().inConversation();
    room.send({ type: 'dismiss-button' });
    expect(room.send({ type: 'select', hold: 'long', target: 'elsewhere' })).toEqual([]);
    expect(room.send({ type: 'dismiss-button' })).toEqual([]);
  });
});

describe('failures', () => {
  it('holds the problem at his spot, hands it to the page, and keeps him there', () => {
    const room = new Room().inConversation('greeting');
    const problem = 'ElevenLabs rejected the API key. Check it in the settings.';
    expect(room.send({ type: 'problem', message: problem })).toEqual([]);
    const effects = room.send({ type: 'session-phase', phase: 'failed' });
    expect(room.scene).toEqual({ kind: 'failed', problem, until: room.now + SHORTEST_ERROR_MS });
    expect(effects).toEqual([
      { type: 'remember-problem', message: problem },
      { type: 'show-panel', panel: 'error', lines: [problem] },
    ]);
    expect(room.view.hologram).toBe('shown');
    expect(room.view.wakeArmed).toBe(false);
  });

  it('keeps a long problem up for as long as it takes to read', () => {
    const room = new Room().inConversation('connecting');
    const problem = 'A problem with a great deal to say about itself, '.repeat(4).trim();
    room.send({ type: 'problem', message: problem });
    room.send({ type: 'session-phase', phase: 'failed' });
    expect(readingMilliseconds(problem)).toBeGreaterThan(SHORTEST_ERROR_MS);
    expect(room.scene).toEqual({ kind: 'failed', problem, until: room.now + readingMilliseconds(problem) });
  });

  it('says something even when the conversation failed without a reason', () => {
    const room = new Room().inConversation('connecting');
    room.send({ type: 'session-phase', phase: 'failed' });
    expect(room.scene).toMatchObject({ kind: 'failed', problem: UNEXPLAINED_FAILURE });
  });

  it('keeps the wake word disarmed after a failure while the greeting still echoes', () => {
    const room = new Room().inConversation('greeting');
    room.send({ type: 'voice-quiet', quiet: false });
    room.send({ type: 'session-phase', phase: 'failed' });
    expect(types(room.after(SHORTEST_ERROR_MS))).toEqual(['hologram', 'hide-panel']);
    expect(types(room.send({ type: 'voice-quiet', quiet: true }))).toEqual(['arm-wake']);
  });

  it('lets him leave and re-arms the wake word once the problem has been up long enough', () => {
    const room = new Room().inConversation('live');
    room.send({ type: 'problem', message: 'The connection to Jarvis dropped.' });
    room.send({ type: 'session-phase', phase: 'failed' });
    expect(room.after(SHORTEST_ERROR_MS - 1)).toEqual([]);
    expect(room.after(1)).toEqual([
      { type: 'hologram', state: 'leaving' },
      { type: 'hide-panel', panel: 'error' },
      { type: 'arm-wake' },
    ]);
    room.send({ type: 'presence-gone' });
    expect(room.scene).toEqual({ kind: 'waiting' });
  });

  it('dismisses the problem early on any select or the B button', () => {
    for (const event of [
      { type: 'select', hold: 'short', target: 'elsewhere' },
      { type: 'select', hold: 'long', target: 'him' },
      { type: 'dismiss-button' },
    ] satisfies AppEvent[]) {
      const room = new Room().inConversation('greeting');
      room.send({ type: 'session-phase', phase: 'failed' });
      expect(types(room.send(event))).toEqual(['hologram', 'hide-panel', 'arm-wake']);
      expect(room.scene).toEqual({ kind: 'leaving', afterwards: 'wait' });
    }
  });

  it('ignores the wake word and later phases while the problem is up', () => {
    const room = new Room().inConversation('greeting');
    room.send({ type: 'session-phase', phase: 'failed' });
    const before = room.model;
    expect(room.send({ type: 'wake' })).toEqual([]);
    expect(room.send({ type: 'session-phase', phase: 'ended' })).toEqual([]);
    expect(room.send({ type: 'problem', message: 'Another one.' })).toEqual([]);
    expect(room.model).toBe(before);
  });

  it('forgets a problem that no failure followed', () => {
    const room = new Room().inConversation('live');
    room.send({ type: 'problem', message: 'Stale.' });
    room.send({ type: 'dismiss-button' });
    expect(room.model.pendingProblem).toBeUndefined();
  });
});

describe('the wake engine', () => {
  it('shows a status line with the fix whenever it is not listening, and only while waiting', () => {
    const room = new Room();
    room.send({ type: 'entered', mode: 'conversation' });
    const effects = room.send({
      type: 'wake-health',
      readiness: { kind: 'not-listening', problem: 'The microphone stopped. Pinch to wake me.' },
    });
    expect(effects).toEqual([
      { type: 'hide-panel', panel: 'hint' },
      {
        type: 'show-panel',
        panel: 'status',
        lines: [NOT_LISTENING_LINE, 'The microphone stopped. Pinch to wake me.'],
      },
    ]);
    // A select still summons him: the engine being deaf is no reason to refuse the other way in.
    room.send({ type: 'select', hold: 'short', target: 'elsewhere' });
    expect(room.view.panels.status).toBeNull();
  });

  it('updates the status line when the problem changes', () => {
    const room = new Room({ kind: 'not-listening', problem: 'First.' });
    room.send({ type: 'entered', mode: 'conversation' });
    expect(room.send({ type: 'wake-health', readiness: { kind: 'not-listening', problem: 'Second.' } })).toEqual([
      { type: 'show-panel', panel: 'status', lines: [NOT_LISTENING_LINE, 'Second.'] },
    ]);
  });
});

describe('the headset looking away', () => {
  it('keeps the call while blurred, but ignores the wake word, selects and the B button', () => {
    const room = new Room().inConversation();
    expect(room.send({ type: 'visibility', state: 'visible-blurred' })).toEqual([
      { type: 'hide-panel', panel: 'keyboard' },
    ]);
    expect(room.send({ type: 'select', hold: 'long', target: 'elsewhere' })).toEqual([]);
    expect(room.send({ type: 'dismiss-button' })).toEqual([]);
    expect(room.scene).toEqual({ kind: 'present', sessionPhase: 'live' });
  });

  it('disarms the wake word while blurred, and ignores it if it fires anyway', () => {
    const room = new Room();
    room.send({ type: 'entered', mode: 'conversation' });
    expect(room.send({ type: 'visibility', state: 'visible-blurred' })).toEqual([
      { type: 'hide-panel', panel: 'hint' },
      { type: 'disarm-wake' },
    ]);
    expect(room.send({ type: 'wake' })).toEqual([]);
    expect(room.scene).toEqual({ kind: 'waiting' });
  });

  it('ends the call quietly after a minute blurred', () => {
    const room = new Room().inConversation();
    room.send({ type: 'visibility', state: 'visible-blurred' });
    expect(room.after(BLURRED_CALL_LIMIT_MS - 1)).toEqual([]);
    expect(room.after(1)).toEqual([{ type: 'end-quietly' }, { type: 'hologram', state: 'leaving' }]);
    expect(room.scene).toEqual({ kind: 'leaving', afterwards: 'wait' });
    expect(room.after(BLURRED_CALL_LIMIT_MS)).toEqual([]);
  });

  it('does not count the time the system keyboard is up against the call', () => {
    const room = new Room().inConversation('live', true);
    room.send({ type: 'select', hold: 'short', target: 'keyboard' });
    room.send({ type: 'visibility', state: 'visible-blurred' });
    expect(room.after(BLURRED_CALL_LIMIT_MS * 3)).toEqual([]);
    // The keyboard goes down but the room stays blurred: that is counted, from now.
    room.send({ type: 'keyboard-closed' });
    expect(room.after(BLURRED_CALL_LIMIT_MS - 1)).toEqual([]);
    expect(types(room.after(1))).toContain('end-quietly');
  });

  it('starts the minute again after coming back', () => {
    const room = new Room().inConversation();
    room.send({ type: 'visibility', state: 'visible-blurred' });
    room.after(BLURRED_CALL_LIMIT_MS - 1000, { type: 'visibility', state: 'visible' });
    room.send({ type: 'visibility', state: 'visible-blurred' });
    expect(room.after(BLURRED_CALL_LIMIT_MS - 1)).toEqual([]);
  });

  it('ends the call quietly and disarms when hidden, and he is simply gone', () => {
    const room = new Room().inConversation();
    const effects = room.send({ type: 'visibility', state: 'hidden' });
    expect(room.scene).toEqual({ kind: 'waiting' });
    expect(effects).toEqual([
      { type: 'end-quietly' },
      { type: 'hologram', state: 'hidden' },
      { type: 'hide-panel', panel: 'keyboard' },
      { type: 'set-frame-rate', target: 'lowest' },
    ]);
    expect(room.view.wakeArmed).toBe(false);
  });

  it('takes down an error panel when hidden, without ending anything twice', () => {
    const room = new Room().inConversation('greeting');
    room.send({ type: 'session-phase', phase: 'failed' });
    expect(types(room.send({ type: 'visibility', state: 'hidden' }))).not.toContain('end-quietly');
    expect(room.scene).toEqual({ kind: 'waiting' });
  });

  it('checks the wake engine before arming again on coming back', () => {
    const room = new Room();
    room.send({ type: 'entered', mode: 'conversation' });
    room.send({ type: 'visibility', state: 'hidden' });
    expect(room.send({ type: 'visibility', state: 'visible' })).toEqual([{ type: 'check-wake' }]);
    expect(room.send({ type: 'wake' })).toEqual([]);
    expect(room.send({ type: 'wake-health', readiness: LISTENING })).toEqual([
      { type: 'show-panel', panel: 'hint', lines: HINT_LINES },
      { type: 'arm-wake' },
    ]);
  });

  it('checks the wake engine after a blur as well', () => {
    const room = new Room();
    room.send({ type: 'entered', mode: 'conversation' });
    room.send({ type: 'visibility', state: 'visible-blurred' });
    expect(room.send({ type: 'visibility', state: 'visible' })).toEqual([{ type: 'check-wake' }]);
  });

  it('has nothing to check when there is no wake engine', () => {
    const room = new Room({ kind: 'absent' });
    room.send({ type: 'entered', mode: 'conversation' });
    room.send({ type: 'visibility', state: 'hidden' });
    expect(room.send({ type: 'visibility', state: 'visible' })).toEqual([]);
  });

  it('ignores a visibility state it is already in', () => {
    const room = new Room();
    room.send({ type: 'entered', mode: 'conversation' });
    const before = room.model;
    expect(room.send({ type: 'visibility', state: 'visible' })).toEqual([]);
    expect(room.model).toEqual(before);
  });
});

describe('the session ending', () => {
  it('hangs up, stops the microphone and puts the page back', () => {
    const room = new Room().inConversation();
    const effects = room.send({ type: 'session-ended' });
    expect(room.scene).toEqual({ kind: 'outside' });
    expect(effects).toEqual([
      { type: 'hang-up' },
      { type: 'stop-microphone' },
      { type: 'return-to-page' },
      { type: 'hologram', state: 'hidden' },
      { type: 'hide-panel', panel: 'keyboard' },
    ]);
  });

  it('puts the keyboard away if it was up', () => {
    const room = new Room().inConversation('live', true);
    room.send({ type: 'select', hold: 'short', target: 'keyboard' });
    expect(types(room.send({ type: 'session-ended' }))).toEqual([
      'hang-up',
      'stop-microphone',
      'return-to-page',
      'close-keyboard',
      'set-typing',
      'hologram',
    ]);
  });

  it('only stops the microphone when there was no call', () => {
    const room = new Room();
    room.send({ type: 'entered', mode: 'conversation' });
    expect(room.send({ type: 'session-ended' })).toEqual([
      { type: 'stop-microphone' },
      { type: 'return-to-page' },
      { type: 'hide-panel', panel: 'hint' },
      { type: 'disarm-wake' },
    ]);
  });

  it('abandons a summon still looking for a spot', () => {
    const room = new Room();
    room.send({ type: 'entered', mode: 'conversation' });
    room.send({ type: 'wake' });
    expect(types(room.send({ type: 'session-ended' }))).toEqual(['hang-up', 'stop-microphone', 'return-to-page']);
  });

  it('forgets being blurred, so the next session starts in view', () => {
    const room = new Room();
    room.send({ type: 'entered', mode: 'conversation' });
    room.send({ type: 'visibility', state: 'visible-blurred' });
    room.send({ type: 'session-ended' });
    expect(room.model.visibility).toBe('visible');
    expect(room.model.blurredSince).toBeUndefined();
  });
});

describe('typing to him', () => {
  it('offers the keyboard only while live, in view, and on a headset that can show it', () => {
    expect(new Room().inConversation('live', true).view.panels.keyboard).toEqual([]);
    expect(new Room().inConversation('greeting', true).view.panels.keyboard).toBeNull();
    expect(new Room().inConversation('live', false).view.panels.keyboard).toBeNull();
  });

  it('opens the keyboard on a select on its glyph, mutes the microphone, and sends each line', () => {
    const room = new Room().inConversation('live', true);
    expect(room.send({ type: 'select', hold: 'short', target: 'keyboard' })).toEqual([
      { type: 'open-keyboard' },
      { type: 'set-typing', typing: true },
      { type: 'hide-panel', panel: 'keyboard' },
    ]);
    expect(room.send({ type: 'typed', text: '  What is the weather like?  ' })).toEqual([
      { type: 'send-text', text: 'What is the weather like?' },
    ]);
    expect(room.send({ type: 'typed', text: '   ' })).toEqual([]);
    expect(room.send({ type: 'keyboard-closed' })).toEqual([
      { type: 'set-typing', typing: false },
      { type: 'show-panel', panel: 'keyboard', lines: [] },
    ]);
    expect(room.send({ type: 'keyboard-closed' })).toEqual([]);
  });

  it('ignores the glyph when the headset cannot show a keyboard, and typing when not live', () => {
    const room = new Room().inConversation('live', false);
    expect(room.send({ type: 'select', hold: 'short', target: 'keyboard' })).toEqual([]);
    const greeting = new Room().inConversation('greeting', true);
    expect(greeting.send({ type: 'select', hold: 'short', target: 'keyboard' })).toEqual([]);
    expect(greeting.send({ type: 'typed', text: 'Hello' })).toEqual([]);
  });

  it('puts the keyboard away when the conversation stops being live', () => {
    const room = new Room().inConversation('live', true);
    room.send({ type: 'select', hold: 'short', target: 'keyboard' });
    const effects = room.send({ type: 'session-phase', phase: 'ended' });
    expect(types(effects).slice(0, 2)).toEqual(['close-keyboard', 'set-typing']);
    expect(room.model.keyboardOpen).toBe(false);
  });
});

describe('captions', () => {
  it('shows his written line while he is present, and forgets it when he goes', () => {
    const room = new Room().inConversation();
    expect(room.send({ type: 'caption', text: 'Good evening, sir.' })).toEqual([
      { type: 'show-panel', panel: 'caption', lines: ['Good evening, sir.'] },
    ]);
    expect(room.send({ type: 'caption', text: undefined })).toEqual([{ type: 'hide-panel', panel: 'caption' }]);
    room.send({ type: 'caption', text: 'Goodbye.' });
    expect(types(room.send({ type: 'dismiss-button' }))).toContain('hide-panel');
    expect(room.model.caption).toBeUndefined();
  });

  it('ignores a caption when he is not there', () => {
    const room = new Room();
    room.send({ type: 'entered', mode: 'conversation' });
    expect(room.send({ type: 'caption', text: 'Late.' })).toEqual([]);
  });
});

describe('sample mode', () => {
  it('places him at once and starts on the first mood, with the frame-rate readout', () => {
    const room = new Room();
    expect(room.send({ type: 'entered', mode: 'sample' })).toEqual([
      { type: 'place', towards: undefined },
      { type: 'set-frame-rate', target: 'highest' },
    ]);
    expect(room.send({ type: 'placed' })).toEqual([
      { type: 'arrive' },
      { type: 'start-sample', mode: 'speaking' },
      { type: 'hologram', state: 'shown' },
      { type: 'show-panel', panel: 'readout', lines: [] },
    ]);
    expect(room.scene).toEqual({ kind: 'sample', mode: 'speaking' });
  });

  it('walks every mood on selects on him, naming each for a moment, and wraps round', () => {
    const room = new Room().inSample();
    const seen = [];
    for (let step = 0; step < SAMPLE_MODES.length; step += 1) {
      const effects = room.send({ type: 'select', hold: 'short', target: 'him' });
      const scene = room.scene;
      if (scene.kind !== 'sample') throw new Error('Left sample mode.');
      seen.push(scene.mode);
      expect(effects).toEqual([
        { type: 'cycle-sample', mode: scene.mode },
        { type: 'show-panel', panel: 'toast', lines: [SAMPLE_MODE_NAMES[scene.mode]] },
      ]);
    }
    expect(seen).toEqual([...SAMPLE_MODES.slice(1), SAMPLE_MODES[0]]);
  });

  it('takes the mood name down again', () => {
    const room = new Room().inSample();
    room.send({ type: 'select', hold: 'short', target: 'him' });
    expect(room.after(TOAST_MS - 1)).toEqual([]);
    expect(room.after(1)).toEqual([{ type: 'hide-panel', panel: 'toast' }]);
  });

  it('leaves and closes the room on a select anywhere else, a held select or the B button', () => {
    for (const event of [
      { type: 'select', hold: 'short', target: 'elsewhere' },
      { type: 'select', hold: 'long', target: 'him' },
      { type: 'dismiss-button' },
    ] satisfies AppEvent[]) {
      const room = new Room().inSample();
      expect(room.send(event)).toEqual([
        { type: 'hologram', state: 'leaving' },
        { type: 'hide-panel', panel: 'readout' },
      ]);
      expect(room.send({ type: 'select', hold: 'short', target: 'him' })).toEqual([]);
      expect(room.send({ type: 'presence-gone' })).toEqual([
        { type: 'stop-sample' },
        { type: 'exit-xr' },
        { type: 'hologram', state: 'hidden' },
      ]);
      expect(room.send({ type: 'session-ended' })).toEqual([{ type: 'return-to-page' }]);
    }
  });

  it('stops the sample when the session ends under it', () => {
    const room = new Room().inSample();
    expect(types(room.send({ type: 'session-ended' }))).toEqual([
      'stop-sample',
      'return-to-page',
      'hologram',
      'hide-panel',
    ]);
  });

  it('never listens: no wake word, no microphone, no health check', () => {
    const room = new Room().inSample();
    expect(room.send({ type: 'wake' })).toEqual([]);
    expect(room.view.wakeArmed).toBe(false);
    room.send({ type: 'visibility', state: 'hidden' });
    expect(room.scene).toEqual({ kind: 'sample', mode: 'speaking' });
    expect(room.send({ type: 'visibility', state: 'visible' })).toEqual([]);
  });
});

describe('outside the room', () => {
  it('ignores everything but entering', () => {
    const room = new Room();
    const before = room.model;
    for (const event of [
      { type: 'wake' },
      { type: 'select', hold: 'short', target: 'elsewhere' },
      { type: 'dismiss-button' },
      { type: 'placed' },
      { type: 'session-phase', phase: 'live' },
      { type: 'presence-gone' },
      { type: 'tick' },
      { type: 'typed', text: 'Hello' },
    ] satisfies AppEvent[]) {
      expect(room.send(event)).toEqual([]);
    }
    expect(room.model).toEqual(before);
  });
});
