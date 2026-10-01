import { useEffect } from 'react';
import { connectToServer, type JarvisDevice } from '../jarvis-server-link';

/**
 * Keeps the app's line to the Jarvis server open for as long as the component holding it is mounted
 * and the app has a server address: across conversations and between them (see
 * `jarvis-server-link.ts`). A new address closes the old line and opens a new one; none closes it.
 *
 * For the phone and the watch, which point at nothing and show nothing of what a request touches,
 * so nothing is read from the line: holding it open is the whole of their part.
 */
export function useJarvisServer(address: string | undefined, device: JarvisDevice): void {
  useEffect(() => {
    const link = connectToServer({ address, device });
    return link.close;
  }, [address, device]);
}
