import { describe, expect, it } from 'bun:test';
import { HEADSET_PARTICIPANT_NAME } from 'hologram';
import {
  NO_LONGER_PAIRED_PROBLEM,
  PAIRED_CONVERSATION_PATH,
  pairedCredentials,
  SERVER_UNREACHABLE_PROBLEM,
} from './paired-credentials';

const PAIRING = { address: 'https://jarvis.example.com', deviceToken: 'p'.repeat(43) };

describe('a paired headset’s conversation credentials', () => {
  it('asks the server for a spoken conversation’s token with its own token', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const token = await pairedCredentials(PAIRING).token(HEADSET_PARTICIPANT_NAME, async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ success: true, data: { token: 'livekit-token' } });
    });

    expect(token).toBe('livekit-token');
    expect(requests).toEqual([
      {
        url: `https://jarvis.example.com${PAIRED_CONVERSATION_PATH}`,
        init: {
          method: 'POST',
          headers: { Authorization: `Bearer ${PAIRING.deviceToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ transport: 'webrtc', participantName: HEADSET_PARTICIPANT_NAME }),
        },
      },
    ]);
  });

  it('asks for a signed URL for a typed conversation, and takes only a wss:// one', async () => {
    const credentials = pairedCredentials(PAIRING);

    expect(
      await credentials.signedUrl(async () => Response.json({ data: { signedUrl: 'wss://example/signed' } })),
    ).toBe('wss://example/signed');
    await expect(
      credentials.signedUrl(async () => Response.json({ data: { signedUrl: 'ws://plain' } })),
    ).rejects.toThrow('not wss://');
  });

  it('says it is no longer paired when the server does not know its token', async () => {
    await expect(
      pairedCredentials(PAIRING).token(HEADSET_PARTICIPANT_NAME, async () => new Response('', { status: 401 })),
    ).rejects.toThrow(NO_LONGER_PAIRED_PROBLEM);
  });

  it('passes on the server’s own words for why there is no conversation', async () => {
    await expect(
      pairedCredentials(PAIRING).token(HEADSET_PARTICIPANT_NAME, async () =>
        Response.json(
          { success: false, message: 'ElevenLabs could not start a conversation (HTTP 402).' },
          { status: 502 },
        ),
      ),
    ).rejects.toThrow('ElevenLabs could not start a conversation (HTTP 402).');
  });

  it('says the server could not be reached when no answer came', async () => {
    await expect(
      pairedCredentials(PAIRING).token(HEADSET_PARTICIPANT_NAME, async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).rejects.toThrow(SERVER_UNREACHABLE_PROBLEM);
  });
});
