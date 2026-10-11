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
