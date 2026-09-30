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

  // Agent IDs are letters, digits and underscores (a hyphen is let through, to
  // be safe). Anything else is a paste of
  // the wrong thing — the agent's dashboard URL, or a whole `NAME=value` line —
  // which ElevenLabs would only reject later, less helpfully.
  if (!/^[A-Za-z0-9_-]+$/.test(agentId)) {
    return 'The agent ID should be just the ID, like agent_01jz…, not a link or a line from a file.';
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

/**
 * Where the ElevenLabs API key and agent ID are kept, in whatever key-value store the device has —
 * the Android keystore on a phone, `localStorage` in a browser.
 *
 * A new key rather than the one the earlier server settings used: what was kept under that one is
 * a different shape, and reading it as this one would only ever fail. An install that has it simply
 * opens on the settings screen.
 *
 * Here, with the reading and writing of what is stored under it, rather than in the phone app,
 * because more than one app reads the same store: the headset's page is published on the same
 * origin as the phone app's web build, so it sees the same `localStorage`. A key or a format kept
 * by one app alone is a rename away from the other quietly finding nothing.
 */
export const ELEVENLABS_SETTINGS_STORAGE_KEY = 'jarvis.elevenlabs-settings';

/**
 * Narrows what came back out of storage, which is only ever a string, to settings — or nothing,
 * when it is not the shape {@link serialiseElevenLabsSettings} writes.
 *
 * Text that is not JSON at all throws, as `JSON.parse` does, and what that means is the caller's to
 * decide.
 */
export function parseStoredElevenLabsSettings(stored: string): ElevenLabsSettings | undefined {
  const parsed: unknown = JSON.parse(stored);

  if (typeof parsed !== 'object' || parsed === null || !('apiKey' in parsed) || !('agentId' in parsed)) {
    return undefined;
  }

  const { apiKey, agentId } = parsed;
  if (typeof apiKey !== 'string' || !apiKey || typeof agentId !== 'string' || !agentId) {
    return undefined;
  }

  return { apiKey, agentId };
}

/** What is kept under {@link ELEVENLABS_SETTINGS_STORAGE_KEY}, for {@link parseStoredElevenLabsSettings} to read back. */
export function serialiseElevenLabsSettings(settings: ElevenLabsSettings): string {
  return JSON.stringify(settings);
}
