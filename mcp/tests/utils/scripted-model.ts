import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';

/**
 * A language model that plays a script instead of calling a provider.
 *
 * For specs that need an agent to behave a particular way — call a tool, answer in JSON, say
 * something — without credentials or a network. The script sees what the model was sent, so a
 * turn can depend on the conversation so far, which is how an interviewer "hears" an answer.
 */

/** One reply: text, tool calls, or both. */
export interface ScriptedTurn {
  text?: string;
  toolCalls?: { toolName: string; input: unknown }[];
}

/** Everything the model was sent on one call, flattened to text the script can search. */
export interface ScriptedCall {
  /** Which call this is, counting from 1. */
  index: number;
  /** Every message's text, tool calls and tool results, in order. */
  transcript: string;
  options: LanguageModelV3CallOptions;
}

/** A provider's token accounting, which nothing here looks at but the stream shape requires. */
const usage: LanguageModelV3Usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function transcriptOf(options: LanguageModelV3CallOptions): string {
  return options.prompt
    .map((message) => {
      if (typeof message.content === 'string') {
        return `${message.role}: ${message.content}`;
      }

      // Text as text, so a script can match what was said; anything else as JSON.
      const parts = message.content.map((part) => (part.type === 'text' ? part.text : JSON.stringify(part)));
      return `${message.role}: ${parts.join('\n')}`;
    })
    .join('\n');
}

function toolCallsOf(turn: ScriptedTurn, index: number) {
  return (turn.toolCalls ?? []).map((toolCall, toolCallIndex) => ({
    type: 'tool-call' as const,
    toolCallId: `call-${index}-${toolCallIndex}`,
    toolName: toolCall.toolName,
    input: JSON.stringify(toolCall.input),
  }));
}

function finishReasonOf(turn: ScriptedTurn) {
  return (turn.toolCalls ?? []).length > 0
    ? { unified: 'tool-calls' as const, raw: 'tool-calls' }
    : { unified: 'stop' as const, raw: 'stop' };
}

function partsOf(turn: ScriptedTurn, index: number): LanguageModelV3StreamPart[] {
  const parts: LanguageModelV3StreamPart[] = [{ type: 'stream-start', warnings: [] }];

  if (turn.text !== undefined) {
    const id = `text-${index}`;
    parts.push({ type: 'text-start', id }, { type: 'text-delta', id, delta: turn.text }, { type: 'text-end', id });
  }

  parts.push(...toolCallsOf(turn, index), { type: 'finish', finishReason: finishReasonOf(turn), usage });
  return parts;
}

/**
 * Builds a model that answers each call with whatever `respond` returns for it.
 *
 * `calls` records every call, so a spec can assert how often the model was asked and what it
 * was shown.
 */
export function createScriptedModel(respond: (call: ScriptedCall) => ScriptedTurn) {
  const calls: ScriptedCall[] = [];

  const record = (options: LanguageModelV3CallOptions) => {
    const call = { index: calls.length + 1, transcript: transcriptOf(options), options };
    calls.push(call);
    return { call, turn: respond(call) };
  };

  // `stream()` asks for a stream, and `generate()` -- which the routing planner uses -- asks for
  // the whole reply at once. A turn is written the same way for both.
  const doStream = async (options: LanguageModelV3CallOptions) => {
    const { call, turn } = record(options);
    const parts = partsOf(turn, call.index);
    return {
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          for (const part of parts) {
            controller.enqueue(part);
          }
          controller.close();
        },
      }),
    };
  };

  const doGenerate = async (options: LanguageModelV3CallOptions) => {
    const { call, turn } = record(options);
    return {
      content: [
        ...(turn.text !== undefined ? [{ type: 'text' as const, text: turn.text }] : []),
        ...toolCallsOf(turn, call.index),
      ],
      finishReason: finishReasonOf(turn),
      usage,
      warnings: [],
    };
  };

  const model = {
    specificationVersion: 'v3',
    provider: 'scripted',
    modelId: 'scripted',
    supportedUrls: {},
    doStream,
    doGenerate,
  } satisfies LanguageModelV3;

  return { model, calls };
}
