import { type ConversationCredentials, pairedCredentials } from 'hologram';

/**
 * Where each conversation's credential comes from: the Jarvis server this device is paired with,
 * which holds the ElevenLabs key and asks ElevenLabs on the device's behalf (`paired-device.ts` in
 * `hologram`). Pairing is the only way in, so with no address, or no token from the server at it,
 * there is no conversation to have, and the app is not set up.
 */
export function conversationCredentialsOf(
  serverAddress: string | undefined,
  deviceToken: string | undefined,
): ConversationCredentials | undefined {
  return serverAddress === undefined || deviceToken === undefined
    ? undefined
    : pairedCredentials({ address: serverAddress, deviceToken });
}
