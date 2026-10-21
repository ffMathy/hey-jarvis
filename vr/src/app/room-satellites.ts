import {
  type AgentActivity,
  type AgentWorkState,
  describeWork,
  NO_WORK,
  pretendWork,
  recordActivity,
  releaseWork,
  stepWork,
} from 'hologram';
import { createSatellites } from '../hologram3d/satellites';
import type { Vector3Like } from '../hologram3d/view-basis';
import { satelliteSpots } from '../satellites/satellite-spots';

/** One frame, as the satellites need it. */
export interface SatelliteFrame {
  /** Seconds on the XR frame's clock. */
  time: number;
  deltaSeconds: number;
  eye: { position: Vector3Like };
  /** Where he stands and how big he is, or `undefined` while he is not in the room. */
  him: { centre: Vector3Like; radius: number } | undefined;
  /** Sample mode's thinking, which has its pretend agents at work. */
  pretendWorking: boolean;
}

/** The room's satellites: what the server says of his agents, drawn round him every frame. */
export interface RoomSatellites {
  readonly object: ReturnType<typeof createSatellites>['object'];
  /** One `agentActivity` message: taken in on the next frame, on the frame's own clock. */
  activity(activity: AgentActivity): void;
  /** The conversation is over: every satellite still out folds in on the next frame. */
  conversationEnded(): void;
  update(frame: SatelliteFrame): void;
  /** Each satellite's agent and status, for the debug hook. */
  report(): { agentId: string; status: string }[];
  dispose(): void;
}

/**
 * Holds the satellites' state (`hologram`'s `agent-work.ts`) and draws it (`hologram3d/satellites.ts`).
 * Messages arrive between frames, on the page's clock; they are queued and taken in at the start of
 * the next frame, so every time in the state is the XR frame's. A message that arrives while he is
 * not in the room is still taken in — a request asked from the phone has satellites too, which show
 * if he is summoned while it runs — but nothing is drawn without him to circle.
 */
export function createRoomSatellites(): RoomSatellites {
  const satellites = createSatellites();
  let work: AgentWorkState = NO_WORK;
  let queued: (AgentActivity | 'ended')[] = [];

  return {
    object: satellites.object,
    activity(activity) {
      queued.push(activity);
    },
    conversationEnded() {
      queued.push('ended');
    },
    update({ time, deltaSeconds, eye, him, pretendWorking }) {
      for (const news of queued) work = news === 'ended' ? releaseWork(work, time) : recordActivity(work, news, time);
      queued = [];
      work = stepWork(pretendWork(work, pretendWorking, time), time);
      satellites.set(him === undefined ? [] : satelliteSpots(work, time, him.centre, him.radius));
      satellites.update(deltaSeconds, eye.position);
    },
    report: () => describeWork(work),
    dispose: () => satellites.dispose(),
  };
}
