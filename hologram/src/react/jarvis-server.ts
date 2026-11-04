import { useEffect, useState } from 'react';
import { connectToServer, type JarvisDevice, type ServerLink } from '../jarvis-server-link';

/**
 * Keeps the app's line to the Jarvis server open for as long as the component holding it is mounted
 * and the app has a server address: across conversations and between them (see
 * `jarvis-server-link.ts`), with the token the device was paired with (`paired-device.ts`) in its
 * hello. A new address or token closes the old line and opens a new one; no address closes it.
 *
 * Returns the line while it is open, for whatever wants to hear the server: the phone hands it to
 * `useAgentSatellites`, to show which of his agents are at work. The watch only holds it open.
 */
export function useJarvisServer(
  address: string | undefined,
  device: JarvisDevice,
  deviceToken: string | undefined,
): ServerLink | undefined {
  const [line, setLine] = useState<ServerLink | undefined>(undefined);
  useEffect(() => {
    const link = connectToServer({ address, device, deviceToken });
    setLine(link);
    return () => {
      setLine(undefined);
      link.close();
    };
  }, [address, device, deviceToken]);
  return line;
}
