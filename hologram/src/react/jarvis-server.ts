import { useEffect, useState } from 'react';
import type { JarvisServerServiceToken } from '../jarvis-server-address';
import { connectToServer, type JarvisDevice, type ServerLink } from '../jarvis-server-link';

/**
 * Keeps the app's line to the Jarvis server open for as long as the component holding it is mounted
 * and the app has a server address: across conversations and between them (see
 * `jarvis-server-link.ts`), with the service token the Cloudflare Zero Trust application in front
 * of it accepts, when there is one. A new address or service token closes the old line and opens a
 * new one; no address closes it. The token is compared by its two values, not by identity, so a
 * caller handing over an equal one on every render keeps the line it has.
 *
 * Returns the line while it is open, for whatever wants to hear the server: the phone hands it to
 * `useAgentSatellites`, to show which of his agents are at work. The watch only holds it open.
 */
export function useJarvisServer(
  address: string | undefined,
  serviceToken: JarvisServerServiceToken | undefined,
  device: JarvisDevice,
  /** The token the browser was paired with, when it is (`paired-device.ts`): the line then needs no Access. */
  deviceToken?: string,
): ServerLink | undefined {
  const [line, setLine] = useState<ServerLink | undefined>(undefined);
  const clientId = serviceToken?.clientId;
  const clientSecret = serviceToken?.clientSecret;
  useEffect(() => {
    const link = connectToServer({
      address,
      serviceToken: clientId !== undefined && clientSecret !== undefined ? { clientId, clientSecret } : undefined,
      device,
      deviceToken,
    });
    setLine(link);
    return () => {
      setLine(undefined);
      link.close();
    };
  }, [address, clientId, clientSecret, device, deviceToken]);
  return line;
}
