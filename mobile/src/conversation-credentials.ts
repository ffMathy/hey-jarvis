import {
  type ConversationCredentials,
  type ElevenLabsSettings,
  elevenLabsCredentials,
  pairedCredentials,
} from 'hologram';

/**
 * Where each conversation's token comes from: the Jarvis server, when this browser is paired with
 * the server it has the address of (`server-pairing.tsx`) — which wins over a saved key, since the
 * server holds the key it would otherwise be — else ElevenLabs with the saved key, else nothing yet,
 * and there is no conversation to have. Only the web build is ever paired.
 */
export function conversationCredentialsOf(
  serverAddress: string | undefined,
  deviceToken: string | undefined,
  settings: ElevenLabsSettings | undefined,
): ConversationCredentials | undefined {
  if (serverAddress !== undefined && deviceToken !== undefined) {
    return pairedCredentials({ address: serverAddress, deviceToken });
  }
  return settings === undefined ? undefined : elevenLabsCredentials(settings);
}
