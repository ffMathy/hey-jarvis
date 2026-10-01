import { createRoomWorkerHost } from './room-worker-host';
import { isRoomWorkerRequest } from './room-worker-protocol';

/**
 * The placement worker: builds the room's grid and answers placements, off the page's thread.
 * Started by `createRoomModelWorker`; everything it does is in `room-worker-host.ts`.
 */

const host = createRoomWorkerHost(
  (response) => self.postMessage(response),
  // A zero timeout hands the event loop back between slices, so questions that arrived during
  // one are answered before the next.
  (callback) => setTimeout(callback, 0),
);

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (isRoomWorkerRequest(event.data)) host.receive(event.data);
});
