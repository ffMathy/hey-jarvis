import { describe, expect, it } from 'bun:test';
import type { ConversationalConfig } from '@elevenlabs/elevenlabs-js/api';
import { readAgentConfig } from '../../src/agent-assets';
import { toConversationConfigBody } from '../../src/main.js';

const agentConfig = await readAgentConfig();

describe('toConversationConfigBody', () => {
  it('should send the TTS model even when the SDK does not know it yet', () => {
    // Typed as a plain string, as it arrives from agent-config.json: the SDK's own
    // TtsConversationalModel union does not list the model yet.
    const modelId: string = 'eleven_v4_turbo';
    const body = toConversationConfigBody({ tts: { modelId } } as ConversationalConfig);

    expect(body).toEqual({ tts: { model_id: 'eleven_v4_turbo' } });
  });

  it('should serialize keys to the snake_case the API expects', () => {
    const body = toConversationConfigBody({
      turn: { turnTimeout: 3, silenceEndCallTimeout: 30 },
    } as ConversationalConfig);

    expect(body).toEqual({ turn: { turn_timeout: 3, silence_end_call_timeout: 30 } });
  });

  it('should send the Realtime model even though the SDK has no field for it', () => {
    // Saved by `fetch` under the API's own snake_case name, as every key the SDK does not know is.
    const body = toConversationConfigBody({
      realtime_model: 'eleven_realtime_v1_max',
      turn: { turnTimeout: 3 },
    } as ConversationalConfig);

    expect(body).toEqual({ realtime_model: 'eleven_realtime_v1_max', turn: { turn_timeout: 3 } });
  });

  it('should send a null Realtime model, which puts the agent back in Custom mode', () => {
    const body = toConversationConfigBody({ realtime_model: null } as ConversationalConfig);

    expect(body).toEqual({ realtime_model: null });
  });

  it('should send the Realtime model the committed agent config names', () => {
    const { conversationConfig } = agentConfig;
    if (!conversationConfig || !('realtime_model' in conversationConfig)) {
      throw new Error('The committed agent config names no Realtime model');
    }
    const body = toConversationConfigBody(conversationConfig) as { realtime_model: unknown };

    expect(body.realtime_model).toBe('eleven_realtime_v1_max');
  });

  it('should serialize the committed agent config with its TTS model intact', () => {
    const { conversationConfig } = agentConfig;
    const modelId = conversationConfig?.tts?.modelId;
    if (!conversationConfig || !modelId) {
      throw new Error('The committed agent config names no TTS model');
    }
    const body = toConversationConfigBody(conversationConfig) as {
      tts: { model_id: string };
    };

    expect(body.tts.model_id).toBe(modelId);
  });
});
