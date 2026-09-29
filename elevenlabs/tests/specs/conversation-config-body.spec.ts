import { describe, expect, it } from 'bun:test';
import type { ConversationalConfig } from '@elevenlabs/elevenlabs-js/api';
import agentConfig from '../../src/assets/agent-config.json';
import { toConversationConfigBody } from '../../src/main.js';

describe('toConversationConfigBody', () => {
  it('should send the TTS model even when the SDK does not know it yet', () => {
    const body = toConversationConfigBody({ tts: { modelId: 'eleven_v4_turbo' } } as ConversationalConfig);

    expect(body).toEqual({ tts: { model_id: 'eleven_v4_turbo' } });
  });

  it('should serialize keys to the snake_case the API expects', () => {
    const body = toConversationConfigBody({
      turn: { turnTimeout: 3, silenceEndCallTimeout: 30 },
    } as ConversationalConfig);

    expect(body).toEqual({ turn: { turn_timeout: 3, silence_end_call_timeout: 30 } });
  });

  it('should serialize the committed agent config with its TTS model intact', () => {
    const body = toConversationConfigBody(agentConfig.conversationConfig as ConversationalConfig) as {
      tts: { model_id: string };
    };

    expect(body.tts.model_id).toBe(agentConfig.conversationConfig.tts.modelId);
  });
});
