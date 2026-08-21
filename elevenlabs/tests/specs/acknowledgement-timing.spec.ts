import { describe, expect, it } from 'bun:test';
import {
  classifyAcknowledgementTiming,
  findLookupPromisesBeforeRouting,
  stripAudioTags,
} from '../utils/acknowledgement-timing.js';
import type { ServerMessage } from '../utils/conversation-strategy.js';

const said = (text: string): ServerMessage =>
  ({ type: 'agent_response', agent_response_event: { agent_response: text } }) as ServerMessage;
const asked = (text: string): ServerMessage => ({ type: 'user_message', text }) as ServerMessage;
const called = (toolName: string): ServerMessage =>
  ({
    type: 'mcp_tool_call',
    mcp_tool_call: { tool_name: toolName, tool_call_id: 'call-1', state: 'loading', result: [] },
  }) as unknown as ServerMessage;

/**
 * Offline coverage for the two rules the live evals lean on: the user must hear
 * something before the results land, and he must not be told twice that he is being
 * attended to. Needs no credentials, so it holds the line on every push.
 */
describe('classifyAcknowledgementTiming', () => {
  it('accepts the acknowledgement arriving after routing, which is where it comes from', () => {
    // The routing tool supplies "I'm on it" in its own instructions, so it lands
    // after the first tool call. That is the design, not a failure.
    const timing = classifyAcknowledgementTiming([
      said('Hello sir, how can I help?'),
      asked('Could you check my calendar?'),
      called('routePromptWorkflow'),
      said("I'm on it, sir."),
      said('Your sole engagement is a birthday, sir.'),
    ]);

    expect(timing.kind).toBe('acknowledged');
    expect(timing).toHaveProperty('acknowledgement', "I'm on it, sir.");
  });

  it('accepts an answer-what-you-can remark before routing', () => {
    const timing = classifyAcknowledgementTiming([
      asked('Hey, Charles, could you check my calendar?'),
      said("[amused] I'm not Charles, sir. I'm Jarvis."),
      called('routePromptWorkflow'),
      said('A birthday, sir.'),
    ]);

    expect(timing.kind).toBe('acknowledged');
  });

  it('catches the agent saying nothing until the whole lookup finished', () => {
    const timing = classifyAcknowledgementTiming([
      asked('Could you check my calendar for today?'),
      called('routePromptWorkflow'),
      said('[dry] Naturally, sir. Your sole engagement today is a birthday.'),
    ]);

    expect(timing.kind).toBe('silent');
  });

  it('treats a reply of nothing but audio tags as silence', () => {
    const timing = classifyAcknowledgementTiming([
      asked('Check my calendar.'),
      called('routePromptWorkflow'),
      said('[sighs] [dry]'),
      said('A birthday, sir.'),
    ]);

    expect(timing.kind).toBe('silent');
  });

  it('ignores the greeting, which was said before the user asked for anything', () => {
    const timing = classifyAcknowledgementTiming([
      said('Hello sir, how can I help?'),
      asked('Check my calendar.'),
      called('routePromptWorkflow'),
      said('A birthday, sir.'),
    ]);

    expect(timing.kind).toBe('silent');
  });

  it('stands down when nothing was routed', () => {
    const timing = classifyAcknowledgementTiming([asked('What is your name?'), said('I am Jarvis, sir.')]);

    expect(timing.kind).toBe('no-tool-call');
  });

  it('stands down when the user never spoke', () => {
    expect(classifyAcknowledgementTiming([said('Hello sir, how can I help?')]).kind).toBe('no-request');
  });
});

describe('findLookupPromisesBeforeRouting', () => {
  it('catches the half of the duplicate that Jarvis says himself', () => {
    // The reported transcript: Jarvis announced the lookup, then the routing tool's
    // instructions had him announce it again.
    const promises = findLookupPromisesBeforeRouting([
      asked('Hey, Charles, could you check my calendar?'),
      said("[amused] I'm not Charles, sir. I'm Jarvis. [dry] Let me check your calendar."),
      called('routePromptWorkflow'),
      said("I'm on it, sir."),
    ]);

    expect(promises).toHaveLength(1);
    expect(promises[0]).toContain('Let me check your calendar');
  });

  const announcements = [
    'Let me see what trivial engagements await you.',
    'Allow me to consult your calendar, sir.',
    "I'll take a look, sir.",
    'One moment, sir.',
    "I'm on it, sir.",
    'Let me check on those blinds and lights for you, sir.',
  ];

  for (const announcement of announcements) {
    it(`flags ${JSON.stringify(announcement.slice(0, 45))}`, () => {
      expect(findLookupPromisesBeforeRouting([asked('Check it'), said(announcement), called('x')])).toHaveLength(1);
    });
  }

  const allowed = [
    "[amused] I'm not Charles, sir. I'm Jarvis.",
    '[dry] Naturally, sir.',
    'It is 21:53, sir. [dry] Riveting.',
    '[sighs] Another matter requiring my attention.',
  ];

  for (const remark of allowed) {
    it(`leaves ${JSON.stringify(remark.slice(0, 45))} alone`, () => {
      expect(findLookupPromisesBeforeRouting([asked('Check it'), said(remark), called('x')])).toEqual([]);
    });
  }

  it('says nothing about the line the tool itself asked for, after routing', () => {
    // Identical words, opposite side of the call: this one the tool requested.
    const promises = findLookupPromisesBeforeRouting([
      asked('Check my calendar.'),
      called('routePromptWorkflow'),
      said("I'm on it, sir."),
    ]);

    expect(promises).toEqual([]);
  });
});

describe('stripAudioTags', () => {
  it('keeps the words and drops the delivery notes', () => {
    expect(stripAudioTags('[sighs] [dry] Naturally, sir.')).toBe('Naturally, sir.');
  });

  it('empties a reply that was only tags', () => {
    expect(stripAudioTags('[sighs] [theatrically exasperated]')).toBe('');
  });

  it('leaves plain speech alone', () => {
    expect(stripAudioTags('Naturally, sir.')).toBe('Naturally, sir.');
  });
});
