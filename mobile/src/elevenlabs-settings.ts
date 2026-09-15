/**
 * What the app needs to talk to Jarvis: an ElevenLabs API key, and which agent
 * on that account is Jarvis.
 *
 * Neither is compiled into the app. Both are typed into the settings screen and
 * kept in the Android keystore (`key-value-store.ts`), so no copy of the bundle
 * carries a credential. The key goes to ElevenLabs and nowhere else: the app uses
 * it only to mint a short-lived token for one conversation
 * (`conversation-token.ts`), and the conversation itself runs on that token.
 *
 * A key on a phone is still a key on a phone. It is worth creating one for this
 * app alone, restricted to what a conversation needs, so that losing the phone
 * means revoking one key rather than every integration on the account.
 */
export interface ElevenLabsSettings {
  /** An ElevenLabs API key, sent as `xi-api-key`. */
  apiKey: string;
  /** The ID of the Jarvis agent — the value of `HEY_JARVIS_ELEVENLABS_AGENT_ID`. */
  agentId: string;
}

/** Says what is wrong with an API key, or nothing if it is usable. */
export function describeApiKeyProblem(rawApiKey: string): string | undefined {
  const apiKey = rawApiKey.trim();

  if (!apiKey) {
    return 'Enter your ElevenLabs API key.';
  }

  // A key never contains whitespace, and one that does is almost always two
  // pastes, or a key with the label it was copied next to — which ElevenLabs
  // would reject later with a far less helpful message.
  if (/\s/.test(apiKey)) {
    return 'The API key has a space in it. Paste just the key.';
  }

  return undefined;
}

/** Says what is wrong with an agent ID, or nothing if it is usable. */
export function describeAgentIdProblem(rawAgentId: string): string | undefined {
  const agentId = rawAgentId.trim();

  if (!agentId) {
    return 'Enter the ID of the Jarvis agent.';
  }

  if (/\s/.test(agentId)) {
    return 'The agent ID has a space in it. Paste just the ID.';
  }

  return undefined;
}

/**
 * Turns what was typed into settings the rest of the app can rely on, or
 * explains why it cannot. Surrounding whitespace is forgiven, since pasting
 * picks it up; anything else wrong is reported rather than guessed at.
 */
export function parseElevenLabsSettings(
  rawApiKey: string,
  rawAgentId: string,
): { settings: ElevenLabsSettings } | { problem: string } {
  const problem = describeApiKeyProblem(rawApiKey) ?? describeAgentIdProblem(rawAgentId);
  if (problem) {
    return { problem };
  }

  return { settings: { apiKey: rawApiKey.trim(), agentId: rawAgentId.trim() } };
}
