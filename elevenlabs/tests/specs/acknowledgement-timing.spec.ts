import { describe, expect, it } from 'bun:test';
import { classifyAcknowledgementTiming, stripAudioTags } from '../utils/acknowledgement-timing.js';
import type { ServerMessage } from '../utils/conversation-strategy.js';

const greeting = (text: string): ServerMessage =>
  ({ type: 'agent_response', agent_response_event: { agent_response: text } }) as ServerMessage;
const said = greeting;
const asked = (text: string): ServerMessage => ({ type: 'user_message', text }) as ServerMessage;
const called = (toolName: string): ServerMessage =>
  ({
    type: 'mcp_tool_call',
    mcp_tool_call: { tool_name: toolName, tool_call_id: 'call-1', state: 'loading', result: [] },
  }) as unknown as ServerMessage;

/**
 * Offline coverage for the ordering rule behind the live eval: the user must hear
 * something between asking and the tool call, because everything after that point
 * is a wait. Needs no credentials, so it holds the line on every push.
 */
describe('classifyAcknowledgementTiming', () => {
  it('accepts an acknowledgement spoken before the tool call', () => {
    const timing = classifyAcknowledgementTiming([
      greeting('Hello sir, how can I help?'),
      asked('Hey, Jarvis, could you check my calendar for today?'),
      said('[dry] Naturally, sir. Let me have a look.'),
      called('routePromptWorkflow'),
      said('Your sole engagement is a birthday, sir.'),
    ]);

    expect(timing.kind).toBe('spoke-first');
    expect(timing).toHaveProperty('acknowledgement', 'Naturally, sir. Let me have a look.');
  });

  it('catches the agent routing without a word', () => {
    // The reported transcript: one utterance, arriving only once everything was
    // done, with the acknowledgement glued to the front of the answer.
    const timing = classifyAcknowledgementTiming([
      greeting('Hello sir, how can I help?'),
      asked('Hey, Jarvis, could you check my calendar for today?'),
      called('routePromptWorkflow'),
      said('[dry] Naturally, sir. Your sole engagement today is celebrating a birthday.'),
    ]);

    expect(timing.kind).toBe('silent');
  });

  it('treats a reply of nothing but audio tags as silence', () => {
    const timing = classifyAcknowledgementTiming([
      asked('Check my calendar.'),
      said('[sighs] [dry]'),
      called('routePromptWorkflow'),
    ]);

    expect(timing.kind).toBe('silent');
  });

  it('ignores the greeting, which was said before the user asked for anything', () => {
    const timing = classifyAcknowledgementTiming([
      greeting('Hello sir, how can I help?'),
      asked('Check my calendar.'),
      called('routePromptWorkflow'),
    ]);

    expect(timing.kind).toBe('silent');
  });

  it('stands down when nothing was routed', () => {
    // Answering outright is a different rule's business, not this one's.
    const timing = classifyAcknowledgementTiming([asked('What is your name?'), said('I am Jarvis, sir.')]);

    expect(timing.kind).toBe('no-tool-call');
  });

  it('stands down when the user never spoke', () => {
    expect(classifyAcknowledgementTiming([greeting('Hello sir, how can I help?')]).kind).toBe('no-request');
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
